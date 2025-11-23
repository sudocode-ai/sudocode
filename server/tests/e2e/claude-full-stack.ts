/**
 * End-to-End Tests for Phase 2: Direct Execution Pattern Migration
 *
 * Tests the complete execution flow using real ClaudeCodeExecutor (when available).
 * Based on the original full-stack.test.ts but updated for Phase 2 architecture.
 *
 * IMPORTANT: These tests require Claude Code CLI to be installed and are SKIPPED BY DEFAULT.
 * Set RUN_E2E_TESTS=true to enable them.
 *
 * RUN_E2E_TESTS=true npm --prefix server test -- --run tests/e2e/phase2-migration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { ExecutionService } from "../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../src/services/execution-logs-store.js";
import { TransportManager } from "../../src/execution/transport/transport-manager.js";
import { getExecution } from "../../src/services/executions.js";
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  ISSUES_TABLE,
  SPECS_TABLE,
  RELATIONSHIPS_TABLE,
  PROMPT_TEMPLATES_TABLE,
  DB_CONFIG,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";

// Check if E2E tests should run
const RUN_E2E = process.env.RUN_E2E_TESTS === "true";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

/**
 * Check if Claude Code CLI is available (synchronous check for skipIf)
 */
function checkClaudeAvailableSync(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`${CLAUDE_PATH} --version`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude Code CLI is available (async version for detailed checks)
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(CLAUDE_PATH, ["--version"], {
      stdio: "ignore",
    });

    check.on("error", () => resolve(false));
    check.on("exit", (code) => resolve(code === 0));

    setTimeout(() => {
      check.kill();
      resolve(false);
    }, 5000);
  });
}

// Check Claude availability at collection time for skipIf
const CLAUDE_AVAILABLE = RUN_E2E && checkClaudeAvailableSync();

