/**
 * Scope System for sudocode MCP Server
 *
 * Provides opt-in tool categories via the --scope argument.
 * Default scope includes the original 10 CLI-wrapped tools.
 * Extended scopes require --server-url for HTTP API access.
 */

// =============================================================================
// Scope Types
// =============================================================================

/**
 * Individual scope identifiers.
 * - `default`: Original CLI-wrapped tools (no server required)
 * - Extended scopes: Require server URL for HTTP API
 */
export type Scope =
  // Base scope (CLI-wrapped, no server required)
  | "default"
  // Extended scopes (require server URL)
  | "overview"
  | "executions"
  | "executions:read"
  | "executions:write"
  | "inspection"
  | "workflows"
  | "workflows:read"
  | "workflows:write"
  | "voice";

/**
 * Meta-scopes that expand to multiple scopes.
 */
export type MetaScope = "project-assistant" | "all";

/**
 * All valid scope identifiers (scopes + meta-scopes).
 */
export type ScopeIdentifier = Scope | MetaScope;

// =============================================================================
// Scope Constants
// =============================================================================

/**
 * All individual scopes (excluding meta-scopes).
 */
export const ALL_SCOPES: Scope[] = [
  "default",
  "overview",
  "executions",
  "executions:read",
  "executions:write",
  "inspection",
  "workflows",
  "workflows:read",
  "workflows:write",
  "voice",
];

/**
 * Scopes that require --server-url to be configured.
 */
export const SERVER_REQUIRED_SCOPES: Scope[] = [
  "overview",
  "executions",
  "executions:read",
  "executions:write",
  "inspection",
  "workflows",
  "workflows:read",
  "workflows:write",
  "voice",
];

/**
 * Meta-scope expansions.
 */
export const META_SCOPE_EXPANSIONS: Record<MetaScope, Scope[]> = {
  "project-assistant": [
    "overview",
    "executions",
    "inspection",
    "workflows",
  ],
  all: [
    "default",
    "overview",
    "executions",
    "inspection",
    "workflows",
  ],
};

/**
 * Parent scope expansions (e.g., "executions" -> "executions:read" + "executions:write").
 */
export const PARENT_SCOPE_EXPANSIONS: Record<string, Scope[]> = {
  executions: ["executions:read", "executions:write"],
  workflows: ["workflows:read", "workflows:write"],
};

/**
 * Tools available in each scope.
 */
export const SCOPE_TOOLS: Record<Scope, string[]> = {
  // Default scope - original CLI-wrapped tools
  default: [
    "ready",
    "list_issues",
    "show_issue",
    "upsert_issue",
    "list_specs",
    "show_spec",
    "upsert_spec",
    "link",
    "add_reference",
    "add_feedback",
  ],

  // Overview scope
  overview: ["project_status"],

  // Execution scopes
  executions: [], // Parent scope, tools in children
  "executions:read": ["list_executions", "show_execution"],
  "executions:write": [
    "start_execution",
    "start_adhoc_execution",
    "create_follow_up",
    "cancel_execution",
  ],

  // Inspection scope
  inspection: ["execution_trajectory", "execution_changes", "execution_chain"],

  // Workflow scopes
  workflows: [], // Parent scope, tools in children
  "workflows:read": ["list_workflows", "show_workflow", "workflow_status"],
  "workflows:write": [
    "create_workflow",
    "start_workflow",
    "pause_workflow",
    "cancel_workflow",
    "resume_workflow",
  ],

  // Voice scope - for explicit agent narration
  voice: ["speak"],
};

// =============================================================================
// Scope Configuration
// =============================================================================

/**
 * Configuration for scope-based tool filtering.
 */
export interface ScopeConfig {
  /** Resolved set of enabled scopes */
  enabledScopes: Set<Scope>;
  /** Server URL for extended tools (required if extended scopes enabled) */
  serverUrl?: string;
  /** Project ID for API calls */
  projectId?: string;
}

// =============================================================================
// Scope Resolution Functions
// =============================================================================

/**
 * Check if a string is a valid scope identifier.
 */
export function isValidScope(scope: string): scope is ScopeIdentifier {
  return (
    ALL_SCOPES.includes(scope as Scope) ||
    scope === "project-assistant" ||
    scope === "all"
  );
}

/**
 * Parse a comma-separated scope string into individual identifiers.
 *
 * @param scopeArg - Comma-separated scope string (e.g., "default,executions")
 * @returns Array of scope identifiers
 * @throws Error if any scope is invalid
 */
