/**
 * Tool Registry for sudocode MCP Server
 *
 * Centralized registry of all MCP tools with their scopes and schemas.
 * Supports filtering by scope and routing to appropriate handlers.
 */

import type { Scope } from "./scopes.js";

// =============================================================================
// Types
// =============================================================================

/**
 * MCP tool input schema.
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Tool definition with scope information.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: ToolInputSchema;
}

/**
 * Handler types for tool routing.
 */
export type ToolHandlerType = "cli" | "api";

// =============================================================================
// Default Scope Tools (CLI-based)
// =============================================================================

const DEFAULT_TOOLS: ToolDefinition[] = [
  {
    name: "ready",
    scope: "default",
    description:
      "Shows you the current project state: what issues are ready to work on (no blockers), what's in progress, and what's blocked. Essential for understanding context before making any decisions about what to work on next.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_issues",
    scope: "default",
    description:
      "Search and filter issues. Use this when you need to find specific issues by status, priority, keyword, or when exploring what work exists in the project.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in_progress", "blocked", "closed"],
          description:
            "Filter by workflow status: 'open' (not started), 'in_progress' (currently working), 'blocked' (waiting on dependencies), 'closed' (completed)",
        },
        priority: {
          type: "number",
          description:
            "Filter by priority level where 0=highest priority and 4=lowest priority",
        },
        archived: {
          type: "boolean",
          description:
            "Include archived issues. Defaults to false (excludes archived issues from results)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 50.",
          default: 50,
        },
        search: {
          type: "string",
          description:
            "Search text - matches against issue titles and descriptions (case-insensitive)",
        },
      },
    },
  },
  {
    name: "show_issue",
    scope: "default",
    description:
      "Get full details about a specific issue. Use this to understand what the issue implements (which specs), what blocks it (dependencies), its current status, and related work. Essential for understanding context before starting implementation.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: 'Issue ID with format "i-xxxx" (e.g., "i-x7k9")',
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "upsert_issue",
    scope: "default",
    description:
      "Create or update an issue (agent's actionable work item). **Issues implement specs** - use 'link' with type='implements' to connect issue to spec. **Before closing:** provide feedback on the spec using 'add_feedback' if this issue implements a spec. If issue_id is provided, updates the issue; otherwise creates a new one. To close an issue, set status='closed'. To archive an issue, set archived=true.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description:
            'Issue ID in format "i-xxxx". Omit to create new issue (auto-generates ID). Provide to update existing issue.',
        },
        title: {
          type: "string",
          description:
            "Concise issue title describing the work (e.g., 'Implement OAuth login flow'). Required when creating, optional when updating.",
        },
        description: {
          type: "string",
          description:
            "Detailed description of the work to be done. Supports markdown and inline references using [[id]] syntax.",
        },
        priority: {
          type: "number",
          description:
            "Priority level: 0 (highest/urgent) to 4 (lowest/nice-to-have).",
        },
        parent: {
          type: "string",
          description: "Parent issue ID for hierarchical organization.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tag strings for categorization.",
        },
        status: {
          type: "string",
          enum: ["open", "in_progress", "blocked", "closed"],
          description: "Workflow status.",
        },
        archived: {
          type: "boolean",
          description: "Set to true to archive completed/obsolete issues.",
        },
      },
    },
  },
  {
    name: "list_specs",
    scope: "default",
    description:
      "Search and browse all specs in the project. Use this to find existing specifications by keyword, or to see what specs are available before creating new ones.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 50.",
          default: 50,
        },
        search: {
          type: "string",
          description:
            "Search text - matches against spec titles and descriptions (case-insensitive).",
        },
      },
    },
  },
  {
    name: "show_spec",
    scope: "default",
    description:
      "Get full details about a specific spec including its content, relationships, and all anchored feedback. Use this to understand requirements before implementing.",
    inputSchema: {
      type: "object",
      properties: {
        spec_id: {
          type: "string",
          description: 'Spec ID with format "s-xxxx" (e.g., "s-14sh").',
        },
      },
      required: ["spec_id"],
    },
  },
  {
    name: "upsert_spec",
    scope: "default",
    description:
      "Create or update a spec (user's requirements/intent/context document). If spec_id is provided, updates the spec; otherwise creates a new one with a hash-based ID.",
    inputSchema: {
      type: "object",
      properties: {
        spec_id: {
          type: "string",
          description:
            'Spec ID in format "s-xxxx". Omit to create new spec (auto-generates hash-based ID).',
        },
        title: {
          type: "string",
          description: "Descriptive spec title. Required when creating.",
        },
        priority: {
          type: "number",
          description: "Priority level: 0 (highest) to 4 (lowest).",
        },
        description: {
          type: "string",
          description: "Full specification content in markdown format.",
        },
        parent: {
          type: "string",
          description: "Parent spec ID for hierarchical organization.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tag strings for categorization.",
        },
      },
    },
  },
  {
    name: "link",
    scope: "default",
    description:
      "Create a relationship between specs and/or issues. Use this to establish the dependency graph and connect work to requirements. Most common: 'implements' (issue → spec) and 'blocks' (dependency ordering).",
    inputSchema: {
      type: "object",
      properties: {
        from_id: {
          type: "string",
          description: "Source entity ID (format 'i-xxxx' or 's-xxxx').",
        },
        to_id: {
          type: "string",
          description: "Target entity ID (format 'i-xxxx' or 's-xxxx').",
        },
        type: {
          type: "string",
          enum: [
            "blocks",
            "implements",
            "references",
            "depends-on",
            "discovered-from",
            "related",
          ],
          description: "Relationship type.",
        },
      },
      required: ["from_id", "to_id"],
    },
  },
  {
    name: "add_reference",
    scope: "default",
    description:
      "Insert an Obsidian-style [[ID]] reference into spec or issue markdown content.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Entity ID where the reference will be inserted.",
        },
        reference_id: {
          type: "string",
          description: "Entity ID being referenced.",
        },
        display_text: {
          type: "string",
          description: "Optional display text for the reference.",
        },
        relationship_type: {
          type: "string",
          enum: [
            "blocks",
            "implements",
            "references",
            "depends-on",
            "discovered-from",
            "related",
          ],
          description: "Optional relationship type.",
        },
        line: {
          type: "number",
          description: "Line number where reference should be inserted.",
        },
        text: {
          type: "string",
          description: "Text substring to search for as insertion point.",
        },
        format: {
          type: "string",
          enum: ["inline", "newline"],
          description: "How to insert: 'inline' or on 'newline'.",
          default: "inline",
        },
      },
      required: ["entity_id", "reference_id"],
    },
  },
  {
    name: "add_feedback",
    scope: "default",
    description:
      "**REQUIRED when closing issues that implement specs.** Document implementation results by providing feedback on a spec or issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID that's providing the feedback.",
        },
        to_id: {
          type: "string",
          description: "Target ID receiving the feedback (spec or issue).",
        },
        content: {
          type: "string",
          description: "Feedback content in markdown.",
        },
        type: {
          type: "string",
          enum: ["comment", "suggestion", "request"],
          description: "Feedback type.",
        },
        line: {
          type: "number",
          description: "Line number to anchor feedback.",
        },
        text: {
          type: "string",
          description: "Text to anchor feedback to.",
        },
      },
      required: ["to_id"],
    },
  },
];

