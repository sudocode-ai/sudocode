/**
 * Integration Tests for Codex Agent
 *
 * Tests the complete Codex execution stack:
 * - Codex adapter configuration and validation
 * - Process config building
 * - Integration with agent registry
 * - Error handling scenarios
 *
 * Note: This test suite mocks actual Codex CLI execution to prevent
 * external API calls. Real E2E tests with actual Codex should be
 * run separately with proper API credentials.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { CodexAdapter } from "../../src/execution/adapters/codex-adapter.js";
import type { CodexConfig } from "@sudocode-ai/types/agents";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock WebSocket module
vi.mock("../../src/services/websocket.js", () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

describe("Codex Agent Integration", () => {
  let db: Database.Database;
  let testDbPath: string;
  let testDir: string;
  let testIssueId: string;
  let testSpecId: string;
  let codexAdapter: CodexAdapter;

  beforeAll(() => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-codex-test-"));
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
      title: "Test Codex execution",
      content: "Integration test for Codex agent",
    });

    const { id: specId, uuid: specUuid } = generateSpecId(db, testDir);
    testSpecId = specId;
    createSpec(db, {
      id: specId,
      uuid: specUuid,
      title: "Codex integration spec",
      content: "Test specification for Codex",
      file_path: path.join(testDir, "specs", "codex-test.md"),
    });

    addRelationship(db, {
      from_id: testIssueId,
      from_type: "issue",
      to_id: testSpecId,
      to_type: "spec",
      relationship_type: "implements",
    });

    // Initialize Codex adapter
    codexAdapter = new CodexAdapter();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.SUDOCODE_DIR;
  });

  describe("Codex Adapter", () => {
    it("should be registered in agent registry", () => {
      const adapter = agentRegistryService.getAdapter("codex");
      expect(adapter).toBeDefined();
      expect(adapter.metadata.name).toBe("codex");
      expect(adapter.metadata.displayName).toBe("OpenAI Codex");
    });

    it("should provide correct metadata", () => {
      const metadata = codexAdapter.metadata;
      expect(metadata.name).toBe("codex");
      expect(metadata.displayName).toBe("OpenAI Codex");
      expect(metadata.supportedModes).toContain("structured");
      expect(metadata.supportedModes).toContain("interactive");
      expect(metadata.supportsStreaming).toBe(true);
      expect(metadata.supportsStructuredOutput).toBe(true);
    });

    it("should provide default configuration", () => {
      const defaultConfig = codexAdapter.getDefaultConfig();
      expect(defaultConfig.codexPath).toBe("codex");
      expect(defaultConfig.exec).toBe(true);
      expect(defaultConfig.json).toBe(true);
      expect(defaultConfig.fullAuto).toBe(true);
      expect(defaultConfig.search).toBe(true);
      expect(defaultConfig.color).toBe("auto");
    });
  });

  describe("Configuration Building", () => {
    it("should build process config from Codex config", () => {
      const codexConfig: CodexConfig = {
        workDir: testDir,
        exec: true,
        json: true,
        fullAuto: true,
        search: true,
      };

      const processConfig = codexAdapter.buildProcessConfig(codexConfig);

      expect(processConfig).toBeDefined();
      expect(processConfig.executablePath).toBe("codex");
      expect(processConfig.args).toContain("exec");
      expect(processConfig.args).toContain("--json");
      expect(processConfig.args).toContain("--full-auto");
      expect(processConfig.args).toContain("--search");
      expect(processConfig.workDir).toBe(testDir);
    });

    it("should build config with custom Codex path", () => {
      const codexConfig: CodexConfig = {
        workDir: testDir,
        codexPath: "/custom/path/to/codex",
        exec: true,
      };

      const processConfig = codexAdapter.buildProcessConfig(codexConfig);

      expect(processConfig.executablePath).toBe("/custom/path/to/codex");
    });

    it("should build config with sandbox policy", () => {
      const codexConfig: CodexConfig = {
        workDir: testDir,
        sandbox: "workspace-write",
      };

      const processConfig = codexAdapter.buildProcessConfig(codexConfig);

      expect(processConfig.args).toContain("--sandbox");
      expect(processConfig.args).toContain("workspace-write");
    });

    it("should build config with approval policy", () => {
      const codexConfig: CodexConfig = {
        workDir: testDir,
        askForApproval: "on-failure",
      };

      const processConfig = codexAdapter.buildProcessConfig(codexConfig);

      expect(processConfig.args).toContain("--ask-for-approval");
      expect(processConfig.args).toContain("on-failure");
    });

    it("should build config with color mode", () => {
      const codexConfig: CodexConfig = {
        workDir: testDir,
        color: "always",
      };

      const processConfig = codexAdapter.buildProcessConfig(codexConfig);

      expect(processConfig.args).toContain("--color");
      expect(processConfig.args).toContain("always");
    });
  });

  describe("Configuration Validation", () => {
    it("should validate correct configuration", () => {
      const validConfig: CodexConfig = {
        workDir: testDir,
        exec: true,
        json: true,
        fullAuto: true,
      };

      const errors = codexAdapter.validateConfig(validConfig);
      expect(errors).toEqual([]);
    });

    it("should require workDir", () => {
      const invalidConfig: CodexConfig = {
        workDir: "",
        exec: true,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors).toContain("workDir is required");
    });

    it("should reject conflicting JSON flags", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        json: true,
        experimentalJson: true,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("json"))).toBe(true);
    });

    it("should reject fullAuto with sandbox", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        fullAuto: true,
        sandbox: "workspace-write",
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("fullAuto"))).toBe(true);
    });

    it("should reject fullAuto with askForApproval", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        fullAuto: true,
        askForApproval: "on-failure",
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("fullAuto"))).toBe(true);
    });

    it("should reject yolo with other approval flags", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        yolo: true,
        fullAuto: true,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("yolo"))).toBe(true);
    });

    it("should validate sandbox values", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        sandbox: "invalid-sandbox" as any,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("sandbox"))).toBe(true);
    });

    it("should validate askForApproval values", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        askForApproval: "invalid-approval" as any,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("askForApproval"))).toBe(true);
    });

    it("should validate color values", () => {
      const invalidConfig: CodexConfig = {
        workDir: testDir,
        color: "invalid-color" as any,
      };

      const errors = codexAdapter.validateConfig(invalidConfig);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("color"))).toBe(true);
    });
  });

  describe("Error Handling Scenarios", () => {
    it("should handle missing workDir gracefully", () => {
      const config: CodexConfig = {
        workDir: "",
      };

      const errors = codexAdapter.validateConfig(config);
      expect(errors).toContain("workDir is required");
    });

    it("should handle multiple validation errors", () => {
      const config: CodexConfig = {
        workDir: "",
        fullAuto: true,
        sandbox: "workspace-write",
        json: true,
        experimentalJson: true,
      };

      const errors = codexAdapter.validateConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(3); // workDir, fullAuto+sandbox, json conflict
    });

    it("should build config even with warnings (validation is separate)", () => {
      // Config builder should work even if config would fail validation
      const config: CodexConfig = {
        workDir: testDir,
        fullAuto: true,
        sandbox: "workspace-write", // Conflict with fullAuto
      };

      // Build should work (it's validation that catches conflicts)
      const processConfig = codexAdapter.buildProcessConfig(config);
      expect(processConfig).toBeDefined();

      // But validation should fail
      const errors = codexAdapter.validateConfig(config);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("Output Configuration", () => {
    it("should include JSON flag in args when json is enabled", () => {
      const config: CodexConfig = {
        workDir: testDir,
        json: true,
      };

      const processConfig = codexAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--json");
    });

    it("should include experimental JSON flag when experimentalJson is enabled", () => {
      const config: CodexConfig = {
        workDir: testDir,
        experimentalJson: true,
      };

      const processConfig = codexAdapter.buildProcessConfig(config);
      expect(processConfig.args).toContain("--experimental-json");
    });

    it("should not include JSON flags when disabled", () => {
      const config: CodexConfig = {
        workDir: testDir,
        json: false,
        experimentalJson: false,
      };

      const processConfig = codexAdapter.buildProcessConfig(config);
      expect(processConfig.args).not.toContain("--json");
      expect(processConfig.args).not.toContain("--experimental-json");
    });
  });
});