export function parseScopes(scopeArg: string): ScopeIdentifier[] {
  const parts = scopeArg
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const invalid = parts.filter((p) => !isValidScope(p));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown scope(s): ${invalid.join(", ")}. Valid scopes: ${ALL_SCOPES.join(", ")}, project-assistant, all`
    );
  }

  return parts as ScopeIdentifier[];
}

/**
 * Expand meta-scopes and parent scopes to their constituent scopes.
 *
 * @param scopes - Array of scope identifiers (may include meta-scopes)
 * @returns Set of resolved individual scopes
 */
export function expandScopes(scopes: ScopeIdentifier[]): Set<Scope> {
  const result = new Set<Scope>();

  for (const scope of scopes) {
    // Handle meta-scopes
    if (scope === "project-assistant" || scope === "all") {
      for (const expanded of META_SCOPE_EXPANSIONS[scope]) {
        result.add(expanded);
        // Also expand parent scopes
        if (expanded in PARENT_SCOPE_EXPANSIONS) {
          for (const child of PARENT_SCOPE_EXPANSIONS[expanded]) {
            result.add(child);
          }
        }
      }
      continue;
    }

    // Handle parent scopes (executions, workflows)
    if (scope in PARENT_SCOPE_EXPANSIONS) {
      result.add(scope);
      for (const child of PARENT_SCOPE_EXPANSIONS[scope]) {
        result.add(child);
      }
      continue;
    }

    // Regular scope
    result.add(scope);
  }

  return result;
}

/**
 * Resolve a scope argument string to a ScopeConfig.
 *
 * @param scopeArg - Comma-separated scope string
 * @param serverUrl - Optional server URL
 * @param projectId - Optional project ID
 * @returns Resolved ScopeConfig
 */
export function resolveScopes(
  scopeArg: string,
  serverUrl?: string,
  projectId?: string
): ScopeConfig {
  const parsed = parseScopes(scopeArg);
  const enabledScopes = expandScopes(parsed);

  return {
    enabledScopes,
    serverUrl,
    projectId,
  };
}

/**
 * Check if any extended scopes are enabled (scopes that require server URL).
 */
export function hasExtendedScopes(enabledScopes: Set<Scope>): boolean {
  for (const scope of enabledScopes) {
    if (SERVER_REQUIRED_SCOPES.includes(scope)) {
      return true;
    }
  }
  return false;
}

/**
 * Get the list of extended scopes that are enabled but missing server URL.
 */
export function getMissingServerUrlScopes(enabledScopes: Set<Scope>): Scope[] {
  return Array.from(enabledScopes).filter((scope) =>
    SERVER_REQUIRED_SCOPES.includes(scope)
  );
}

/**
 * Filter enabled scopes to only those that can be used (have required prerequisites).
 *
 * @param enabledScopes - Set of enabled scopes
 * @param serverUrl - Server URL (if configured)
 * @returns Set of scopes that can actually be used
 */
export function getUsableScopes(
  enabledScopes: Set<Scope>,
  serverUrl?: string
): Set<Scope> {
  const usable = new Set<Scope>();

  for (const scope of enabledScopes) {
    // Default scope always usable
    if (scope === "default") {
      usable.add(scope);
      continue;
    }

    // Extended scopes require server URL
    if (SERVER_REQUIRED_SCOPES.includes(scope) && serverUrl) {
      usable.add(scope);
    }
  }

  return usable;
}

/**
 * Get all tools available for the given scopes.
 *
 * @param scopes - Set of enabled scopes
 * @returns Array of tool names
 */
export function getToolsForScopes(scopes: Set<Scope>): string[] {
  const tools = new Set<string>();

  for (const scope of scopes) {
    for (const tool of SCOPE_TOOLS[scope]) {
      tools.add(tool);
    }
  }

  return Array.from(tools);
}

/**
 * Get the scope that a tool belongs to.
 *
 * @param toolName - Name of the tool
 * @returns The scope containing this tool, or undefined
 */
export function getScopeForTool(toolName: string): Scope | undefined {
  for (const [scope, tools] of Object.entries(SCOPE_TOOLS)) {
    if (tools.includes(toolName)) {
      return scope as Scope;
    }
  }
  return undefined;
}

/**
 * Check if a tool is available given the current scope configuration.
 *
 * @param toolName - Name of the tool
 * @param usableScopes - Set of usable scopes (after filtering by prerequisites)
 * @returns true if the tool can be invoked
 */
export function isToolAvailable(
  toolName: string,
  usableScopes: Set<Scope>
): boolean {
  const scope = getScopeForTool(toolName);
  if (!scope) return false;
  return usableScopes.has(scope);
}

/**
 * Check if a tool requires the server URL.
 *
 * @param toolName - Name of the tool
 * @returns true if the tool requires server URL
 */
export function toolRequiresServer(toolName: string): boolean {
  const scope = getScopeForTool(toolName);
  if (!scope) return false;
  return SERVER_REQUIRED_SCOPES.includes(scope);
}
