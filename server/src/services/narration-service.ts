/**
 * Narration Service
 *
 * Converts execution events (NormalizedEntry) into spoken narration text.
 * Summarizes agent actions for voice feedback during execution.
 *
 * @module services/narration-service
 */

import type { NormalizedEntry, ActionType } from "agent-execution-engine/agents";
import type {
  VoiceNarrationEvent,
  NarrationCategory,
  NarrationPriority,
} from "@sudocode-ai/types/voice";

/**
 * Result of narration generation (without executionId which is added later)
 */
export interface NarrationResult {
  text: string;
  category: NarrationCategory;
  priority: NarrationPriority;
}

/**
 * Configuration for narration generation
 */
export interface NarrationConfig {
  /**
   * Whether voice narration broadcasts are enabled.
   * When false, no voice_narration events are broadcast to clients.
   * Default: false
   */
  enabled: boolean;
  /** Maximum length for assistant messages before summarization (default: 100) */
  maxAssistantMessageLength: number;
  /** Maximum length for command display (default: 50) */
  maxCommandLength: number;
  /** Whether to include file paths in narration (default: true) */
  includeFilePaths: boolean;
  /** Whether to narrate tool results (default: false) */
  narrateToolResults: boolean;
  /**
   * Whether to narrate tool use events (Read, Write, Bash, etc.)
   * When false, only 'speak' tool and assistant_message are narrated.
   * Default: true
   */
  narrateToolUse: boolean;
  /**
   * Whether to narrate assistant messages.
   * When false, assistant messages don't trigger narration.
   * Combined with narrateToolUse: false, only 'speak' tool triggers narration.
   * Default: true
   */
  narrateAssistantMessages: boolean;
}

/**
 * Default narration configuration
 */
const DEFAULT_CONFIG: NarrationConfig = {
  enabled: false,
  maxAssistantMessageLength: 100,
  maxCommandLength: 50,
  includeFilePaths: true,
  narrateToolResults: false,
  narrateToolUse: true,
  narrateAssistantMessages: true,
};

/**
 * NarrationService
 *
 * Transforms NormalizedEntry execution events into human-readable narration
 * suitable for text-to-speech output.
 *
 * Narration rules:
 * | Event | Narration |
 * |-------|-----------|
 * | tool_use: Read | "Reading [filename]" |
 * | tool_use: Edit | "Editing [filename]" |
 * | tool_use: Write | "Writing [filename]" |
 * | tool_use: Bash | "Running [command summary]" |
 * | tool_use: Grep | "Searching for [pattern]" |
 * | tool_use: Glob | "Finding files matching [pattern]" |
 * | assistant (short) | Speak directly |
 * | assistant (long) | Summarize to ~2 sentences |
 * | error | "Error: [summary]" |
 * | result | "Done. [summary]" |
 *
 * @example
 * ```typescript
 * const service = new NarrationService();
 *
 * for await (const entry of executionStream) {
 *   const narration = service.summarizeForVoice(entry);
 *   if (narration) {
 *     // Emit voice narration event
 *     emit({
 *       type: 'voice_narration',
 *       executionId: 'exec-123',
 *       ...narration
 *     });
 *   }
 * }
 * ```
 */
export class NarrationService {
  private config: NarrationConfig;

