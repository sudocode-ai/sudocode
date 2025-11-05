/**
 * Tests for Claude to AG-UI transformation logic
 */

import { describe, it, expect } from "vitest";
import {
  transformClaudeMessageToAgUi,
  parseExecutionLogs,
  type ClaudeStreamMessage,
  type AgUiEvent,
} from "../../../../src/execution/output/claude-to-ag-ui.js";

describe("transformClaudeMessageToAgUi", () => {
  describe("assistant messages", () => {
    it("should transform text content to TEXT_MESSAGE_CONTENT event", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          content: [
            {
              type: "text",
              text: "Hello, I'll help you with that.",
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "CUSTOM",
        name: "TEXT_MESSAGE_CONTENT",
        value: {
          content: "Hello, I'll help you with that.",
        },
      });
      expect(events[0].timestamp).toBeTypeOf("number");
    });

    it("should transform tool_use to TOOL_CALL_START and TOOL_CALL_ARGS events", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_abc123",
              name: "Read",
              input: {
                file_path: "/test/file.ts",
              },
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "TOOL_CALL_START",
        toolCallId: "tool_abc123",
        toolCallName: "Read",
      });
      expect(events[1]).toMatchObject({
        type: "TOOL_CALL_ARGS",
        toolCallId: "tool_abc123",
        delta: JSON.stringify({ file_path: "/test/file.ts" }),
      });
    });

    it("should handle mixed text and tool_use content", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Let me read that file for you.",
            },
            {
              type: "tool_use",
              id: "tool_456",
              name: "Read",
              input: { file_path: "/test.ts" },
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(3);
      expect(events[0].name).toBe("TEXT_MESSAGE_CONTENT");
      expect(events[1].type).toBe("TOOL_CALL_START");
      expect(events[2].type).toBe("TOOL_CALL_ARGS");
    });

    it("should handle empty content array", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(0);
    });

    it("should handle missing content", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {},
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(0);
    });

    it("should skip text blocks with no text", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              // No text field
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(0);
    });

    it("should generate tool ID if missing", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              // No id field
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(2);
      expect(events[0].toolCallId).toMatch(/^tool-\d+$/);
      expect(events[1].toolCallId).toMatch(/^tool-\d+$/);
    });
  });

  describe("tool_result messages", () => {
    it("should transform tool_result to TOOL_CALL_END and TOOL_CALL_RESULT events", () => {
      const message: ClaudeStreamMessage = {
        type: "tool_result",
        result: {
          tool_use_id: "tool_abc123",
          content: [
            {
              type: "text",
              text: "File contents here",
            },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "TOOL_CALL_END",
        toolCallId: "tool_abc123",
      });
      expect(events[1]).toMatchObject({
        type: "TOOL_CALL_RESULT",
        toolCallId: "tool_abc123",
        messageId: "msg-tool_abc123",
        content: "File contents here",
      });
    });

    it("should handle missing tool_use_id", () => {
      const message: ClaudeStreamMessage = {
        type: "tool_result",
        result: {
          content: [{ type: "text", text: "result" }],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(2);
      expect(events[0].toolCallId).toBe("unknown");
      expect(events[1].toolCallId).toBe("unknown");
    });

    it("should handle empty content", () => {
      const message: ClaudeStreamMessage = {
        type: "tool_result",
        result: {
          tool_use_id: "tool_123",
          content: [],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(2);
      expect(events[1].content).toBe("");
    });

    it("should extract text from first matching content item", () => {
      const message: ClaudeStreamMessage = {
        type: "tool_result",
        result: {
          tool_use_id: "tool_123",
          content: [
            { type: "other", text: "ignored" },
            { type: "text", text: "correct result" },
            { type: "text", text: "also ignored" },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events[1].content).toBe("correct result");
    });
  });

  describe("result messages with usage", () => {
    it("should transform usage to USAGE_UPDATE event", () => {
      const message: ClaudeStreamMessage = {
        type: "result",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 25,
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "CUSTOM",
        name: "USAGE_UPDATE",
        value: {
          inputTokens: 100,
          outputTokens: 50,
          cacheTokens: 25,
          totalTokens: 150,
        },
      });
    });

    it("should handle missing token fields", () => {
      const message: ClaudeStreamMessage = {
        type: "result",
        usage: {
          input_tokens: 100,
          // Missing output_tokens
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      expect(events[0].value).toMatchObject({
        inputTokens: 100,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 100,
      });
    });

    it("should return empty array for result without usage", () => {
      const message: ClaudeStreamMessage = {
        type: "result",
        // No usage field
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(0);
    });
  });

  describe("error messages", () => {
    it("should transform error to RUN_ERROR event", () => {
      const message: ClaudeStreamMessage = {
        type: "error",
        error: {
          message: "Something went wrong",
          type: "api_error",
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "RUN_ERROR",
        message: "Something went wrong",
        errorType: "api_error",
      });
    });

    it("should use fallback for empty error message", () => {
      const message: ClaudeStreamMessage = {
        type: "error",
        error: {
          message: "",
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      // Empty string is falsy, so fallback is used
      expect(events[0].message).toBe("Unknown error");
    });

    it("should handle missing error field", () => {
      const message: ClaudeStreamMessage = {
        type: "error",
        // No error field
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events).toHaveLength(1);
      expect(events[0].message).toBe("Unknown error");
    });
  });

  describe("edge cases", () => {
    it("should return consistent timestamps for events in same message", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First" },
            { type: "text", text: "Second" },
          ],
        },
      };

      const events = transformClaudeMessageToAgUi(message, 0);

      expect(events[0].timestamp).toBe(events[1].timestamp);
    });

    it("should handle sequence parameter correctly", () => {
      const message: ClaudeStreamMessage = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "test" }],
        },
      };

      // startSequence is passed but not currently used in transformation
      // Just verify it doesn't cause errors
      const events = transformClaudeMessageToAgUi(message, 42);

      expect(events).toHaveLength(1);
    });
  });
});

describe("parseExecutionLogs", () => {
  it("should parse array of NDJSON log lines", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(2);
    expect(events[0].name).toBe("TEXT_MESSAGE_CONTENT");
    expect(events[1].name).toBe("USAGE_UPDATE");
  });

  it("should skip empty lines", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "test" }] },
      }),
      "",
      "   ",
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 10 },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(2);
  });

  it("should handle malformed JSON gracefully", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "valid" }] },
      }),
      "{ invalid json",
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 10 },
      }),
    ];

    // Should not throw, continues processing
    const events = await parseExecutionLogs(rawLogs);

    // Should get events from the 2 valid lines
    expect(events).toHaveLength(2);
    expect(events[0].value.content).toBe("valid");
    expect(events[1].name).toBe("USAGE_UPDATE");
  });

  it("should handle empty array", async () => {
    const events = await parseExecutionLogs([]);

    expect(events).toHaveLength(0);
  });

  it("should accumulate events from multiple messages", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "text1" },
            { type: "tool_use", id: "tool1", name: "Read", input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: "tool_result",
        result: { tool_use_id: "tool1", content: [{ type: "text", text: "result" }] },
      }),
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    // First message: 1 text + 2 tool events = 3
    // Second message: 2 tool result events = 2
    // Third message: 1 usage event = 1
    // Total: 6 events
    expect(events).toHaveLength(6);
  });

  it("should handle very large log arrays", async () => {
    const rawLogs = Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: `Message ${i}` }] },
      })
    );

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(1000);
  });

  it("should trim whitespace from lines", async () => {
    const rawLogs = [
      `  ${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "test" }] },
      })}  `,
    ];

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(1);
    expect(events[0].value.content).toBe("test");
  });

  it("should handle lines with only whitespace", async () => {
    const rawLogs = [
      "   ",
      "\t\t",
      "\n",
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 10 },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(1);
  });

  it("should update sequence numbers correctly", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "text1" },
            { type: "text", text: "text2" },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 10 },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    // First message generates 2 events (sequence 0-1)
    // Second message should start at sequence 2
    expect(events).toHaveLength(3);
  });

  it("should handle complex nested structures", async () => {
    const rawLogs = [
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_complex",
          model: "claude-3-5-sonnet-20241022",
          content: [
            { type: "text", text: "I'll run these commands:" },
            {
              type: "tool_use",
              id: "tool_bash_1",
              name: "Bash",
              input: {
                command: "npm test",
                description: "Run unit tests",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    ];

    const events = await parseExecutionLogs(rawLogs);

    expect(events).toHaveLength(3); // 1 text + 2 tool events
    expect(events[0].value.content).toBe("I'll run these commands:");
    expect(events[1].toolCallName).toBe("Bash");
    expect(events[2].delta).toContain("npm test");
  });
});
