/**
 * Unit tests for Agent Registry Service
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentRegistryService,
  AgentNotFoundError,
  AgentNotImplementedError,
} from "../../../src/services/agent-registry.js";
import type { AgentType } from "@sudocode-ai/types/agents";

describe("AgentRegistryService", () => {
  let service: AgentRegistryService;

  beforeEach(() => {
    service = new AgentRegistryService();
    // No need to call initialize() - it's lazy-initialized on first use
  });

  describe("initialization", () => {
    it("should initialize successfully", () => {
      expect(service).toBeDefined();
    });

    it("should register all 6 agents", () => {
      const agents = service.getAvailableAgents();
      expect(agents).toHaveLength(6);
    });

    it("should register agents with correct names", () => {
      const agents = service.getAvailableAgents();
      const names = agents.map((a) => a.name);
      expect(names).toContain("claude-code");
      expect(names).toContain("codex");
      expect(names).toContain("gemini");
      expect(names).toContain("opencode");
      expect(names).toContain("copilot");
      expect(names).toContain("cursor");
    });
  });

  describe("getAvailableAgents", () => {
    it("should return agent metadata with implementation status", () => {
      const agents = service.getAvailableAgents();

      agents.forEach((agent) => {
        expect(agent).toHaveProperty("name");
        expect(agent).toHaveProperty("displayName");
        expect(agent).toHaveProperty("supportedModes");
        expect(agent).toHaveProperty("supportsStreaming");
        expect(agent).toHaveProperty("supportsStructuredOutput");
        expect(agent).toHaveProperty("implemented");
        expect(typeof agent.implemented).toBe("boolean");
      });
    });

    it("should mark Claude Code as implemented", () => {
      const agents = service.getAvailableAgents();
      const claudeCode = agents.find((a) => a.name === "claude-code");
      expect(claudeCode?.implemented).toBe(true);
    });

    it("should mark all agents as implemented", () => {
      const agents = service.getAvailableAgents();
      const codex = agents.find((a) => a.name === "codex");
      const gemini = agents.find((a) => a.name === "gemini");
      const opencode = agents.find((a) => a.name === "opencode");
      const copilot = agents.find((a) => a.name === "copilot");
      const cursor = agents.find((a) => a.name === "cursor");

      expect(codex?.implemented).toBe(true);
      expect(gemini?.implemented).toBe(true);
      expect(opencode?.implemented).toBe(true);
      expect(cursor?.implemented).toBe(true);
      expect(copilot?.implemented).toBe(true);
    });

    it("should return agents with correct metadata", () => {
      const agents = service.getAvailableAgents();

      const claudeCode = agents.find((a) => a.name === "claude-code");
      expect(claudeCode?.displayName).toBe("Claude");
      expect(claudeCode?.supportedModes).toEqual([
        "structured",
        "interactive",
        "hybrid",
      ]);
      expect(claudeCode?.supportsStreaming).toBe(true);
      expect(claudeCode?.supportsStructuredOutput).toBe(true);

      const codex = agents.find((a) => a.name === "codex");
      expect(codex?.displayName).toBe("Codex");
      expect(codex?.supportedModes).toEqual(["structured", "interactive"]);
      expect(codex?.supportsStreaming).toBe(true);
      expect(codex?.supportsStructuredOutput).toBe(true);
    });
  });

  describe("getAdapter", () => {
    it("should retrieve Claude Code adapter successfully", () => {
      const adapter = service.getAdapter("claude-code");
      expect(adapter).toBeDefined();
      expect(adapter.metadata.name).toBe("claude-code");
    });

    it("should retrieve adapters successfully", () => {
      const codexAdapter = service.getAdapter("codex");
      const cursorAdapter = service.getAdapter("cursor");

      expect(codexAdapter.metadata.name).toBe("codex");
      expect(cursorAdapter.metadata.name).toBe("cursor");
      // Note: copilot no longer has an adapter - it uses ACP via copilot-cli
    });

    it("should throw AgentNotFoundError for copilot (uses ACP, no adapter)", () => {
      // copilot now uses ACP via copilot-cli and doesn't have an adapter
      expect(() => {
        service.getAdapter("copilot");
      }).toThrow(AgentNotFoundError);
    });

    it("should throw AgentNotFoundError for unknown agent", () => {
      expect(() => {
        service.getAdapter("unknown" as AgentType);
      }).toThrow(AgentNotFoundError);
    });

    it("should throw AgentNotFoundError with correct message", () => {
      expect(() => {
        service.getAdapter("unknown" as AgentType);
      }).toThrow("Agent 'unknown' not found in registry");
    });
  });

  describe("isAgentImplemented", () => {
    it("should return true for Claude Code", () => {
      expect(service.isAgentImplemented("claude-code")).toBe(true);
    });

    it("should return true for Codex", () => {
      expect(service.isAgentImplemented("codex")).toBe(true);
    });

    it("should return true for Gemini", () => {
      expect(service.isAgentImplemented("gemini")).toBe(true);
    });

    it("should return true for Opencode", () => {
      expect(service.isAgentImplemented("opencode")).toBe(true);
    });

    it("should return true for Cursor", () => {
      expect(service.isAgentImplemented("cursor")).toBe(true);
    });

    it("should return true for Copilot", () => {
      expect(service.isAgentImplemented("copilot")).toBe(true);
    });
  });

  describe("hasAgent", () => {
    it("should return true for registered agents", () => {
      expect(service.hasAgent("claude-code")).toBe(true);
      expect(service.hasAgent("codex")).toBe(true);
      expect(service.hasAgent("gemini")).toBe(true);
      expect(service.hasAgent("opencode")).toBe(true);
      expect(service.hasAgent("copilot")).toBe(true);
      expect(service.hasAgent("cursor")).toBe(true);
    });

    it("should return false for unregistered agents", () => {
      expect(service.hasAgent("unknown" as AgentType)).toBe(false);
    });
  });

  describe("implemented adapters", () => {
    it("should work correctly with Codex adapter", () => {
      const adapter = service.getAdapter("codex");
      const processConfig = adapter.buildProcessConfig({
        workDir: "/tmp",
      });
      expect(processConfig).toBeDefined();
      expect(processConfig.workDir).toBe("/tmp");
      expect(processConfig.executablePath).toBe("codex");
    });

    // Note: Copilot no longer has an adapter - it uses ACP via copilot-cli

    it("should have working Cursor adapter", () => {
      const adapter = service.getAdapter("cursor");
      const config = adapter.buildProcessConfig({
        workDir: "/tmp",
      });
      expect(config.executablePath).toBe("cursor-agent");
      expect(config.workDir).toBe("/tmp");
    });
  });

  describe("markAsImplemented", () => {
    it("should throw AgentNotFoundError for unknown agent", () => {
      expect(() => {
        service.markAsImplemented("unknown" as AgentType);
      }).toThrow(AgentNotFoundError);
    });
  });

  describe("Claude Code adapter", () => {
    it("should have working buildProcessConfig", () => {
      const adapter = service.getAdapter("claude-code");
      const config = adapter.buildProcessConfig({
        workDir: "/tmp/test",
        print: true,
        outputFormat: "stream-json",
        verbose: true,
      });

      expect(config).toBeDefined();
      expect(config.workDir).toBe("/tmp/test");
      expect(config.args).toBeDefined();
      expect(Array.isArray(config.args)).toBe(true);
    });

    it("should have working validateConfig", () => {
      const adapter = service.getAdapter("claude-code");

      // Valid config
      const validErrors = adapter.validateConfig?.({
        workDir: "/tmp/test",
        print: true,
        outputFormat: "stream-json",
      });
      expect(validErrors).toEqual([]);

      // Invalid config - missing workDir
      const invalidErrors = adapter.validateConfig?.({
        workDir: "",
        print: false,
        outputFormat: "stream-json",
      });
      expect(invalidErrors).toBeDefined();
      expect(invalidErrors!.length).toBeGreaterThan(0);
    });

    it("should have working getDefaultConfig", () => {
      const adapter = service.getAdapter("claude-code");
      const defaults = adapter.getDefaultConfig?.();

      expect(defaults).toBeDefined();
      expect(defaults?.claudePath).toBe("claude");
      expect(defaults?.print).toBe(true);
      expect(defaults?.outputFormat).toBe("stream-json");
    });
  });
});
