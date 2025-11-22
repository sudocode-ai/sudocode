/**
 * Unit tests for NormalizedEntryToAgUiAdapter
 *
 * Tests the conversion of NormalizedEntry objects to AG-UI events.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NormalizedEntryToAgUiAdapter } from "../../../../src/execution/output/normalized-to-ag-ui-adapter.js";
import type { NormalizedEntry } from "agent-execution-engine/agents";

describe("NormalizedEntryToAgUiAdapter", () => {
  let mockAgUiAdapter: any;
  let adapter: NormalizedEntryToAgUiAdapter;

  beforeEach(() => {
    // Mock the AgUiEventAdapter with the emit method
    mockAgUiAdapter = {
      emit: vi.fn(),
    };

    adapter = new NormalizedEntryToAgUiAdapter(mockAgUiAdapter);
  });

  describe("assistant_message handling", () => {
    it("should emit text message events for assistant_message", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Hello world",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      // Should emit 3 events: START, CONTENT, END
      expect(mockAgUiAdapter.emit).toHaveBeenCalledTimes(3);

      // Verify event types
      const calls = mockAgUiAdapter.emit.mock.calls;
      expect(calls[0][0].type).toBe("TEXT_MESSAGE_START");
      expect(calls[1][0].type).toBe("TEXT_MESSAGE_CONTENT");
      expect(calls[1][0].delta).toBe("Hello world");
      expect(calls[2][0].type).toBe("TEXT_MESSAGE_END");
    });

    it("should generate unique message IDs", async () => {
      const entry1: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Message 1",
        timestamp: new Date(),
      };

      const entry2: NormalizedEntry = {
        index: 1,
        type: { kind: "assistant_message" },
        content: "Message 2",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry1);
      await adapter.processEntry(entry2);

      // 6 events total (3 per message)
      expect(mockAgUiAdapter.emit).toHaveBeenCalledTimes(6);

      // Extract message IDs from START events
      const calls = mockAgUiAdapter.emit.mock.calls;
      const message1Id = calls[0][0].messageId;
      const message2Id = calls[3][0].messageId;
      expect(message1Id).not.toBe(message2Id);
    });

    it("should preserve content", async () => {
      const content = "This is a test message with special characters: !@#$%";
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content,
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const contentEvent = calls.find((call) => call[0].type === "TEXT_MESSAGE_CONTENT");
      expect(contentEvent[0].delta).toBe(content);
    });
  });

  describe("tool_use handling", () => {
    it("should emit ToolCallStart for pending tool", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "ls -la" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      // Should emit START and ARGS events
      const calls = mockAgUiAdapter.emit.mock.calls;
      const startEvent = calls.find((call) => call[0].type === "TOOL_CALL_START");
      const argsEvent = calls.find((call) => call[0].type === "TOOL_CALL_ARGS");

      expect(startEvent).toBeDefined();
      expect(startEvent[0].toolCallName).toBe("Bash");
      expect(argsEvent).toBeDefined();
      expect(JSON.parse(argsEvent[0].delta)).toEqual({ command: "ls -la" });
    });

    it("should emit ToolCallResult and End for completed tool", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "echo test" },
            status: "success",
            result: {
              success: true,
              data: "test\n",
            },
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const endEvent = calls.find((call) => call[0].type === "TOOL_CALL_END");
      const resultEvent = calls.find((call) => call[0].type === "TOOL_CALL_RESULT");

      expect(endEvent).toBeDefined();
      expect(resultEvent).toBeDefined();
      expect(resultEvent[0].content).toContain("test");
    });

    it("should handle failed tool calls", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "invalid-command" },
            status: "failed",
            result: {
              success: false,
              error: "Command not found",
            },
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const resultEvent = calls.find((call) => call[0].type === "TOOL_CALL_RESULT");

      expect(resultEvent).toBeDefined();
      expect(resultEvent[0].content).toContain("Command not found");
    });

    it("should extract file_read args", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/path/to/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const argsEvent = calls.find((call) => call[0].type === "TOOL_CALL_ARGS");

      expect(argsEvent).toBeDefined();
      expect(JSON.parse(argsEvent[0].delta)).toEqual({ path: "/path/to/file.ts" });
    });
  });

  describe("thinking handling", () => {
    it("should convert thinking to text message", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "thinking",
          reasoning: "Let me analyze the problem...",
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const contentEvent = calls.find((call) => call[0].type === "TEXT_MESSAGE_CONTENT");

      expect(contentEvent).toBeDefined();
      expect(contentEvent[0].delta).toBe("[Thinking] Let me analyze the problem...");
    });

    it("should handle empty reasoning", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "thinking" },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const contentEvent = calls.find((call) => call[0].type === "TEXT_MESSAGE_CONTENT");

      expect(contentEvent).toBeDefined();
      expect(contentEvent[0].delta).toBe("[Thinking] ");
    });
  });

  describe("error handling", () => {
    it("should emit RunError for error entries", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "error",
          error: {
            message: "Execution failed",
            code: "E001",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const errorEvent = calls.find((call) => call[0].type === "RUN_ERROR");

      expect(errorEvent).toBeDefined();
      expect(errorEvent[0].message).toBe("Execution failed");
    });

    it("should include error stack if available", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "error",
          error: {
            message: "Execution failed",
            code: "E001",
            stack: "Error: Execution failed\n  at ...",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const errorEvent = calls.find((call) => call[0].type === "RUN_ERROR");

      expect(errorEvent).toBeDefined();
      expect(errorEvent[0].rawEvent?.details).toBe("Error: Execution failed\n  at ...");
    });
  });

  describe("system_message handling", () => {
    it("should convert system messages to text messages", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "system_message" },
        content: "System initialized",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const contentEvent = calls.find((call) => call[0].type === "TEXT_MESSAGE_CONTENT");

      expect(contentEvent).toBeDefined();
      expect(contentEvent[0].delta).toBe("[System] System initialized");
    });
  });

  describe("user_message handling", () => {
    it("should skip user messages", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "user_message" },
        content: "User input",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      // No events should be emitted
      expect(mockAgUiAdapter.emit).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle entry with missing timestamp", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Test",
      };

      await expect(adapter.processEntry(entry)).resolves.not.toThrow();
    });

    it("should handle empty content", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const contentEvent = calls.find((call) => call[0].type === "TEXT_MESSAGE_CONTENT");

      expect(contentEvent).toBeDefined();
      expect(contentEvent[0].delta).toBe("");
    });

    it("should handle tool with no result", async () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "ls" },
            status: "success",
            // No result field
          },
        },
        content: "",
        timestamp: new Date(),
      };

      await adapter.processEntry(entry);

      const calls = mockAgUiAdapter.emit.mock.calls;
      const resultEvent = calls.find((call) => call[0].type === "TOOL_CALL_RESULT");

      expect(resultEvent).toBeDefined();
      expect(resultEvent[0].content).toContain("No result available");
    });
  });
});
