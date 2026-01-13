/**
 * Agent configuration types for sudocode
 *
 * Defines agent types and their specific configuration interfaces.
 * Each agent config extends BaseAgentConfig from agent-execution-engine.
 *
 * @example
 * ```typescript
 * // Import from main package
 * import type { AgentType, AgentConfig } from '@sudocode-ai/types';
 *
 * // Or import directly from agents
 * import type { ClaudeCodeConfig } from '@sudocode-ai/types/agents';
 *
 * const agentType: AgentType = 'claude-code';
 * const config: ClaudeCodeConfig = {
 *   workDir: '/path/to/project',
 *   claudePath: 'claude',
 *   print: true,
 *   outputFormat: 'stream-json',
 * };
 * ```
 *
 * @module @sudocode-ai/types/agents
 */

/**
 * Agent types supported for execution
 *
 * ACP-native agents: claude-code, codex, gemini, opencode
 * Legacy agents (via shim): copilot, cursor
 */
export type AgentType = "claude-code" | "codex" | "gemini" | "opencode" | "copilot" | "cursor";

/**
 * Execution modes supported by agents
 * Aligns with ExecutionMode from agent-execution-engine
 */
export type ExecutionMode = "structured" | "interactive" | "hybrid";

/**
 * Base configuration options that all agents should support
 * Aligns with BaseAgentConfig from agent-execution-engine
 */
export interface BaseAgentConfig {
  /** Path to the agent's CLI executable */
  executablePath?: string;
  /** Working directory for execution */
  workDir: string;
  /** Environment variables to pass to the process */
  env?: Record<string, string>;
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Execution mode (if agent supports multiple modes) */
  mode?: ExecutionMode;
}

/**
 * Claude Code specific configuration
 */
export interface ClaudeCodeConfig extends BaseAgentConfig {
  /** Path to Claude Code CLI executable (default: 'claude') */
  claudePath?: string;
  /** Run in non-interactive print mode */
  print?: boolean;
  /** Output format (stream-json recommended for parsing) */
  outputFormat?: "stream-json" | "json" | "text";
  /** Enable verbose output (required for stream-json with print mode) */
  verbose?: boolean;
  /** Skip permission prompts */
  dangerouslySkipPermissions?: boolean;
  /** Enable bypassing permission checks as an option without enabling by default */
  allowDangerouslySkipPermissions?: boolean;
  /** Permission mode setting (acceptEdits, bypassPermissions, default, dontAsk, plan) */
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan";

  // === Model Configuration ===
  /** Model for the session (alias like 'sonnet', 'opus' or full name like 'claude-sonnet-4-5-20250929') */
  model?: string;
  /** Fallback model when default is overloaded (only works with --print) */
  fallbackModel?: string;

  // === Tool Permissions ===
  /** Comma or space-separated list of tool names to allow (e.g., "Bash(git:*) Edit") */
  allowedTools?: string[];
  /** Specify available tools from built-in set. Use "" to disable all, "default" for all, or tool names */
  tools?: string[];
  /** Comma or space-separated list of tool names to deny (e.g., "Bash(git:*) Edit") */
  disallowedTools?: string[];

  // === System Prompt ===
  /** System prompt to use for the session */
  systemPrompt?: string;
  /** Append a system prompt to the default system prompt */
  appendSystemPrompt?: string;

  // === Directory & Context ===
  /** Additional directories to allow tool access to */
  addDir?: string[];

  // === MCP Configuration ===
  /** Load MCP servers from JSON files or strings (space-separated) */
  mcpConfig?: string[];
  /** Only use MCP servers from --mcp-config, ignoring all other MCP configurations */
  strictMcpConfig?: boolean;

  // === Session Management ===
  /** Continue the most recent conversation */
  continue?: boolean;
  /** Resume a conversation - provide a session ID or leave empty for interactive selection */
  resume?: string;
  /** When resuming, create a new session ID instead of reusing the original */
  forkSession?: boolean;
  /** Use a specific session ID for the conversation (must be a valid UUID) */
  sessionId?: string;

  // === Output Configuration ===
  /** JSON Schema for structured output validation */
  jsonSchema?: string;
  /** Include partial message chunks as they arrive (only with --print and --output-format=stream-json) */
  includePartialMessages?: boolean;

  // === Advanced ===
  /** Path to a settings JSON file or a JSON string to load additional settings from */
  settings?: string;
  /** Comma-separated list of setting sources to load (user, project, local) */
  settingSources?: string;
  /** Enable debug mode with optional category filtering */
  debug?: string | boolean;

  // === Process Management ===
  /** Maximum idle time before cleanup (pool only) */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  /** Prompt to send to Claude Code */
  prompt?: string;

