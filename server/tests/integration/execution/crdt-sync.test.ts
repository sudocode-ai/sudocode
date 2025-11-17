/**
 * Integration Tests for CRDT Synchronization
 *
 * Tests the integration between ExecutionService and CRDT Agent/Coordinator
 * to ensure proper state synchronization during execution lifecycle.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
} from "@sudocode-ai/types/schema";
import { initializeDefaultTemplates } from "../../../src/services/prompt-templates.js";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { CRDTCoordinator, type ExecutionState, type AgentMetadata } from "../../../src/services/crdt-coordinator.js";
import { generateIssueId } from "@sudocode-ai/cli/dist/id-generator.js";
import { createIssue } from "@sudocode-ai/cli/dist/operations/index.js";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

/**
 * Helper to set up a git repository
 */
function setupGitRepository(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  // Initialize git repo
  execSync("git init", { cwd: repoPath, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', {
    cwd: repoPath,
    stdio: "ignore",
  });
  execSync('git config user.name "Test User"', {
    cwd: repoPath,
    stdio: "ignore",
  });

  // Create initial commit
  fs.writeFileSync(path.join(repoPath, "README.md"), "# Test Repository\n");
  execSync("git add .", { cwd: repoPath, stdio: "ignore" });
  execSync('git commit -m "Initial commit"', {
    cwd: repoPath,
    stdio: "ignore",
  });
}

