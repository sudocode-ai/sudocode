/**
 * End-to-End Tests for Persistent Session Execution Mode
 *
 * These tests verify persistent session functionality with actual Claude Code CLI.
 * Tests are skipped by default and require claude to be installed and available.
 *
 * ⚠️ These tests make REAL AI API calls (optimized with simple prompts).
 * Full suite runs in ~60-90 seconds.
 *
 * To run these tests:
 * 1. Install Claude Code CLI (https://claude.com/claude-code)
 * 2. Authenticate: claude login
 * 3. Set environment variable: RUN_E2E_TESTS=true
 * 4. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run persistent-session.test.ts
 *
 * Test coverage:
 * - Persistent session lifecycle (start → pending → prompt → pending → end)
 * - Multiple prompts in same session
 * - Session state tracking
 * - Explicit session termination
 * - Pause on completion mode
 *
 * @group e2e
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import { AcpExecutorWrapper } from "../../src/execution/executors/acp-executor-wrapper.js";
import { createExecutorForAgent } from "../../src/execution/executors/executor-factory.js";
import { ExecutionLifecycleService } from "../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../src/services/execution-logs-store.js";
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  ISSUES_TABLE,
  DB_CONFIG,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
import type { ExecutionTask } from "agent-execution-engine/engine";

// Skip E2E tests by default (they require claude to be installed)
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// Mock WebSocket broadcasts (we're testing execution, not WebSocket)
vi.mock("../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
  broadcastVoiceNarration: vi.fn(),
  broadcastSessionEvent: vi.fn(),
  websocketManager: {
    broadcast: vi.fn(),
    onDisconnect: vi.fn().mockReturnValue(() => {}),
    hasSubscribers: vi.fn().mockReturnValue(false),
  },
}));

// Mock execution event callbacks
vi.mock("../../src/services/execution-event-callbacks.js", () => ({
  notifyExecutionEvent: vi.fn().mockResolvedValue(undefined),
}));

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
 * Create an in-memory SQLite database with the required schema
 */
function createTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.exec(DB_CONFIG);
  db.exec(ISSUES_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);
  runMigrations(db);
  return db;
}

/**
 * Create an execution record in the database
 */
