/**
 * Tests for agent operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  initializeAgentsDirectory,
  createAgentPreset,
  getAgentPreset,
  listAgentPresets,
  deleteAgentPreset,
  validateAgentPresets,
  isAgentsDirectoryInitialized,
  installDefaultPresets,
  listDefaultPresets,
  getAgentsDir,
  getPresetsDir,
  getHooksDir,
  getAgentConfigPath,
  getHooksConfigPath,
  type CreateAgentPresetInput,
} from "../../src/operations/agents.js";

describe("Agent Operations", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join("/tmp", `agent-test-${Date.now()}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("initializeAgentsDirectory", () => {
    it("should create agents directory structure", () => {
      initializeAgentsDirectory(sudocodeDir);

      expect(fs.existsSync(getAgentsDir(sudocodeDir))).toBe(true);
      expect(fs.existsSync(getPresetsDir(sudocodeDir))).toBe(true);
      expect(fs.existsSync(getHooksDir(sudocodeDir))).toBe(true);
    });

    it("should create default config.json", () => {
      initializeAgentsDirectory(sudocodeDir);

      const configPath = getAgentConfigPath(sudocodeDir);
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.version).toBe("1.0.0");
      expect(config.defaults).toBeDefined();
      expect(config.execution).toBeDefined();
      expect(config.hooks).toBeDefined();
    });

    it("should create default hooks.config.json", () => {
      initializeAgentsDirectory(sudocodeDir);

      const hooksConfigPath = getHooksConfigPath(sudocodeDir);
      expect(fs.existsSync(hooksConfigPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(hooksConfigPath, "utf8"));
      expect(config.version).toBe("1.0.0");
      expect(config.hooks).toEqual([]);
      expect(config.global_env).toBeDefined();
    });

    it("should create README in presets directory", () => {
      initializeAgentsDirectory(sudocodeDir);

      const readmePath = path.join(getPresetsDir(sudocodeDir), "README.md");
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    it("should not overwrite existing config files", () => {
      initializeAgentsDirectory(sudocodeDir);

      const configPath = getAgentConfigPath(sudocodeDir);
      const originalContent = fs.readFileSync(configPath, "utf8");

      // Modify config
      const config = JSON.parse(originalContent);
      config.custom = "value";
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Re-initialize
      initializeAgentsDirectory(sudocodeDir);

      // Config should not be overwritten
      const newConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(newConfig.custom).toBe("value");
    });
  });

  describe("isAgentsDirectoryInitialized", () => {
    it("should return false for uninitialized directory", () => {
      expect(isAgentsDirectoryInitialized(sudocodeDir)).toBe(false);
    });

    it("should return true for initialized directory", () => {
      initializeAgentsDirectory(sudocodeDir);
      expect(isAgentsDirectoryInitialized(sudocodeDir)).toBe(true);
    });
  });

  describe("createAgentPreset", () => {
    beforeEach(() => {
      initializeAgentsDirectory(sudocodeDir);
    });

    it("should create a basic agent preset", () => {
      const input: CreateAgentPresetInput = {
        id: "test-agent",
        name: "Test Agent",
        description: "A test agent",
      };

      const preset = createAgentPreset(sudocodeDir, input);

      expect(preset.id).toBe("test-agent");
      expect(preset.name).toBe("Test Agent");
      expect(preset.description).toBe("A test agent");
      expect(preset.version).toBe("1.0.0");
      expect(preset.config.agent_type).toBe("claude-code");
    });

    it("should create agent preset with tools", () => {
      const input: CreateAgentPresetInput = {
        id: "reviewer",
        name: "Reviewer",
        description: "Code reviewer",
        tools: ["Read", "Grep", "Glob"],
      };

      const preset = createAgentPreset(sudocodeDir, input);

      expect(preset.config.tools).toEqual(["Read", "Grep", "Glob"]);
    });

    it("should create agent preset with custom system prompt", () => {
      const input: CreateAgentPresetInput = {
        id: "custom",
        name: "Custom",
        description: "Custom agent",
        system_prompt: "Custom system prompt content",
      };

      const preset = createAgentPreset(sudocodeDir, input);

      expect(preset.system_prompt).toBe("Custom system prompt content");
    });

    it("should create valid .agent.md file", () => {
      const input: CreateAgentPresetInput = {
        id: "test",
        name: "Test",
        description: "Test agent",
      };

      createAgentPreset(sudocodeDir, input);

      const filePath = path.join(
        getPresetsDir(sudocodeDir),
        "test.agent.md"
      );
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("---");
      expect(content).toContain("id: test");
      expect(content).toContain("name: Test");
      expect(content).toContain("# System Prompt");
    });

    it("should throw error if preset already exists", () => {
      const input: CreateAgentPresetInput = {
        id: "duplicate",
        name: "Duplicate",
        description: "Test",
      };

      createAgentPreset(sudocodeDir, input);

      expect(() => createAgentPreset(sudocodeDir, input)).toThrow(
        "Agent preset already exists: duplicate"
      );
    });
  });

  describe("getAgentPreset", () => {
    beforeEach(() => {
      initializeAgentsDirectory(sudocodeDir);
    });

    it("should retrieve existing preset", () => {
      const input: CreateAgentPresetInput = {
        id: "test",
        name: "Test",
        description: "Test agent",
      };

      createAgentPreset(sudocodeDir, input);

      const preset = getAgentPreset(sudocodeDir, "test");
      expect(preset).not.toBeNull();
      expect(preset?.id).toBe("test");
    });

    it("should return null for non-existent preset", () => {
      const preset = getAgentPreset(sudocodeDir, "nonexistent");
      expect(preset).toBeNull();
    });

    it("should parse all preset fields correctly", () => {
      const input: CreateAgentPresetInput = {
        id: "full-test",
        name: "Full Test",
        description: "Fully configured agent",
        version: "2.0.0",
        agent_type: "cursor",
        model: "claude-sonnet-4-5",
        tools: ["Read", "Write"],
        mcp_servers: ["github"],
        max_context_tokens: 100000,
        isolation_mode: "isolated",
        capabilities: ["testing"],
        protocols: ["mcp"],
        tags: ["test"],
      };

      createAgentPreset(sudocodeDir, input);

      const preset = getAgentPreset(sudocodeDir, "full-test");
      expect(preset).not.toBeNull();
      expect(preset?.version).toBe("2.0.0");
      expect(preset?.config.agent_type).toBe("cursor");
      expect(preset?.config.model).toBe("claude-sonnet-4-5");
      expect(preset?.config.tools).toEqual(["Read", "Write"]);
      expect(preset?.config.mcp_servers).toEqual(["github"]);
      expect(preset?.config.max_context_tokens).toBe(100000);
      expect(preset?.config.isolation_mode).toBe("isolated");
      expect(preset?.config.capabilities).toEqual(["testing"]);
      expect(preset?.config.protocols).toEqual(["mcp"]);
      expect(preset?.config.tags).toEqual(["test"]);
    });
  });

  describe("listAgentPresets", () => {
    beforeEach(() => {
      initializeAgentsDirectory(sudocodeDir);
    });

    it("should return empty array when no presets exist", () => {
      const presets = listAgentPresets(sudocodeDir);
      expect(presets).toEqual([]);
    });

    it("should list all presets", () => {
      createAgentPreset(sudocodeDir, {
        id: "preset1",
        name: "Preset 1",
        description: "First preset",
      });
      createAgentPreset(sudocodeDir, {
        id: "preset2",
        name: "Preset 2",
        description: "Second preset",
      });

      const presets = listAgentPresets(sudocodeDir);
      expect(presets.length).toBe(2);
      expect(presets.map((p) => p.id).sort()).toEqual(["preset1", "preset2"]);
    });

    it("should filter by tag", () => {
      createAgentPreset(sudocodeDir, {
        id: "tagged",
        name: "Tagged",
        description: "Tagged preset",
        tags: ["test"],
      });
      createAgentPreset(sudocodeDir, {
        id: "untagged",
        name: "Untagged",
        description: "Untagged preset",
      });

      const presets = listAgentPresets(sudocodeDir, { tag: "test" });
      expect(presets.length).toBe(1);
      expect(presets[0].id).toBe("tagged");
    });

    it("should filter by agent_type", () => {
      createAgentPreset(sudocodeDir, {
        id: "claude",
        name: "Claude",
        description: "Claude agent",
        agent_type: "claude-code",
      });
      createAgentPreset(sudocodeDir, {
        id: "cursor",
        name: "Cursor",
        description: "Cursor agent",
        agent_type: "cursor",
      });

      const presets = listAgentPresets(sudocodeDir, {
        agent_type: "cursor",
      });
      expect(presets.length).toBe(1);
      expect(presets[0].id).toBe("cursor");
    });

    it("should filter by capability", () => {
      createAgentPreset(sudocodeDir, {
        id: "reviewer",
        name: "Reviewer",
        description: "Code reviewer",
        capabilities: ["code-review"],
      });
      createAgentPreset(sudocodeDir, {
        id: "tester",
        name: "Tester",
        description: "Test writer",
        capabilities: ["testing"],
      });

      const presets = listAgentPresets(sudocodeDir, {
        capability: "code-review",
      });
      expect(presets.length).toBe(1);
      expect(presets[0].id).toBe("reviewer");
    });
  });

  describe("deleteAgentPreset", () => {
    beforeEach(() => {
      initializeAgentsDirectory(sudocodeDir);
    });

    it("should delete existing preset", () => {
      createAgentPreset(sudocodeDir, {
        id: "to-delete",
        name: "To Delete",
        description: "Will be deleted",
      });

      const deleted = deleteAgentPreset(sudocodeDir, "to-delete");
      expect(deleted).toBe(true);

      const preset = getAgentPreset(sudocodeDir, "to-delete");
      expect(preset).toBeNull();
    });

    it("should return false for non-existent preset", () => {
      const deleted = deleteAgentPreset(sudocodeDir, "nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("validateAgentPresets", () => {
    beforeEach(() => {
      initializeAgentsDirectory(sudocodeDir);
    });

    it("should validate valid presets", () => {
      createAgentPreset(sudocodeDir, {
        id: "valid",
        name: "Valid",
        description: "Valid preset",
        system_prompt: "Valid system prompt",
      });

      const results = validateAgentPresets(sudocodeDir);
      expect(results.length).toBe(1);
      expect(results[0].errors.length).toBe(0);
    });

    it("should detect invalid presets", () => {
      // Create a preset manually with invalid data
      const presetsDir = getPresetsDir(sudocodeDir);
      const invalidPreset = `---
id: invalid
name: Invalid
description: Invalid preset
version: not-semver
agent_type: unknown-type
---
`;
      fs.writeFileSync(
        path.join(presetsDir, "invalid.agent.md"),
        invalidPreset
      );

      const results = validateAgentPresets(sudocodeDir);
      expect(results.length).toBe(1);
      expect(results[0].errors.length).toBeGreaterThan(0);
    });
  });

  describe("default presets", () => {
    it("should list default presets", () => {
      const defaults = listDefaultPresets();
      expect(defaults.length).toBeGreaterThan(0);
      expect(defaults).toContain("code-reviewer");
      expect(defaults).toContain("test-writer");
      expect(defaults).toContain("refactorer");
      expect(defaults).toContain("documenter");
    });

    it("should install all default presets", () => {
      initializeAgentsDirectory(sudocodeDir);

      const installed = installDefaultPresets(sudocodeDir);
      expect(installed.length).toBeGreaterThan(0);

      // Verify presets were created
      const presets = listAgentPresets(sudocodeDir);
      expect(presets.length).toBe(installed.length);
    });

    it("should not reinstall existing presets without overwrite", () => {
      initializeAgentsDirectory(sudocodeDir);

      const firstInstall = installDefaultPresets(sudocodeDir);
      const secondInstall = installDefaultPresets(sudocodeDir);

      expect(firstInstall.length).toBeGreaterThan(0);
      expect(secondInstall.length).toBe(0); // Nothing installed
    });

    it("should reinstall with overwrite flag", () => {
      initializeAgentsDirectory(sudocodeDir);

      const firstInstall = installDefaultPresets(sudocodeDir);
      const secondInstall = installDefaultPresets(sudocodeDir, {
        overwrite: true,
      });

      expect(firstInstall.length).toBe(secondInstall.length);
    });

    it("should install specific presets only", () => {
      initializeAgentsDirectory(sudocodeDir);

      const installed = installDefaultPresets(sudocodeDir, {
        presets: ["code-reviewer", "test-writer"],
      });

      expect(installed).toEqual(["code-reviewer", "test-writer"]);
      expect(listAgentPresets(sudocodeDir).length).toBe(2);
    });
  });
});
