/**
 * Integration Tests for Multi-Agent Support - Phase 1
 *
 * Tests the complete execution stack with the new agent registry pattern:
 * - Agent registry initialization and lookup
 * - Executor factory and wrapper creation
 * - ExecutionService with multi-agent support
 * - End-to-end execution flow with mocked agent executors
 *
 * Note: Real end-to-end tests with actual agent execution
 * should be in separate E2E test files that are run explicitly.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  vi,
} from "vitest";

// Mock agent-execution-engine to prevent spawning real legacy agent processes
vi.mock("agent-execution-engine/agents", () => {
  const createMockProcess = () => ({
    process: {
      pid: 12345,
      kill: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        // Auto-complete with exit code 0
        if (event === "exit") {
          setTimeout(() => handler(0), 100);
        }
      }),
    },
    streams: {
      stdout: (async function* () {
        // Empty stream
      })(),
      stderr: (async function* () {
        // Empty stream
      })(),
    },
  });

  const createMockExecutor = () => ({
    executeTask: vi.fn().mockResolvedValue({ process: createMockProcess() }),
    normalizeOutput: vi.fn().mockImplementation(async function* () {
      // Empty normalized output
    }),
    getCapabilities: vi.fn().mockReturnValue({
      supportsSessionResume: false,
      requiresSetup: false,
      supportsApprovals: false,
      supportsMcp: false,
    }),
  });

  // AgentRegistry is a class that needs register, get, getAll methods
  class MockAgentRegistry {
    private adapters = new Map<string, any>();

    register(adapter: any) {
      this.adapters.set(adapter.metadata?.name || adapter.name, adapter);
    }

    get(name: string) {
      return this.adapters.get(name);
    }

    getAll() {
      return Array.from(this.adapters.values());
    }
  }

  return {
    CopilotExecutor: vi.fn().mockImplementation(() => createMockExecutor()),
    CursorExecutor: vi.fn().mockImplementation(() => createMockExecutor()),
    AgentRegistry: MockAgentRegistry,
  };
});

// Mock acp-factory to prevent spawning real Claude processes
vi.mock("acp-factory", () => {
  const createMockSession = () => ({
    id: `mock-session-${Date.now()}`,
    cwd: "/tmp/test",
    modes: ["code"],
    models: ["claude-sonnet"],
    prompt: vi.fn().mockImplementation(async function* () {
      // Yield nothing - empty execution
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  });

  const createMockAgent = () => ({
    capabilities: { loadSession: true },
    createSession: vi.fn().mockImplementation(() => Promise.resolve(createMockSession())),
    loadSession: vi.fn().mockImplementation(() => Promise.resolve(createMockSession())),
    close: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
  });

  return {
    AgentFactory: {
      spawn: vi.fn().mockImplementation(() => Promise.resolve(createMockAgent())),
      listAgents: vi.fn().mockReturnValue(["claude-code", "codex", "gemini", "opencode"]),
      getConfig: vi.fn(),
      register: vi.fn(),
    },
  };
});
import Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
import { initializeDefaultTemplates } from "../../src/services/prompt-templates.js";
import {
  generateIssueId,
  generateSpecId,
} from "@sudocode-ai/cli/dist/id-generator.js";
import {
  createIssue,
  createSpec,
  addRelationship,
} from "@sudocode-ai/cli/dist/operations/index.js";
import { agentRegistryService } from "../../src/services/agent-registry.js";
import {
  createExecutorForAgent,
  validateAgentConfig,
} from "../../src/execution/executors/executor-factory.js";
import { ExecutionService } from "../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../src/services/execution-lifecycle.js";
import type { IWorktreeManager } from "../../src/execution/worktree/manager.js";
import type {
  WorktreeCreateParams,
  WorktreeInfo,
} from "../../src/execution/worktree/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock WebSocket module
vi.mock("../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

// Mock AgentExecutorWrapper to prevent actual Codex process spawning
vi.mock("../../src/execution/executors/agent-executor-wrapper.js", () => {
  return {
    AgentExecutorWrapper: class AgentExecutorWrapper {
      private config: any;

      constructor(config: any) {
        // Store config for inspection if needed
        this.config = config;
      }

      async executeWithLifecycle(
        executionId: string,
        task: any,
        workDir: string
      ): Promise<void> {
        // Don't actually spawn Codex - just resolve immediately
        // The ExecutionService already created the execution with status 'running'
        // We simulate successful execution by just resolving
        return Promise.resolve();
      }

      async resumeWithLifecycle(
        executionId: string,
        sessionId: string,
        task: any,
        workDir: string
      ): Promise<void> {
        // Don't actually spawn Codex - just resolve immediately
        // Simulates resuming an existing session
        return Promise.resolve();
      }

      async cancel(executionId: string): Promise<void> {
        // Mock cancel - do nothing
        return Promise.resolve();
      }
    },
  };
});

describe("Multi-Agent Support - Phase 1 Integration", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let executionService: ExecutionService;
  const issueContent = "Add OAuth2 authentication with JWT tokens";

  beforeAll(() => {
    // Create temporary directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-multi-agent-test-")
    );
    testDbPath = path.join(testDir, "cache.db");
    process.env.SUDOCODE_DIR = testDir;

    // Create config for ID generation
    const configPath = path.join(testDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: "1.0.0",
        id_prefix: { spec: "SPEC", issue: "ISSUE" },
      })
    );

    // Initialize database with schema and migrations
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);
    db.exec(PROMPT_TEMPLATES_TABLE);
    db.exec(PROMPT_TEMPLATES_INDEXES);
    runMigrations(db);
    initializeDefaultTemplates(db);

    // Create test issue and spec
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, testDir);
    testIssueId = issueId;
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test multi-agent execution",
      content: "Integration test for multi-agent support",
    });

    const { id: specId, uuid: specUuid } = generateSpecId(db, testDir);
    testSpecId = specId;
    createSpec(db, {
      id: specId,
      uuid: specUuid,
      title: "Multi-agent spec",
      content: "Test specification",
      file_path: path.join(testDir, "specs", "test.md"),
    });

    addRelationship(db, {
      from_id: testIssueId,
      from_type: "issue",
      to_id: testSpecId,
      to_type: "spec",
      relationship_type: "implements",
    });

    // Create mock worktree manager
    const mockWorktreeManager = createMockWorktreeManager();
    const lifecycleService = new ExecutionLifecycleService(
      db,
      testDir,
      mockWorktreeManager
    );

    // Create execution service
    executionService = new ExecutionService(
      db,
      "test-project",
      testDir,
      lifecycleService
    );
  });

  afterEach(() => {
    // Cleanup: cancel any running executions to prevent conflicts between tests
    const runningExecutions = db
      .prepare("SELECT id FROM executions WHERE status = ?")
      .all("running") as Array<{ id: string }>;

    for (const execution of runningExecutions) {
      try {
        executionService.cancelExecution(execution.id);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Also update any remaining running executions to cancelled state
    db.prepare(
      "UPDATE executions SET status = ?, updated_at = ? WHERE status = ?"
    ).run("cancelled", new Date().toISOString(), "running");
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.SUDOCODE_DIR;
  });

  describe("Agent Registry", () => {
    it("should initialize with all 4 agents registered", () => {
      const claudeAdapter = agentRegistryService.getAdapter("claude-code");
      expect(claudeAdapter).toBeDefined();
      expect(claudeAdapter.metadata.name).toBe("claude-code");

      const codexAdapter = agentRegistryService.getAdapter("codex");
      expect(codexAdapter).toBeDefined();
      expect(codexAdapter.metadata.name).toBe("codex");

      const copilotAdapter = agentRegistryService.getAdapter("copilot");
      expect(copilotAdapter).toBeDefined();
      expect(copilotAdapter.metadata.name).toBe("copilot");

      const cursorAdapter = agentRegistryService.getAdapter("cursor");
      expect(cursorAdapter).toBeDefined();
      expect(cursorAdapter.metadata.name).toBe("cursor");
    });

    it("should provide metadata for all agents", () => {
      const agents = agentRegistryService.getAvailableAgents();
      expect(agents).toHaveLength(7);

      const agentNames = agents.map((a) => a.name);
      expect(agentNames).toContain("claude-code");
      expect(agentNames).toContain("codex");
      expect(agentNames).toContain("gemini");
      expect(agentNames).toContain("opencode");
      expect(agentNames).toContain("copilot");
      expect(agentNames).toContain("cursor");
      expect(agentNames).toContain("macro-agent");
    });

    it("should identify implemented agents", () => {
      expect(agentRegistryService.isAgentImplemented("claude-code")).toBe(true);
      expect(agentRegistryService.isAgentImplemented("codex")).toBe(true);
      expect(agentRegistryService.isAgentImplemented("gemini")).toBe(true);
      expect(agentRegistryService.isAgentImplemented("opencode")).toBe(true);
      expect(agentRegistryService.isAgentImplemented("cursor")).toBe(true);
    });

    it("should identify copilot as implemented", () => {
      expect(agentRegistryService.isAgentImplemented("copilot")).toBe(true);
    });

    it("should throw for unknown agent types", () => {
      expect(() => {
        agentRegistryService.getAdapter("unknown-agent" as any);
      }).toThrow(/Agent 'unknown-agent' not found/);
    });
  });

  describe("Executor Factory", () => {
    it("should create AcpExecutorWrapper for claude-code (ACP-native agent)", async () => {
      const wrapper = await createExecutorForAgent(
        "claude-code",
        { workDir: testDir },
        {
          workDir: testDir,
          lifecycleService: executionService["lifecycleService"],
          logsStore: executionService["logsStore"],
          projectId: "test-project",
          db,
        }
      );

      expect(wrapper).toBeDefined();
      // ACP-native agents use AcpExecutorWrapper
      expect(wrapper.constructor.name).toBe("AcpExecutorWrapper");
    });

    it("should create executor for codex agent (ACP-native)", async () => {
      // Codex is an ACP-native agent supported via acp-factory
      const wrapper = await createExecutorForAgent(
        "codex",
        { workDir: testDir },
        {
          workDir: testDir,
          lifecycleService: executionService["lifecycleService"],
          logsStore: executionService["logsStore"],
          projectId: "test-project",
          db,
        }
      );
      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("AcpExecutorWrapper");
    });

    it("should throw for unsupported agent types", async () => {
      // Unknown agent types should throw
      await expect(
        createExecutorForAgent(
          "unknown-agent" as any,
          { workDir: testDir },
          {
            workDir: testDir,
            lifecycleService: executionService["lifecycleService"],
            logsStore: executionService["logsStore"],
            projectId: "test-project",
            db,
          }
        )
      ).rejects.toThrow(/Unknown agent type: unknown-agent/);
    });

    it("should create executor for copilot agent", async () => {
      // Copilot is now implemented
      const wrapper = await createExecutorForAgent(
        "copilot",
        { workDir: testDir },
        {
          workDir: testDir,
          lifecycleService: executionService["lifecycleService"],
          logsStore: executionService["logsStore"],
          projectId: "test-project",
          db,
        }
      );
      expect(wrapper).toBeDefined();
    });

    it("should validate agent configuration", () => {
      // Valid config
      const validErrors = validateAgentConfig("claude-code", {
        workDir: testDir,
        print: true,
        outputFormat: "stream-json",
      });
      expect(validErrors).toEqual([]);

      // Invalid config
      const invalidErrors = validateAgentConfig("claude-code", {
        workDir: "",
        print: false,
        outputFormat: "stream-json",
      });
      expect(invalidErrors.length).toBeGreaterThan(0);
      expect(invalidErrors).toContain("workDir is required");
    });

    it("should create LegacyShimExecutorWrapper for copilot (legacy agent)", async () => {
      // Copilot uses the legacy shim wrapper that converts NormalizedEntry to SessionUpdate
      const wrapper = await createExecutorForAgent(
        "copilot",
        { workDir: testDir },
        {
          workDir: testDir,
          lifecycleService: executionService["lifecycleService"],
          logsStore: executionService["logsStore"],
          projectId: "test-project",
          db,
        }
      );

      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("LegacyShimExecutorWrapper");
    });
  });

  describe("ExecutionService Multi-Agent Integration", () => {
    it("should create execution with default claude-code agent", async () => {

      // Create without specifying agentType
      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("claude-code");
      expect(execution.issue_id).toBe(testIssueId);
    });

    it("should create execution with explicit agent type", async () => {

      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "claude-code"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("claude-code");
    });

    it("should create execution for codex agent (ACP-native)", async () => {
      // Codex is an ACP-native agent supported via acp-factory
      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "codex"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("codex");
    });

    it("should reject unknown agent types", async () => {
      // Unknown agent types should be rejected
      await expect(
        executionService.createExecution(
          testIssueId,
          { mode: "worktree" as const },
          issueContent,
          "unknown-agent" as any
        )
      ).rejects.toThrow(/Unknown agent type: unknown-agent/);
    });

    it("should create execution for copilot agent", async () => {

      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "copilot"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("copilot");
      expect(execution.status).toBe("running");
    });

    it("should persist agent_type to database", async () => {

      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "claude-code"
      );

      // Query database directly
      const dbExecution = db
        .prepare("SELECT agent_type FROM executions WHERE id = ?")
        .get(execution.id) as { agent_type: string };

      expect(dbExecution.agent_type).toBe("claude-code");
    });

    it("should handle NULL agent_type in database gracefully", async () => {

      // Create execution
      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Manually set agent_type to NULL in database
      db.prepare("UPDATE executions SET agent_type = NULL WHERE id = ?").run(
        execution.id
      );

      // createFollowUp should handle NULL by defaulting to claude-code
      const followUp = await executionService.createFollowUp(
        execution.id,
        "Test follow-up"
      );

      expect(followUp.agent_type).toBe("claude-code");
    });
  });

  describe("Database Migration Integration", () => {
    it("should have applied migration v3 successfully", () => {
      const migrations = db
        .prepare("SELECT * FROM migrations ORDER BY version")
        .all() as Array<{ version: number; name: string }>;

      expect(migrations.length).toBeGreaterThanOrEqual(3);

      const migration3 = migrations.find((m) => m.version === 3);
      expect(migration3).toBeDefined();
      expect(migration3?.name).toBe("remove-agent-type-constraints");
    });

    it("should allow any agent_type value in database", () => {
      // Should be able to insert custom agent types
      expect(() => {
        db.exec("PRAGMA foreign_keys = OFF");
        db.prepare(
          `
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run(
          "test-exec-1",
          "main",
          "test-branch",
          "completed",
          "custom-agent"
        );
        db.exec("PRAGMA foreign_keys = ON");
      }).not.toThrow();

      const execution = db
        .prepare("SELECT agent_type FROM executions WHERE id = ?")
        .get("test-exec-1") as { agent_type: string };

      expect(execution.agent_type).toBe("custom-agent");
    });

    it("should allow NULL agent_type in database", () => {
      expect(() => {
        db.exec("PRAGMA foreign_keys = OFF");
        db.prepare(
          `
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type
          ) VALUES (?, ?, ?, ?, ?)
        `
        ).run("test-exec-2", "main", "test-branch", "completed", null);
        db.exec("PRAGMA foreign_keys = ON");
      }).not.toThrow();

      const execution = db
        .prepare("SELECT agent_type FROM executions WHERE id = ?")
        .get("test-exec-2") as { agent_type: string | null };

      expect(execution.agent_type).toBeNull();
    });
  });

  describe("Regression Testing - Claude Code Functionality", () => {
    it("should create Claude Code execution without breaking changes", async () => {

      const execution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      expect(execution).toBeDefined();
      expect(execution.id).toBeTruthy();
      expect(execution.issue_id).toBe(testIssueId);
      expect(execution.agent_type).toBe("claude-code");
      expect(execution.status).toBe("running");
      expect(execution.worktree_path).toBeTruthy();
      expect(execution.branch_name).toBeTruthy();
    });

    it("should list executions correctly", async () => {
      // Create an execution to ensure we have data
      const newExecution = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      const executions = executionService.listExecutions(testIssueId);
      expect(executions.length).toBeGreaterThan(0);

      // All executions should have agent_type
      // Check the execution we just created specifically
      const createdExec = executions.find((e) => e.id === newExecution.id);
      expect(createdExec).toBeDefined();
      expect(createdExec!.agent_type).toBeTruthy();
      expect(createdExec!.agent_type).toBe("claude-code");
    });

    // prepareExecution was removed - prompts are now passed directly to createExecution
  });

  describe("Multiple and Concurrent Executions", () => {
    it("should handle multiple sequential executions with same agent", async () => {
      const prompts = [
        "First execution prompt",
        "Second execution prompt",
        "Third execution prompt",
      ];

      const executionIds: string[] = [];

      // Create executions sequentially
      for (const prompt of prompts) {
        const execution = await executionService.createExecution(
          testIssueId,
          { mode: "local" },
          prompt,
          "claude-code"
        );

        expect(execution).toBeDefined();
        expect(execution.agent_type).toBe("claude-code");
        expect(execution.prompt).toBe(prompt);
        executionIds.push(execution.id);
      }

      // Verify all executions were created
      expect(executionIds).toHaveLength(3);
      expect(new Set(executionIds).size).toBe(3); // All unique IDs

      // Verify in database
      const dbExecutions = db
        .prepare(
          "SELECT id, agent_type, prompt FROM executions WHERE id IN (?, ?, ?)"
        )
        .all(...executionIds) as Array<{
        id: string;
        agent_type: string;
        prompt: string;
      }>;

      expect(dbExecutions).toHaveLength(3);

      // Sort database results to match the order of executionIds
      const sortedDbExecutions = executionIds.map(
        (id) => dbExecutions.find((exec) => exec.id === id)!
      );

      sortedDbExecutions.forEach((exec, index) => {
        expect(exec.agent_type).toBe("claude-code");
        expect(exec.prompt).toBe(prompts[index]);
      });
    });

    it("should handle multiple executions with explicit agent types", async () => {
      const executions: Array<{ prompt: string; agentType: string }> = [
        { prompt: "Execution 1 with claude-code", agentType: "claude-code" },
        { prompt: "Execution 2 with claude-code", agentType: "claude-code" },
        { prompt: "Execution 3 with claude-code", agentType: "claude-code" },
      ];

      const createdExecutions = [];

      for (const { prompt, agentType } of executions) {
        const execution = await executionService.createExecution(
          testIssueId,
          { mode: "local" },
          prompt,
          agentType as any
        );

        expect(execution.agent_type).toBe(agentType);
        expect(execution.prompt).toBe(prompt);
        createdExecutions.push(execution);
      }

      // Verify all executions are independent
      expect(createdExecutions).toHaveLength(3);
      const ids = createdExecutions.map((e) => e.id);
      expect(new Set(ids).size).toBe(3); // All unique

      // Verify they can be listed together
      const listedExecutions = executionService.listExecutions(testIssueId);
      const ourExecutions = listedExecutions.filter((e) => ids.includes(e.id));
      expect(ourExecutions).toHaveLength(3);
    });

    it("should handle concurrent execution creation without conflicts", async () => {
      // Create multiple executions concurrently
      const promises = [
        executionService.createExecution(
          testIssueId,
          { mode: "local" },
          "Concurrent execution 1",
          "claude-code"
        ),
        executionService.createExecution(
          testIssueId,
          { mode: "local" },
          "Concurrent execution 2",
          "claude-code"
        ),
        executionService.createExecution(
          testIssueId,
          { mode: "local" },
          "Concurrent execution 3",
          "claude-code"
        ),
      ];

      const results = await Promise.all(promises);

      // Verify all completed successfully
      expect(results).toHaveLength(3);
      results.forEach((execution) => {
        expect(execution).toBeDefined();
        expect(execution.id).toBeTruthy();
        expect(execution.agent_type).toBe("claude-code");
      });

      // Verify unique IDs
      const ids = results.map((e) => e.id);
      expect(new Set(ids).size).toBe(3);

      // Verify all are in database
      const dbExecutions = db
        .prepare("SELECT id, agent_type FROM executions WHERE id IN (?, ?, ?)")
        .all(...ids) as Array<{ id: string; agent_type: string }>;

      expect(dbExecutions).toHaveLength(3);
      dbExecutions.forEach((exec) => {
        expect(exec.agent_type).toBe("claude-code");
      });
    });

    it("should isolate executions from each other", async () => {
      // Create first execution
      const exec1 = await executionService.createExecution(
        testIssueId,
        { mode: "local" },
        "Isolated execution 1",
        "claude-code"
      );

      // Create second execution
      const exec2 = await executionService.createExecution(
        testIssueId,
        { mode: "local" },
        "Isolated execution 2",
        "claude-code"
      );

      // With mocked acp-factory, executions complete immediately
      // Check that both executions are tracked independently
      const exec1After = executionService.getExecution(exec1.id);
      const exec2After = executionService.getExecution(exec2.id);

      // Verify executions are independent (have different IDs and states)
      expect(exec1After?.id).not.toBe(exec2After?.id);
      expect(exec1After).toBeDefined();
      expect(exec2After).toBeDefined();

      // Both should have completed (or be in a terminal state) with mocked execution
      expect(["running", "completed", "stopped", "cancelled"]).toContain(exec1After?.status);
      expect(["running", "completed", "stopped", "cancelled"]).toContain(exec2After?.status);
    });

    it("should track agent type correctly across follow-up executions", async () => {
      // Create initial execution with worktree mode (required for follow-ups)
      const initialExec = await executionService.createExecution(
        testIssueId,
        { mode: "worktree" },
        "Initial execution for follow-up test",
        "claude-code"
      );

      expect(initialExec.agent_type).toBe("claude-code");
      expect(initialExec.worktree_path).toBeTruthy(); // Must have worktree for follow-ups

      // Create follow-up - should inherit agent type from parent
      const followUpExec = await executionService.createFollowUp(
        initialExec.id,
        "Follow-up feedback"
      );

      // Verify follow-up execution inherited the agent type
      expect(followUpExec.agent_type).toBe("claude-code");
      expect(followUpExec.id).toBeTruthy();
      expect(followUpExec.id).not.toBe(initialExec.id); // Different execution

      // Verify in database that agent_type was persisted
      const dbFollowUp = db
        .prepare("SELECT agent_type FROM executions WHERE id = ?")
        .get(followUpExec.id) as {
        agent_type: string;
      };

      expect(dbFollowUp.agent_type).toBe("claude-code");
    });
  });
});

/**
 * Create mock worktree manager for testing
 */