function createExecution(
  db: Database.Database,
  data: {
    id: string;
    issue_id?: string;
    agent_type?: string;
    mode?: string;
    prompt?: string;
    status?: string;
    target_branch?: string;
    branch_name?: string;
  }
) {
  const stmt = db.prepare(`
    INSERT INTO executions (
      id, issue_id, agent_type, mode, prompt, status,
      target_branch, branch_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    data.id,
    data.issue_id || null,
    data.agent_type || "claude-code",
    data.mode || "local",
    data.prompt || "Test prompt",
    data.status || "pending",
    data.target_branch || "main",
    data.branch_name || "test-branch"
  );
}

/**
 * Get an execution record from the database
 */
function getExecution(db: Database.Database, id: string) {
  const stmt = db.prepare("SELECT * FROM executions WHERE id = ?");
  return stmt.get(id) as any;
}

describe.skipIf(SKIP_E2E)("Persistent Session E2E Tests", () => {
  let tempDir: string;
  let db: Database.Database;
  let lifecycleService: ExecutionLifecycleService;
  let logsStore: ExecutionLogsStore;
  let wrapper: AcpExecutorWrapper;

  beforeAll(async () => {
    // Verify claude is available
    const available = await checkClaudeAvailable();
    if (!available) {
      throw new Error(
        "Claude Code CLI is not available. Install and authenticate first."
      );
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "persistent-session-e2e-"));

    // Create test file
    await fs.writeFile(
      path.join(tempDir, "test.txt"),
      "Hello from persistent session E2E test"
    );

    // Create test database and services
    db = createTestDatabase();
    lifecycleService = new ExecutionLifecycleService(db, tempDir);
    logsStore = new ExecutionLogsStore(db);

    // Create wrapper using factory
    wrapper = createExecutorForAgent(
      "claude-code",
      { workDir: tempDir },
      {
        workDir: tempDir,
        lifecycleService,
        logsStore,
        projectId: "e2e-test-project",
        db,
      }
    ) as AcpExecutorWrapper;
  });

  afterEach(async () => {
    // Clean up any active sessions
    try {
      // Give some time for any pending operations
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // Ignore cleanup errors
    }

    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    // Close database
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  });

  describe("Basic Persistent Session Flow", () => {
    it(
      "should start a persistent session and transition to pending state",
      { timeout: 120000 },
      async () => {
        const execId = "e2e-persistent-1";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-persistent-1",
          type: "issue",
          prompt: "What is 2 + 2? Reply with just the number.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Start persistent session
        await wrapper.executeWithLifecycle(execId, task, tempDir, {
          sessionMode: "persistent",
        });

        // Verify session is in pending state
        expect(wrapper.isPersistentSession(execId)).toBe(true);

        const state = wrapper.getSessionState(execId);
        expect(state).toBeDefined();
        expect(state?.mode).toBe("persistent");
        expect(state?.state).toBe("pending");
        expect(state?.promptCount).toBe(1);

        // Verify DB status
        const execution = getExecution(db, execId);
        expect(execution?.status).toBe("pending");

        // End session
        await wrapper.endSession(execId);
        expect(wrapper.isPersistentSession(execId)).toBe(false);

        // Verify final DB status
        const finalExecution = getExecution(db, execId);
        expect(finalExecution?.status).toBe("completed");
      }
    );

    it(
      "should send multiple prompts to the same persistent session",
      { timeout: 180000 },
      async () => {
        const execId = "e2e-multi-prompt";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-multi-1",
          type: "issue",
          prompt: "What is 5 + 5? Reply with just the number.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Start persistent session with first prompt
        await wrapper.executeWithLifecycle(execId, task, tempDir, {
          sessionMode: "persistent",
        });

        expect(wrapper.getSessionState(execId)?.promptCount).toBe(1);
        expect(wrapper.getSessionState(execId)?.state).toBe("pending");

        // Send second prompt
        await wrapper.sendPrompt(execId, "What is 10 + 10? Reply with just the number.");
        expect(wrapper.getSessionState(execId)?.promptCount).toBe(2);
        expect(wrapper.getSessionState(execId)?.state).toBe("pending");

        // Send third prompt
        await wrapper.sendPrompt(execId, "What is 20 + 20? Reply with just the number.");
        expect(wrapper.getSessionState(execId)?.promptCount).toBe(3);
        expect(wrapper.getSessionState(execId)?.state).toBe("pending");

        // End session
        await wrapper.endSession(execId);
        expect(wrapper.isPersistentSession(execId)).toBe(false);

        const execution = getExecution(db, execId);
        expect(execution?.status).toBe("completed");
      }
    );
  });

  describe("Session State Tracking", () => {
    it(
      "should track idle time correctly",
      { timeout: 120000 },
      async () => {
        const execId = "e2e-idle-time";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-idle-1",
          type: "issue",
          prompt: "What is 1 + 1? Reply with just the number.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Start persistent session
        await wrapper.executeWithLifecycle(execId, task, tempDir, {
          sessionMode: "persistent",
        });

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check idle time
        const state = wrapper.getSessionState(execId);
        expect(state?.idleTimeMs).toBeGreaterThanOrEqual(500);

        // End session
        await wrapper.endSession(execId);
      }
    );
  });

  describe("Pause on Completion Mode", () => {
    it(
      "should transition to paused state instead of pending when pauseOnCompletion is true",
      { timeout: 120000 },
      async () => {
        const execId = "e2e-pause-on-completion";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-pause-1",
          type: "issue",
          prompt: "What is 3 + 3? Reply with just the number.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Start persistent session with pauseOnCompletion
        await wrapper.executeWithLifecycle(execId, task, tempDir, {
          sessionMode: "persistent",
          sessionEndMode: { pauseOnCompletion: true },
        });

        // Verify paused state
        expect(wrapper.isPersistentSession(execId)).toBe(true);
        expect(wrapper.getSessionState(execId)?.state).toBe("paused");

        // Verify DB status
        const execution = getExecution(db, execId);
        expect(execution?.status).toBe("paused");

        // Can still send prompts when paused
        await wrapper.sendPrompt(execId, "What is 6 + 6? Reply with just the number.");
        expect(wrapper.getSessionState(execId)?.state).toBe("paused");
        expect(wrapper.getSessionState(execId)?.promptCount).toBe(2);

        // End session
        await wrapper.endSession(execId);
        expect(wrapper.isPersistentSession(execId)).toBe(false);
      }
    );
  });

  describe("Error Handling", () => {
    it("should reject sendPrompt for non-existent session", async () => {
      await expect(
        wrapper.sendPrompt("non-existent-session", "Test prompt")
      ).rejects.toThrow("No persistent session found");
    });

    it(
      "should reject sendPrompt when session is running",
      { timeout: 120000 },
      async () => {
        const execId = "e2e-reject-running";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-reject-1",
          type: "issue",
          // Use a slightly longer prompt to ensure we can catch it running
          prompt:
            "List the first 5 prime numbers and explain why each is prime. Be concise.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Start execution but don't await - catch it while running
        const execPromise = wrapper.executeWithLifecycle(execId, task, tempDir, {
          sessionMode: "persistent",
        });

        // Wait a tiny bit for execution to start
        await new Promise((resolve) => setTimeout(resolve, 500));

        // If still running, try to send prompt (should fail)
        const state = wrapper.getSessionState(execId);
        if (state?.state === "running") {
          await expect(
            wrapper.sendPrompt(execId, "Another prompt")
          ).rejects.toThrow("Cannot send prompt to session in state: running");
        }

        // Wait for completion
        await execPromise;

        // Clean up
        if (wrapper.isPersistentSession(execId)) {
          await wrapper.endSession(execId);
        }
      }
    );
  });

  describe("Discrete Mode Compatibility", () => {
    it(
      "should complete execution and close agent when not in persistent mode",
      { timeout: 120000 },
      async () => {
        const execId = "e2e-discrete";
        createExecution(db, {
          id: execId,
          agent_type: "claude-code",
          mode: "local",
        });

        const task: ExecutionTask = {
          id: "task-discrete-1",
          type: "issue",
          prompt: "What is 7 + 7? Reply with just the number.",
          workDir: tempDir,
          priority: 0,
          dependencies: [],
          config: {},
          createdAt: new Date(),
        };

        // Execute without persistent mode (discrete)
        await wrapper.executeWithLifecycle(execId, task, tempDir);

        // Should NOT be a persistent session
        expect(wrapper.isPersistentSession(execId)).toBe(false);

        // DB should show completed (not pending)
        const execution = getExecution(db, execId);
        expect(execution?.status).toBe("completed");
      }
    );
  });
});
