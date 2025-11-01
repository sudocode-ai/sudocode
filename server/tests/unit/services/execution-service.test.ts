/**
 * Unit tests for ExecutionService
 *
 * Tests the high-level execution service that orchestrates
 * template rendering, worktree management, and workflow execution.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert";
import type Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
} from "@sudocode/types/schema";
import { ExecutionService } from "../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../src/services/execution-lifecycle.js";
import { initializeDefaultTemplates } from "../../../src/services/prompt-templates.js";
import { updateExecution } from "../../../src/services/executions.js";
import {
  generateIssueId,
  generateSpecId,
} from "@sudocode/cli/dist/id-generator.js";
import {
  createIssue,
  createSpec,
  addRelationship,
} from "@sudocode/cli/dist/operations/index.js";
import type { IWorktreeManager } from "../../../src/execution/worktree/manager.js";
import type {
  WorktreeConfig,
  WorktreeCreateParams,
  WorktreeInfo,
} from "../../../src/execution/worktree/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Skip tests that spawn real Claude processes unless E2E tests are enabled
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

describe("ExecutionService", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let service: ExecutionService;

  before(() => {
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
    testIssueId = generateIssueId(db, testDir);
    createIssue(db, {
      id: testIssueId,
      title: "Implement user authentication",
      content: "Add OAuth2 authentication with JWT tokens",
    });

    // Create test spec
    testSpecId = generateSpecId(db, testDir);
    createSpec(db, {
      id: testSpecId,
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
    service = new ExecutionService(db, testDir, lifecycleService);
  });

  after(() => {
    // Clean up database
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    // Unset environment variable
    delete process.env.SUDOCODE_DIR;
  });

  afterEach(() => {
    // Clean up running executions after each test to prevent interference
    // This ensures each test starts with a clean slate
    const executions = service.listExecutions(testIssueId);
    for (const execution of executions) {
      if (execution.status === "running") {
        updateExecution(db, execution.id, {
          status: "stopped",
          completed_at: Math.floor(Date.now() / 1000),
        });
      }
    }
  });

  describe("prepareExecution", () => {
    it("should load issue and render template", async () => {
      const result = await service.prepareExecution(testIssueId);

      // Verify structure
      assert.ok(result.renderedPrompt, "Should have rendered prompt");
      assert.ok(result.issue, "Should have issue");
      assert.ok(result.relatedSpecs, "Should have related specs");
      assert.ok(result.defaultConfig, "Should have default config");

      // Verify issue data
      assert.strictEqual(result.issue.id, testIssueId);
      assert.strictEqual(result.issue.title, "Implement user authentication");
      assert.strictEqual(
        result.issue.content,
        "Add OAuth2 authentication with JWT tokens"
      );

      // Verify related specs
      assert.strictEqual(result.relatedSpecs.length, 1);
      assert.strictEqual(result.relatedSpecs[0].id, testSpecId);
      assert.strictEqual(
        result.relatedSpecs[0].title,
        "Authentication System Design"
      );

      // Verify rendered prompt contains issue info
      assert.ok(
        result.renderedPrompt.includes(testIssueId),
        "Prompt should include issue ID"
      );
      assert.ok(
        result.renderedPrompt.includes("Implement user authentication"),
        "Prompt should include issue title"
      );
      assert.ok(
        result.renderedPrompt.includes("OAuth2 authentication with JWT tokens"),
        "Prompt should include issue content"
      );
      assert.ok(
        result.renderedPrompt.includes(testSpecId),
        "Prompt should include spec ID"
      );

      // Verify default config
      assert.strictEqual(result.defaultConfig.mode, "worktree");
      assert.strictEqual(result.defaultConfig.model, "claude-sonnet-4");
      assert.strictEqual(result.defaultConfig.baseBranch, "main");
    });

    it("should handle issue without related specs", async () => {
      // Create issue without relationships
      const isolatedIssueId = generateIssueId(db, testDir);
      createIssue(db, {
        id: isolatedIssueId,
        title: "Fix bug",
        content: "Fix the bug",
      });

      const result = await service.prepareExecution(isolatedIssueId);

      assert.ok(result.renderedPrompt);
      assert.strictEqual(result.relatedSpecs.length, 0);

      // Verify prompt doesn't include Related Specifications section
      assert.ok(
        !result.renderedPrompt.includes("Related Specifications"),
        "Should not include Related Specifications section"
      );
    });

    it("should throw error for non-existent issue", async () => {
      await assert.rejects(
        () => service.prepareExecution("ISSUE-999"),
        /Issue ISSUE-999 not found/
      );
    });

    it("should render template even with empty issue content", async () => {
      // Create issue with empty content
      const emptyIssueId = generateIssueId(db, testDir);
      createIssue(db, {
        id: emptyIssueId,
        title: "",
        content: "",
      });

      const result = await service.prepareExecution(emptyIssueId);

      // Template should still render with structure
      assert.ok(result.renderedPrompt);
      assert.ok(result.renderedPrompt.trim().length > 0);
      // Should include the template structure even if issue is empty
      assert.ok(result.renderedPrompt.includes("## Description"));
    });

    it("should allow config overrides", async () => {
      const result = await service.prepareExecution(testIssueId, {
        config: {
          mode: "local",
          model: "claude-opus-4",
          baseBranch: "develop",
        },
      });

      assert.strictEqual(result.defaultConfig.mode, "local");
      assert.strictEqual(result.defaultConfig.model, "claude-opus-4");
      assert.strictEqual(result.defaultConfig.baseBranch, "develop");
    });
  });

  describe("createExecution", () => {
    it(
      "should create execution in worktree mode",
      { skip: SKIP_E2E },
      async () => {
        const prepareResult = await service.prepareExecution(testIssueId);
        const execution = await service.createExecution(
          testIssueId,
          prepareResult.defaultConfig,
          prepareResult.renderedPrompt
        );

        // Verify execution was created
        assert.ok(execution.id, "Should have execution ID");
        assert.strictEqual(execution.issue_id, testIssueId);
        assert.strictEqual(execution.agent_type, "claude-code");
        assert.strictEqual(execution.status, "running");
        assert.ok(execution.worktree_path, "Should have worktree path");
        assert.ok(execution.branch_name, "Should have branch name");

        // Verify branch name format (should be worktree/{uuid}/{sanitized-title})
        assert.ok(
          execution.branch_name.startsWith("worktree/"),
          "Branch name should start with worktree/"
        );
        assert.ok(
          execution.branch_name.includes("implement-user-authentication"),
          "Branch name should include sanitized title"
        );
      }
    );

    it(
      "should create execution in local mode",
      { skip: SKIP_E2E },
      async () => {
        const prepareResult = await service.prepareExecution(testIssueId, {
          config: { mode: "local" },
        });

        const execution = await service.createExecution(
          testIssueId,
          { ...prepareResult.defaultConfig, mode: "local" },
          prepareResult.renderedPrompt
        );

        // Verify execution was created in local mode
        assert.ok(execution.id);
        assert.strictEqual(execution.issue_id, testIssueId);
        assert.strictEqual(execution.status, "running");
        // In local mode, worktree_path should be null
        assert.strictEqual(execution.worktree_path, null);
      }
    );

    it("should throw error for empty prompt", async () => {
      await assert.rejects(
        () => service.createExecution(testIssueId, { mode: "worktree" }, ""),
        /Prompt cannot be empty/
      );

      await assert.rejects(
        () => service.createExecution(testIssueId, { mode: "worktree" }, "   "),
        /Prompt cannot be empty/
      );
    });

    it("should throw error for non-existent issue", async () => {
      await assert.rejects(
        () =>
          service.createExecution(
            "ISSUE-999",
            { mode: "worktree" },
            "Test prompt"
          ),
        /Issue ISSUE-999 not found/
      );
    });
  });

  describe("createFollowUp", () => {
    it(
      "should create follow-up execution reusing worktree",
      { skip: SKIP_E2E },
      async () => {
        // Create initial execution
        const prepareResult = await service.prepareExecution(testIssueId);
        const initialExecution = await service.createExecution(
          testIssueId,
          prepareResult.defaultConfig,
          prepareResult.renderedPrompt
        );

        // Create follow-up
        const followUpExecution = await service.createFollowUp(
          initialExecution.id,
          "Please add unit tests for the authentication flow"
        );

        // Verify follow-up execution
        assert.ok(followUpExecution.id);
        assert.notStrictEqual(
          followUpExecution.id,
          initialExecution.id,
          "Follow-up should have different ID"
        );
        assert.strictEqual(
          followUpExecution.issue_id,
          initialExecution.issue_id,
          "Follow-up should have same issue ID"
        );
        assert.strictEqual(
          followUpExecution.worktree_path,
          initialExecution.worktree_path,
          "Follow-up should reuse same worktree"
        );
        assert.strictEqual(
          followUpExecution.branch_name,
          initialExecution.branch_name,
          "Follow-up should use same branch"
        );
      }
    );

    it("should throw error for non-existent execution", async () => {
      await assert.rejects(
        () => service.createFollowUp("non-existent-id", "feedback"),
        /Execution non-existent-id not found/
      );
    });

    it(
      "should throw error for execution without worktree",
      { skip: SKIP_E2E },
      async () => {
        // Create local execution (no worktree)
        const prepareResult = await service.prepareExecution(testIssueId, {
          config: { mode: "local" },
        });
        const localExecution = await service.createExecution(
          testIssueId,
          { ...prepareResult.defaultConfig, mode: "local" },
          prepareResult.renderedPrompt
        );

        await assert.rejects(
          () => service.createFollowUp(localExecution.id, "feedback"),
          /has no worktree/
        );
      }
    );
  });

  describe("cancelExecution", () => {
    it("should cancel running execution", { skip: SKIP_E2E }, async () => {
      // Create execution
      const prepareResult = await service.prepareExecution(testIssueId);
      const execution = await service.createExecution(
        testIssueId,
        prepareResult.defaultConfig,
        prepareResult.renderedPrompt
      );

      // Cancel it
      await service.cancelExecution(execution.id);

      // Verify status updated
      const { getExecution } = await import(
        "../../../src/services/executions.js"
      );
      const updated = getExecution(db, execution.id);
      assert.strictEqual(updated?.status, "stopped");
      assert.ok(updated?.completed_at, "Should have completion timestamp");
    });

    it("should throw error for non-existent execution", async () => {
      await assert.rejects(
        () => service.cancelExecution("non-existent-id"),
        /Execution non-existent-id not found/
      );
    });

    it(
      "should throw error for non-running execution",
      { skip: SKIP_E2E },
      async () => {
        // Create and immediately cancel
        const prepareResult = await service.prepareExecution(testIssueId);
        const execution = await service.createExecution(
          testIssueId,
          prepareResult.defaultConfig,
          prepareResult.renderedPrompt
        );

        await service.cancelExecution(execution.id);

        // Try to cancel again
        await assert.rejects(
          () => service.cancelExecution(execution.id),
          /Cannot cancel execution in stopped state/
        );
      }
    );
  });

  describe("cleanupExecution", () => {
    it("should cleanup execution resources", { skip: SKIP_E2E }, async () => {
      // Create execution
      const prepareResult = await service.prepareExecution(testIssueId);
      const execution = await service.createExecution(
        testIssueId,
        prepareResult.defaultConfig,
        prepareResult.renderedPrompt
      );

      // Cleanup
      await service.cleanupExecution(execution.id);

      // Verify worktree was removed from execution record
      const { getExecution } = await import(
        "../../../src/services/executions.js"
      );
      const updated = getExecution(db, execution.id);
      assert.strictEqual(
        updated?.worktree_path,
        null,
        "Worktree path should be cleared"
      );
    });

    it("should not throw error for non-existent execution", async () => {
      // Should silently succeed for non-existent executions
      await assert.doesNotReject(() =>
        service.cleanupExecution("non-existent-id")
      );
    });
  });

  describe("template rendering", () => {
    it("should handle variables in template", async () => {
      const result = await service.prepareExecution(testIssueId);

      // Verify variable substitution worked
      assert.ok(result.renderedPrompt.includes(testIssueId));
      assert.ok(
        result.renderedPrompt.includes("Implement user authentication")
      );
      assert.ok(
        result.renderedPrompt.includes("OAuth2 authentication with JWT tokens")
      );
    });

    it("should handle conditionals in template", async () => {
      // Issue with related specs should show Related Specifications section
      const withSpecs = await service.prepareExecution(testIssueId);
      assert.ok(
        withSpecs.renderedPrompt.includes("Related Specifications"),
        "Should include Related Specifications section"
      );

      // Issue without related specs should not show section
      const isolatedIssueId = generateIssueId(db, testDir);
      createIssue(db, {
        id: isolatedIssueId,
        title: "Isolated issue",
        content: "No related specs",
      });

      const withoutSpecs = await service.prepareExecution(isolatedIssueId);
      assert.ok(
        !withoutSpecs.renderedPrompt.includes("Related Specifications"),
        "Should not include Related Specifications section"
      );
    });

    it("should handle loops in template", async () => {
      // Create multiple related specs
      const spec2Id = generateSpecId(db, testDir);
      createSpec(db, {
        id: spec2Id,
        title: "Database Design",
        content: "User table schema",
        file_path: path.join(testDir, "specs", "db.md"),
      });

      addRelationship(db, {
        from_id: testIssueId,
        from_type: "issue",
        to_id: spec2Id,
        to_type: "spec",
        relationship_type: "references",
      });

      const result = await service.prepareExecution(testIssueId);

      // Verify both specs are listed
      assert.ok(
        result.renderedPrompt.includes(testSpecId),
        "Should include first spec"
      );
      assert.ok(
        result.renderedPrompt.includes(spec2Id),
        "Should include second spec"
      );
      assert.ok(
        result.renderedPrompt.includes("Authentication System Design"),
        "Should include first spec title"
      );
      assert.ok(
        result.renderedPrompt.includes("Database Design"),
        "Should include second spec title"
      );
    });
  });
});

/**
 * Create a mock worktree manager for testing
 */
function createMockWorktreeManager(): IWorktreeManager {
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
  };
}
