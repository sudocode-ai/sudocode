/**
 * Unit tests for ExecutionService
 *
 * Tests the high-level execution service that orchestrates
 * template rendering, worktree management, and workflow execution.
 */

import { describe, it, afterEach, expect, beforeAll, afterAll } from "vitest";
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
    service = new ExecutionService(db, testDir, lifecycleService);
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

  describe("prepareExecution", () => {
    it("should load issue and render template", async () => {
      const result = await service.prepareExecution(testIssueId);

      // Verify structure
      expect(result.renderedPrompt, "Should have rendered prompt").toBeTruthy();
      expect(result.issue, "Should have issue").toBeTruthy();
      expect(result.relatedSpecs, "Should have related specs").toBeTruthy();
      expect(result.defaultConfig, "Should have default config").toBeTruthy();

      // Verify issue data
      expect(result.issue.id).toBe(testIssueId);
      expect(result.issue.title).toBe("Implement user authentication");
      expect(result.issue.content).toBe(
        "Add OAuth2 authentication with JWT tokens"
      );

      // Verify related specs
      expect(result.relatedSpecs.length).toBe(1);
      expect(result.relatedSpecs[0].id).toBe(testSpecId);
      expect(result.relatedSpecs[0].title).toBe("Authentication System Design");

      // Verify rendered prompt contains issue info
      expect(result.renderedPrompt.includes(testIssueId)).toBeTruthy();
      expect(
        result.renderedPrompt.includes("Implement user authentication")
      ).toBeTruthy();
      expect(
        result.renderedPrompt.includes("OAuth2 authentication with JWT tokens")
      ).toBeTruthy();
      expect(result.renderedPrompt.includes(testSpecId)).toBeTruthy();

      // Verify default config
      expect(result.defaultConfig.mode).toBe("worktree");
      expect(result.defaultConfig.model).toBe("claude-sonnet-4");
      expect(result.defaultConfig.baseBranch).toBe("main");
    });

    it("should handle issue without related specs", async () => {
      // Create issue without relationships
      const { id: isolatedIssueId, uuid: isolatedIssueUuid } = generateIssueId(
        db,
        testDir
      );
      createIssue(db, {
        id: isolatedIssueId,
        uuid: isolatedIssueUuid,
        title: "Fix bug",
        content: "Fix the bug",
      });

      const result = await service.prepareExecution(isolatedIssueId);

      expect(result.renderedPrompt).toBeTruthy();
      expect(result.relatedSpecs.length).toBe(0);

      // Verify prompt doesn't include Related Specifications section
      expect(
        !result.renderedPrompt.includes("Related Specifications")
      ).toBeTruthy();
    });

    it("should throw error for non-existent issue", async () => {
      await expect(service.prepareExecution("ISSUE-999")).rejects.toThrow(
        /Issue ISSUE-999 not found/
      );
    });

    it("should render template even with empty issue content", async () => {
      // Create issue with empty content
      const { id: emptyIssueId, uuid: emptyIssueUuid } = generateIssueId(
        db,
        testDir
      );
      createIssue(db, {
        id: emptyIssueId,
        uuid: emptyIssueUuid,
        title: "",
        content: "",
      });

      const result = await service.prepareExecution(emptyIssueId);

      // Template should still render with structure
      expect(result.renderedPrompt).toBeTruthy();
      expect(result.renderedPrompt.trim().length > 0).toBeTruthy();
      // Should include the template structure even if issue is empty
      expect(result.renderedPrompt.includes("## Description")).toBeTruthy();
    });

    it("should allow config overrides", async () => {
      const result = await service.prepareExecution(testIssueId, {
        config: {
          mode: "local",
          model: "claude-opus-4",
          baseBranch: "develop",
        },
      });

      expect(result.defaultConfig.mode).toBe("local");
      expect(result.defaultConfig.model).toBe("claude-opus-4");
      expect(result.defaultConfig.baseBranch).toBe("develop");
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
        expect(execution.id, "Should have execution ID").toBeTruthy();
        expect(execution.issue_id).toBe(testIssueId);
        expect(execution.agent_type).toBe("claude-code");
        expect(execution.status).toBe("running");
        expect(
          execution.worktree_path,
          "Should have worktree path"
        ).toBeTruthy();
        expect(execution.branch_name, "Should have branch name").toBeTruthy();

        // Verify branch name format (should be worktree/{uuid}/{sanitized-title})
        expect(execution.branch_name.startsWith("worktree/")).toBeTruthy();
        expect(
          execution.branch_name.includes("implement-user-authentication")
        ).toBeTruthy();
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
        expect(execution.id).toBeTruthy();
        expect(execution.issue_id).toBe(testIssueId);
        expect(execution.status).toBe("running");
        // In local mode, worktree_path should be null
        expect(execution.worktree_path).toBe(null);
      }
    );

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
        expect(followUpExecution.id).toBeTruthy();
        expect(followUpExecution.id).not.toBe(initialExecution.id);
        expect(followUpExecution.issue_id).toBe(initialExecution.issue_id);
        expect(followUpExecution.worktree_path).toBe(
          initialExecution.worktree_path
        );
        expect(followUpExecution.branch_name).toBe(
          initialExecution.branch_name
        );
      }
    );

    it("should throw error for non-existent execution", async () => {
      await expect(
        service.createFollowUp("non-existent-id", "feedback")
      ).rejects.toThrow(/Execution non-existent-id not found/);
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

        await expect(
          service.createFollowUp(localExecution.id, "feedback")
        ).rejects.toThrow(/has no worktree/);
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
        await expect(service.cancelExecution(execution.id)).rejects.toThrow(
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

  describe("template rendering", () => {
    it("should handle variables in template", async () => {
      const result = await service.prepareExecution(testIssueId);

      // Verify variable substitution worked
      expect(result.renderedPrompt.includes(testIssueId)).toBeTruthy();
      expect(
        result.renderedPrompt.includes("Implement user authentication")
      ).toBeTruthy();
      expect(
        result.renderedPrompt.includes("OAuth2 authentication with JWT tokens")
      ).toBeTruthy();
    });

    it("should handle conditionals in template", async () => {
      // Issue with related specs should show Related Specifications section
      const withSpecs = await service.prepareExecution(testIssueId);
      expect(
        withSpecs.renderedPrompt.includes("Related Specifications")
      ).toBeTruthy();

      // Issue without related specs should not show section
      const { id: isolatedIssueId, uuid: isolatedIssueUuid } = generateIssueId(
        db,
        testDir
      );
      createIssue(db, {
        id: isolatedIssueId,
        uuid: isolatedIssueUuid,
        title: "Isolated issue",
        content: "No related specs",
      });

      const withoutSpecs = await service.prepareExecution(isolatedIssueId);
      expect(
        !withoutSpecs.renderedPrompt.includes("Related Specifications")
      ).toBeTruthy();
    });

    it("should handle loops in template", async () => {
      // Create multiple related specs
      const { id: spec2Id, uuid: spec2Uuid } = generateSpecId(db, testDir);
      createSpec(db, {
        id: spec2Id,
        uuid: spec2Uuid,
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
      expect(result.renderedPrompt.includes(testSpecId)).toBeTruthy();
      expect(result.renderedPrompt.includes(spec2Id)).toBeTruthy();
      expect(
        result.renderedPrompt.includes("Authentication System Design")
      ).toBeTruthy();
      expect(result.renderedPrompt.includes("Database Design")).toBeTruthy();
    });
  });

  describe("Direct Runner Integration", () => {
    it("should create executor with direct-runner mode", () => {
      const mockWorktreeManager = createMockWorktreeManager();
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );
      const service = new ExecutionService(db, testDir, lifecycleService);

      // Access private method via type assertion (for testing only)
      const config = {
        agentType: "claude-code" as const,
      };

      // Test executor factory method
      const executor = (service as any).createExecutor(config, testDir);
      expect(executor).toBeDefined();

      // Verify capabilities
      const capabilities = executor.getCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities.supportsApprovals).toBe(true);
      expect(capabilities.supportsSessionResume).toBe(true);
    });

    it("should throw error for unsupported agent type", () => {
      const mockWorktreeManager = createMockWorktreeManager();
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        mockWorktreeManager
      );
      const service = new ExecutionService(db, testDir, lifecycleService);

      const config = {
        agentType: "codex" as any, // Unsupported agent type
      };

      // Should throw error for unsupported agent type
      expect(() => {
        (service as any).createExecutor(config, testDir);
      }).toThrow("Unsupported agent type");
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
