/**
 * Claude to AG-UI Transformation Logic
 *
 * Shared transformation functions for converting raw Claude stream-json messages
 * to AG-UI events. Used by both:
 * - Backend: Real-time transformation for SSE streaming
 * - Frontend: Historical transformation for log replay
 *
 * @module execution/output/claude-to-ag-ui
 */

/**
 * Claude stream-json message format
 * Based on Claude Code CLI output structure
 */
export interface ClaudeStreamMessage {
  type: "assistant" | "tool_result" | "result" | "error";
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: Array<{
      type: "text" | "tool_use";
      text?: string;
      id?: string;
      name?: string;
      input?: any;
    }>;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  result?: {
    tool_use_id?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: {
    message: string;
    type?: string;
  };
}

/**
 * AG-UI Event types
 * Minimal interface needed for transformation
 */
export interface AgUiEvent {
  type: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * Transform a single Claude stream-json message to AG-UI events
 *
 * @param message - Raw Claude message from stream-json output
 * @param startSequence - Starting sequence number for events
 * @returns Array of AG-UI events (may be empty for unhandled message types)
 *
 * @example
 * ```typescript
 * const message = JSON.parse(line);
 * const events = transformClaudeMessageToAgUi(message, 0);
 * events.forEach(event => console.log(event));
 * ```
 */
export function transformClaudeMessageToAgUi(
  message: ClaudeStreamMessage,
  _startSequence: number
): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  const timestamp = Date.now();

  switch (message.type) {
    case "assistant": {
      // Extract content blocks from assistant message
      const content = message.message?.content || [];

      for (const block of content) {
        if (block.type === "text" && block.text) {
          // Text message → TEXT_MESSAGE_CONTENT event
          events.push({
            type: "CUSTOM",
            timestamp,
            name: "TEXT_MESSAGE_CONTENT",
            value: {
              content: block.text,
            },
          });
        } else if (block.type === "tool_use") {
          // Tool use → TOOL_CALL_START + TOOL_CALL_ARGS events
          const toolId = block.id || `tool-${Date.now()}`;

          events.push(
            {
              type: "TOOL_CALL_START",
              timestamp,
              toolCallId: toolId,
              toolCallName: block.name || "unknown",
            },
            {
              type: "TOOL_CALL_ARGS",
              timestamp,
              toolCallId: toolId,
              delta: JSON.stringify(block.input || {}),
            }
          );
        }
      }
      break;
    }

    case "tool_result": {
      // Tool result → TOOL_CALL_END + TOOL_CALL_RESULT events
      const toolUseId = message.result?.tool_use_id || "unknown";
      const resultContent = message.result?.content || [];
      const resultText =
        resultContent.find((c) => c.type === "text")?.text || "";

      events.push(
        {
          type: "TOOL_CALL_END",
          timestamp,
          toolCallId: toolUseId,
        },
        {
          type: "TOOL_CALL_RESULT",
          timestamp,
          messageId: `msg-${toolUseId}`,
          toolCallId: toolUseId,
          content: resultText,
        }
      );
      break;
    }

    case "result": {
      // Result message with usage → USAGE_UPDATE event
      if (message.usage) {
        const usage = message.usage;
        events.push({
          type: "CUSTOM",
          timestamp,
          name: "USAGE_UPDATE",
          value: {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cacheTokens: usage.cache_read_input_tokens || 0,
            totalTokens:
              (usage.input_tokens || 0) + (usage.output_tokens || 0),
          },
        });
      }
      break;
    }

    case "error": {
      // Error message → RUN_ERROR event
      events.push({
        type: "RUN_ERROR",
        timestamp,
        message: message.error?.message || "Unknown error",
        errorType: message.error?.type,
      });
      break;
    }
  }

  return events;
}

/**
 * Parse array of raw execution logs (NDJSON format) to AG-UI events
 *
 * Processes each line as a separate Claude message and transforms to AG-UI events.
 * Handles parse errors gracefully by logging warnings and continuing.
 *
 * @param rawLogs - Array of NDJSON log lines
 * @returns Promise resolving to array of AG-UI events
 *
 * @example
 * ```typescript
 * const logs = await fetch('/api/executions/123/logs').then(r => r.json());
 * const events = await parseExecutionLogs(logs.logs);
 * console.log(`Parsed ${events.length} events`);
 * ```
 */
export async function parseExecutionLogs(
  rawLogs: string[]
): Promise<AgUiEvent[]> {
  const events: AgUiEvent[] = [];
  let sequence = 0;

  for (let i = 0; i < rawLogs.length; i++) {
    const line = rawLogs[i].trim();

    // Skip empty lines
    if (!line) {
      continue;
    }

    try {
      // Parse JSON line
      const message = JSON.parse(line) as ClaudeStreamMessage;

      // Transform to AG-UI events
      const agUiEvents = transformClaudeMessageToAgUi(message, sequence);

      // Accumulate events
      events.push(...agUiEvents);
      sequence += agUiEvents.length;
    } catch (error) {
      // Log warning but continue processing
      console.warn(
        `[parseExecutionLogs] Failed to parse log line ${i + 1}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Don't throw - continue with remaining logs
    }
  }

  return events;
}