// =============================================================================
// Overview Tools
// =============================================================================

const OVERVIEW_TOOLS: ToolDefinition[] = [
  {
    name: "project_status",
    scope: "overview",
    description:
      "Get current project state including ready issues, active executions, and running workflows. " +
      "Use this as your first tool to understand what's happening in the project.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// =============================================================================
// Execution Tools
// =============================================================================

const EXECUTION_READ_TOOLS: ToolDefinition[] = [
  {
    name: "list_executions",
    scope: "executions:read",
    description:
      "List executions with optional filters. " +
      "Use to see what's running, recently completed, or filter by issue.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by status (running, completed, failed, cancelled, pending)",
        },
        issue_id: {
          type: "string",
          description: "Filter by issue ID",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 20)",
        },
        since: {
          type: "string",
          description: "Only executions since this ISO timestamp",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
      },
    },
  },
  {
    name: "show_execution",
    scope: "executions:read",
    description:
      "Get detailed information about a specific execution including status, commits, and files changed.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to inspect",
        },
      },
      required: ["execution_id"],
    },
  },
];

const EXECUTION_WRITE_TOOLS: ToolDefinition[] = [
  {
    name: "start_execution",
    scope: "executions:write",
    description:
      "Start a new execution for an issue. Returns immediately with execution ID. " +
      "Use show_execution or execution_trajectory to monitor progress.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: {
          type: "string",
          description: "Issue ID to execute (e.g., i-abc123)",
        },
        agent_type: {
          type: "string",
          enum: ["claude-code", "codex", "copilot", "cursor"],
          description: "Agent type to use (default: claude-code)",
        },
        model: {
          type: "string",
          description: "Model override for the agent",
        },
        prompt: {
          type: "string",
          description: "Additional instructions for the execution",
        },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "start_adhoc_execution",
    scope: "executions:write",
    description:
      "Start an execution without an associated issue. " +
      "Use for quick tasks or exploratory work.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Instructions for the execution",
        },
        agent_type: {
          type: "string",
          enum: ["claude-code", "codex", "copilot", "cursor"],
          description: "Agent type to use (default: claude-code)",
        },
        model: {
          type: "string",
          description: "Model override for the agent",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "create_follow_up",
    scope: "executions:write",
    description:
      "Create a follow-up execution that continues from a previous execution. " +
      "Shares the same worktree and builds on previous work.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to follow up on",
        },
        feedback: {
          type: "string",
          description: "Follow-up instructions or feedback",
        },
      },
      required: ["execution_id", "feedback"],
    },
  },
  {
    name: "cancel_execution",
    scope: "executions:write",
    description: "Cancel a running execution.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to cancel",
        },
        reason: {
          type: "string",
          description: "Reason for cancellation",
        },
      },
      required: ["execution_id"],
    },
  },
];

