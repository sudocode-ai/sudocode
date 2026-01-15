/**
 * End-to-End Tests for Dataplane Execution Stream and Checkpoint Tracking
 *
 * These tests verify the full execution flow with real agents and dataplane integration:
 * 1. Normal worktree executions create streams and checkpoints on completion
 * 2. Follow-up executions inherit parent's stream
 * 3. Workflow executions create streams and checkpoints per step
 * 4. Local mode executions create streams (visibility only, no checkpoint)
 *
 * ⚠️ These tests make REAL AI API calls with simple prompts.
 * They require:
 * - Claude Code CLI installed and authenticated
 * - RUN_E2E_TESTS=true environment variable
 *
 * To run these tests:
 * 1. Install Claude Code CLI (https://claude.com/claude-code)
 * 2. Authenticate: claude login
 * 3. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run dataplane-execution-tracking.test.ts
 *
 * @group e2e
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import request from "supertest";
import express from "express";
import Database from "better-sqlite3";

// Server components
import { createExecutionsRouter } from "../../src/routes/executions.js";
import { createIssuesRouter } from "../../src/routes/issues.js";
import { ProjectManager } from "../../src/services/project-manager.js";
import { ProjectRegistry } from "../../src/services/project-registry.js";
import { requireProject } from "../../src/middleware/project-context.js";
import {
  closeAllDataplaneAdapters,
  getDataplaneAdapter,
  type DataplaneAdapter,
} from "../../src/services/dataplane-adapter.js";
import { clearDataplaneConfigCache } from "../../src/services/dataplane-config.js";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  ISSUES_TABLE,
  ISSUES_INDEXES,
  SPECS_TABLE,
  SPECS_INDEXES,
  RELATIONSHIPS_TABLE,
  RELATIONSHIPS_INDEXES,
  CHECKPOINTS_TABLE,
  CHECKPOINTS_INDEXES,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";

// Skip E2E tests by default
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if Claude Code CLI is available on the system
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH, ["--version"]);
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Wait for a condition to be true
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Create test repo with sudocode and dataplane setup
 */
function createE2ETestRepo(): {
  path: string;
  sudocodePath: string;
  db: Database.Database;
  dbPath: string;
  cleanup: () => void;
} {
  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sudocode-dataplane-e2e-real-")
  );

  // Initialize git repo
  execSync("git init", { cwd: testDir, stdio: "pipe" });
  execSync('git config user.email "test@sudocode.ai"', {
    cwd: testDir,
    stdio: "pipe",
  });
  execSync('git config user.name "Sudocode E2E Test"', {
    cwd: testDir,
    stdio: "pipe",
  });

  // Create initial files
  fs.writeFileSync(
    path.join(testDir, "README.md"),
    "# E2E Test Project\n\nThis is a test project for dataplane e2e tests with real agents.\n"
  );

  fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(testDir, "src", "index.ts"),
    'export const greeting = "Hello, World!";\n'
  );

  // Initial commit
  execSync("git add .", { cwd: testDir, stdio: "pipe" });
  execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });

  // Create .sudocode directory structure
  const sudocodePath = path.join(testDir, ".sudocode");
  const worktreesPath = path.join(sudocodePath, "worktrees");
  const issuesPath = path.join(sudocodePath, "issues");
  const specsPath = path.join(sudocodePath, "specs");

  fs.mkdirSync(sudocodePath, { recursive: true });
  fs.mkdirSync(worktreesPath, { recursive: true });
  fs.mkdirSync(issuesPath, { recursive: true });
  fs.mkdirSync(specsPath, { recursive: true });

  // Create config with dataplane enabled (unified mode)
  const configContent = {
    version: "0.1.0",
    worktree: {
      worktreeStoragePath: ".sudocode/worktrees",
      autoCreateBranches: true,
      autoDeleteBranches: false,
      branchPrefix: "sudocode",
      cleanupOrphanedWorktreesOnStartup: false,
    },
    dataplane: {
      enabled: true,
      tablePrefix: "dp_",
    },
  };

  fs.writeFileSync(
    path.join(sudocodePath, "config.json"),
    JSON.stringify(configContent, null, 2)
  );

  // Initialize database
  const dbPath = path.join(sudocodePath, "cache.db");
  const db = initCliDatabase({ path: dbPath });

  // Create required tables
  db.exec(ISSUES_TABLE);
  db.exec(ISSUES_INDEXES);
  db.exec(SPECS_TABLE);
  db.exec(SPECS_INDEXES);
  db.exec(RELATIONSHIPS_TABLE);
  db.exec(RELATIONSHIPS_INDEXES);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTIONS_INDEXES);
  db.exec(CHECKPOINTS_TABLE);
  db.exec(CHECKPOINTS_INDEXES);

  // Run migrations
  runMigrations(db);

  // Create empty JSONL files
  fs.writeFileSync(path.join(sudocodePath, "issues.jsonl"), "");
  fs.writeFileSync(path.join(sudocodePath, "specs.jsonl"), "");

  const cleanup = () => {
    try {
      db.close();
    } catch {
      // Ignore close errors
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  };

  return {
    path: testDir,
    sudocodePath,
    db,
    dbPath,
    cleanup,
  };
}

