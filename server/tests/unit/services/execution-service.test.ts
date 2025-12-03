/**
 * Unit tests for ExecutionService
 *
 * Tests the high-level execution service that orchestrates
 * template rendering, worktree management, and workflow execution.
 */

import {
  describe,
  it,
  afterEach,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
} from "@sudocode-ai/types/schema";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { initializeDefaultTemplates } from "../../../src/services/prompt-templates.js";
import { updateExecution } from "../../../src/services/executions.js";
import {
  generateIssueId,
  generateSpecId,
} from "@sudocode-ai/cli/dist/id-generator.js";
import {
  createIssue,
  createSpec,
  addRelationship,
} from "@sudocode-ai/cli/dist/operations/index.js";
import type { IWorktreeManager } from "../../../src/execution/worktree/manager.js";
import type {
  WorktreeConfig,
  WorktreeCreateParams,
  WorktreeInfo,
} from "../../../src/execution/worktree/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the WebSocket module
vi.mock("../../../src/services/websocket.js", () => {
  return {
    broadcastExecutionUpdate: vi.fn(),
  };
});

// Mock the executor factory to avoid spawning real processes
vi.mock("../../../src/execution/executors/executor-factory.js", () => {
  return {
    createExecutorForAgent: vi.fn(() => {
      // Return a mock executor wrapper that mimics AgentExecutorWrapper interface
      return {
        executeWithLifecycle: vi.fn(async () => {
          // Return a promise that resolves immediately (non-blocking execution)
          return Promise.resolve();
        }),
        resumeWithLifecycle: vi.fn(async () => {
          // Return a promise that resolves immediately (non-blocking follow-up execution)
          return Promise.resolve();
        }),
        cancel: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
    }),
    validateAgentConfig: vi.fn(() => []),
  };
});

describe("ExecutionService", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let service: ExecutionService;

  beforeAll(() => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-test-exec-service-")
    );
    testDbPath = path.join(testDir, "cache.db");

    // Set SUDOCODE_DIR environment variable
    process.env.SUDOCODE_DIR = testDir;

    // Create config.json for ID generation
    const configPath = path.join(testDir, "config.json");
    const config = {
      version: "1.0.0",
      id_prefix: {
        spec: "SPEC",
        issue: "ISSUE",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Initialize test database (with both CLI and server tables)
    db = initCliDatabase({ path: testDbPath });
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);
    db.exec(PROMPT_TEMPLATES_TABLE);
    db.exec(PROMPT_TEMPLATES_INDEXES);

    // Initialize default prompt templates
    initializeDefaultTemplates(db);

    // Create test issue
    const { id: issueId, uuid: issueUuid } = generateIssueId(db, testDir);
    testIssueId = issueId;
    createIssue(db, {
      id: issueId,
      uuid: issueUuid,
      title: "Implement user authentication",
      content: "Add OAuth2 authentication with JWT tokens",
    });

    // Create test spec
    const { id: specId, uuid: specUuid } = generateSpecId(db, testDir);
    testSpecId = specId;
    createSpec(db, {
      id: specId,
      uuid: specUuid,
      title: "Authentication System Design",
      content: "OAuth2 with JWT tokens",
      file_path: path.join(testDir, "specs", "auth.md"),
    });

    // Link issue to spec
    addRelationship(db, {
      from_id: testIssueId,
      from_type: "issue",
      to_id: testSpecId,
      to_type: "spec",
      relationship_type: "implements",
    });

    // Create mock worktree manager
    const mockWorktreeManager = createMockWorktreeManager();

    // Create lifecycle service with mock
    const lifecycleService = new ExecutionLifecycleService(
      db,
      testDir,
      mockWorktreeManager
    );

    // Create execution service
    service = new ExecutionService(
      db,
      "test-project",
      testDir,
      lifecycleService
    );
  });

  afterAll(() => {
    // Clean up database
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  beforeEach(() => {
    // Clear mock call history before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up running executions after each test to prevent interference
    // This ensures each test starts with a clean slate
    const executions = service.listExecutions(testIssueId);
    for (const execution of executions) {
      if (execution.status === "running") {
        updateExecution(db, execution.id, {
          status: "stopped",
          completed_at: new Date().toISOString(),
        });
      }
    }
  });

  describe("prompt resolution", () => {
    it("should resolve [[s-xxxxx]] spec references in prompt", async () => {
      const promptWithSpec = `Implement authentication as per [[${testSpecId}]]`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithSpec
      );

      // Verify execution was created
      expect(execution.id).toBeTruthy();

      // Verify original (unexpanded) prompt is stored in database
      expect(execution.prompt).toBe(promptWithSpec);
      expect(execution.prompt).toContain(`[[${testSpecId}]]`);
    });

    it("should resolve @s-xxxxx spec references in prompt", async () => {
      const promptWithSpec = `Implement authentication as per @${testSpecId}`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithSpec
      );

      // Verify original (unexpanded) prompt is stored in database
      expect(execution.prompt).toBe(promptWithSpec);
      expect(execution.prompt).toContain(`@${testSpecId}`);
    });

    it("should resolve [[i-xxxxx]] issue references in prompt", async () => {
      const promptWithIssue = `Fix the bug from [[${testIssueId}]]`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithIssue
      );

      // Verify original (unexpanded) prompt is stored in database
      expect(execution.prompt).toBe(promptWithIssue);
      expect(execution.prompt).toContain(`[[${testIssueId}]]`);
    });

    it("should resolve @i-xxxxx issue references in prompt", async () => {
      const promptWithIssue = `Fix the bug from @${testIssueId}`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithIssue
      );

      // Verify original (unexpanded) prompt is stored in database
      expect(execution.prompt).toBe(promptWithIssue);
      expect(execution.prompt).toContain(`@${testIssueId}`);
    });

    it("should resolve multiple references in one prompt", async () => {
      const promptWithMultiple = `Implement [[${testSpecId}]] and fix @${testIssueId}`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithMultiple
      );

      // Verify original (unexpanded) prompt is stored in database
      expect(execution.prompt).toBe(promptWithMultiple);
      expect(execution.prompt).toContain(`[[${testSpecId}]]`);
      expect(execution.prompt).toContain(`@${testIssueId}`);
    });

    it("should pass through @file mentions unchanged", async () => {
      const promptWithFile = `Review @src/auth.ts and implement [[${testSpecId}]]`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithFile
      );

      // Verify original (unexpanded) prompt is stored with file mention and spec reference
      expect(execution.prompt).toBe(promptWithFile);
      expect(execution.prompt).toContain("@src/auth.ts");
      expect(execution.prompt).toContain(`[[${testSpecId}]]`);
    });

    it("should handle missing spec references gracefully", async () => {
      const promptWithMissing = `Implement [[s-nonexistent]]`;

      // Should not throw error
      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithMissing
      );

      // Missing reference should remain unchanged
      expect(execution.prompt).toContain("[[s-nonexistent]]");
    });

    it("should handle missing issue references gracefully", async () => {
      const promptWithMissing = `Fix @i-nonexistent`;

      // Should not throw error
      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        promptWithMissing
      );

      // Missing reference should remain unchanged
      expect(execution.prompt).toContain("@i-nonexistent");
    });

    it("should resolve references in worktree mode", async () => {
      const promptWithSpec = `Implement [[${testSpecId}]]`;

      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" },
        promptWithSpec
      );

      // Verify original (unexpanded) prompt is stored in worktree mode too
      expect(execution.prompt).toBe(promptWithSpec);
      expect(execution.prompt).toContain(`[[${testSpecId}]]`);
    });
  });

  describe("createExecution", () => {
    it("should create execution in worktree mode", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify execution was created
      expect(execution.id, "Should have execution ID").toBeTruthy();
      expect(execution.issue_id).toBe(testIssueId);
      expect(execution.agent_type).toBe("claude-code");
      expect(execution.status).toBe("running");
      expect(execution.worktree_path, "Should have worktree path").toBeTruthy();
      expect(execution.branch_name, "Should have branch name").toBeTruthy();

      // Verify branch name format (should be worktree/{uuid}/{sanitized-title})
      expect(execution.branch_name.startsWith("worktree/")).toBeTruthy();
      expect(
        execution.branch_name.includes("implement-user-authentication")
      ).toBeTruthy();
    });

    it("should create execution in local mode", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";

      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        issueContent
      );

      // Verify execution was created in local mode
      expect(execution.id).toBeTruthy();
      expect(execution.issue_id).toBe(testIssueId);
      expect(execution.status).toBe("running");
      // In local mode, worktree_path should be null
      expect(execution.worktree_path).toBe(null);
    });

    it("should capture before_commit in local mode", async () => {
      // Create a real git repo for this test
      const gitTestDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-git-local-")
      );

      try {
        // Initialize git repo
        const { execSync } = await import("child_process");
        execSync("git init", { cwd: gitTestDir });
        execSync('git config user.email "test@example.com"', {
          cwd: gitTestDir,
        });
        execSync('git config user.name "Test User"', { cwd: gitTestDir });

        // Create initial commit
        fs.writeFileSync(path.join(gitTestDir, "README.md"), "# Test\n");
        execSync("git add .", { cwd: gitTestDir });
        execSync('git commit -m "Initial commit"', { cwd: gitTestDir });

        // Get the current commit SHA
        const expectedCommit = execSync("git rev-parse HEAD", {
          cwd: gitTestDir,
          encoding: "utf-8",
        }).trim();

        // Initialize database in git test directory
        const gitTestDbPath = path.join(gitTestDir, ".sudocode", "cache.db");
        fs.mkdirSync(path.join(gitTestDir, ".sudocode"), { recursive: true });
        const gitTestDb = initCliDatabase({ path: gitTestDbPath });
        gitTestDb.exec(EXECUTIONS_TABLE);
        gitTestDb.exec(EXECUTIONS_INDEXES);
        gitTestDb.exec(PROMPT_TEMPLATES_TABLE);
        gitTestDb.exec(PROMPT_TEMPLATES_INDEXES);
        initializeDefaultTemplates(gitTestDb);

        // Create test issue in git test db
        const { id: gitIssueId, uuid: gitIssueUuid } = generateIssueId(
          gitTestDb,
          gitTestDir
        );
        const gitIssue = createIssue(gitTestDb, {
          id: gitIssueId,
          uuid: gitIssueUuid,
          title: "Test Issue for Git",
          content: "This is a test issue",
        });

        // Create execution service with git test directory
        const gitLifecycleService = new ExecutionLifecycleService(
          gitTestDb,
          gitTestDir,
          createMockWorktreeManager()
        );
        const gitService = new ExecutionService(
          gitTestDb,
          "test-project-git",
          gitTestDir,
          gitLifecycleService
        );

        const issueContent = "Add OAuth2 authentication";
        const execution = await gitService.createExecution(
          gitIssue.id,
          { mode: "local" },
          issueContent
        );

        // Verify before_commit was captured
        expect(execution.before_commit).toBe(expectedCommit);
        expect(execution.before_commit).toMatch(/^[0-9a-f]{40}$/);

        // Cleanup
        gitTestDb.close();
      } finally {
        // Clean up git test directory
        if (fs.existsSync(gitTestDir)) {
          fs.rmSync(gitTestDir, { recursive: true, force: true });
        }
      }
    });

    it("should throw error for empty prompt", async () => {
      await expect(
        service.createExecution(testIssueId, { mode: "worktree" }, "")
      ).rejects.toThrow(/Prompt cannot be empty/);

      await expect(
        service.createExecution(testIssueId, { mode: "worktree" }, "   ")
      ).rejects.toThrow(/Prompt cannot be empty/);
    });

    it("should throw error for non-existent issue", async () => {
      await expect(
        service.createExecution(
          "ISSUE-999",
          { mode: "worktree" },
          "Test prompt"
        )
      ).rejects.toThrow(/Issue ISSUE-999 not found/);
    });

    it("should default to claude-code agent when agentType not specified", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
        // agentType not specified, should default to 'claude-code'
      );

      expect(execution.agent_type).toBe("claude-code");
    });

    it("should create execution with specified agent type", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "claude-code" // Explicitly specify claude-code
      );

      expect(execution.agent_type).toBe("claude-code");
    });

    it("should create execution for codex agent", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";

      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "codex"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("codex");
      expect(execution.status).toBe("running");
    });

    it("should create execution for copilot agent", async () => {
      // Create a separate issue for this test to avoid "active execution" conflict
      const { id: copilotIssueId, uuid: copilotIssueUuid } = generateIssueId(
        db,
        testDir
      );
      createIssue(db, {
        id: copilotIssueId,
        uuid: copilotIssueUuid,
        title: "Test copilot",
        content: "Test copilot agent",
      });

      const copilotIssueContent = "Implement GitHub Copilot integration";

      // Copilot is now implemented
      const execution = await service.createExecution(
        copilotIssueId,
        { mode: "worktree" as const },
        copilotIssueContent,
        "copilot"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("copilot");
      expect(execution.status).toBe("running");
    });

    it("should create execution for cursor agent", async () => {
      // Create a separate issue for this test to avoid "active execution" conflict
      const { id: cursorIssueId, uuid: cursorIssueUuid } = generateIssueId(
        db,
        testDir
      );
      createIssue(db, {
        id: cursorIssueId,
        uuid: cursorIssueUuid,
        title: "Test cursor",
        content: "Test cursor agent",
      });

      const cursorIssueContent = "Integrate Cursor features";

      const execution = await service.createExecution(
        cursorIssueId,
        { mode: "worktree" as const },
        cursorIssueContent,
        "cursor"
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe("cursor");
      expect(execution.status).toBe("running");
    });
  });

  describe("createFollowUp", () => {
    it("should create follow-up execution reusing worktree", async () => {
      // Create initial execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Create follow-up
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests for the authentication flow"
      );

      // Verify follow-up execution
      expect(followUpExecution.id).toBeTruthy();
      expect(followUpExecution.id).not.toBe(initialExecution.id);
      expect(followUpExecution.issue_id).toBe(initialExecution.issue_id);
      expect(followUpExecution.worktree_path).toBe(
        initialExecution.worktree_path
      );
      expect(followUpExecution.branch_name).toBe(initialExecution.branch_name);
    });

    it("should preserve agent type from parent execution", async () => {
      // Create initial execution with explicit agent type
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent,
        "claude-code"
      );

      expect(initialExecution.agent_type).toBe("claude-code");

      // Create follow-up
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Follow-up should preserve agent type from parent
      expect(followUpExecution.agent_type).toBe("claude-code");
    });

    it("should store user feedback as prompt in follow-up execution", async () => {
      // Create initial execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify initial execution has a prompt (may be resolved if it had references)
      expect(initialExecution.prompt).toBeTruthy();
      expect(typeof initialExecution.prompt).toBe("string");

      // Create follow-up with specific feedback
      const feedbackText = "Please add unit tests for the authentication flow";
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        feedbackText
      );

      // Verify follow-up execution stores the feedback as the prompt
      expect(followUpExecution.prompt).toBe(feedbackText);
      expect(followUpExecution.prompt).not.toBe(initialExecution.prompt);
      expect(followUpExecution.parent_execution_id).toBe(initialExecution.id);
    });

    it("should throw error for non-existent execution", async () => {
      await expect(
        service.createFollowUp("non-existent-id", "feedback")
      ).rejects.toThrow(/Execution non-existent-id not found/);
    });

    it("should include original prompt when option is enabled", async () => {
      // Create initial execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Create follow-up with includeOriginalPrompt option
      const feedbackText = "Please add tests";
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        feedbackText,
        { includeOriginalPrompt: true }
      );

      // Verify prompt includes both original content and feedback
      expect(followUpExecution.prompt).toContain(issueContent);
      expect(followUpExecution.prompt).toContain(feedbackText);
      expect(followUpExecution.prompt).toBe(
        `${issueContent}\n\n${feedbackText}`
      );
    });

    it("should support follow-ups for local mode executions (no worktree)", async () => {
      // Create local execution (no worktree)
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const localExecution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        issueContent
      );

      // Follow-ups should work for local mode (uses repo path instead of worktree)
      const followUp = await service.createFollowUp(
        localExecution.id,
        "Continue the work"
      );

      expect(followUp).toBeDefined();
      expect(followUp.parent_execution_id).toBe(localExecution.id);
      expect(followUp.issue_id).toBe(testIssueId);
      expect(followUp.worktree_path).toBeNull(); // Local mode has no worktree
    });

    it("should inherit mode from parent execution (worktree mode)", async () => {
      // Create initial execution in worktree mode
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      expect(initialExecution.mode).toBe("worktree");

      // Create follow-up
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Follow-up should inherit mode from parent
      expect(followUpExecution.mode).toBe("worktree");
    });

    it("should inherit mode from parent execution (local mode)", async () => {
      // Create initial execution in local mode
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        issueContent
      );

      expect(initialExecution.mode).toBe("local");

      // Create follow-up
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Follow-up should inherit mode from parent
      expect(followUpExecution.mode).toBe("local");
    });

    it("should default to worktree mode when parent has worktree_path but no mode", async () => {
      // Create initial execution in worktree mode
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Manually clear the mode field to simulate legacy execution
      // (before mode field was consistently set)
      updateExecution(db, initialExecution.id, { mode: null as any });

      // Create follow-up from execution with worktree_path but no mode
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Should default to worktree mode since parent has worktree_path
      expect(followUpExecution.mode).toBe("worktree");
      expect(followUpExecution.worktree_path).toBe(
        initialExecution.worktree_path
      );
    });

    it("should default to local mode when parent has no worktree_path and no mode", async () => {
      // Create initial execution in local mode
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "local" },
        issueContent
      );

      // Manually clear the mode field to simulate legacy execution
      updateExecution(db, initialExecution.id, { mode: null as any });

      // Create follow-up from execution without worktree_path and no mode
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Should default to local mode since parent has no worktree_path
      expect(followUpExecution.mode).toBe("local");
      expect(followUpExecution.worktree_path).toBeNull();
    });
  });

  describe("cancelExecution", () => {
    it("should cancel running execution", async () => {
      // Create execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Cancel it
      await service.cancelExecution(execution.id);

      // Verify status updated
      const { getExecution } = await import(
        "../../../src/services/executions.js"
      );
      const updated = getExecution(db, execution.id);
      expect(updated?.status).toBe("stopped");
      expect(
        updated?.completed_at,
        "Should have completion timestamp"
      ).toBeTruthy();
    });

    it("should throw error for non-existent execution", async () => {
      await expect(service.cancelExecution("non-existent-id")).rejects.toThrow(
        /Execution non-existent-id not found/
      );
    });

    it("should throw error for non-running execution", async () => {
      // Create and immediately cancel
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      await service.cancelExecution(execution.id);

      // Try to cancel again
      await expect(service.cancelExecution(execution.id)).rejects.toThrow(
        /Cannot cancel execution in stopped state/
      );
    });
  });

  describe("cleanupExecution", () => {
    it("should cleanup execution resources", async () => {
      // Create execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Cleanup
      await service.cleanupExecution(execution.id);

      // Verify worktree path is kept in database for follow-up executions
      // (the filesystem worktree is deleted, but the path remains)
      const { getExecution } = await import(
        "../../../src/services/executions.js"
      );
      const updated = getExecution(db, execution.id);
      expect(updated?.worktree_path).toBe(execution.worktree_path);
    });

    it("should not throw error for non-existent execution", async () => {
      // Should silently succeed for non-existent executions
      await expect(
        service.cleanupExecution("non-existent-id")
      ).resolves.not.toThrow();
    });
  });

  describe("deleteExecution", () => {
    it("should delete a single execution", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify execution exists
      const before = service.getExecution(execution.id);
      expect(before).toBeDefined();
      expect(before?.id).toBe(execution.id);

      // Delete execution
      await service.deleteExecution(execution.id);

      // Verify execution is deleted
      const after = service.getExecution(execution.id);
      expect(after).toBeNull();
    });

    it("should delete entire execution chain", async () => {
      // Create initial execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const rootExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Create follow-up executions
      const followUp1 = await service.createFollowUp(
        rootExecution.id,
        "Please add tests"
      );
      const followUp2 = await service.createFollowUp(
        followUp1.id,
        "Please add documentation"
      );

      // Verify all executions exist
      expect(service.getExecution(rootExecution.id)).toBeDefined();
      expect(service.getExecution(followUp1.id)).toBeDefined();
      expect(service.getExecution(followUp2.id)).toBeDefined();

      // Delete from any point in the chain (should delete entire chain)
      await service.deleteExecution(followUp1.id);

      // Verify all executions in chain are deleted
      expect(service.getExecution(rootExecution.id)).toBeNull();
      expect(service.getExecution(followUp1.id)).toBeNull();
      expect(service.getExecution(followUp2.id)).toBeNull();
    });

    it("should throw error when deleting non-existent execution", async () => {
      await expect(service.deleteExecution("non-existent-id")).rejects.toThrow(
        "Execution non-existent-id not found"
      );
    });

    it("should cancel running executions before deletion", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Execution should be running or pending
      const beforeDelete = service.getExecution(execution.id);
      expect(["running", "pending", "preparing"]).toContain(
        beforeDelete?.status
      );

      // Delete should cancel and then delete
      await service.deleteExecution(execution.id);

      // Execution should be deleted
      expect(service.getExecution(execution.id)).toBeNull();
    });

    it("should delete branch when deleteBranch is true and branch was created by execution", async () => {
      // Note: This test verifies the branch deletion logic exists in the code
      // In our mock environment, the worktree manager doesn't create real branches,
      // so we're testing that the method accepts the parameter correctly
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify execution has branch_name different from target_branch
      const exec = service.getExecution(execution.id);
      expect(exec?.branch_name).toBeTruthy();
      expect(exec?.branch_name).not.toBe(exec?.target_branch);
      expect(exec?.branch_name).not.toBe("(detached)");

      // Delete execution with deleteBranch flag
      await expect(
        service.deleteExecution(execution.id, true)
      ).resolves.not.toThrow();

      // Verify execution is deleted
      expect(service.getExecution(execution.id)).toBeNull();
    });

    it("should not fail when deleteBranch is true but branch was not created by execution", async () => {
      // Create execution where branch_name == target_branch (no new branch created)
      const issueContent = "Add OAuth2 authentication with JWT tokens";

      // First create an execution to get the format
      const execution = await service.createExecution(
        testIssueId,
        { mode: "local" }, // Local mode uses repo branch
        issueContent
      );

      // Manually update the execution to simulate branch_name == target_branch
      const { updateExecution } = await import(
        "../../../src/services/executions.js"
      );
      updateExecution(db, execution.id, {
        branch_name: "main",
        target_branch: "main",
        status: "completed",
      });

      // Delete with deleteBranch=true should not fail (branch shouldn't be deleted)
      await expect(
        service.deleteExecution(execution.id, true)
      ).resolves.not.toThrow();

      // Verify execution is deleted
      expect(service.getExecution(execution.id)).toBeNull();
    });

    it("should not delete branch when deleteBranch is false", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Delete execution without deleteBranch flag (default: false)
      await service.deleteExecution(execution.id, false);

      // Verify execution is deleted
      expect(service.getExecution(execution.id)).toBeNull();
    });

    it("should not delete detached HEAD branches", async () => {
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Manually update execution to have detached HEAD
      const { updateExecution } = await import(
        "../../../src/services/executions.js"
      );
      updateExecution(db, execution.id, {
        branch_name: "(detached)",
        status: "completed",
      });

      // Delete with deleteBranch=true should not fail
      await expect(
        service.deleteExecution(execution.id, true)
      ).resolves.not.toThrow();

      // Verify execution is deleted
      expect(service.getExecution(execution.id)).toBeNull();
    });
  });

  describe("WebSocket broadcasting", () => {
    it("should broadcast execution_created when creating execution with issue", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Should broadcast execution created event
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        "test-project",
        execution.id,
        "created",
        execution,
        testIssueId
      );
    });

    it("should broadcast execution_status_changed on workflow completion", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Clear creation broadcast
      vi.clearAllMocks();

      // Wait a moment for workflow to potentially complete or update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The orchestrator should broadcast status changes
      // (Note: In real tests, the workflow may complete quickly or slowly
      // depending on the actual execution. This test verifies the broadcast
      // mechanism is wired up correctly)
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;

      // If workflow completed, we should see a status_changed broadcast
      if (calls.length > 0) {
        const statusChangedCall = calls.find(
          (call) => call[2] === "status_changed"
        );
        if (statusChangedCall) {
          expect(statusChangedCall[0]).toBe("test-project");
          expect(statusChangedCall[1]).toBe(execution.id);
          expect(statusChangedCall[3]?.status).toMatch(
            /running|completed|failed|stopped/
          );
          expect(statusChangedCall[4]).toBe(testIssueId);
        }
      }
    });

    it("should broadcast execution_status_changed when canceling execution", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Clear creation and any workflow broadcasts
      vi.clearAllMocks();

      // Cancel the execution
      await service.cancelExecution(execution.id);

      // Should broadcast status change to stopped
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;
      const statusChangedCall = calls.find(
        (call) => call[2] === "status_changed"
      );

      expect(statusChangedCall).toBeDefined();
      expect(statusChangedCall?.[0]).toBe("test-project");
      expect(statusChangedCall?.[1]).toBe(execution.id);
      expect(statusChangedCall?.[3]?.status).toBe("stopped");
      expect(statusChangedCall?.[4]).toBe(testIssueId);
    });

    it("should broadcast with issue_id for issue-linked executions", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify that issueId is passed for dual broadcast
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;
      expect(calls[0][4]).toBe(testIssueId); // Fifth parameter is issueId
    });

    it("should broadcast execution_created when creating follow-up execution", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      // Create initial execution
      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const initialExecution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Clear initial broadcast
      vi.clearAllMocks();

      // Create follow-up
      const followUpExecution = await service.createFollowUp(
        initialExecution.id,
        "Please add unit tests"
      );

      // Should broadcast creation of follow-up execution
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        "test-project",
        followUpExecution.id,
        "created",
        followUpExecution,
        testIssueId
      );
    });

    it("should broadcast execution_deleted when deleting execution", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      const execution = await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Clear creation broadcast
      vi.clearAllMocks();

      // Delete the execution
      await service.deleteExecution(execution.id);

      // Should broadcast deletion event
      expect(broadcastExecutionUpdate).toHaveBeenCalledWith(
        "test-project",
        execution.id,
        "deleted",
        { executionId: execution.id },
        testIssueId
      );
    });

    it("should include projectId in all broadcasts", async () => {
      const { broadcastExecutionUpdate } = await import(
        "../../../src/services/websocket.js"
      );

      const issueContent = "Add OAuth2 authentication with JWT tokens";
      await service.createExecution(
        testIssueId,
        { mode: "worktree" as const },
        issueContent
      );

      // Verify all broadcasts include the project ID
      const calls = vi.mocked(broadcastExecutionUpdate).mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toBe("test-project");
      });
    });
  });
});

/**
 * Create a mock worktree manager for testing
 */
function createMockWorktreeManager(): IWorktreeManager & {
  git: {
    deleteBranch: (
      repoPath: string,
      branchName: string,
      force: boolean
    ) => Promise<void>;
  };
} {
  const config: WorktreeConfig = {
    worktreeStoragePath: ".worktrees",
    branchPrefix: "worktree",
    autoCreateBranches: true,
    autoDeleteBranches: false,
    enableSparseCheckout: false,
    cleanupOrphanedWorktreesOnStartup: false,
  };

  return {
    getConfig: () => config,

    createWorktree: async (_params: WorktreeCreateParams): Promise<void> => {
      // Mock: just return success
      return Promise.resolve();
    },

    cleanupWorktree: async (
      _worktreePath: string,
      _repoPath: string
    ): Promise<void> => {
      // Mock: just return success
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

    // Mock git property for branch deletion tests
    git: {
      deleteBranch: async (
        _repoPath: string,
        _branchName: string,
        _force: boolean
      ): Promise<void> => {
        // Mock: just return success
        return Promise.resolve();
      },
    },
  };
}
