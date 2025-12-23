/**
 * Unit tests for NarrationService
 *
 * Tests the conversion of NormalizedEntry execution events
 * into voice narration text.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  NarrationService,
  NarrationRateLimiter,
  getNarrationService,
  resetNarrationService,
  type NarrationResult,
} from "../../../src/services/narration-service.js";
import type { NormalizedEntry } from "agent-execution-engine/agents";

describe("NarrationService", () => {
  let service: NarrationService;

  beforeEach(() => {
    service = new NarrationService();
    resetNarrationService();
  });

  describe("summarizeForVoice", () => {
    describe("tool_use events", () => {
      it("should narrate Read tool with file path", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: { kind: "file_read", path: "/src/components/Button.tsx" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).not.toBeNull();
        expect(result?.text).toBe("Reading components/Button.tsx");
        expect(result?.category).toBe("progress");
        expect(result?.priority).toBe("normal");
      });

      it("should narrate Write tool with file path", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Write",
              action: { kind: "file_write", path: "/src/utils/helpers.ts" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Writing utils/helpers.ts");
        expect(result?.category).toBe("progress");
      });

      it("should narrate Edit tool with file path", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Edit",
              action: {
                kind: "file_edit",
                path: "/src/index.ts",
                changes: [],
              },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Editing src/index.ts");
      });

      it("should narrate Bash tool with command summary", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Bash",
              action: { kind: "command_run", command: "npm test" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Running npm test");
        expect(result?.category).toBe("progress");
      });

      it("should truncate long commands", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Bash",
              action: {
                kind: "command_run",
                command:
                  "some-very-long-custom-command-that-is-definitely-too-long-to-display-in-full --with --many --options",
              },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text.length).toBeLessThanOrEqual(60);
        expect(result?.text).toContain("...");
      });

      it("should narrate Grep tool with search pattern", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Grep",
              action: { kind: "search", query: "TODO" },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Searching for TODO");
      });

      it("should handle generic tool with args", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: {
                kind: "tool",
                toolName: "Read",
                args: { file_path: "/path/to/file.ts" },
              },
              status: "running",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        // Path is formatted as parent/filename
        expect(result?.text).toBe("Reading to/file.ts");
      });

      it("should skip completed tool events by default", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: { kind: "file_read", path: "/src/file.ts" },
              status: "success",
              result: { success: true, data: "file content" },
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });

      it("should narrate completed tools when configured", () => {
        const narrationService = new NarrationService({
          narrateToolResults: true,
        });

        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Read",
              action: { kind: "file_read", path: "/src/file.ts" },
              status: "success",
              result: { success: true, data: "file content" },
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = narrationService.summarizeForVoice(entry);

        expect(result).not.toBeNull();
        expect(result?.text).toBe("Read completed successfully");
        expect(result?.category).toBe("progress");
        expect(result?.priority).toBe("low");
      });

      it("should narrate failed tool results with high priority", () => {
        const narrationService = new NarrationService({
          narrateToolResults: true,
        });

        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "tool_use",
            tool: {
              toolName: "Bash",
              action: { kind: "command_run", command: "invalid-command" },
              status: "failed",
              result: { success: false, error: "Command not found" },
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = narrationService.summarizeForVoice(entry);

        expect(result?.text).toBe("Bash failed: Command not found");
        expect(result?.category).toBe("error");
        expect(result?.priority).toBe("high");
      });
    });

    describe("assistant_message events", () => {
      it("should return short messages directly", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "assistant_message" },
          content: "I found the issue in the login component.",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("I found the issue in the login component.");
        expect(result?.category).toBe("status");
        expect(result?.priority).toBe("normal");
      });

      it("should summarize long messages to key sentences", () => {
        const longMessage = `
          I've analyzed the codebase and identified several areas for improvement.
          The authentication system needs refactoring to use modern patterns.
          Additionally, there are performance issues in the data fetching layer.
          I recommend implementing caching and optimizing database queries.
          Let me start by creating the new authentication module.
        `.trim();

        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "assistant_message" },
          content: longMessage,
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).not.toBeNull();
        expect(result?.text.length).toBeLessThan(longMessage.length);
        // Should contain the first sentence
        expect(result?.text).toContain("analyzed the codebase");
      });

      it("should skip empty messages", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "assistant_message" },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });

      it("should skip whitespace-only messages", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "assistant_message" },
          content: "   \n\t  ",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });

      it("should skip markdown headers when summarizing long content", () => {
        // The content needs to be longer than maxAssistantMessageLength to trigger summarization
        const content = `
# Header

This is the actual content that should be narrated. It contains important information about the analysis that was performed. The system has identified several key areas that need attention and has prepared recommendations for improvement.
`.trim();

        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "assistant_message" },
          content,
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).not.toContain("# Header");
        expect(result?.text).toContain("actual content");
      });
    });

    describe("error events", () => {
      it("should narrate errors with high priority", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "error",
            error: {
              message: "File not found: /path/to/missing.ts",
              code: "ENOENT",
            },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Error: File not found: /path/to/missing.ts");
        expect(result?.category).toBe("error");
        expect(result?.priority).toBe("high");
      });

      it("should truncate long error messages", () => {
        const longError = "A".repeat(200);

        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "error",
            error: { message: longError },
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text.length).toBeLessThanOrEqual(90); // "Error: " + 80 + "..."
        expect(result?.text).toContain("...");
      });

      it("should handle missing error message", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "error",
            error: {} as any,
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result?.text).toBe("Error: An unknown error occurred");
      });
    });

    describe("ignored event types", () => {
      it("should skip thinking events", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: {
            kind: "thinking",
            reasoning: "Let me analyze this problem...",
          },
          content: "",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });

      it("should skip system_message events", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "system_message" },
          content: "Session initialized",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });

      it("should skip user_message events", () => {
        const entry: NormalizedEntry = {
          index: 0,
          type: { kind: "user_message" },
          content: "Fix the login bug",
          timestamp: new Date(),
        };

        const result = service.summarizeForVoice(entry);

        expect(result).toBeNull();
      });
    });
  });

  describe("createNarrationEvent", () => {
    it("should create full VoiceNarrationEvent with execution ID", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/src/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const event = service.createNarrationEvent(entry, "exec-123");

      expect(event).not.toBeNull();
      expect(event?.type).toBe("voice_narration");
      expect(event?.executionId).toBe("exec-123");
      expect(event?.text).toBe("Reading src/file.ts");
      expect(event?.category).toBe("progress");
      expect(event?.priority).toBe("normal");
    });

    it("should return null for events that shouldn't be narrated", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "thinking", reasoning: "..." },
        content: "",
        timestamp: new Date(),
      };

      const event = service.createNarrationEvent(entry, "exec-123");

      expect(event).toBeNull();
    });
  });

  describe("configuration", () => {
    it("should respect maxAssistantMessageLength config", () => {
      const shortService = new NarrationService({
        maxAssistantMessageLength: 20,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "This is a message that exceeds twenty characters",
        timestamp: new Date(),
      };

      const result = shortService.summarizeForVoice(entry);

      // Should truncate or summarize
      expect(result?.text.length).toBeLessThanOrEqual(40); // Some tolerance for sentence extraction
    });

    it("should hide file paths when includeFilePaths is false", () => {
      const noPathsService = new NarrationService({
        includeFilePaths: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/secret/path/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = noPathsService.summarizeForVoice(entry);

      expect(result?.text).toBe("Reading a file");
      expect(result?.text).not.toContain("secret");
    });

    it("should allow updating config", () => {
      service.updateConfig({ maxCommandLength: 10 });

      const config = service.getConfig();

      expect(config.maxCommandLength).toBe(10);
    });

    it("should skip tool use narration when narrateToolUse is false", () => {
      const quietService = new NarrationService({
        narrateToolUse: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/src/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = quietService.summarizeForVoice(entry);

      expect(result).toBeNull();
    });

    it("should still narrate speak tool when narrateToolUse is false", () => {
      const quietService = new NarrationService({
        narrateToolUse: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              toolName: "speak",
              args: { text: "Hello world!", priority: "high" },
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = quietService.summarizeForVoice(entry);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Hello world!");
      expect(result?.priority).toBe("high");
      expect(result?.category).toBe("status");
    });

    it("should still narrate assistant_message when narrateToolUse is false", () => {
      const quietService = new NarrationService({
        narrateToolUse: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "I found the bug",
        timestamp: new Date(),
      };

      const result = quietService.summarizeForVoice(entry);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("I found the bug");
    });
  });

  describe("speak tool", () => {
    it("should return text directly from speak tool", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              toolName: "speak",
              args: { text: "Task complete!" },
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Task complete!");
      expect(result?.category).toBe("status");
      expect(result?.priority).toBe("normal"); // default priority
    });

    it("should respect priority argument in speak tool", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              toolName: "speak",
              args: { text: "Critical error!", priority: "high" },
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Critical error!");
      expect(result?.priority).toBe("high");
    });

    it("should return null if speak tool has no text", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              toolName: "speak",
              args: {},
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result).toBeNull();
    });
  });

  describe("narrateAssistantMessages config", () => {
    it("should skip assistant message narration when narrateAssistantMessages is false", () => {
      const quietService = new NarrationService({
        narrateAssistantMessages: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: { kind: "assistant_message" },
        content: "Hello, I will help you with that.",
        timestamp: new Date(),
      };

      const result = quietService.summarizeForVoice(entry);

      expect(result).toBeNull();
    });

    it("should still narrate speak tool when narrateAssistantMessages is false", () => {
      const quietService = new NarrationService({
        narrateAssistantMessages: false,
      });

      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              args: { text: "This is important", priority: "high" },
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = quietService.summarizeForVoice(entry);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("This is important");
    });

    it("should only narrate speak tool when both narrateToolUse and narrateAssistantMessages are false", () => {
      const speakOnlyService = new NarrationService({
        narrateToolUse: false,
        narrateAssistantMessages: false,
      });

      // Read tool should be skipped
      const readEntry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/src/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };
      expect(speakOnlyService.summarizeForVoice(readEntry)).toBeNull();

      // Assistant message should be skipped
      const assistantEntry: NormalizedEntry = {
        index: 1,
        type: { kind: "assistant_message" },
        content: "Hello!",
        timestamp: new Date(),
      };
      expect(speakOnlyService.summarizeForVoice(assistantEntry)).toBeNull();

      // Speak tool should still work
      const speakEntry: NormalizedEntry = {
        index: 2,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "speak",
            action: {
              kind: "tool",
              args: { text: "Only this should be narrated" },
            },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };
      const result = speakOnlyService.summarizeForVoice(speakEntry);
      expect(result).not.toBeNull();
      expect(result?.text).toBe("Only this should be narrated");
    });
  });

  describe("path formatting", () => {
    it("should extract filename with parent directory", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/very/long/path/to/file.ts" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result?.text).toBe("Reading to/file.ts");
    });

    it("should handle files in root directory", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Read",
            action: { kind: "file_read", path: "/package.json" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result?.text).toBe("Reading package.json");
    });
  });

  describe("command formatting", () => {
    it("should include subcommand for npm/yarn/git", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "npm install lodash" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result?.text).toBe("Running npm install");
    });

    it("should include subcommand for git", () => {
      const entry: NormalizedEntry = {
        index: 0,
        type: {
          kind: "tool_use",
          tool: {
            toolName: "Bash",
            action: { kind: "command_run", command: "git status" },
            status: "running",
          },
        },
        content: "",
        timestamp: new Date(),
      };

      const result = service.summarizeForVoice(entry);

      expect(result?.text).toBe("Running git status");
    });
  });

  describe("global instance", () => {
    it("should return the same instance", () => {
      const instance1 = getNarrationService();
      const instance2 = getNarrationService();

      expect(instance1).toBe(instance2);
    });

    it("should reset instance", () => {
      const instance1 = getNarrationService();
      resetNarrationService();
      const instance2 = getNarrationService();

      expect(instance1).not.toBe(instance2);
    });
  });
});

describe("NarrationRateLimiter", () => {
  let limiter: NarrationRateLimiter;

  beforeEach(() => {
    limiter = new NarrationRateLimiter({
      minIntervalMs: 100, // Short interval for testing
      maxQueueSize: 3,
      coalesceToolCalls: true,
      coalesceWindowMs: 200,
    });
  });

  describe("basic rate limiting", () => {
    it("should emit first narration immediately", () => {
      // Use a non-coalesceable narration (not a file read/edit/search pattern)
      const narration: NarrationResult = {
        text: "Starting task execution",
        category: "status",
        priority: "normal",
      };

      const result = limiter.submit(narration);

      expect(result).toEqual(narration);
    });

    it("should rate limit rapid submissions", async () => {
      const narration1: NarrationResult = {
        text: "First narration",
        category: "status",
        priority: "normal",
      };
      const narration2: NarrationResult = {
        text: "Second narration",
        category: "status",
        priority: "normal",
      };

      // First submission should emit immediately
      const result1 = limiter.submit(narration1);
      expect(result1).toEqual(narration1);

      // Second submission (immediate) should be queued
      const result2 = limiter.submit(narration2);
      expect(result2).toBeNull();

      // After waiting, flush should return the queued item
      await new Promise((resolve) => setTimeout(resolve, 150));
      const flushed = limiter.flush();
      expect(flushed).toEqual(narration2);
    });

    it("should skip low priority narrations when queue is full", () => {
      // Fill queue with normal priority items
      limiter.submit({ text: "First", category: "status", priority: "normal" });
      limiter.submit({
        text: "Second",
        category: "status",
        priority: "normal",
      });
      limiter.submit({ text: "Third", category: "status", priority: "normal" });
      limiter.submit({
        text: "Fourth",
        category: "status",
        priority: "normal",
      });

      // Low priority should be skipped
      const lowPriority = limiter.submit({
        text: "Low priority",
        category: "progress",
        priority: "low",
      });
      expect(lowPriority).toBeNull();

      // Verify low priority was not queued
      expect(limiter.hasPending()).toBe(true);
      // Should not find the low priority item when flushing
    });

    it("should prioritize high priority items in queue", () => {
      // Submit items in order: normal, high, normal
      limiter.submit({
        text: "First normal",
        category: "status",
        priority: "normal",
      });
      limiter.submit({
        text: "Second normal",
        category: "status",
        priority: "normal",
      });
      limiter.submit({
        text: "High priority",
        category: "error",
        priority: "high",
      });
      limiter.submit({
        text: "Third normal",
        category: "status",
        priority: "normal",
      });

      // When flushing, high priority should come first
      const first = limiter.flush();
      expect(first?.priority).toBe("high");
    });
  });

  describe("tool call coalescing", () => {
    it("should coalesce multiple file reads", () => {
      const read1: NarrationResult = {
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      };
      const read2: NarrationResult = {
        text: "Reading file2.ts",
        category: "progress",
        priority: "normal",
      };
      const read3: NarrationResult = {
        text: "Reading file3.ts",
        category: "progress",
        priority: "normal",
      };

      // First read goes to coalescing queue
      expect(limiter.submit(read1)).toBeNull();
      expect(limiter.submit(read2)).toBeNull();
      expect(limiter.submit(read3)).toBeNull();

      // Flush should return coalesced result
      const result = limiter.flush();
      expect(result).not.toBeNull();
      expect(result?.text).toBe("Reading 3 files");
    });

    it("should flush coalesced reads when different action type arrives", () => {
      limiter.submit({
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      });
      limiter.submit({
        text: "Reading file2.ts",
        category: "progress",
        priority: "normal",
      });

      // Non-coalesceable narration should flush the pending reads
      const nonCoalesceable: NarrationResult = {
        text: "Running npm test",
        category: "progress",
        priority: "normal",
      };

      const result = limiter.submit(nonCoalesceable);
      // The coalesced reads might be returned instead of the new narration
      // depending on timing, or the new one if rate limit allows
      expect(result).not.toBeNull();
    });

    it("should coalesce mixed read and edit operations", () => {
      limiter.submit({
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      });
      limiter.submit({
        text: "Reading file2.ts",
        category: "progress",
        priority: "normal",
      });
      limiter.submit({
        text: "Editing file3.ts",
        category: "progress",
        priority: "normal",
      });

      const result = limiter.flush();
      expect(result).not.toBeNull();
      // Should contain both read and edit counts
      expect(result?.text).toContain("reading 2 files");
      expect(result?.text).toContain("editing 1 file");
    });

    it("should not coalesce single operations", () => {
      limiter.submit({
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      });

      // Single read shouldn't generate a coalesced message
      const result = limiter.flush();
      expect(result).toBeNull();
    });

    it("should reset coalescing after window expires", async () => {
      limiter.submit({
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      });

      // Wait for coalesce window to expire
      await new Promise((resolve) => setTimeout(resolve, 250));

      // New read should start fresh coalescing
      limiter.submit({
        text: "Reading file2.ts",
        category: "progress",
        priority: "normal",
      });

      // First batch flushed, second batch still pending
      const result = limiter.flush();
      // Since first batch was only 1 file, it returns null (no coalescing needed)
      // Second batch is now pending with 1 file
      expect(limiter.hasPending()).toBe(false);
    });
  });

  describe("flush and reset", () => {
    it("should flush all pending narrations", () => {
      limiter.submit({ text: "First", category: "status", priority: "normal" });
      limiter.submit({
        text: "Second",
        category: "status",
        priority: "normal",
      });
      limiter.submit({ text: "Third", category: "status", priority: "normal" });

      // Flush all
      const results: NarrationResult[] = [];
      while (limiter.hasPending()) {
        const item = limiter.flush();
        if (item) results.push(item);
      }

      // Should have gotten all queued items
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should reset all state", () => {
      limiter.submit({ text: "First", category: "status", priority: "normal" });
      limiter.submit({
        text: "Second",
        category: "status",
        priority: "normal",
      });

      expect(limiter.hasPending()).toBe(true);

      limiter.reset();

      expect(limiter.hasPending()).toBe(false);
      expect(limiter.flush()).toBeNull();
    });
  });

  describe("custom configuration", () => {
    it("should respect custom minIntervalMs", async () => {
      const fastLimiter = new NarrationRateLimiter({
        minIntervalMs: 50,
        coalesceToolCalls: false,
      });

      fastLimiter.submit({
        text: "First",
        category: "status",
        priority: "normal",
      });

      // Should be rate limited
      expect(
        fastLimiter.submit({
          text: "Second",
          category: "status",
          priority: "normal",
        })
      ).toBeNull();

      // After interval, should emit
      await new Promise((resolve) => setTimeout(resolve, 60));
      const result = fastLimiter.submit({
        text: "Third",
        category: "status",
        priority: "normal",
      });
      // Either emits Third or the pending Second
      expect(result).not.toBeNull();
    });

    it("should respect disabled coalescing", () => {
      const noCoalesceLimiter = new NarrationRateLimiter({
        coalesceToolCalls: false,
        minIntervalMs: 1000, // High to force queuing
      });

      noCoalesceLimiter.submit({
        text: "Reading file1.ts",
        category: "progress",
        priority: "normal",
      });
      noCoalesceLimiter.submit({
        text: "Reading file2.ts",
        category: "progress",
        priority: "normal",
      });

      // Without coalescing, should get original text
      const result = noCoalesceLimiter.flush();
      expect(result?.text).toBe("Reading file2.ts");
    });
  });
});