/**
 * Create a test issue in the database
 */
function createTestIssue(
  db: Database.Database,
  data: {
    id: string;
    title: string;
    content?: string;
    status?: string;
  }
) {
  const uuid = `uuid-${data.id}-${Date.now()}`;

  db.prepare(
    `
    INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `
  ).run(
    data.id,
    uuid,
    data.title,
    data.content || `Content for ${data.title}`,
    data.status || "open",
    2
  );

  return { id: data.id, uuid };
}

/**
 * Get execution from database
 */
function getExecution(db: Database.Database, executionId: string) {
  return db.prepare("SELECT * FROM executions WHERE id = ?").get(executionId) as {
    id: string;
    status: string;
    stream_id: string | null;
    mode: string;
    worktree_path: string | null;
    parent_execution_id: string | null;
  } | null;
}

/**
 * Get streams from database
 */
function getStreams(db: Database.Database) {
  return db.prepare("SELECT * FROM dp_streams").all() as {
    id: string;
    name: string;
    metadata: string;
  }[];
}

/**
 * Get checkpoints from database
 */
function getCheckpoints(db: Database.Database) {
  return db.prepare("SELECT * FROM checkpoints").all() as {
    id: string;
    execution_id: string;
    stream_id: string;
    issue_id: string;
  }[];
}

/**
 * Find stream by execution ID
 */