// =============================================================================
// Inspection Tools
// =============================================================================

// TODO: Implement execution_trajectory tool once GET /api/executions/:id/trajectory
// endpoint is added to the server. This tool would return the agent's tool calls
// and actions during an execution, parsed from execution logs.
// {
//   name: "execution_trajectory",
//   scope: "inspection",
//   description:
//     "Get the agent's actions and tool calls from an execution. " +
//     "Useful for understanding what happened and debugging issues.",
//   inputSchema: {
//     type: "object",
//     properties: {
//       execution_id: {
//         type: "string",
//         description: "Execution ID to inspect",
//       },
//       max_entries: {
//         type: "number",
//         description: "Maximum entries to return (default: 50)",
//       },
//     },
//     required: ["execution_id"],
//   },
// },

const INSPECTION_TOOLS: ToolDefinition[] = [
  {
    name: "execution_changes",
    scope: "inspection",
    description:
      "Get code changes made by an execution including files modified, additions, deletions, and commits.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID to get changes for",
        },
        include_diff: {
          type: "boolean",
          description: "Include full diff content (default: false)",
        },
      },
      required: ["execution_id"],
    },
  },
  {
    name: "execution_chain",
    scope: "inspection",
    description:
      "Get the full execution chain including root execution and all follow-ups.",
    inputSchema: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "Any execution ID in the chain",
        },
      },
      required: ["execution_id"],
    },
  },
];

// =============================================================================
// Workflow Tools
// =============================================================================

const WORKFLOW_READ_TOOLS: ToolDefinition[] = [
  {
    name: "list_workflows",
    scope: "workflows:read",
    description: "List workflows with optional status filter.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by status (pending, running, paused, completed, failed)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 20)",
        },
      },
    },
  },
  {
    name: "show_workflow",
    scope: "workflows:read",
    description: "Get workflow details including configuration and steps.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "workflow_status",
    scope: "workflows:read",
    description:
      "Get extended workflow status including step progress, active executions, and ready steps.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["workflow_id"],
    },
  },
];

const WORKFLOW_WRITE_TOOLS: ToolDefinition[] = [
  {
    name: "create_workflow",
    scope: "workflows:write",
    description: "Create a new workflow from a spec or issue.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Source spec or issue ID (e.g., s-abc123 or i-xyz789)",
        },
        config: {
          type: "object",
          description: "Optional workflow configuration",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "start_workflow",
    scope: "workflows:write",
    description: "Start a pending workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID to start",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "pause_workflow",
    scope: "workflows:write",
    description: "Pause a running workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID to pause",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "cancel_workflow",
    scope: "workflows:write",
    description: "Cancel a workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID to cancel",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "resume_workflow",
    scope: "workflows:write",
    description: "Resume a paused workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow ID to resume",
        },
      },
      required: ["workflow_id"],
    },
  },
];

// =============================================================================
// Voice Tools
// =============================================================================

const VOICE_TOOLS: ToolDefinition[] = [
  {
    name: "speak",
    scope: "voice",
    description:
      "Narrate text aloud via text-to-speech. Use this to provide voice feedback to the user during execution. " +
      "Keep messages concise and targeted, as the user will still have visibility to your other text messages. " +
      "Avoid unique symbols that may not render well in speech.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to speak aloud",
        },
      },
      required: ["text"],
    },
  },
];

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All tool definitions.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  ...DEFAULT_TOOLS,
  ...OVERVIEW_TOOLS,
  ...EXECUTION_READ_TOOLS,
  ...EXECUTION_WRITE_TOOLS,
  ...INSPECTION_TOOLS,
  ...WORKFLOW_READ_TOOLS,
  ...WORKFLOW_WRITE_TOOLS,
  ...VOICE_TOOLS,
];

/**
 * Get all tools for the given scopes.
 */
export function getToolsForScopes(scopes: Set<Scope>): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => scopes.has(tool.scope));
}

/**
 * Get a tool definition by name.
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}

/**
 * Determine the handler type for a tool.
 */
export function getHandlerType(tool: ToolDefinition): ToolHandlerType {
  return tool.scope === "default" ? "cli" : "api";
}

/**
 * Check if a tool requires the API client.
 */
export function requiresApiClient(tool: ToolDefinition): boolean {
  return tool.scope !== "default";
}