  constructor(config?: Partial<NarrationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Convert an execution event to a voice narration event
   *
   * @param entry - The normalized entry from agent execution
   * @returns NarrationResult if the event should be narrated, null otherwise
   */
  summarizeForVoice(entry: NormalizedEntry): NarrationResult | null {
    switch (entry.type.kind) {
      case "tool_use":
        return this.describeToolUse(entry);

      case "assistant_message":
        // Skip if assistant message narration is disabled
        if (!this.config.narrateAssistantMessages) {
          return null;
        }
        return this.summarizeAssistantMessage(entry.content);

      case "error":
        return this.summarizeError(entry);

      case "thinking":
        // Skip thinking events - internal reasoning shouldn't be narrated
        return null;

      case "system_message":
        // Skip system messages - they're not user-facing
        return null;

      case "user_message":
        // Skip user messages - the user knows what they said
        return null;

      default:
        return null;
    }
  }

  /**
   * Create a full VoiceNarrationEvent with execution ID
   *
   * @param entry - The normalized entry from agent execution
   * @param executionId - The execution ID to associate with the event
   * @returns VoiceNarrationEvent if the event should be narrated, null otherwise
   */
  createNarrationEvent(
    entry: NormalizedEntry,
    executionId: string
  ): VoiceNarrationEvent | null {
    const result = this.summarizeForVoice(entry);
    if (!result) return null;

    return {
      type: "voice_narration",
      executionId,
      text: result.text,
      category: result.category,
      priority: result.priority,
    };
  }

  /**
   * Describe a tool use event in natural language
   */
  private describeToolUse(entry: NormalizedEntry): NarrationResult | null {
    if (entry.type.kind !== "tool_use") return null;

    const tool = entry.type.tool;
    const toolName = tool.toolName.toLowerCase();

    // If narrateToolUse is disabled, only allow 'speak' tool through
    if (!this.config.narrateToolUse && toolName !== "speak") {
      return null;
    }

    // Only narrate the start of tool execution (running status)
    // or completed tools if configured to narrate results
    if (tool.status !== "running" && !this.config.narrateToolResults) {
      return null;
    }

    // If tool completed and we should narrate results
    if (
      this.config.narrateToolResults &&
      (tool.status === "success" || tool.status === "failed")
    ) {
      return this.describeToolResult(tool);
    }

    // Special handling for 'speak' tool - extract text and priority from args
    if (toolName === "speak") {
      const args =
        tool.action.kind === "tool"
          ? (tool.action.args as Record<string, unknown>)
          : {};
      const text = args.text as string | undefined;
      if (!text) return null;

      const priority = (args.priority as NarrationPriority) || "normal";
      return {
        text,
        category: "status",
        priority,
      };
    }

    // Describe the tool action starting
    const text = this.describeToolAction(tool.toolName, tool.action);
    if (!text) return null;

    return {
      text,
      category: "progress",
      priority: "normal",
    };
  }

  /**
   * Generate narration text for a specific tool action
   */
  private describeToolAction(
    toolName: string,
    action: ActionType
  ): string | null {
    switch (action.kind) {
      case "file_read":
        return `Reading ${this.formatPath(action.path)}`;

      case "file_write":
        return `Writing ${this.formatPath(action.path)}`;

      case "file_edit":
        return `Editing ${this.formatPath(action.path)}`;

      case "command_run":
        return `Running ${this.formatCommand(action.command)}`;

      case "search":
        return `Searching for ${this.truncate(action.query, 30)}`;

      case "tool":
        // Generic tool - describe based on tool name
        return this.describeGenericTool(
          action.toolName,
          (action.args as Record<string, unknown>) || {}
        );

      default:
        // Unknown action type - use tool name
        return `Using ${toolName}`;
    }
  }

  /**
   * Describe a generic tool use
   */
  private describeGenericTool(
    toolName: string,
    args: Record<string, unknown>
  ): string | null {
    const normalizedName = toolName.toLowerCase();

    // Handle common tool names
    switch (normalizedName) {
      case "read":
        if (args.file_path || args.path) {
          return `Reading ${this.formatPath(String(args.file_path || args.path))}`;
        }
        return "Reading a file";

      case "write":
        if (args.file_path || args.path) {
          return `Writing ${this.formatPath(String(args.file_path || args.path))}`;
        }
        return "Writing a file";

      case "edit":
        if (args.file_path || args.path) {
          return `Editing ${this.formatPath(String(args.file_path || args.path))}`;
        }
        return "Editing a file";

      case "bash":
        if (args.command) {
          return `Running ${this.formatCommand(String(args.command))}`;
        }
        return "Running a command";

      case "grep":
        if (args.pattern) {
          return `Searching for ${this.truncate(String(args.pattern), 30)}`;
        }
        return "Searching code";

      case "glob":
        if (args.pattern) {
          return `Finding files matching ${this.truncate(String(args.pattern), 30)}`;
        }
        return "Finding files";

      case "task":
        return "Starting a background task";

      case "webfetch":
      case "web_fetch":
        if (args.url) {
          return `Fetching ${this.formatUrl(String(args.url))}`;
        }
        return "Fetching from the web";

      case "websearch":
      case "web_search":
        if (args.query) {
          return `Searching the web for ${this.truncate(String(args.query), 30)}`;
        }
        return "Searching the web";

      case "speak":
        // Agent explicitly wants to speak this text - return as-is
        if (args.text) {
          return String(args.text);
        }
        return null;

      default:
        return `Using ${toolName}`;
    }
  }

  /**
   * Describe a tool result (for when narrateToolResults is enabled)
   */
  private describeToolResult(tool: {
    toolName: string;
    status: string;
    result?: { success: boolean; data?: unknown; error?: string };
  }): NarrationResult {
    if (tool.status === "failed" || !tool.result?.success) {
      const errorMsg = tool.result?.error || "unknown error";
      return {
        text: `${tool.toolName} failed: ${this.truncate(errorMsg, 50)}`,
        category: "error",
        priority: "high",
      };
    }

    return {
      text: `${tool.toolName} completed successfully`,
      category: "progress",
      priority: "low",
    };
  }

  /**
   * Summarize an assistant message for voice narration
   */
  private summarizeAssistantMessage(content: string): NarrationResult | null {
    if (!content || content.trim().length === 0) {
      return null;
    }

    const trimmed = content.trim();

    // If message is short enough, use it directly
    if (trimmed.length <= this.config.maxAssistantMessageLength) {
      return {
        text: trimmed,
        category: "status",
        priority: "normal",
      };
    }

    // For longer messages, extract key sentences
    const summarized = this.extractKeySentences(trimmed);

    return {
      text: summarized,
      category: "status",
      priority: "normal",
    };
  }

  /**
   * Extract key sentences from a longer text
   *
   * Strategy:
   * 1. Split into sentences
   * 2. Take first 1-2 sentences that are meaningful
   * 3. Skip sentences that are just formatting or headers
   */
  private extractKeySentences(text: string): string {
    // Split on sentence boundaries
    const sentencePattern = /[.!?]+\s+|[\n\r]+/;
    const sentences = text.split(sentencePattern).filter((s) => {
      const trimmed = s.trim();
      // Skip empty sentences, markdown headers, code blocks, etc.
      return (
        trimmed.length > 10 &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("```") &&
        !trimmed.startsWith("|") && // tables
        !trimmed.match(/^[-*]\s/) // bullet points
      );
    });

    if (sentences.length === 0) {
      // Fall back to truncating the original text
      return this.truncate(text, this.config.maxAssistantMessageLength);
    }

    // Take first 1-2 sentences
    const firstSentence = sentences[0].trim();
    if (sentences.length === 1 || firstSentence.length > 80) {
      return this.truncate(firstSentence, this.config.maxAssistantMessageLength);
    }

    const secondSentence = sentences[1]?.trim();
    if (secondSentence) {
      const combined = `${firstSentence}. ${secondSentence}`;
      if (combined.length <= this.config.maxAssistantMessageLength + 20) {
        return combined;
      }
    }

    return firstSentence;
  }

  /**
   * Summarize an error event
   */
  private summarizeError(entry: NormalizedEntry): NarrationResult {
    if (entry.type.kind !== "error") {
      return {
        text: "An error occurred",
        category: "error",
        priority: "high",
      };
    }

    const error = entry.type.error;
    const message = error.message || "An unknown error occurred";

    return {
      text: `Error: ${this.truncate(message, 80)}`,
      category: "error",
      priority: "high",
    };
  }

  /**
   * Format a file path for narration
   *
   * Extracts just the filename or last path component for brevity.
   */
  private formatPath(path: string): string {
    if (!this.config.includeFilePaths) {
      return "a file";
    }

    // Extract filename from path
    const parts = path.split(/[/\\]/);
    const filename = parts[parts.length - 1];

    // If path has directory context, include parent
    if (parts.length > 1) {
      const parent = parts[parts.length - 2];
      if (parent && parent !== "." && parent !== "..") {
        return `${parent}/${filename}`;
      }
    }

    return filename;
  }

  /**
   * Format a command for narration
   *
   * Truncates long commands and extracts the main command.
   */
  private formatCommand(command: string): string {
    const trimmed = command.trim();

    // Extract first part (the actual command)
    const firstWord = trimmed.split(/\s+/)[0];

    // For common commands, provide more context
    const commonCommands = ["npm", "yarn", "pnpm", "git", "docker", "make"];

    if (commonCommands.includes(firstWord)) {
      // Include the subcommand for these
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const subcommand = `${parts[0]} ${parts[1]}`;
        if (subcommand.length <= this.config.maxCommandLength) {
          return subcommand;
        }
      }
    }

    return this.truncate(trimmed, this.config.maxCommandLength);
  }