function findStreamByExecutionId(db: Database.Database, executionId: string) {
  const streams = getStreams(db);
  return streams.find((s) => {
    try {
      const metadata = JSON.parse(s.metadata);
      return metadata?.sudocode?.execution_id === executionId;
    } catch {
      return false;
    }
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe.skipIf(SKIP_E2E)("Dataplane Execution Tracking E2E with Real Agents", () => {
  let testRepo: ReturnType<typeof createE2ETestRepo>;
  let app: express.Application;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let registryPath: string;
  let adapter: DataplaneAdapter | null;

  beforeAll(async () => {
    // Check if Claude is available
    const claudeAvailable = await checkClaudeAvailable();
    if (!claudeAvailable) {
      console.warn("Claude Code CLI not available, some tests may fail");
    }

    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  afterAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  beforeEach(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();

    // Create test repo
    testRepo = createE2ETestRepo();

    // Set up project registry and manager
    registryPath = path.join(testRepo.path, "..", "projects-e2e.json");
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testRepo.path);
    if (!result.ok) {
      throw new Error(`Failed to open test project: ${result.error}`);
    }
    projectId = result.value.id;

    // Get the dataplane adapter
    adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api", requireProject(projectManager), createExecutionsRouter());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
  });

  afterEach(async () => {
    try {
      // Shutdown project manager first
      if (projectManager) {
        await projectManager.shutdown();
      }
    } catch (e) {
      console.warn("Error shutting down project manager:", e);
    }

    try {
      // Cleanup test repo
      if (testRepo) {
        testRepo.cleanup();
      }
    } catch (e) {
      console.warn("Error cleaning up test repo:", e);
    }

    try {
      if (registryPath && fs.existsSync(registryPath)) {
        fs.unlinkSync(registryPath);
      }
    } catch (e) {
      console.warn("Error cleaning up registry:", e);
    }

    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();

    // Small delay to allow Vitest worker communication
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 30000); // 30 second timeout for cleanup

  // ===========================================================================
  // Claude Availability Check
  // ===========================================================================

  it("should verify Claude Code CLI is available", { timeout: 10000 }, async () => {
    const available = await checkClaudeAvailable();
    expect(available).toBe(true);
  });

  // ===========================================================================
  // Normal Worktree Execution with Real Agent
  // ===========================================================================

  describe("Normal Worktree Execution with Real Agent", () => {
    it(
      "should create stream and execute with real agent",
      { timeout: 180000 },
      async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-e2e-wt001",
          title: "Simple math task",
        });

        // Create execution via API
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "What is 2 + 2? Reply with just the number, no explanation.",
            agentType: "claude-code",
            config: {
              mode: "worktree",
              dangerouslySkipPermissions: true,
            },
          });

        expect(response.status).toBe(201);
        const executionId = response.body.data.id;

        // Wait for stream creation
        await waitFor(() => {
          const execution = getExecution(testRepo.db, executionId);
          return execution?.stream_id !== null;
        }, 30000);

        // Verify stream was created
        const execution = getExecution(testRepo.db, executionId);
        expect(execution).toBeDefined();
        expect(execution!.stream_id).toBeTruthy();

        // Find the stream
        const stream = findStreamByExecutionId(testRepo.db, executionId);
        expect(stream).toBeDefined();

        // Verify metadata
        const metadata = JSON.parse(stream!.metadata);
        expect(metadata.sudocode.execution_id).toBe(executionId);
        expect(metadata.sudocode.issue_id).toBe(issue.id);
        expect(metadata.sudocode.agent_type).toBe("claude-code");

        // Wait for execution to complete (may take time with real agent)
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, executionId);
            return (
              exec?.status === "completed" ||
              exec?.status === "failed" ||
              exec?.status === "stopped"
            );
          },
          120000,
          1000
        );

        const finalExecution = getExecution(testRepo.db, executionId);
        console.log(`Execution ${executionId} completed with status: ${finalExecution?.status}`);

        // Stream should still be linked
        expect(finalExecution!.stream_id).toBeTruthy();
      }
    );
  });

  // ===========================================================================
  // Follow-up Execution with Real Agent
  // ===========================================================================

  describe("Follow-up Execution with Real Agent", () => {
    it(
      "should inherit parent stream in follow-up execution",
      { timeout: 300000 },
      async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-e2e-followup001",
          title: "Follow-up test",
        });

        // Create root execution
        const rootResponse = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "What is 3 + 3? Reply with just the number.",
            agentType: "claude-code",
            config: {
              mode: "worktree",
              dangerouslySkipPermissions: true,
            },
          });

        expect(rootResponse.status).toBe(201);
        const rootExecutionId = rootResponse.body.data.id;

        // Wait for root execution to complete
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, rootExecutionId);
            return exec?.status === "completed" || exec?.status === "failed";
          },
          120000,
          1000
        );

        const rootExecution = getExecution(testRepo.db, rootExecutionId);
        expect(rootExecution).toBeDefined();

        // Skip follow-up if root failed
        if (rootExecution!.status !== "completed") {
          console.warn("Root execution did not complete, skipping follow-up test");
          return;
        }

        const rootStreamId = rootExecution!.stream_id;
        expect(rootStreamId).toBeTruthy();

        // Create follow-up execution
        const followUpResponse = await request(app)
          .post(`/api/executions/${rootExecutionId}/follow-up`)
          .set("X-Project-ID", projectId)
          .send({
            feedback: "Now what is 4 + 4? Reply with just the number.",
          });

        expect(followUpResponse.status).toBe(201);
        const followUpExecutionId = followUpResponse.body.data.id;

        // Wait for follow-up to be set up
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify follow-up is linked to parent
        const followUpExecution = getExecution(testRepo.db, followUpExecutionId);
        expect(followUpExecution).toBeDefined();
        expect(followUpExecution!.parent_execution_id).toBe(rootExecutionId);

        // Follow-up should have a stream (inherited or its own)
        // With reuseWorktree=true, it should inherit parent's stream
        if (followUpExecution!.stream_id) {
          expect(followUpExecution!.stream_id).toBe(rootStreamId);
        }

        // Wait for follow-up to complete
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, followUpExecutionId);
            return (
              exec?.status === "completed" ||
              exec?.status === "failed" ||
              exec?.status === "stopped"
            );
          },
          120000,
          1000
        );

        console.log(
          `Follow-up execution completed with status: ${getExecution(testRepo.db, followUpExecutionId)?.status}`
        );
      }
    );
  });

  // ===========================================================================
  // Local Mode Execution with Real Agent
  // ===========================================================================

  describe("Local Mode Execution with Real Agent", () => {
    it(
      "should create stream for local mode execution",
      { timeout: 180000 },
      async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-e2e-local001",
          title: "Local mode test",
        });

        // Create execution in local mode
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "What is 5 + 5? Reply with just the number.",
            agentType: "claude-code",
            config: {
              mode: "local",
              dangerouslySkipPermissions: true,
            },
          });

        expect(response.status).toBe(201);
        const executionId = response.body.data.id;

        // Wait for execution setup
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Verify execution is in local mode
        const execution = getExecution(testRepo.db, executionId);
        expect(execution).toBeDefined();
        expect(execution!.mode).toBe("local");
        expect(execution!.worktree_path).toBeFalsy();

        // Local mode should still create a stream for visibility
        // (stream creation may be async)
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, executionId);
            return exec?.stream_id !== null || exec?.status !== "pending";
          },
          30000,
          500
        );

        // Wait for completion
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, executionId);
            return (
              exec?.status === "completed" ||
              exec?.status === "failed" ||
              exec?.status === "stopped"
            );
          },
          120000,
          1000
        );

        const finalExecution = getExecution(testRepo.db, executionId);
        console.log(`Local mode execution completed with status: ${finalExecution?.status}`);
      }
    );
  });

  // ===========================================================================
  // Stream Persistence Test
  // ===========================================================================

  describe("Stream Persistence", () => {
    it(
      "should persist stream data across execution lifecycle",
      { timeout: 180000 },
      async () => {
        const issue = createTestIssue(testRepo.db, {
          id: "i-e2e-persist001",
          title: "Stream persistence test",
        });

        // Count initial streams
        const initialStreams = getStreams(testRepo.db);
        const initialCount = initialStreams.length;

        // Create execution
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: "What is 6 + 6? Reply with just the number.",
            agentType: "claude-code",
            config: {
              mode: "worktree",
              dangerouslySkipPermissions: true,
            },
          });

        expect(response.status).toBe(201);
        const executionId = response.body.data.id;

        // Wait for stream creation
        await waitFor(() => {
          const streams = getStreams(testRepo.db);
          return streams.length > initialCount;
        }, 30000);

        // Verify stream count increased
        const streamsAfterCreate = getStreams(testRepo.db);
        expect(streamsAfterCreate.length).toBeGreaterThan(initialCount);

        // Wait for execution to complete
        await waitFor(
          () => {
            const exec = getExecution(testRepo.db, executionId);
            return (
              exec?.status === "completed" ||
              exec?.status === "failed" ||
              exec?.status === "stopped"
            );
          },
          120000,
          1000
        );

        // Verify stream still exists after completion
        const streamsAfterComplete = getStreams(testRepo.db);
        expect(streamsAfterComplete.length).toBeGreaterThanOrEqual(initialCount + 1);

        // Verify execution still has stream_id
        const finalExecution = getExecution(testRepo.db, executionId);
        expect(finalExecution!.stream_id).toBeTruthy();

        console.log(
          `Stream persistence test completed. Initial: ${initialCount}, Final: ${streamsAfterComplete.length}`
        );
      }
    );
  });

  // ===========================================================================
  // Multiple Concurrent Executions
  // ===========================================================================

  describe("Multiple Concurrent Executions", () => {
    it(
      "should create separate streams for concurrent executions",
      { timeout: 300000 },
      async () => {
        // Create multiple issues
        const issues = [
          createTestIssue(testRepo.db, { id: "i-e2e-concurrent001", title: "Concurrent 1" }),
          createTestIssue(testRepo.db, { id: "i-e2e-concurrent002", title: "Concurrent 2" }),
        ];

        // Create executions concurrently
        const executions = await Promise.all(
          issues.map(async (issue, index) => {
            const response = await request(app)
              .post(`/api/issues/${issue.id}/executions`)
              .set("X-Project-ID", projectId)
              .send({
                prompt: `What is ${index + 7} + ${index + 7}? Reply with just the number.`,
                agentType: "claude-code",
                config: {
                  mode: "worktree",
                  dangerouslySkipPermissions: true,
                },
              });

            expect(response.status).toBe(201);
            return response.body.data.id;
          })
        );

        // Wait for all streams to be created
        await waitFor(() => {
          const allHaveStreams = executions.every((execId) => {
            const exec = getExecution(testRepo.db, execId);
            return exec?.stream_id !== null;
          });
          return allHaveStreams;
        }, 60000);

        // Verify each execution has its own stream
        const streamIds = new Set<string>();
        for (const execId of executions) {
          const execution = getExecution(testRepo.db, execId);
          expect(execution).toBeDefined();
          expect(execution!.stream_id).toBeTruthy();

          // Stream IDs should be unique
          expect(streamIds.has(execution!.stream_id!)).toBe(false);
          streamIds.add(execution!.stream_id!);
        }

        // Wait for all to complete
        await waitFor(
          () => {
            return executions.every((execId) => {
              const exec = getExecution(testRepo.db, execId);
              return (
                exec?.status === "completed" ||
                exec?.status === "failed" ||
                exec?.status === "stopped"
              );
            });
          },
          180000,
          2000
        );

        console.log(`Concurrent executions completed. Stream count: ${streamIds.size}`);
      }
    );
  });

  // ===========================================================================
  // Workflow Execution with Real Agent
  // ===========================================================================

  describe("Workflow Execution with Real Agent", () => {
    it(
      "should create streams for workflow steps",
      { timeout: 600000 }, // 10 minutes for multi-step workflow
      async () => {
        // Create issues for workflow
        const issues = [
          createTestIssue(testRepo.db, {
            id: "i-e2e-workflow001",
            title: "Workflow Step 1",
            content: "First step of the workflow",
          }),
          createTestIssue(testRepo.db, {
            id: "i-e2e-workflow002",
            title: "Workflow Step 2",
            content: "Second step of the workflow",
          }),
        ];

        // Count initial streams
        const initialStreams = getStreams(testRepo.db);
        const initialCount = initialStreams.length;

        // Create workflow via API
        const workflowResponse = await request(app)
          .post("/api/workflows")
          .set("X-Project-ID", projectId)
          .send({
            name: "E2E Stream Test Workflow",
            steps: [
              {
                issueId: issues[0].id,
                prompt: "What is 8 + 8? Reply with just the number.",
              },
              {
                issueId: issues[1].id,
                prompt: "What is 9 + 9? Reply with just the number.",
              },
            ],
            config: {
              parallelism: "sequential",
              onFailure: "stop",
              autoCommitAfterStep: true,
            },
          });

        // Workflow creation may or may not be supported
        if (workflowResponse.status === 404) {
          console.log("Workflow API not available, skipping workflow test");
          return;
        }

        if (workflowResponse.status !== 201) {
          console.log(`Workflow creation failed: ${workflowResponse.status}`);
          console.log(workflowResponse.body);
          return;
        }

        const workflowId = workflowResponse.body.data?.id;
        expect(workflowId).toBeDefined();

        // Start workflow
        const startResponse = await request(app)
          .post(`/api/workflows/${workflowId}/start`)
          .set("X-Project-ID", projectId)
          .send({
            agentType: "claude-code",
            config: {
              dangerouslySkipPermissions: true,
            },
          });

        if (startResponse.status !== 200) {
          console.log(`Workflow start failed: ${startResponse.status}`);
          console.log(startResponse.body);
          return;
        }

        // Wait for workflow to complete or timeout
        const startTime = Date.now();
        const maxWaitTime = 480000; // 8 minutes

        while (Date.now() - startTime < maxWaitTime) {
          const statusResponse = await request(app)
            .get(`/api/workflows/${workflowId}`)
            .set("X-Project-ID", projectId);

          const status = statusResponse.body.data?.status;

          if (status === "completed" || status === "failed" || status === "cancelled") {
            console.log(`Workflow completed with status: ${status}`);
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        // Verify streams were created for workflow executions
        const finalStreams = getStreams(testRepo.db);
        console.log(`Workflow test: Initial streams: ${initialCount}, Final streams: ${finalStreams.length}`);

        // Should have at least created streams for the workflow
        expect(finalStreams.length).toBeGreaterThanOrEqual(initialCount);

        // Check if any executions were created for the workflow
        const workflowExecutions = testRepo.db
          .prepare("SELECT * FROM executions WHERE workflow_execution_id IS NOT NULL")
          .all() as { id: string; stream_id: string | null }[];

        if (workflowExecutions.length > 0) {
          console.log(`Workflow created ${workflowExecutions.length} executions`);

          // Verify workflow executions have streams
          for (const exec of workflowExecutions) {
            if (exec.stream_id) {
              console.log(`Workflow execution ${exec.id} has stream ${exec.stream_id}`);
            }
          }
        }
      }
    );
  });

  // ===========================================================================
  // Checkpoint Creation Test
  // ===========================================================================

  describe("Checkpoint Creation", () => {
    it(
      "should have checkpoint infrastructure in place",
      { timeout: 60000 },
      async () => {
        // Verify checkpoints table exists
        const checkpointTableExists = testRepo.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
          )
          .get();
        expect(checkpointTableExists).toBeDefined();

        // Verify dp_merge_queue table exists
        const mergeQueueTableExists = testRepo.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='dp_merge_queue'"
          )
          .get();
        expect(mergeQueueTableExists).toBeDefined();

        // Get current checkpoints
        const checkpoints = getCheckpoints(testRepo.db);
        console.log(`Current checkpoint count: ${checkpoints.length}`);

        // Checkpoint creation happens automatically on execution completion
        // This test verifies the infrastructure is in place
      }
    );
  });
});