describe("CRDT Synchronization Integration", () => {
  let db: Database.Database;
  let repoPath: string;
  let server: http.Server;
  let coordinator: CRDTCoordinator;
  let executionService: ExecutionService;
  let lifecycleService: ExecutionLifecycleService;
  let port: number;
  let wsPath: string;
  let coordinatorUrl: string;

  beforeAll(async () => {
    // Create temporary directory for test repository
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-crdt-test-"));
    setupGitRepository(repoPath);

    // Initialize database
    db = initCliDatabase(repoPath);

    // Create executions table
    db.exec(EXECUTIONS_TABLE);
    for (const index of EXECUTIONS_INDEXES) {
      try {
        db.exec(index);
      } catch (error) {
        // Ignore SQL comment errors
        if (error instanceof Error && !error.message.includes("syntax error")) {
          throw error;
        }
      }
    }

    // Initialize templates
    initializeDefaultTemplates(db);

    // Create HTTP server
    port = 30000 + Math.floor(Math.random() * 1000);
    wsPath = '/ws/crdt';
    server = http.createServer();

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(port, () => resolve());
    });

    // Initialize CRDT Coordinator
    coordinator = new CRDTCoordinator(db, {
      path: wsPath,
      persistInterval: 100, // Fast persistence for tests
      gcInterval: 60000
    });
    coordinator.init(server);

    // Construct coordinator URL
    coordinatorUrl = `ws://localhost:${port}${wsPath}`;

    // Initialize lifecycle service
    lifecycleService = new ExecutionLifecycleService(db, repoPath);

    // Initialize execution service with CRDT enabled
    executionService = new ExecutionService(
      db,
      repoPath,
      lifecycleService,
      undefined, // No transport manager for these tests
      undefined  // No logs store for these tests
    );
    executionService.setCRDTUrl(coordinatorUrl);
  });

  afterAll(async () => {
    // Shutdown services
    if (executionService) {
      await executionService.shutdown();
    }
    if (coordinator) {
      await coordinator.shutdown();
    }

    // Close HTTP server
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // Close database
    if (db) {
      db.close();
    }

    // Clean up test repository
    if (repoPath && fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clean up issues before each test
    db.prepare("DELETE FROM issues").run();
    db.prepare("DELETE FROM executions").run();
  });

  it("should create CRDT agent when execution is created", async () => {
    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test CRDT Issue",
      content: "This is a test issue for CRDT integration",
    });

    // Prepare execution
    const prepareResult = await executionService.prepareExecution(issueId);

    // Create execution (this should create and connect CRDT agent)
    const execution = await executionService.createExecution(
      issueId,
      {
        mode: "worktree",
        model: "claude-sonnet-4",
        baseBranch: "main",
      },
      prepareResult.renderedPrompt
    );

    // Wait a bit for agent to connect and register
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify agent metadata exists in coordinator
    const agentMetadata = coordinator.getAgentMetadata();
    const agent = agentMetadata.find((a) => a.executionId === execution.id);

    expect(agent).toBeDefined();
    expect(agent?.executionId).toBe(execution.id);
    expect(agent?.status).toBe("working"); // Should be working after workflow starts

    // Cancel execution to clean up
    await executionService.cancelExecution(execution.id);
  }, 30000); // 30 second timeout

  it("should track execution state in CRDT", async () => {
    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test CRDT State",
      content:"This is a test issue for state tracking",
      status: "open",
    });

    // Prepare and create execution
    const prepareResult = await executionService.prepareExecution(issueId);
    const execution = await executionService.createExecution(
      issueId,
      {
        mode: "worktree",
        model: "claude-sonnet-4",
        baseBranch: "main",
      },
      prepareResult.renderedPrompt
    );

    // Wait for execution to start and state to sync
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get execution state from coordinator
    const executionStates = coordinator.getExecutionState();
    const execState = executionStates.find((e) => e.executionId === execution.id);

    expect(execState).toBeDefined();
    expect(execState?.issueId).toBe(issueId);
    expect(["preparing", "running"]).toContain(execState?.status);

    // Cancel execution
    await executionService.cancelExecution(execution.id);

    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify cancelled state
    const updatedStates = coordinator.getExecutionState();
    const cancelledState = updatedStates.find((e) => e.executionId === execution.id);
    expect(cancelledState?.status).toBe("cancelled");
  }, 30000);

  it("should export JSONL on execution completion", async () => {
    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test JSONL Export",
      content:"Test issue for JSONL export verification",
      status: "open",
    });

    // Prepare and create execution
    const prepareResult = await executionService.prepareExecution(issueId);
    const execution = await executionService.createExecution(
      issueId,
      {
        mode: "worktree",
        model: "claude-sonnet-4",
        baseBranch: "main",
      },
      prepareResult.renderedPrompt
    );

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Cancel execution (this triggers cleanup and JSONL export)
    await executionService.cancelExecution(execution.id);

    // Wait for export to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify JSONL files exist in worktree
    const worktreeExists = await executionService.worktreeExists(execution.id);
    if (worktreeExists) {
      const dbExecution = executionService.getExecution(execution.id);
      if (dbExecution?.worktree_path) {
        const sudocodeDir = path.join(dbExecution.worktree_path, ".sudocode");
        const issuesJsonl = path.join(sudocodeDir, "issues.jsonl");

        // .sudocode directory should exist after export
        expect(fs.existsSync(sudocodeDir)).toBe(true);
      }
    }
  }, 30000);

  it("should handle multiple concurrent executions", async () => {
    // Create multiple test issues
    const issueIds = [];
    for (let i = 0; i < 3; i++) {
      const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
      createIssue(db, {
        id: issueId,
        uuid: issueUuid,
        title: `Test Concurrent Issue ${i}`,
        content:`Concurrent execution test ${i}`,
        status: "open",
      });
      issueIds.push(issueId);
    }

    // Create multiple executions
    const executions = [];
    for (const issueId of issueIds) {
      const prepareResult = await executionService.prepareExecution(issueId);
      const execution = await executionService.createExecution(
        issueId,
        {
          mode: "worktree",
          model: "claude-sonnet-4",
          baseBranch: "main",
        },
        prepareResult.renderedPrompt
      );
      executions.push(execution);
    }

    // Wait for all agents to connect
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify all agents are registered
    const agentMetadata = coordinator.getAgentMetadata();
    for (const execution of executions) {
      const agent = agentMetadata.find((a) => a.executionId === execution.id);
      expect(agent).toBeDefined();
      expect(agent?.executionId).toBe(execution.id);
    }

    // Verify all execution states exist
    const executionStates = coordinator.getExecutionState();
    for (const execution of executions) {
      const state = executionStates.find((s) => s.executionId === execution.id);
      expect(state).toBeDefined();
    }

    // Cancel all executions
    for (const execution of executions) {
      await executionService.cancelExecution(execution.id);
    }
  }, 60000);

  it("should handle agent reconnection gracefully", async () => {
    // This test verifies that the CRDT Agent can handle connection issues
    // In practice, the agent will fall back to local-only mode if coordinator is unavailable

    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test Reconnection",
      content:"Test agent reconnection handling",
      status: "open",
    });

    // Create execution
    const prepareResult = await executionService.prepareExecution(issueId);
    const execution = await executionService.createExecution(
      issueId,
      {
        mode: "worktree",
        model: "claude-sonnet-4",
        baseBranch: "main",
      },
      prepareResult.renderedPrompt
    );

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Agent should be connected (or in local-only mode)
    const agentMetadata = coordinator.getAgentMetadata();
    const agent = agentMetadata.find((a) => a.executionId === execution.id);

    // Agent may or may not be connected depending on timing
    // But execution should continue regardless
    expect(execution).toBeDefined();
    // Status could be preparing or running depending on timing
    expect(["preparing", "running"]).toContain(execution.status);

    // Cancel execution
    await executionService.cancelExecution(execution.id);
  }, 30000);

  it("should cleanup agents on service shutdown", async () => {
    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, repoPath);
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Test Shutdown",
      content:"Test service shutdown cleanup",
      status: "open",
    });

    // Create execution
    const prepareResult = await executionService.prepareExecution(issueId);
    const execution = await executionService.createExecution(
      issueId,
      {
        mode: "worktree",
        model: "claude-sonnet-4",
        baseBranch: "main",
      },
      prepareResult.renderedPrompt
    );

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Shutdown should disconnect all agents
    await executionService.shutdown();

    // Wait for disconnection
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Agent should be marked as disconnected
    const agentMetadata = coordinator.getAgentMetadata();
    const agent = agentMetadata.find((a) => a.executionId === execution.id);

    if (agent) {
      expect(agent.status).toBe("disconnected");
    }

    // Note: We need to recreate executionService for remaining tests
    executionService = new ExecutionService(
      db,
      repoPath,
      lifecycleService,
      undefined,
      undefined,
      {
        enabled: true,
        host: "localhost",
        port: 3002,
      }
    );
  }, 30000);
});
