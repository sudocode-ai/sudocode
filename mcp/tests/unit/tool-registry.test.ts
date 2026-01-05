/**
 * Tests for tool registry
 */

import { describe, it, expect } from "vitest";
import {
  ALL_TOOLS,
  getToolsForScopes,
  getToolByName,
  getHandlerType,
  requiresApiClient,
  type ToolDefinition,
} from "../../src/tool-registry.js";

describe("tool-registry", () => {
  describe("ALL_TOOLS", () => {
    it("contains all expected default tools", () => {
      const defaultTools = ALL_TOOLS.filter((t) => t.scope === "default");
      const names = defaultTools.map((t) => t.name);

      expect(names).toContain("ready");
      expect(names).toContain("list_issues");
      expect(names).toContain("show_issue");
      expect(names).toContain("upsert_issue");
      expect(names).toContain("list_specs");
      expect(names).toContain("show_spec");
      expect(names).toContain("upsert_spec");
      expect(names).toContain("link");
      expect(names).toContain("add_reference");
      expect(names).toContain("add_feedback");
      expect(defaultTools).toHaveLength(10);
    });

    it("contains overview tools", () => {
      const overviewTools = ALL_TOOLS.filter((t) => t.scope === "overview");
      expect(overviewTools.map((t) => t.name)).toContain("project_status");
    });

    it("contains execution read tools", () => {
      const tools = ALL_TOOLS.filter((t) => t.scope === "executions:read");
      const names = tools.map((t) => t.name);

      expect(names).toContain("list_executions");
      expect(names).toContain("show_execution");
    });

    it("contains execution write tools", () => {
      const tools = ALL_TOOLS.filter((t) => t.scope === "executions:write");
      const names = tools.map((t) => t.name);

      expect(names).toContain("start_execution");
      expect(names).toContain("start_adhoc_execution");
      expect(names).toContain("create_follow_up");
      expect(names).toContain("cancel_execution");
    });

    it("contains inspection tools", () => {
      const tools = ALL_TOOLS.filter((t) => t.scope === "inspection");
      const names = tools.map((t) => t.name);

      expect(names).toContain("execution_trajectory");
      expect(names).toContain("execution_changes");
      expect(names).toContain("execution_chain");
    });

    it("contains workflow read tools", () => {
      const tools = ALL_TOOLS.filter((t) => t.scope === "workflows:read");
      const names = tools.map((t) => t.name);

      expect(names).toContain("list_workflows");
      expect(names).toContain("show_workflow");
      expect(names).toContain("workflow_status");
    });

    it("contains workflow write tools", () => {
      const tools = ALL_TOOLS.filter((t) => t.scope === "workflows:write");
      const names = tools.map((t) => t.name);

      expect(names).toContain("create_workflow");
      expect(names).toContain("start_workflow");
      expect(names).toContain("pause_workflow");
      expect(names).toContain("cancel_workflow");
      expect(names).toContain("resume_workflow");
    });

    it("has valid input schema for all tools", () => {
      for (const tool of ALL_TOOLS) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it("has unique tool names", () => {
      const names = ALL_TOOLS.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe("getToolsForScopes", () => {
    it("returns empty array for empty scopes", () => {
      const result = getToolsForScopes(new Set());
      expect(result).toEqual([]);
    });

    it("returns only default tools for default scope", () => {
      const result = getToolsForScopes(new Set(["default"]));
      expect(result).toHaveLength(10);
      expect(result.every((t) => t.scope === "default")).toBe(true);
    });

    it("returns execution tools for execution scopes", () => {
      const result = getToolsForScopes(
        new Set(["executions:read", "executions:write"])
      );
      const names = result.map((t) => t.name);

      expect(names).toContain("list_executions");
      expect(names).toContain("start_execution");
    });

    it("returns combined tools for multiple scopes", () => {
      const result = getToolsForScopes(new Set(["default", "overview"]));
      const names = result.map((t) => t.name);

      expect(names).toContain("ready");
      expect(names).toContain("project_status");
    });

    it("returns inspection tools", () => {
      const result = getToolsForScopes(new Set(["inspection"]));
      const names = result.map((t) => t.name);

      expect(names).toContain("execution_trajectory");
      expect(names).toContain("execution_changes");
      expect(names).toContain("execution_chain");
      expect(result).toHaveLength(3);
    });

    it("returns workflow tools for workflow scopes", () => {
      const result = getToolsForScopes(
        new Set(["workflows:read", "workflows:write"])
      );
      const names = result.map((t) => t.name);

      expect(names).toContain("list_workflows");
      expect(names).toContain("create_workflow");
    });
  });

  describe("getToolByName", () => {
    it("returns tool definition for valid name", () => {
      const tool = getToolByName("ready");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("ready");
      expect(tool?.scope).toBe("default");
    });

    it("returns undefined for unknown tool", () => {
      const tool = getToolByName("nonexistent_tool");
      expect(tool).toBeUndefined();
    });

    it("returns correct tool for execution tools", () => {
      const listExec = getToolByName("list_executions");
      expect(listExec?.scope).toBe("executions:read");

      const startExec = getToolByName("start_execution");
      expect(startExec?.scope).toBe("executions:write");
    });

    it("returns correct tool for workflow tools", () => {
      const listWorkflows = getToolByName("list_workflows");
      expect(listWorkflows?.scope).toBe("workflows:read");

      const createWorkflow = getToolByName("create_workflow");
      expect(createWorkflow?.scope).toBe("workflows:write");
    });
  });

  describe("getHandlerType", () => {
    it("returns 'cli' for default scope tools", () => {
      const tool = getToolByName("ready")!;
      expect(getHandlerType(tool)).toBe("cli");
    });

    it("returns 'api' for extended scope tools", () => {
      const projectStatus = getToolByName("project_status")!;
      expect(getHandlerType(projectStatus)).toBe("api");

      const listExec = getToolByName("list_executions")!;
      expect(getHandlerType(listExec)).toBe("api");
    });

    it("returns 'api' for all non-default tools", () => {
      const nonDefaultTools = ALL_TOOLS.filter((t) => t.scope !== "default");
      for (const tool of nonDefaultTools) {
        expect(getHandlerType(tool)).toBe("api");
      }
    });
  });

  describe("requiresApiClient", () => {
    it("returns false for default scope tools", () => {
      const tool = getToolByName("ready")!;
      expect(requiresApiClient(tool)).toBe(false);
    });

    it("returns true for extended scope tools", () => {
      const projectStatus = getToolByName("project_status")!;
      expect(requiresApiClient(projectStatus)).toBe(true);

      const listExec = getToolByName("list_executions")!;
      expect(requiresApiClient(listExec)).toBe(true);

      const trajectory = getToolByName("execution_trajectory")!;
      expect(requiresApiClient(trajectory)).toBe(true);
    });

    it("returns true for all workflow tools", () => {
      const workflowTools = ALL_TOOLS.filter((t) =>
        t.scope.startsWith("workflows")
      );
      for (const tool of workflowTools) {
        expect(requiresApiClient(tool)).toBe(true);
      }
    });
  });

  describe("tool input schemas", () => {
    it("list_issues has correct schema", () => {
      const tool = getToolByName("list_issues")!;
      expect(tool.inputSchema.properties).toHaveProperty("status");
      expect(tool.inputSchema.properties).toHaveProperty("priority");
      expect(tool.inputSchema.properties).toHaveProperty("limit");
      expect(tool.inputSchema.properties).toHaveProperty("search");
    });

    it("show_issue requires issue_id", () => {
      const tool = getToolByName("show_issue")!;
      expect(tool.inputSchema.required).toContain("issue_id");
    });

    it("start_execution requires issue_id", () => {
      const tool = getToolByName("start_execution")!;
      expect(tool.inputSchema.required).toContain("issue_id");
      expect(tool.inputSchema.properties).toHaveProperty("agent_type");
      expect(tool.inputSchema.properties).toHaveProperty("model");
    });

    it("start_adhoc_execution requires prompt", () => {
      const tool = getToolByName("start_adhoc_execution")!;
      expect(tool.inputSchema.required).toContain("prompt");
    });

    it("create_follow_up requires execution_id and feedback", () => {
      const tool = getToolByName("create_follow_up")!;
      expect(tool.inputSchema.required).toContain("execution_id");
      expect(tool.inputSchema.required).toContain("feedback");
    });

    it("link has correct relationship types", () => {
      const tool = getToolByName("link")!;
      const typeProperty = tool.inputSchema.properties.type as any;
      expect(typeProperty.enum).toContain("blocks");
      expect(typeProperty.enum).toContain("implements");
      expect(typeProperty.enum).toContain("depends-on");
      expect(typeProperty.enum).toContain("references");
    });

    it("execution_trajectory has optional max_entries", () => {
      const tool = getToolByName("execution_trajectory")!;
      expect(tool.inputSchema.properties).toHaveProperty("max_entries");
      expect(tool.inputSchema.required).toContain("execution_id");
      expect(tool.inputSchema.required).not.toContain("max_entries");
    });

    it("execution_changes has optional include_diff", () => {
      const tool = getToolByName("execution_changes")!;
      expect(tool.inputSchema.properties).toHaveProperty("include_diff");
      expect(tool.inputSchema.required).toContain("execution_id");
    });
  });
});
