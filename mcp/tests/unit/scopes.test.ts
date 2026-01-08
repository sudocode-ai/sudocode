/**
 * Tests for scope system
 */

import { describe, it, expect } from "vitest";
import {
  parseScopes,
  expandScopes,
  resolveScopes,
  getUsableScopes,
  getToolsForScopes,
  getScopeForTool,
  isToolAvailable,
  toolRequiresServer,
  hasExtendedScopes,
  getMissingServerUrlScopes,
  SCOPE_TOOLS,
} from "../../src/scopes.js";

describe("scopes", () => {
  describe("parseScopes", () => {
    it("parses single scope", () => {
      expect(parseScopes("default")).toEqual(["default"]);
    });

    it("parses comma-separated scopes", () => {
      expect(parseScopes("default,executions")).toEqual([
        "default",
        "executions",
      ]);
    });

    it("handles whitespace", () => {
      expect(parseScopes(" default , executions ")).toEqual([
        "default",
        "executions",
      ]);
    });

    it("parses meta-scopes", () => {
      expect(parseScopes("project-assistant")).toEqual(["project-assistant"]);
      expect(parseScopes("all")).toEqual(["all"]);
    });

    it("throws on invalid scope", () => {
      expect(() => parseScopes("invalid")).toThrow("Unknown scope");
    });

    it("lists valid scopes in error message", () => {
      expect(() => parseScopes("invalid")).toThrow("project-assistant");
    });
  });

  describe("expandScopes", () => {
    it("keeps default scope as-is", () => {
      const result = expandScopes(["default"]);
      expect(result.has("default")).toBe(true);
      expect(result.size).toBe(1);
    });

    it("expands parent scopes", () => {
      const result = expandScopes(["executions"]);
      expect(result.has("executions")).toBe(true);
      expect(result.has("executions:read")).toBe(true);
      expect(result.has("executions:write")).toBe(true);
    });

    it("expands project-assistant meta-scope", () => {
      const result = expandScopes(["project-assistant"]);
      expect(result.has("overview")).toBe(true);
      expect(result.has("executions")).toBe(true);
      expect(result.has("executions:read")).toBe(true);
      expect(result.has("executions:write")).toBe(true);
      expect(result.has("inspection")).toBe(true);
      expect(result.has("workflows")).toBe(true);
      expect(result.has("workflows:read")).toBe(true);
      expect(result.has("workflows:write")).toBe(true);
      expect(result.has("default")).toBe(false);
    });

    it("expands all meta-scope", () => {
      const result = expandScopes(["all"]);
      expect(result.has("default")).toBe(true);
      expect(result.has("overview")).toBe(true);
      expect(result.has("executions")).toBe(true);
      expect(result.has("inspection")).toBe(true);
      expect(result.has("workflows")).toBe(true);
    });

    it("handles granular scopes", () => {
      const result = expandScopes(["executions:read"]);
      expect(result.has("executions:read")).toBe(true);
      expect(result.has("executions:write")).toBe(false);
      expect(result.has("executions")).toBe(false);
    });
  });

  describe("resolveScopes", () => {
    it("returns ScopeConfig with resolved scopes", () => {
      const result = resolveScopes("default,executions", "http://localhost:3000");
      expect(result.enabledScopes.has("default")).toBe(true);
      expect(result.enabledScopes.has("executions")).toBe(true);
      expect(result.serverUrl).toBe("http://localhost:3000");
    });
  });

  describe("getUsableScopes", () => {
    it("includes default scope without server URL", () => {
      const enabled = new Set<any>(["default", "executions", "executions:read", "executions:write"]);
      const usable = getUsableScopes(enabled, undefined);
      expect(usable.has("default")).toBe(true);
      expect(usable.has("executions")).toBe(false);
    });

    it("includes extended scopes with server URL", () => {
      const enabled = new Set<any>(["default", "executions", "executions:read", "executions:write"]);
      const usable = getUsableScopes(enabled, "http://localhost:3000");
      expect(usable.has("default")).toBe(true);
      expect(usable.has("executions")).toBe(true);
      expect(usable.has("executions:read")).toBe(true);
      expect(usable.has("executions:write")).toBe(true);
    });
  });

  describe("getToolsForScopes", () => {
    it("returns default tools for default scope", () => {
      const tools = getToolsForScopes(new Set(["default"]));
      expect(tools).toContain("ready");
      expect(tools).toContain("list_issues");
      expect(tools).toContain("upsert_spec");
      expect(tools.length).toBe(10);
    });

    it("returns execution tools for execution scopes", () => {
      const tools = getToolsForScopes(new Set(["executions:read", "executions:write"]));
      expect(tools).toContain("list_executions");
      expect(tools).toContain("show_execution");
      expect(tools).toContain("start_execution");
      expect(tools).toContain("cancel_execution");
    });

    it("combines tools from multiple scopes", () => {
      const tools = getToolsForScopes(new Set(["default", "overview"]));
      expect(tools).toContain("ready");
      expect(tools).toContain("project_status");
    });
  });

  describe("getScopeForTool", () => {
    it("returns correct scope for default tools", () => {
      expect(getScopeForTool("ready")).toBe("default");
      expect(getScopeForTool("list_issues")).toBe("default");
    });

    it("returns correct scope for extended tools", () => {
      expect(getScopeForTool("project_status")).toBe("overview");
      expect(getScopeForTool("list_executions")).toBe("executions:read");
      expect(getScopeForTool("start_execution")).toBe("executions:write");
    });

    it("returns undefined for unknown tools", () => {
      expect(getScopeForTool("unknown_tool")).toBeUndefined();
    });
  });

  describe("isToolAvailable", () => {
    it("returns true for tools in usable scopes", () => {
      const usable = new Set<any>(["default"]);
      expect(isToolAvailable("ready", usable)).toBe(true);
    });

    it("returns false for tools not in usable scopes", () => {
      const usable = new Set<any>(["default"]);
      expect(isToolAvailable("project_status", usable)).toBe(false);
    });
  });

  describe("toolRequiresServer", () => {
    it("returns false for default tools", () => {
      expect(toolRequiresServer("ready")).toBe(false);
      expect(toolRequiresServer("list_issues")).toBe(false);
    });

    it("returns true for extended tools", () => {
      expect(toolRequiresServer("project_status")).toBe(true);
      expect(toolRequiresServer("list_executions")).toBe(true);
    });
  });

  describe("hasExtendedScopes", () => {
    it("returns false for only default scope", () => {
      expect(hasExtendedScopes(new Set(["default"]))).toBe(false);
    });

    it("returns true when extended scopes are present", () => {
      expect(hasExtendedScopes(new Set(["default", "executions"]))).toBe(true);
    });
  });

  describe("getMissingServerUrlScopes", () => {
    it("returns extended scopes from enabled set", () => {
      const enabled = new Set<any>(["default", "executions", "overview"]);
      const missing = getMissingServerUrlScopes(enabled);
      expect(missing).toContain("executions");
      expect(missing).toContain("overview");
      expect(missing).not.toContain("default");
    });
  });

  describe("SCOPE_TOOLS mapping", () => {
    it("has all default tools", () => {
      expect(SCOPE_TOOLS.default).toHaveLength(10);
    });

    it("has execution read tools", () => {
      expect(SCOPE_TOOLS["executions:read"]).toContain("list_executions");
      expect(SCOPE_TOOLS["executions:read"]).toContain("show_execution");
    });

    it("has execution write tools", () => {
      expect(SCOPE_TOOLS["executions:write"]).toContain("start_execution");
      expect(SCOPE_TOOLS["executions:write"]).toContain("cancel_execution");
    });
  });

  describe("voice scope", () => {
    it("parses voice scope", () => {
      expect(parseScopes("voice")).toEqual(["voice"]);
    });

    it("parses voice with other scopes", () => {
      expect(parseScopes("default,voice")).toEqual(["default", "voice"]);
    });

    it("has speak tool in voice scope", () => {
      expect(SCOPE_TOOLS.voice).toContain("speak");
      expect(SCOPE_TOOLS.voice).toHaveLength(1);
    });

    it("returns speak tool for voice scope", () => {
      const tools = getToolsForScopes(new Set(["voice"]));
      expect(tools).toContain("speak");
      expect(tools).toHaveLength(1);
    });

    it("returns correct scope for speak tool", () => {
      expect(getScopeForTool("speak")).toBe("voice");
    });

    it("voice scope requires server URL", () => {
      expect(toolRequiresServer("speak")).toBe(true);
    });

    it("voice scope is excluded when no server URL", () => {
      const enabled = new Set<any>(["default", "voice"]);
      const usable = getUsableScopes(enabled, undefined);
      expect(usable.has("default")).toBe(true);
      expect(usable.has("voice")).toBe(false);
    });

    it("voice scope is included when server URL is provided", () => {
      const enabled = new Set<any>(["default", "voice"]);
      const usable = getUsableScopes(enabled, "http://localhost:3000");
      expect(usable.has("default")).toBe(true);
      expect(usable.has("voice")).toBe(true);
    });

    it("speak tool is available when voice scope is usable", () => {
      const usable = new Set<any>(["voice"]);
      expect(isToolAvailable("speak", usable)).toBe(true);
    });

    it("speak tool is unavailable when voice scope is not enabled", () => {
      const usable = new Set<any>(["default"]);
      expect(isToolAvailable("speak", usable)).toBe(false);
    });

    it("combines voice with default and other scopes", () => {
      const tools = getToolsForScopes(new Set(["default", "voice", "overview"]));
      expect(tools).toContain("ready");
      expect(tools).toContain("speak");
      expect(tools).toContain("project_status");
    });
  });
});
