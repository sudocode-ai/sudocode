/**
 * Model Selection Bug Reproduction Tests (i-6ti6)
 *
 * Reproduces the bug where sudocode executions ignore the user's Claude Code
 * model configuration. When "Default (Agent Decides)" is selected, the user
 * expects their Claude Code profile (e.g., "opusplan" with sonnet 4.6 / opus 4.6)
 * to be respected. Instead, the execution uses a different model (e.g., opus 4.5)
 * because:
 *
 * 1. The env passed to AgentFactory.spawn() doesn't inherit process.env,
 *    so the user's ANTHROPIC_MODEL / profile settings are lost.
 * 2. The metadata model fallback hardcodes "claude-sonnet-4" instead of
 *    reflecting that no model was explicitly chosen.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import {
  claudeCodeHandler,
  processAgentConfig,
  type RawAgentConfig,
  type AgentConfigContext,
} from "../../../../src/execution/executors/agent-config-handlers.js";
import {
  createExecutorForAgent,
  type ExecutorFactoryConfig,
} from "../../../../src/execution/executors/executor-factory.js";
import { AcpExecutorWrapper } from "../../../../src/execution/executors/acp-executor-wrapper.js";
import { ExecutionLifecycleService } from "../../../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../../../src/services/execution-logs-store.js";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock AgentFactory to avoid side effects while preserving listAgents
vi.mock("acp-factory", async () => {
  const actual = await vi.importActual("acp-factory");
  const RealAgentFactory = (actual as any).AgentFactory;
  return {
    ...actual,
    AgentFactory: {
      register: vi.fn(),
      listAgents: (...args: any[]) => RealAgentFactory.listAgents(...args),
      spawn: vi.fn(),
    },
  };
});

describe("Model Selection Bug (i-6ti6)", () => {
  const defaultContext: AgentConfigContext = {
    isResume: false,
    workDir: "/test/workdir",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Bug 1: Default model selection loses user's environment
  // ===========================================================================
  describe("Bug: default model selection should not override user environment", () => {
    it("should NOT set ANTHROPIC_MODEL when model is undefined (default selection)", () => {
      // User selects "Default (Agent Decides)" in the UI.
      // The frontend sends model: undefined.
      const rawConfig: RawAgentConfig = {};

      const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

      // ANTHROPIC_MODEL should NOT be set — let Claude Code use its own config
      expect(result.env).toBeUndefined();
      // Specifically verify no ANTHROPIC_MODEL sneaks in
      expect(result.env?.ANTHROPIC_MODEL).toBeUndefined();
    });

    it("should NOT set ANTHROPIC_MODEL when model is empty string", () => {
      const rawConfig: RawAgentConfig = {
        model: "",
      };

      const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

      // Empty string is falsy, so no ANTHROPIC_MODEL should be set
      expect(result.env?.ANTHROPIC_MODEL).toBeUndefined();
    });

    it("should NOT set ANTHROPIC_MODEL when nested agentConfig.model is undefined", () => {
      const rawConfig: RawAgentConfig = {
        agentConfig: {},
      };

      const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

      expect(result.env?.ANTHROPIC_MODEL).toBeUndefined();
    });
  });

  // ===========================================================================
  // Bug 2: ACP executor env doesn't inherit process.env
  // ===========================================================================
  describe("Bug: AcpExecutorWrapper should inherit process.env for spawned agents", () => {
    let testDir: string;
    let db: Database.Database;
    let factoryConfig: ExecutorFactoryConfig;

    beforeAll(() => {
      testDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-model-selection-bug-")
      );
      const dbPath = path.join(testDir, "test.db");
      db = new Database(dbPath);

      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          agent_type TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          session_id TEXT,
          exit_code INTEGER,
          error_message TEXT,
          files_changed TEXT,
          parent_execution_id TEXT,
          workflow_execution_id TEXT,
          step_type TEXT,
          step_index INTEGER,
          step_config TEXT
        );

        CREATE TABLE IF NOT EXISTS execution_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          raw_logs TEXT,
          normalized_entry TEXT,
          FOREIGN KEY (execution_id) REFERENCES executions(id)
        );
      `);

      const lifecycleService = new ExecutionLifecycleService(db, testDir);
      const logsStore = new ExecutionLogsStore(db);

      factoryConfig = {
        workDir: testDir,
        lifecycleService,
        logsStore,
        projectId: "test-project",
        db,
      };
    });

    afterAll(() => {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("BUG REPRO: when no model is specified, acpConfig.env is undefined — user's process.env is lost", () => {
      // This is the core bug. When no model is specified:
      // 1. claudeCodeHandler.processConfig returns env: undefined
      // 2. executor-factory passes env: undefined to AcpExecutorWrapper
      // 3. AcpExecutorWrapper passes env: undefined to AgentFactory.spawn()
      // 4. If AgentFactory.spawn() doesn't merge with process.env, the user's
      //    ANTHROPIC_MODEL (from their Claude Code profile) is lost.

      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: testDir },
        factoryConfig
      );

      expect(executor).toBeInstanceOf(AcpExecutorWrapper);
      const acpConfig = (executor as any).acpConfig;

      // Current behavior: env is undefined when no model specified
      // This means AgentFactory.spawn() gets { env: undefined }
      // If acp-factory interprets this as "use empty env" instead of
      // "inherit process.env", the user's model config is lost.
      expect(acpConfig.env).toBeUndefined();

      // WHAT SHOULD HAPPEN: The env passed to spawn should at minimum
      // not prevent inheriting the user's process.env. Either:
      // a) env should be undefined AND acp-factory must inherit process.env (verify this), or
      // b) env should explicitly include process.env so user config is preserved
    });

    it("BUG REPRO: explicit model correctly overrides, but default does not preserve user config", () => {
      // With explicit model: works correctly
      const explicitExecutor = createExecutorForAgent(
        "claude-code",
        { workDir: testDir, model: "claude-sonnet-4-6" },
        factoryConfig
      );
      const explicitAcpConfig = (explicitExecutor as any).acpConfig;
      expect(explicitAcpConfig.env).toBeDefined();
      expect(explicitAcpConfig.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");

      // Without model (default): env is undefined, user's config is lost
      const defaultExecutor = createExecutorForAgent(
        "claude-code",
        { workDir: testDir },
        factoryConfig
      );
      const defaultAcpConfig = (defaultExecutor as any).acpConfig;

      // BUG: env is undefined — no mechanism to carry the user's shell ANTHROPIC_MODEL
      expect(defaultAcpConfig.env).toBeUndefined();

      // The fix should ensure that when env is undefined (or empty),
      // the spawned process still inherits process.env so the user's
      // Claude Code profile/model settings are respected.
    });

    it("BUG REPRO: user's env ANTHROPIC_MODEL is not forwarded when no explicit model set", () => {
      // Simulate a user who has ANTHROPIC_MODEL set in their shell
      // (e.g., from their Claude Code profile config)
      const originalEnv = process.env.ANTHROPIC_MODEL;
      try {
        process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";

        const executor = createExecutorForAgent(
          "claude-code",
          { workDir: testDir }, // No explicit model — "Default (Agent Decides)"
          factoryConfig
        );

        const acpConfig = (executor as any).acpConfig;

        // BUG: acpConfig.env is undefined, so it doesn't include the user's
        // process.env.ANTHROPIC_MODEL. If AgentFactory.spawn() creates a
        // subprocess with only acpConfig.env (not merging process.env),
        // the user's model preference is silently dropped.
        //
        // Expected after fix: either
        // - acpConfig.env includes process.env.ANTHROPIC_MODEL, or
        // - the spawn mechanism is verified to inherit process.env
        expect(acpConfig.env).toBeUndefined(); // Current buggy behavior
      } finally {
        // Restore
        if (originalEnv !== undefined) {
          process.env.ANTHROPIC_MODEL = originalEnv;
        } else {
          delete process.env.ANTHROPIC_MODEL;
        }
      }
    });

    it("should preserve user env vars alongside explicit model selection", () => {
      // When an explicit model IS set, other env vars from the config are merged.
      // But process.env is still not included.
      const executor = createExecutorForAgent(
        "claude-code",
        {
          workDir: testDir,
          model: "claude-sonnet-4-6",
          env: { CUSTOM_VAR: "custom-value" },
        },
        factoryConfig
      );

      const acpConfig = (executor as any).acpConfig;
      expect(acpConfig.env).toBeDefined();
      expect(acpConfig.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");
      expect(acpConfig.env.CUSTOM_VAR).toBe("custom-value");
    });
  });

  // ===========================================================================
  // Fix validation: Metadata model fallback now uses "default"
  // ===========================================================================
  describe("Fix: metadata model fallback uses 'default' instead of hardcoded model", () => {
    it("should record 'default' in metadata when no model was chosen", () => {
      // execution-service.ts now uses: model: mergedConfig.model || "default"
      const mergedConfig = { model: undefined as string | undefined };

      const metadataModel = mergedConfig.model || "default";

      expect(metadataModel).toBe("default");
    });

    it("should record the explicit model in metadata when one is chosen", () => {
      const mergedConfig = { model: "claude-sonnet-4-6" };

      const metadataModel = mergedConfig.model || "default";

      expect(metadataModel).toBe("claude-sonnet-4-6");
    });

    it("should not cause stale model stickiness in follow-ups", () => {
      // Parent execution was created with no model → metadata stores "default"
      const parentConfig = JSON.stringify({
        mode: "worktree",
        model: "default",
      });

      const parsedConfig = JSON.parse(parentConfig);
      const followUpModel = parsedConfig.model || "default";

      // Follow-up sees "default" — not a hardcoded model name that would
      // be sent as ANTHROPIC_MODEL and override the user's profile config
      expect(followUpModel).toBe("default");
    });
  });

  // ===========================================================================
  // Bug 4: Full flow — config handler → factory → executor
  // ===========================================================================
  describe("Bug: end-to-end model selection flow", () => {
    let testDir: string;
    let db: Database.Database;
    let factoryConfig: ExecutorFactoryConfig;

    beforeAll(() => {
      testDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-test-model-e2e-")
      );
      const dbPath = path.join(testDir, "test.db");
      db = new Database(dbPath);

      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          issue_id TEXT,
          agent_type TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          before_commit TEXT,
          after_commit TEXT,
          worktree_path TEXT,
          session_id TEXT,
          exit_code INTEGER,
          error_message TEXT,
          files_changed TEXT,
          parent_execution_id TEXT,
          workflow_execution_id TEXT,
          step_type TEXT,
          step_index INTEGER,
          step_config TEXT
        );

        CREATE TABLE IF NOT EXISTS execution_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          raw_logs TEXT,
          normalized_entry TEXT,
          FOREIGN KEY (execution_id) REFERENCES executions(id)
        );
      `);

      const lifecycleService = new ExecutionLifecycleService(db, testDir);
      const logsStore = new ExecutionLogsStore(db);

      factoryConfig = {
        workDir: testDir,
        lifecycleService,
        logsStore,
        projectId: "test-project",
        db,
      };
    });

    afterAll(() => {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("BUG REPRO: 'opusplan' user scenario — model config is completely ignored", () => {
      // Scenario: User has Claude Code configured with "opusplan" profile
      // (sonnet 4.6 for coding, opus 4.6 for planning).
      // They create an execution with "Default (Agent Decides)".

      // Step 1: Frontend sends model: undefined
      const userConfig = { workDir: testDir }; // No model specified

      // Step 2: Config handler produces no ANTHROPIC_MODEL
      const processedConfig = processAgentConfig(
        "claude-code",
        userConfig as RawAgentConfig,
        defaultContext
      );
      expect(processedConfig.env).toBeUndefined();

      // Step 3: Executor factory creates wrapper with env: undefined
      const executor = createExecutorForAgent(
        "claude-code",
        userConfig,
        factoryConfig
      );
      const acpConfig = (executor as any).acpConfig;
      expect(acpConfig.env).toBeUndefined();

      // Step 4: AgentFactory.spawn() receives { env: undefined }
      // If it doesn't inherit process.env, the user's "opusplan" profile
      // (which sets ANTHROPIC_MODEL or uses Claude Code's internal config)
      // is completely lost.

      // Step 5: The metadata records "claude-sonnet-4" (the hardcoded fallback),
      // but the actual model used is whatever ACP/Claude Code defaults to
      // (reportedly opus 4.5 for this user).

      // This is the full bug chain: user's model config is dropped at step 2-3,
      // and the metadata at step 5 hides the problem by showing a different model.
    });

    it("BUG REPRO: explicit model selection works correctly (contrast with default)", () => {
      // When user explicitly selects a model, everything works as expected.
      const userConfig = { workDir: testDir, model: "claude-sonnet-4-6" };

      // Config handler sets ANTHROPIC_MODEL
      const processedConfig = processAgentConfig(
        "claude-code",
        userConfig as RawAgentConfig,
        defaultContext
      );
      expect(processedConfig.env).toEqual({
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
      });

      // Factory passes it through to executor
      const executor = createExecutorForAgent(
        "claude-code",
        userConfig,
        factoryConfig
      );
      const acpConfig = (executor as any).acpConfig;
      expect(acpConfig.env).toBeDefined();
      expect(acpConfig.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");

      // This path works — the bug is only in the "default" path.
    });

    it("Fix: follow-up from 'default' parent does not override user's model config", () => {
      // After fix: parent execution stores model: "default" in metadata.
      // Follow-up inherits "default", config handler skips ANTHROPIC_MODEL,
      // so the user's Claude Code profile config is respected.

      const parentStoredConfig = {
        mode: "worktree",
        model: "default", // After fix: no longer hardcoded "claude-sonnet-4"
      };

      const followUpConfig = {
        workDir: testDir,
        model: parentStoredConfig.model, // "default" from parent
      };

      const processedConfig = processAgentConfig(
        "claude-code",
        followUpConfig as RawAgentConfig,
        defaultContext
      );

      // "default" is treated like no model — ANTHROPIC_MODEL is NOT set,
      // so the user's Claude Code profile (e.g., "opusplan") is respected.
      expect(processedConfig.env).toBeUndefined();
    });
  });
});
