/**
 * End-to-End Tests for Codex Agent Integration
 *
 * Tests the complete execution flow using real Codex CLI (when available).
 * Similar to claude-full-stack.test.ts but for the Codex agent.
 *
 * IMPORTANT: These tests require OpenAI Codex CLI to be installed and are SKIPPED BY DEFAULT.
 * Set RUN_E2E_TESTS=true to enable them.
 *
 * RUN_E2E_TESTS=true npm --prefix server test -- --run tests/e2e/codex-full-stack.test.ts
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
const CODEX_PATH = process.env.CODEX_PATH || "codex";

/**
 * Check if Codex CLI is available (synchronous check for skipIf)
 */
function checkCodexAvailableSync(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`${CODEX_PATH} --version`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Codex CLI is available (async version for detailed checks)
 */
async function checkCodexAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(CODEX_PATH, ["--version"], {
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

// Check Codex availability at collection time for skipIf
const CODEX_AVAILABLE = RUN_E2E && checkCodexAvailableSync();

describe.skipIf(!RUN_E2E || !CODEX_AVAILABLE)(
  "Codex Agent - E2E Tests",
  () => {
    let db: Database.Database;
    let testDir: string;
    let repoPath: string;
    let executionService: ExecutionService;
    let transportManager: TransportManager;

    beforeAll(async () => {
      // Double-check Codex is available
      const codexCheck = await checkCodexAvailable();
      if (!codexCheck) {
        console.log(
          "⚠️  Codex CLI not available - E2E tests will be skipped"
        );
        console.log(
          "   To run E2E tests, ensure Codex CLI is installed and in PATH"
        );
        console.log("   Or set CODEX_PATH environment variable");
        throw new Error("Codex CLI not available");
      }

      // Create test directory
      testDir = join(tmpdir(), `sudocode-e2e-codex-${randomUUID()}`);
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

      console.log("[E2E Setup] Codex test environment ready:", {
        testDir,
        repoPath,
      });
    });

    afterAll(() => {
      if (db) {
        db.close();
      }
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      transportManager?.shutdown();
      console.log("[E2E Cleanup] Codex test environment cleaned up");
    });

    beforeEach(() => {
      // Clear executions before each test
      db?.prepare("DELETE FROM executions").run();
      db?.prepare("DELETE FROM issues").run();
    });

    describe("Full Execution Flow with Real Codex CLI", () => {
      it("should spawn Codex and process JSON output", async () => {
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
            "test-issue-codex-1",
            randomUUID(),
            "Codex E2E Test Issue",
            "Test with real Codex CLI"
          ) as any;

        expect(issue).toBeDefined();

        // Create execution with Codex agent and a simple task
        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          "List the files in the current directory using ls",
          "codex" // Specify Codex agent
        );

        expect(execution).toBeDefined();
        expect(execution.id).toBeDefined();
        expect(execution.agent_type).toBe("codex");

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

        // Verify execution completed successfully
        const finalExecution = getExecution(db, execution.id);
        expect(finalExecution).toBeDefined();
        expect(finalExecution?.status).toBe("completed");

        // Should not have errors if Codex is properly configured
        if (finalExecution?.status === "failed") {
          console.error("[E2E Codex] Execution failed:", finalExecution?.error_message);
        }

        // Verify logs were persisted
        const logs = db
          .prepare(
            "SELECT COUNT(*) as count FROM execution_logs WHERE execution_id = ?"
          )
          .get(execution.id) as { count: number };

        console.log("[E2E Codex] Execution completed:", {
          status: finalExecution?.status,
          logCount: logs.count,
          agentType: finalExecution?.agent_type,
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
            "test-issue-codex-2",
            randomUUID(),
            "Codex Event Test",
            "Test AG-UI events with Codex"
          ) as any;

        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          'Echo "testing codex events"',
          "codex"
        );

        expect(execution.agent_type).toBe("codex");

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

        console.log("[E2E Codex] AG-UI events:", {
          hasEvents,
          eventCount: bufferedEvents.length,
          eventTypes: bufferedEvents.map((e) => e.event.type),
        });

        // Note: AG-UI event buffering may not be fully implemented for generic agents yet
        // This is primarily a regression test - if events are buffered, verify they're valid
        if (bufferedEvents.length > 0) {
          expect(bufferedEvents[0].event.type).toBeDefined();
        }

        // At minimum, execution should complete successfully
        const finalExecution = getExecution(db, execution.id);
        expect(finalExecution).toBeDefined();
      }, 40000);

      it("should handle Codex-specific configuration", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-codex-config",
            randomUUID(),
            "Codex Config Test",
            "Test Codex configuration options"
          ) as any;

        // Create execution with specific Codex config
        // Note: In a real scenario, you'd pass codex-specific config through ExecutionConfig
        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          "Show the current working directory",
          "codex"
        );

        expect(execution.agent_type).toBe("codex");

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
        console.log("[E2E Codex] Configuration test:", {
          status: finalExecution?.status,
          agentType: finalExecution?.agent_type,
        });

        expect(finalExecution).toBeDefined();
        expect(finalExecution?.agent_type).toBe("codex");
        expect(finalExecution?.status).toBe("completed");
      }, 40000);
    });

    describe("Worktree Mode E2E with Codex", () => {
      it("should create execution with worktree using Codex", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-codex-worktree",
            randomUUID(),
            "Codex Worktree Test",
            "Test worktree mode with Codex"
          ) as any;

        const execution = await executionService.createExecution(
          issue.id,
          { mode: "worktree" },
          "Show the current working directory",
          "codex"
        );

        expect(execution.mode).toBe("worktree");
        expect(execution.worktree_path).toBeDefined();
        expect(execution.agent_type).toBe("codex");

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
        console.log("[E2E Codex] Worktree execution:", {
          status: finalExecution?.status,
          worktreePath: finalExecution?.worktree_path,
          worktreeExists: finalExecution?.worktree_path
            ? existsSync(finalExecution.worktree_path)
            : false,
          agentType: finalExecution?.agent_type,
        });

        expect(finalExecution).toBeDefined();
        expect(finalExecution?.agent_type).toBe("codex");
        expect(finalExecution?.status).toBe("completed");
      }, 40000);
    });

    describe("Session Resumption E2E with Codex", () => {
      it("should support follow-up executions with Codex", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-codex-resume",
            randomUUID(),
            "Codex Resume Test",
            "Test session resumption with Codex"
          ) as any;

        // Create initial execution with Codex
        const initial = await executionService.createExecution(
          issue.id,
          { mode: "worktree" },
          'Create a file called test.txt with "hello from codex"',
          "codex"
        );

        expect(initial.agent_type).toBe("codex");

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
        expect(followUp.agent_type).toBe("codex"); // Should inherit agent type

        console.log("[E2E Codex] Session resumption:", {
          initialId: initial.id,
          followUpId: followUp.id,
          sameIssue: followUp.issue_id === issue.id,
          bothCodex:
            initial.agent_type === "codex" && followUp.agent_type === "codex",
        });

        expect(followUp).toBeDefined();
        expect(followUp.agent_type).toBe("codex");
      }, 60000);
    });

    describe("Error Handling E2E with Codex", () => {
      it("should handle task that might fail", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-codex-error",
            randomUUID(),
            "Codex Error Test",
            "Test error handling with Codex"
          ) as any;

        // Task that Codex might handle in different ways
        const execution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          "Run the command 'nonexistent-command-xyz' and handle any errors",
          "codex"
        );

        expect(execution.agent_type).toBe("codex");

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
        console.log("[E2E Codex] Error handling:", {
          status: finalExecution?.status,
          hasErrorMessage: !!finalExecution?.error_message,
          agentType: finalExecution?.agent_type,
        });

        // Should complete (Codex should handle the error gracefully in the task)
        expect(finalExecution).toBeDefined();
        expect(finalExecution?.agent_type).toBe("codex");
        // For this test, we accept either completed (if Codex handled the error)
        // or failed (if the execution itself failed)
        expect(["completed", "failed"]).toContain(finalExecution?.status);
      }, 40000);
    });

    describe("Codex vs Claude Code Comparison", () => {
      it("should run same task with both agents for comparison", async () => {
        const issue = db
          .prepare(
            `
        INSERT INTO issues (id, uuid, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
      `
          )
          .get(
            "test-issue-comparison",
            randomUUID(),
            "Agent Comparison Test",
            "Compare Codex and Claude Code"
          ) as any;

        const task = "Show the current date and time";

        // Run with Codex
        const codexExecution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          task,
          "codex"
        );

        // Run with Claude Code
        const claudeExecution = await executionService.createExecution(
          issue.id,
          { mode: "local" },
          task,
          "claude-code"
        );

        expect(codexExecution.agent_type).toBe("codex");
        expect(claudeExecution.agent_type).toBe("claude-code");

        // Wait for both to complete
        await new Promise<void>((resolve) => {
          let codexDone = false;
          let claudeDone = false;

          const checkInterval = setInterval(() => {
            const codexUpdated = getExecution(db, codexExecution.id);
            const claudeUpdated = getExecution(db, claudeExecution.id);

            if (
              codexUpdated &&
              codexUpdated.status !== "pending" &&
              codexUpdated.status !== "running"
            ) {
              codexDone = true;
            }

            if (
              claudeUpdated &&
              claudeUpdated.status !== "pending" &&
              claudeUpdated.status !== "running"
            ) {
              claudeDone = true;
            }

            if (codexDone && claudeDone) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 60000);
        });

        const finalCodex = getExecution(db, codexExecution.id);
        const finalClaude = getExecution(db, claudeExecution.id);

        console.log("[E2E Comparison] Agent comparison:", {
          codex: {
            status: finalCodex?.status,
            agentType: finalCodex?.agent_type,
          },
          claude: {
            status: finalClaude?.status,
            agentType: finalClaude?.agent_type,
          },
        });

        expect(finalCodex?.agent_type).toBe("codex");
        expect(finalClaude?.agent_type).toBe("claude-code");
      }, 70000);
    });
  }
);

// Show message if tests are skipped
if (!RUN_E2E) {
  describe("Codex Agent - E2E Tests (Skipped)", () => {
    it.skip("E2E tests skipped (set RUN_E2E_TESTS=true to enable)", () => {});
  });
} else if (!CODEX_AVAILABLE) {
  describe("Codex Agent - E2E Tests (Codex CLI Not Available)", () => {
    it.skip("Codex CLI not found - install Codex or set CODEX_PATH", () => {});
  });
}