function createMockWorktreeManager(): IWorktreeManager {
  return {
    getConfig: () => ({
      worktreeStoragePath: ".worktrees",
      branchPrefix: "worktree",
      autoCreateBranches: true,
      autoDeleteBranches: false,
      enableSparseCheckout: false,
      cleanupOrphanedWorktreesOnStartup: false,
    }),

    createWorktree: async (_params: WorktreeCreateParams): Promise<void> => {
      return Promise.resolve();
    },

    cleanupWorktree: async (
      _worktreePath: string,
      _repoPath: string
    ): Promise<void> => {
      return Promise.resolve();
    },

    listWorktrees: async (_repoPath: string): Promise<WorktreeInfo[]> => {
      return Promise.resolve([]);
    },

    isValidRepo: async (_repoPath: string): Promise<boolean> => {
      return Promise.resolve(true);
    },

    listBranches: async (_repoPath: string): Promise<string[]> => {
      return Promise.resolve(["main", "develop"]);
    },

    ensureWorktreeExists: async (
      _repoPath: string,
      _branchName: string,
      _worktreePath: string
    ): Promise<void> => {
      return Promise.resolve();
    },

    isWorktreeValid: async (
      _repoPath: string,
      _worktreePath: string
    ): Promise<boolean> => {
      return Promise.resolve(true);
    },
  };
}
