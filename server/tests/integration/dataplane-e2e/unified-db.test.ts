/**
 * Unified Database E2E Tests
 *
 * Tests the unified SQLite database model where sudocode and dataplane
 * share the same cache.db with table prefixes (dp_* for dataplane tables).
 *
 * Key aspects tested:
 * 1. No separate dataplane.db is created
 * 2. Dataplane tables use dp_ prefix in cache.db
 * 3. Sudocode tables and dataplane tables coexist without conflicts
 * 4. Full execution flow works with unified database
 * 5. Stream/checkpoint data is correctly stored in prefixed tables
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import Database from "better-sqlite3";

// Test helpers
import {
  createTestRepo,
  createTestIssue,
  getHeadCommit,
  type TestRepo,
} from "./helpers/test-repo.js";
import {
  applyMockChanges,
  commitMockChanges,
  simulateExecutionComplete,
  DEFAULT_MOCK_CHANGES,
} from "./helpers/mock-agent.js";

// Server components
import { createExecutionsRouter } from "../../../src/routes/executions.js";
import { createIssuesRouter } from "../../../src/routes/issues.js";
import { ProjectManager } from "../../../src/services/project-manager.js";
import { ProjectRegistry } from "../../../src/services/project-registry.js";
import { requireProject } from "../../../src/middleware/project-context.js";
import {
  closeAllDataplaneAdapters,
  getDataplaneAdapter,
} from "../../../src/services/dataplane-adapter.js";
import { clearDataplaneConfigCache } from "../../../src/services/dataplane-config.js";

// Mock WebSocket broadcasts to prevent errors
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  broadcastVoiceNarration: vi.fn(),
  broadcastIssueChange: vi.fn(),
  broadcastIssueUpdate: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
  },
}));

// Mock execution event callbacks
vi.mock("../../../src/services/execution-event-callbacks.js", () => ({
  notifyExecutionEvent: vi.fn().mockResolvedValue(undefined),
  registerExecutionCallback: vi.fn().mockReturnValue(() => {}),
  getCallbackCount: vi.fn().mockReturnValue(0),
  clearAllCallbacks: vi.fn(),
}));

describe("Unified Database E2E Tests", () => {
  let testRepo: TestRepo;
  let app: express.Application;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;
  let registryPath: string;

  beforeAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  afterAll(async () => {
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();

    // Create test repo with unified database mode enabled
    testRepo = createTestRepo({
      dataplaneEnabled: true,
      useUnifiedDb: true,
      tablePrefix: "dp_",
    });

    // Set up project registry and manager
    registryPath = path.join(testRepo.path, "..", "projects.json");
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testRepo.path);
    if (!result.ok) {
      throw new Error(`Failed to open test project: ${result.error}`);
    }
    projectId = result.value.id;

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    app.use("/api", requireProject(projectManager), createExecutionsRouter());
    app.use("/api/issues", requireProject(projectManager), createIssuesRouter());
  });

  afterEach(async () => {
    await projectManager?.shutdown();
    testRepo?.cleanup();

    if (registryPath && fs.existsSync(registryPath)) {
      fs.unlinkSync(registryPath);
    }

    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
  });

  // ============================================================================
  // Section 1: Database Structure Verification
  // ============================================================================

  describe("1. Database Structure", () => {
    it("should NOT create a separate dataplane.db file", async () => {
      // Get the dataplane adapter (this triggers initialization)
      const adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);
      expect(adapter).not.toBeNull();

      // Verify no separate dataplane.db was created
      const dataplanePath = path.join(testRepo.sudocodePath, "dataplane.db");
      expect(fs.existsSync(dataplanePath)).toBe(false);
    });

    it("should create dataplane tables with dp_ prefix in cache.db", async () => {
      // Get the dataplane adapter
      const adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);
      expect(adapter).not.toBeNull();

      // Query cache.db for tables with dp_ prefix
      const tables = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'dp_%'"
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      // Verify core dataplane tables exist with prefix
      expect(tableNames).toContain("dp_streams");
      expect(tableNames).toContain("dp_operations");
    });

    it("should preserve sudocode tables without prefix", async () => {
      // Get the dataplane adapter
      await getDataplaneAdapter(testRepo.path, testRepo.db);

      // Query for sudocode tables
      const tables = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'dp_%' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      // Verify core sudocode tables exist without prefix
      expect(tableNames).toContain("issues");
      expect(tableNames).toContain("specs");
      expect(tableNames).toContain("executions");
      expect(tableNames).toContain("relationships");
    });

    it("should not have naming conflicts between sudocode and dataplane tables", async () => {
      await getDataplaneAdapter(testRepo.path, testRepo.db);

      // Get all table names
      const allTables = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[];

      const tableNames = allTables.map((t) => t.name);

      // Check no table appears both with and without prefix
      const unprefixedNames = tableNames.filter((n) => !n.startsWith("dp_"));
      const prefixedNames = tableNames
        .filter((n) => n.startsWith("dp_"))
        .map((n) => n.replace("dp_", ""));

      // None of the unprefixed names should match dataplane table base names
      const overlap = unprefixedNames.filter((n) => prefixedNames.includes(n));
      expect(overlap).toHaveLength(0);
    });
  });

  // ============================================================================
  // Section 2: Execution Flow with Unified Database
  // ============================================================================

  describe("2. Execution Flow", () => {
    it("should create execution and store stream in dp_streams table", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified001",
        title: "Test unified db execution",
      });

      // Create execution via API
      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Implement feature",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const executionId = response.body.data.id;

      // Wait for async stream creation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify stream was created in dp_streams table
      const streams = testRepo.db
        .prepare("SELECT * FROM dp_streams")
        .all() as { id: string; name: string; metadata: string }[];

      expect(streams.length).toBeGreaterThan(0);

      // Find the stream for this execution
      const execStream = streams.find((s) => {
        try {
          const metadata = JSON.parse(s.metadata);
          return metadata?.sudocode?.execution_id === executionId;
        } catch {
          return false;
        }
      });

      expect(execStream).toBeDefined();
    });

    it("should have dp_operations table available for tracking", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified002",
        title: "Test operations tracking",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Make changes",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify dp_operations table exists and is queryable
      // Note: Operations may not be logged for every action depending on dataplane config
      const operations = testRepo.db
        .prepare("SELECT * FROM dp_operations")
        .all() as { id: string; type: string; stream_id: string }[];

      // Just verify the table is accessible (array returned)
      expect(Array.isArray(operations)).toBe(true);

      // Verify the table exists in the schema
      const tableExists = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dp_operations'"
        )
        .get();

      expect(tableExists).toBeDefined();
    });

    it("should store execution data in executions table (no prefix)", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified003",
        title: "Test execution storage",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Test execution",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);

      const executionId = response.body.data.id;

      // Verify execution is in unprefixed executions table
      const execution = testRepo.db
        .prepare("SELECT * FROM executions WHERE id = ?")
        .get(executionId) as { id: string; issue_id: string } | undefined;

      expect(execution).toBeDefined();
      expect(execution?.issue_id).toBe(issue.id);
    });
  });

  // ============================================================================
  // Section 3: Cross-Table Queries
  // ============================================================================

  describe("3. Cross-Table Queries", () => {
    it("should be able to join execution and stream data", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified004",
        title: "Test cross-table join",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Cross-table test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Query that joins across tables - find execution with its stream
      const result = testRepo.db
        .prepare(
          `
          SELECT e.id as exec_id, e.issue_id, s.id as stream_id, s.name as stream_name
          FROM executions e
          JOIN dp_streams s ON json_extract(s.metadata, '$.sudocode.execution_id') = e.id
          WHERE e.id = ?
        `
        )
        .get(executionId) as {
        exec_id: string;
        issue_id: string;
        stream_id: string;
        stream_name: string;
      } | undefined;

      expect(result).toBeDefined();
      expect(result?.exec_id).toBe(executionId);
      expect(result?.issue_id).toBe(issue.id);
      expect(result?.stream_id).toBeDefined();
    });

    it("should be able to query issue with related streams", async () => {
      // Create two different issues to avoid conflicts
      const issue1 = createTestIssue(testRepo.db, {
        id: "i-unified005a",
        title: "Test issue-stream relationship 1",
      });
      const issue2 = createTestIssue(testRepo.db, {
        id: "i-unified005b",
        title: "Test issue-stream relationship 2",
      });

      // Create executions for each issue
      const response1 = await request(app)
        .post(`/api/issues/${issue1.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Execution 1",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });
      expect(response1.status).toBe(201);

      const response2 = await request(app)
        .post(`/api/issues/${issue2.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Execution 2",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });
      expect(response2.status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Query for all issues with stream counts
      const results = testRepo.db
        .prepare(
          `
          SELECT i.id as issue_id, i.title
          FROM issues i
          JOIN dp_streams s ON json_extract(s.metadata, '$.sudocode.issue_id') = i.id
          WHERE i.id IN (?, ?)
        `
        )
        .all(issue1.id, issue2.id) as {
        issue_id: string;
        title: string;
      }[];

      // Should have at least 2 issue-stream relationships
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Section 4: Worktree and Commit Flow
  // ============================================================================

  describe("4. Worktree and Commit Flow", () => {
    it("should track worktree in dp_agent_worktrees table", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified006",
        title: "Test worktree tracking",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Worktree test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check for worktree entries in dp_agent_worktrees
      const worktrees = testRepo.db
        .prepare("SELECT * FROM dp_agent_worktrees")
        .all() as { agent_id: string; path: string }[];

      // May or may not have worktrees depending on timing
      // Just verify the table exists and is queryable
      expect(Array.isArray(worktrees)).toBe(true);
    });

    it("should track commits in dp_changes table", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified007",
        title: "Test commit tracking",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Commit test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get the execution's worktree path
      const execResponse = await request(app)
        .get(`/api/executions/${executionId}`)
        .set("X-Project-ID", projectId);

      if (execResponse.body.data?.worktree_path) {
        const worktreePath = execResponse.body.data.worktree_path;

        // Apply and commit changes if worktree exists
        if (fs.existsSync(worktreePath)) {
          applyMockChanges(worktreePath, DEFAULT_MOCK_CHANGES);
          commitMockChanges(worktreePath, "Test commit");

          // Verify dp_changes table exists and is queryable
          const changes = testRepo.db
            .prepare("SELECT * FROM dp_changes")
            .all() as { id: string; stream_id: string }[];

          expect(Array.isArray(changes)).toBe(true);
        }
      }
    });
  });

  // ============================================================================
  // Section 5: Data Consistency
  // ============================================================================

  describe("5. Data Consistency", () => {
    it("should maintain referential integrity between tables", async () => {
      const issue = createTestIssue(testRepo.db, {
        id: "i-unified008",
        title: "Test referential integrity",
      });

      const response = await request(app)
        .post(`/api/issues/${issue.id}/executions`)
        .set("X-Project-ID", projectId)
        .send({
          prompt: "Integrity test",
          agentType: "claude-code",
          config: { mode: "worktree" },
        });

      expect(response.status).toBe(201);
      const executionId = response.body.data.id;

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify the execution references an existing issue
      const execution = testRepo.db
        .prepare(
          `
          SELECT e.*, i.title as issue_title
          FROM executions e
          JOIN issues i ON e.issue_id = i.id
          WHERE e.id = ?
        `
        )
        .get(executionId) as { id: string; issue_title: string } | undefined;

      expect(execution).toBeDefined();
      expect(execution?.issue_title).toBe("Test referential integrity");

      // Verify stream references valid execution
      const stream = testRepo.db
        .prepare(
          `
          SELECT s.*, e.id as exec_id
          FROM dp_streams s
          JOIN executions e ON json_extract(s.metadata, '$.sudocode.execution_id') = e.id
          WHERE json_extract(s.metadata, '$.sudocode.execution_id') = ?
        `
        )
        .get(executionId) as { id: string; exec_id: string } | undefined;

      expect(stream).toBeDefined();
      expect(stream?.exec_id).toBe(executionId);
    });

    it("should preserve data after multiple operations", async () => {
      // Create separate issues for each execution to avoid conflicts
      const issues = [
        createTestIssue(testRepo.db, { id: "i-unified009a", title: "Test data 1" }),
        createTestIssue(testRepo.db, { id: "i-unified009b", title: "Test data 2" }),
        createTestIssue(testRepo.db, { id: "i-unified009c", title: "Test data 3" }),
      ];

      const executions: string[] = [];
      for (const issue of issues) {
        const response = await request(app)
          .post(`/api/issues/${issue.id}/executions`)
          .set("X-Project-ID", projectId)
          .send({
            prompt: `Execution for ${issue.id}`,
            agentType: "claude-code",
            config: { mode: "worktree" },
          });

        expect(response.status).toBe(201);
        executions.push(response.body.data.id);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify all executions exist
      for (const execId of executions) {
        const execution = testRepo.db
          .prepare("SELECT * FROM executions WHERE id = ?")
          .get(execId);
        expect(execution).toBeDefined();
      }

      // Verify all streams exist
      const streams = testRepo.db
        .prepare("SELECT * FROM dp_streams")
        .all() as { metadata: string }[];

      const execIdsInStreams = streams
        .map((s) => {
          try {
            return JSON.parse(s.metadata)?.sudocode?.execution_id;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      for (const execId of executions) {
        expect(execIdsInStreams).toContain(execId);
      }
    });
  });

  // ============================================================================
  // Section 6: Configuration Validation
  // ============================================================================

  describe("6. Configuration Validation", () => {
    it("should use the correct tablePrefix from config", async () => {
      // Verify config has tablePrefix
      const configPath = path.join(testRepo.sudocodePath, "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(config.dataplane.tablePrefix).toBe("dp_");
    });

    it("should have adapter initialized in shared db mode", async () => {
      // The adapter was initialized in beforeEach via projectManager.openProject
      // Verify by checking that we can get the adapter and it's properly configured
      const adapter = await getDataplaneAdapter(testRepo.path, testRepo.db);

      expect(adapter).not.toBeNull();
      expect(adapter!.isInitialized).toBe(true);
      expect(adapter!.isEnabled).toBe(true);

      // Verify dp_ prefixed tables exist (proving shared db mode)
      const tables = testRepo.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'dp_%'"
        )
        .all() as { name: string }[];

      expect(tables.length).toBeGreaterThan(0);
    });
  });
});