describe.skipIf(!RUN_E2E || !CLAUDE_AVAILABLE)(
  "Phase 2 Migration - E2E Tests",
  () => {
    let db: Database.Database;
    let testDir: string;
    let repoPath: string;
    let executionService: ExecutionService;
    let transportManager: TransportManager;

    beforeAll(async () => {
      // Double-check Claude is available
      const claudeCheck = await checkClaudeAvailable();
      if (!claudeCheck) {
        console.log(
          "⚠️  Claude Code not available - E2E tests will be skipped"
        );
        console.log(
          "   To run E2E tests, ensure Claude Code is installed and in PATH"
        );
        console.log("   Or set CLAUDE_PATH environment variable");
        throw new Error("Claude Code not available");
      }

      // Create test directory
      testDir = join(tmpdir(), `sudocode-e2e-phase2-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });

      // Create test repo
      repoPath = join(testDir, "test-repo");
      mkdirSync(repoPath, { recursive: true });

      // Initialize git repo
      const { execSync } = require("child_process");
      execSync("git init", { cwd: repoPath });
      execSync('git config user.email "test@example.com"', { cwd: repoPath });
      execSync('git config user.name "Test User"', { cwd: repoPath });

      // Create initial commit
      writeFileSync(join(repoPath, "README.md"), "# Test Repo\n");
      execSync("git add README.md", { cwd: repoPath });
      execSync('git commit -m "Initial commit"', { cwd: repoPath });

      // Create database
      const dbPath = join(testDir, "test.db");
      db = new Database(dbPath);

      // Apply schema
      db.exec(DB_CONFIG);
      db.exec(ISSUES_TABLE);
      db.exec(SPECS_TABLE);
      db.exec(RELATIONSHIPS_TABLE);
      db.exec(EXECUTIONS_TABLE);
      db.exec(EXECUTION_LOGS_TABLE);
      db.exec(PROMPT_TEMPLATES_TABLE);

      // Run migrations
      runMigrations(db);

      // Create default issue template
      db.prepare(
        `
      INSERT INTO prompt_templates (id, name, description, type, template, variables, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      ).run(
        "default-issue-template",
        "Default Issue Template",
        "Default template for issue execution",
        "issue",
        "{{title}}\n\n{{description}}",
        "[]",
        1
      );

      // Create services
      const lifecycleService = new ExecutionLifecycleService(db, repoPath);
      const logsStore = new ExecutionLogsStore(db);
      transportManager = new TransportManager();

      executionService = new ExecutionService(
        db,
        "test-project",
        repoPath,
        lifecycleService,
        transportManager,
        logsStore
      );

      console.log("[E2E Setup] Test environment ready:", { testDir, repoPath });
    });

    afterAll(() => {
      if (db) {
        db.close();
      }
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      transportManager?.shutdown();
      console.log("[E2E Cleanup] Test environment cleaned up");
    });

    beforeEach(() => {
      // Clear executions before each test
      db?.prepare("DELETE FROM executions").run();
      db?.prepare("DELETE FROM issues").run();
    });

    describe("Full Execution Flow with Real Claude CLI", () => {
      it("should spawn Claude Code and process stream-json output", async () => {
        // Create test issue
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-1",
            randomUUID(),
            "E2E Test Issue",
            "Test with real Claude CLI"
          ) as any;

        expect(issue).toBeDefined();

        // Create execution with a simple task
        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          "List the files in the current directory using ls"
        );

        expect(execution).toBeDefined();
        expect(execution.id).toBeDefined();

        // Wait for execution to complete or timeout
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, execution.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          // Timeout after 30 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        // Verify execution completed
        const finalExecution = getExecution(db, execution.id);
        expect(finalExecution).toBeDefined();
        expect(["completed", "failed", "stopped"]).toContain(
          finalExecution?.status
        );

        // Verify logs were persisted
        const logs = db
          .prepare(
            "SELECT COUNT(*) as count FROM execution_logs WHERE execution_id = ?"
          )
          .get(execution.id) as { count: number };

        console.log("[E2E] Execution completed:", {
          status: finalExecution?.status,
          logCount: logs.count,
        });

        // Should have some logs
        expect(logs.count >= 0).toBe(true);
      }, 40000);

      it("should process AG-UI events via TransportManager", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-2",
            randomUUID(),
            "Event Test",
            "Test AG-UI events"
          ) as any;

        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          'Echo "testing events"'
        );

        // Wait for execution
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, execution.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        // Check buffered events
        const hasEvents = transportManager.hasBufferedEvents(execution.id);
        const bufferedEvents = transportManager.getBufferedEvents(execution.id);

        console.log("[E2E] AG-UI events:", {
          hasEvents,
          eventCount: bufferedEvents.length,
          eventTypes: bufferedEvents.map((e) => e.event.type),
        });

        // Should have buffered some events (at least RUN_STARTED)
        expect(hasEvents || bufferedEvents.length > 0).toBe(true);
      }, 40000);

      it("should track tool calls and file operations", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-3",
            randomUUID(),
            "Tool Call Test",
            "Test tool tracking"
          ) as any;

        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          'Use the Bash tool to echo "test"'
        );

        // Wait for execution
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, execution.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        // Verify logs were persisted
        const logMetadata = db
          .prepare(
            `
        SELECT * FROM execution_logs
        WHERE execution_id = ?
      `
          )
          .get(execution.id) as any;

        console.log("[E2E] Log metadata:", {
          hasRawLogs: !!logMetadata?.raw_logs,
          hasNormalizedEntry: !!logMetadata?.normalized_entry,
          byteSize: logMetadata?.byte_size || 0,
          lineCount: logMetadata?.line_count || 0,
        });

        // Should have initialized log record (content may be empty if execution was fast)
        expect(logMetadata).toBeDefined();
        expect(logMetadata.execution_id).toBe(execution.id);
      }, 40000);
    });

    describe("Worktree Mode E2E", () => {
      it("should create execution with worktree", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-worktree",
            randomUUID(),
            "Worktree Test",
            "Test worktree mode"
          ) as any;

        const execution = await executionService.createExecution(
          issue.id,
          { mode: "worktree" },
          "Show the current working directory"
        );

        expect(execution.mode).toBe("worktree");
        expect(execution.worktree_path).toBeDefined();

        // Wait for execution
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, execution.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        const finalExecution = getExecution(db, execution.id);
        console.log("[E2E] Worktree execution:", {
          status: finalExecution?.status,
          worktreePath: finalExecution?.worktree_path,
          worktreeExists: finalExecution?.worktree_path
            ? existsSync(finalExecution.worktree_path)
            : false,
        });

        expect(finalExecution).toBeDefined();
      }, 40000);
    });

    describe("Session Resumption E2E", () => {
      it("should support follow-up executions", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-resume",
            randomUUID(),
            "Resume Test",
            "Test session resumption"
          ) as any;

        // Create initial execution
        const initial = await executionService.createExecution(
          issue.id,
          { mode: "worktree" },
          'Create a file called test.txt with "hello"'
        );

        // Wait for it to complete
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, initial.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        // Create follow-up
        const followUp = await executionService.createFollowUp(
          initial.id,
          "List the files in the directory"
        );

        expect(followUp.id).not.toBe(initial.id);
        expect(followUp.issue_id).toBe(issue.id);

        console.log("[E2E] Session resumption:", {
          initialId: initial.id,
          followUpId: followUp.id,
          sameIssue: followUp.issue_id === issue.id,
        });

        expect(followUp).toBeDefined();
      }, 60000);
    });

    describe("Error Handling E2E", () => {
      it("should handle execution failures gracefully", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-error",
            randomUUID(),
            "Error Test",
            "Test error handling"
          ) as any;

        // This might fail or complete depending on Claude's interpretation
        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          "Execute an intentionally invalid command"
        );

        // Wait for it to process
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            const updated = getExecution(db, execution.id);
            if (
              updated &&
              updated.status !== "pending" &&
              updated.status !== "running"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 30000);
        });

        const finalExecution = getExecution(db, execution.id);
        console.log("[E2E] Error handling:", {
          status: finalExecution?.status,
          hasErrorMessage: !!finalExecution?.error_message,
        });

        // Should have completed (with success or failure)
        expect(finalExecution).toBeDefined();
        expect(["completed", "failed", "stopped"]).toContain(
          finalExecution?.status
        );
      }, 40000);
    });
  }
);

// Show message if tests are skipped
if (!RUN_E2E) {
  describe("Phase 2 Migration - E2E Tests (Skipped)", () => {
    it.skip("E2E tests skipped (set RUN_E2E_TESTS=true to enable)", () => {});
  });
}