  // === Directory Restriction ===
  /**
   * Restrict file operations to the working directory
   *
   * When enabled, a PreToolUse hook is configured to block Read, Write, Edit,
   * Glob, and Grep operations that target files outside the working directory.
   *
   * This provides security isolation when running agents in worktrees or
   * sandboxed environments.
   *
   * @default false
   */
  restrictToWorkDir?: boolean;
  /**
   * Path to the directory guard hook script
   *
   * Only used when restrictToWorkDir is enabled. If not specified,
   * the executor will use the bundled hook script from agent-execution-engine.
   */
  directoryGuardHookPath?: string;
}

/**
 * OpenAI Codex specific configuration (CLI-based)
 */
export interface CodexConfig extends BaseAgentConfig {
  /** Path to Codex CLI executable */
  codexPath?: string;
  /** Use 'codex exec' for non-interactive execution */
  exec?: boolean;
  /** Emit newline-delimited JSON events */
  json?: boolean;
  /** Use experimental JSON output format */
  experimentalJson?: boolean;
  /** Write final assistant message to file */
  outputLastMessage?: string;
  /** Override configured model (e.g., 'gpt-5-codex', 'gpt-5') */
  model?: string;
  /** Sandbox policy */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /** Approval policy */
  askForApproval?: "untrusted" | "on-failure" | "on-request" | "never";
  /** Shortcut combining workspace-write sandbox + on-failure approvals */
  fullAuto?: boolean;
  /** Allow execution outside Git repositories */
  skipGitRepoCheck?: boolean;
  /** Control ANSI color output */
  color?: "always" | "never" | "auto";
  /** Enable web browsing capability */
  search?: boolean;
  /** Attach image files to the prompt */
  image?: string[];
  /** Load configuration profile from config.toml */
  profile?: string;
  /** Additional directories to grant write access */
  addDir?: string[];
  /** Disable all safety checks (isolated environments only) */
  yolo?: boolean;
  /** Maximum idle time before cleanup */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  /** Prompt to send to Codex */
  prompt?: string;
}

/**
 * GitHub Copilot CLI specific configuration
 *
 * @see https://github.com/github/copilot
 */
export interface CopilotConfig extends BaseAgentConfig {
  /** Path to Copilot CLI executable (default: 'copilot') */
  copilotPath?: string;
  /** Copilot CLI version to use (only with npx, default: 'latest') */
  copilotVersion?: string;
  /** Model to use (e.g., 'gpt-4o', 'gpt-5', 'claude-sonnet-4.5') */
  model?: string;
  /** Allow all tools without prompting */
  allowAllTools?: boolean;
  /** Comma-separated list of allowed tools */
  allowTool?: string;
  /** Comma-separated list of denied tools */
  denyTool?: string;
  /** Additional directories to include in context */
  addDir?: string[];
  /** MCP servers to disable for this execution */
  disableMcpServer?: string[];
  /** System prompt to prepend to user prompt */
  systemPrompt?: string;
  /** Prompt to send to Copilot */
  prompt?: string;
  /** Maximum idle time before cleanup */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

/**
 * Cursor specific configuration (cursor-agent CLI)
 */
export interface CursorConfig extends BaseAgentConfig {
  /** Path to cursor-agent CLI executable */
  cursorPath?: string;
  /** Auto-approve all tool executions (adds --force flag) */
  force?: boolean;
  /** Model to use for code generation */
  model?: string;
  /** Additional text to append to user prompts */
  appendPrompt?: string;
  /**
   * Automatically approve all MCP servers.
   * Only works with --print/headless mode.
   */
  approveMcps?: boolean;
  /** Maximum idle time before cleanup */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  /** Prompt to send to Cursor */
  prompt?: string;
}

/**
 * Google Gemini Code Assist configuration
 */
export interface GeminiConfig extends BaseAgentConfig {
  /** Path to gemini CLI executable */
  geminiPath?: string;
  /** Model to use (e.g., 'gemini-2.0-flash', 'gemini-2.0-pro') */
  model?: string;
  /** Maximum idle time before cleanup */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  /** Prompt to send to Gemini */
  prompt?: string;
}

/**
 * Opencode configuration
 */
export interface OpencodeConfig extends BaseAgentConfig {
  /** Path to opencode CLI executable */
  opencodePath?: string;
  /** Model to use */
  model?: string;
  /** Maximum idle time before cleanup */
  idleTimeout?: number;
  /** Retry configuration for failed spawns */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  /** Prompt to send to Opencode */
  prompt?: string;
}

/**
 * Discriminated union of all agent configurations
 */
export type AgentConfig =
  | ClaudeCodeConfig
  | CodexConfig
  | CopilotConfig
  | CursorConfig
  | GeminiConfig
  | OpencodeConfig;