  /**
   * Format a URL for narration
   */
  private formatUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Return just the hostname
      return parsed.hostname;
    } catch {
      return this.truncate(url, 30);
    }
  }

  /**
   * Truncate text to a maximum length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * Update the narration configuration
   */
  updateConfig(config: Partial<NarrationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration
   */
  getConfig(): NarrationConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Rate Limiter
// =============================================================================

/**
 * Configuration for narration rate limiting
 */
export interface NarrationRateLimiterConfig {
  /** Minimum time between narrations in milliseconds (default: 1000) */
  minIntervalMs: number;
  /** Maximum pending narrations before skipping low priority (default: 3) */
  maxQueueSize: number;
  /** Whether to coalesce rapid tool calls into summaries (default: true) */
  coalesceToolCalls: boolean;
  /** Time window for coalescing tool calls in milliseconds (default: 2000) */
  coalesceWindowMs: number;
}

/**
 * Default rate limiter configuration
 */
const DEFAULT_RATE_LIMITER_CONFIG: NarrationRateLimiterConfig = {
  minIntervalMs: 1000,
  maxQueueSize: 3,
  coalesceToolCalls: true,
  coalesceWindowMs: 2000,
};

/**
 * Pending narration entry with timestamp
 */
interface PendingNarration {
  narration: NarrationResult;
  timestamp: number;
}

/**
 * NarrationRateLimiter
 *
 * Limits narration event emissions to prevent overwhelming the TTS system.
 *
 * Rate limiting rules:
 * - Don't emit narration more than once per second
 * - Coalesce rapid tool calls into summary ("Reading 3 files...")
 * - Skip low-priority narrations if queue is building up
 *
 * @example
 * ```typescript
 * const limiter = new NarrationRateLimiter();
 *
 * for await (const entry of executionStream) {
 *   const narration = narrationService.summarizeForVoice(entry);
 *   if (narration) {
 *     const result = limiter.submit(narration);
 *     if (result) {
 *       // Emit the narration event
 *       broadcastVoiceNarration(projectId, executionId, result);
 *     }
 *   }
 * }
 *
 * // At end of execution, flush any pending narrations
 * const final = limiter.flush();
 * if (final) {
 *   broadcastVoiceNarration(projectId, executionId, final);
 * }
 * ```
 */
export class NarrationRateLimiter {
  private config: NarrationRateLimiterConfig;
  private lastEmitTime: number = 0;
  private pendingQueue: PendingNarration[] = [];
  private coalescingToolCalls: { action: string; count: number }[] = [];
  private lastToolCallTime: number = 0;

  constructor(config?: Partial<NarrationRateLimiterConfig>) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
  }

  /**
   * Submit a narration for potential emission
   *
   * Returns the narration to emit immediately, or null if rate limited.
   * The narration may be modified (e.g., coalesced tool calls).
   *
   * @param narration - The narration result to submit
   * @returns The narration to emit, or null if rate limited
   */
  submit(narration: NarrationResult): NarrationResult | null {
    const now = Date.now();

    // Check if this is a tool call that should be coalesced
    if (this.config.coalesceToolCalls && narration.category === "progress") {
      const coalesced = this.tryCoalesceToolCall(narration, now);
      if (coalesced === "pending") {
        // Tool call was added to coalescing queue, nothing to emit yet
        return null;
      } else if (coalesced) {
        // Coalesced result ready to emit
        narration = coalesced;
      }
    }

    // Check rate limit
    const timeSinceLastEmit = now - this.lastEmitTime;
    if (timeSinceLastEmit < this.config.minIntervalMs) {
      // Rate limited - queue or skip based on priority
      return this.handleRateLimited(narration, now);
    }

    // Can emit now - but first check if we have pending high-priority items
    const pending = this.popHighestPriority();
    if (pending) {
      // Emit pending item first, queue current
      this.pendingQueue.push({ narration, timestamp: now });
      this.lastEmitTime = now;
      return pending;
    }

    // Emit current narration
    this.lastEmitTime = now;
    return narration;
  }

  /**
   * Flush any pending narrations
   *
   * Call this at the end of an execution to emit any remaining narrations.
   *
   * @returns The highest priority pending narration, or null if none
   */
  flush(): NarrationResult | null {
    // First, flush any coalescing tool calls
    const coalescedResult = this.flushCoalescing();
    if (coalescedResult) {
      return coalescedResult;
    }

    // Then return highest priority pending item
    return this.popHighestPriority();
  }

  /**
   * Check if there are any pending narrations
   */
  hasPending(): boolean {
    return (
      this.pendingQueue.length > 0 || this.coalescingToolCalls.length > 0
    );
  }

  /**
   * Reset the rate limiter state
   */
  reset(): void {
    this.lastEmitTime = 0;
    this.pendingQueue = [];
    this.coalescingToolCalls = [];
    this.lastToolCallTime = 0;
  }

  /**
   * Try to coalesce tool calls into a summary
   *
   * @returns "pending" if added to queue, NarrationResult if ready to emit, null if not a coalesceable call
   */
  private tryCoalesceToolCall(
    narration: NarrationResult,
    now: number
  ): NarrationResult | "pending" | null {
    const text = narration.text;

    // Check if this is a file/search operation that can be coalesced
    const fileReadMatch = text.match(/^Reading\s+(.+)$/);
    const fileEditMatch = text.match(/^Editing\s+(.+)$/);
    const searchMatch = text.match(/^Searching\s+(.+)$/);

    let action: string | null = null;
    if (fileReadMatch) action = "Reading";
    else if (fileEditMatch) action = "Editing";
    else if (searchMatch) action = "Searching";

    if (!action) {
      // Not a coalesceable tool call, flush any pending and return null
      return this.flushCoalescing();
    }

    // Check if within coalescing window
    if (
      this.coalescingToolCalls.length > 0 &&
      now - this.lastToolCallTime > this.config.coalesceWindowMs
    ) {
      // Window expired, flush previous and start new
      const flushed = this.flushCoalescing();
      this.coalescingToolCalls = [{ action, count: 1 }];
      this.lastToolCallTime = now;

      if (flushed) {
        // Return flushed result, current is queued
        return flushed;
      }
      return "pending";
    }

    // Add to coalescing queue
    const existing = this.coalescingToolCalls.find((c) => c.action === action);
    if (existing) {
      existing.count++;
    } else {
      this.coalescingToolCalls.push({ action, count: 1 });
    }
    this.lastToolCallTime = now;

    return "pending";
  }

  /**
   * Flush coalescing queue into a summary narration
   */
  private flushCoalescing(): NarrationResult | null {
    if (this.coalescingToolCalls.length === 0) {
      return null;
    }

    const calls = this.coalescingToolCalls;
    this.coalescingToolCalls = [];
    this.lastToolCallTime = 0;

    // Single action
    if (calls.length === 1) {
      const { action, count } = calls[0];
      if (count === 1) {
        // Just one call, no need to summarize
        return null;
      }
      const fileWord = count === 1 ? "file" : "files";
      return {
        text: `${action} ${count} ${fileWord}`,
        category: "progress",
        priority: "normal",
      };
    }

    // Multiple actions - create combined summary
    const parts = calls.map(({ action, count }) => {
      const fileWord = count === 1 ? "file" : "files";
      return `${action.toLowerCase()} ${count} ${fileWord}`;
    });

    return {
      text: parts.join(", "),
      category: "progress",
      priority: "normal",
    };
  }

  /**
   * Handle a rate-limited narration
   *
   * Queues high priority narrations, skips low priority if queue is full.
   */
  private handleRateLimited(
    narration: NarrationResult,
    now: number
  ): NarrationResult | null {
    // Skip low priority if queue is building up
    if (
      narration.priority === "low" &&
      this.pendingQueue.length >= this.config.maxQueueSize
    ) {
      return null;
    }

    // Queue the narration
    this.pendingQueue.push({ narration, timestamp: now });

    // Prune old low-priority items if queue is too large
    while (this.pendingQueue.length > this.config.maxQueueSize) {
      const lowPriorityIndex = this.pendingQueue.findIndex(
        (p) => p.narration.priority === "low"
      );
      if (lowPriorityIndex >= 0) {
        this.pendingQueue.splice(lowPriorityIndex, 1);
      } else {
        // No low priority items, remove oldest
        this.pendingQueue.shift();
      }
    }

    return null;
  }

  /**
   * Pop the highest priority pending narration
   */
  private popHighestPriority(): NarrationResult | null {
    if (this.pendingQueue.length === 0) {
      return null;
    }

    // Priority order: high > normal > low
    const priorityOrder = { high: 0, normal: 1, low: 2 };

    // Find highest priority
    let bestIndex = 0;
    let bestPriority = priorityOrder[this.pendingQueue[0].narration.priority];

    for (let i = 1; i < this.pendingQueue.length; i++) {
      const priority = priorityOrder[this.pendingQueue[i].narration.priority];
      if (priority < bestPriority) {
        bestIndex = i;
        bestPriority = priority;
      }
    }

    // Remove and return
    const [item] = this.pendingQueue.splice(bestIndex, 1);
    return item.narration;
  }
}

