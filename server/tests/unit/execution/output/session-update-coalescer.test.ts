/**
 * Tests for SessionUpdateCoalescer
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SessionUpdateCoalescer } from "../../../../src/execution/output/session-update-coalescer.js";
import type { SessionUpdate } from "acp-factory";

describe("SessionUpdateCoalescer", () => {
  let coalescer: SessionUpdateCoalescer;

  beforeEach(() => {
    coalescer = new SessionUpdateCoalescer();
  });

  describe("message coalescing", () => {
    it("should coalesce multiple agent_message_chunk into single complete message", () => {
      // Process multiple chunks
      const results1 = coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      } as SessionUpdate);

      const results2 = coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world!" },
      } as SessionUpdate);

      // No output yet - still accumulating
      expect(results1).toHaveLength(0);
      expect(results2).toHaveLength(0);

      // Flush to get the complete message
      const flushed = coalescer.flush();
      expect(flushed).toHaveLength(1);
      expect(flushed[0].sessionUpdate).toBe("agent_message_complete");
      expect(flushed[0]).toHaveProperty("content");
      if ("content" in flushed[0]) {
        expect(flushed[0].content).toEqual({ type: "text", text: "Hello world!" });
      }
    });

    it("should coalesce agent_thought_chunk separately from messages", () => {
      // Process message chunk
      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Message" },
      } as SessionUpdate);

      // Switch to thought - should emit pending message
      const results = coalescer.process({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking..." },
      } as SessionUpdate);

      expect(results).toHaveLength(1);
      expect(results[0].sessionUpdate).toBe("agent_message_complete");

      // Flush to get the thought
      const flushed = coalescer.flush();
      expect(flushed).toHaveLength(1);
      expect(flushed[0].sessionUpdate).toBe("agent_thought_complete");
    });
  });

  describe("tool call handling", () => {
    it("should track tool call lifecycle", () => {
      // Tool call starts - should interrupt any pending text
      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Let me run a command" },
      } as SessionUpdate);

      const toolCallResults = coalescer.process({
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Running bash command",
        status: "in_progress",
        rawInput: { command: "ls -la" },
      } as SessionUpdate);

      // Should have flushed the message
      expect(toolCallResults).toHaveLength(1);
      expect(toolCallResults[0].sessionUpdate).toBe("agent_message_complete");

      // Tool completes
      const updateResults = coalescer.process({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "file1.txt\nfile2.txt",
      } as SessionUpdate);

      expect(updateResults).toHaveLength(1);
      expect(updateResults[0].sessionUpdate).toBe("tool_call_complete");
      if (updateResults[0].sessionUpdate === "tool_call_complete") {
        expect(updateResults[0].toolCallId).toBe("tool-1");
        expect(updateResults[0].status).toBe("completed");
        expect(updateResults[0].rawOutput).toBe("file1.txt\nfile2.txt");
      }
    });

    it("should handle failed tool calls", () => {
      coalescer.process({
        sessionUpdate: "tool_call",
        toolCallId: "tool-2",
        title: "Reading file",
        status: "in_progress",
      } as SessionUpdate);

      const results = coalescer.process({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "failed",
        rawOutput: "File not found",
      } as SessionUpdate);

      expect(results).toHaveLength(1);
      expect(results[0].sessionUpdate).toBe("tool_call_complete");
      if (results[0].sessionUpdate === "tool_call_complete") {
        expect(results[0].status).toBe("failed");
      }
    });

    it("should flush incomplete tool calls", () => {
      coalescer.process({
        sessionUpdate: "tool_call",
        toolCallId: "tool-3",
        title: "Long running task",
        status: "in_progress",
      } as SessionUpdate);

      // Flush without completing the tool call
      const flushed = coalescer.flush();
      expect(flushed).toHaveLength(1);
      expect(flushed[0].sessionUpdate).toBe("tool_call_complete");
    });
  });

  describe("state management", () => {
    it("should report pending state correctly", () => {
      expect(coalescer.hasPendingState()).toBe(false);

      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Test" },
      } as SessionUpdate);

      expect(coalescer.hasPendingState()).toBe(true);

      coalescer.flush();
      expect(coalescer.hasPendingState()).toBe(false);
    });

    it("should reset state completely", () => {
      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Test" },
      } as SessionUpdate);

      coalescer.process({
        sessionUpdate: "tool_call",
        toolCallId: "tool-4",
        title: "Test",
        status: "in_progress",
      } as SessionUpdate);

      expect(coalescer.hasPendingState()).toBe(true);

      coalescer.reset();
      expect(coalescer.hasPendingState()).toBe(false);

      // Flush should return empty after reset
      expect(coalescer.flush()).toHaveLength(0);
    });
  });

  describe("timestamp preservation", () => {
    it("should preserve timestamp from first chunk", async () => {
      const beforeProcess = new Date();

      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "First " },
      } as SessionUpdate);

      // Small delay
      await new Promise((r) => setTimeout(r, 10));

      coalescer.process({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "second" },
      } as SessionUpdate);

      const flushed = coalescer.flush();
      expect(flushed).toHaveLength(1);

      const timestamp = flushed[0].timestamp;
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeProcess.getTime());
    });
  });

  describe("metadata events", () => {
    it("should pass through metadata events without coalescing", () => {
      // These shouldn't produce any coalesced output
      const planResults = coalescer.process({
        sessionUpdate: "plan",
        steps: [],
      } as unknown as SessionUpdate);

      const modeResults = coalescer.process({
        sessionUpdate: "current_mode_update",
        mode: "code",
      } as unknown as SessionUpdate);

      expect(planResults).toHaveLength(0);
      expect(modeResults).toHaveLength(0);
      expect(coalescer.hasPendingState()).toBe(false);
    });
  });
});