// =============================================================================
// Global Instances
// =============================================================================

/**
 * Narration settings from voice config
 */
interface NarrationSettingsConfig {
  narrateToolUse?: boolean;
  narrateToolResults?: boolean;
  narrateAssistantMessages?: boolean;
}

/**
 * Get narration configuration from voice settings config.
 *
 * @param voiceConfig - Optional narration settings from project config.json
 */
export function getNarrationConfig(voiceConfig?: { narration?: NarrationSettingsConfig }): Partial<NarrationConfig> {
  const config: Partial<NarrationConfig> = {};

  if (voiceConfig?.narration?.narrateToolUse !== undefined) {
    config.narrateToolUse = voiceConfig.narration.narrateToolUse;
  }

  if (voiceConfig?.narration?.narrateToolResults !== undefined) {
    config.narrateToolResults = voiceConfig.narration.narrateToolResults;
  }

  if (voiceConfig?.narration?.narrateAssistantMessages !== undefined) {
    config.narrateAssistantMessages = voiceConfig.narration.narrateAssistantMessages;
  }

  return config;
}

/**
 * Global narration service instance
 * Lazy-initialized on first use
 */
let narrationServiceInstance: NarrationService | null = null;

/**
 * Get or create the global narration service instance
 *
 * Configuration priority (highest to lowest):
 * 1. config parameter (explicit override)
 * 2. voiceConfig (from project config.json)
 * 3. Environment variables (backwards compatibility)
 * 4. Default values
 *
 * @param config - Optional configuration override (takes precedence over everything)
 * @param voiceConfig - Optional voice settings from project config.json
 * @returns The narration service instance
 */
export function getNarrationService(
  config?: Partial<NarrationConfig>,
  voiceConfig?: { narration?: NarrationSettingsConfig }
): NarrationService {
  if (!narrationServiceInstance) {
    // Merge: voiceConfig/env < provided config
    const baseConfig = getNarrationConfig(voiceConfig);
    narrationServiceInstance = new NarrationService({ ...baseConfig, ...config });
  }
  return narrationServiceInstance;
}

/**
 * Reset the global narration service instance (for testing)
 */
export function resetNarrationService(): void {
  narrationServiceInstance = null;
}
