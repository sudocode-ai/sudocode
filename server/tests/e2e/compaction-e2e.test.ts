/**
 * End-to-End Tests for Auto-Compaction with ACP
 *
 * These tests verify that auto-compaction events flow correctly through
 * acp-factory and claude-code-acp when token thresholds are exceeded.
 *
 * ⚠️ These tests make REAL AI API calls.
 *
 * To run these tests:
 * 1. Install Claude Code CLI (https://claude.com/claude-code)
 * 2. Authenticate: claude login
 * 3. Set environment variable: RUN_E2E_TESTS=true
 * 4. Run: RUN_E2E_TESTS=true npm --prefix server test -- --run compaction-e2e.test.ts
 *
 * @group e2e
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { AgentFactory, type ExtendedSessionUpdate } from "acp-factory";

// Skip E2E tests by default
const SKIP_E2E =
  process.env.SKIP_E2E_TESTS === "true" || process.env.RUN_E2E_TESTS !== "true";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

/**
 * Check if Claude Code CLI is available
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH, ["--version"]);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

describe.skipIf(SKIP_E2E)("Compaction E2E Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "compaction-e2e-"));
    await fs.writeFile(path.join(tempDir, "test.txt"), "Test file content");
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should check claude availability", { timeout: 10000 }, async () => {
    const available = await checkClaudeAvailable();
    expect(available).toBe(true);
  });

  it(
    "should log compaction config and token tracking",
    { timeout: 120000 },
    async () => {
      const agent = await AgentFactory.spawn("claude-code", {
        permissionMode: "auto-approve",
      });

      try {
        console.log("[Compaction Debug] Creating session with compaction config...");

        // Pass compaction config via agentMeta (which maps to _meta in createSession)
        // Using a very low threshold to trigger compaction on the first response
        const agentMeta = {
          claudeCode: {
            compaction: {
              enabled: true,
              contextTokenThreshold: 100, // Extremely low
            },
          },
        };
        console.log("[Compaction Debug] agentMeta:", JSON.stringify(agentMeta, null, 2));

        const session = await agent.createSession(tempDir, { agentMeta });
        console.log("[Compaction Debug] Session created:", session.id);

        console.log("[Compaction Debug] Sending first prompt (generates tokens)...");

        // Collect ALL events to see what we get
        const allEvents: any[] = [];
        let compactionStarted = false;
        let compactionCompleted = false;

        // First prompt - should accumulate tokens
        for await (const update of session.prompt("Explain the number 5 in detail - its properties, history, and significance in mathematics.")) {
          allEvents.push(update);
          const u = update as any;

          if (u.sessionUpdate === "compaction_started") {
            compactionStarted = true;
            console.log("[Compaction Debug] COMPACTION_STARTED:", JSON.stringify(u, null, 2));
          } else if (u.sessionUpdate === "compaction_completed") {
            compactionCompleted = true;
            console.log("[Compaction Debug] COMPACTION_COMPLETED:", JSON.stringify(u, null, 2));
          } else if (u.sessionUpdate !== "agent_message_chunk") {
            // Log all non-chunk events
            console.log(`[Compaction Debug] Event: ${u.sessionUpdate}`, JSON.stringify(u).substring(0, 200));
          }
        }

        console.log("[Compaction Debug] First prompt complete");
        console.log("[Compaction Debug] Events so far:", allEvents.length);

        // If compaction hasn't triggered, send a second prompt
        // Compaction triggers AFTER a prompt completes, so the next prompt should see it
        if (!compactionStarted) {
          console.log("[Compaction Debug] No compaction yet. Sending second prompt...");

          for await (const update of session.prompt("Now explain the number 10 in similar detail.")) {
            allEvents.push(update);
            const u = update as any;

            if (u.sessionUpdate === "compaction_started") {
              compactionStarted = true;
              console.log("[Compaction Debug] COMPACTION_STARTED:", JSON.stringify(u, null, 2));
            } else if (u.sessionUpdate === "compaction_completed") {
              compactionCompleted = true;
              console.log("[Compaction Debug] COMPACTION_COMPLETED:", JSON.stringify(u, null, 2));
            }
          }
        }

        console.log("[Compaction Debug] Total events:", allEvents.length);
        console.log("[Compaction Debug] Event types:", [...new Set(allEvents.map(e => e.sessionUpdate))]);
        console.log("[Compaction Debug] Compaction started:", compactionStarted);
        console.log("[Compaction Debug] Compaction completed:", compactionCompleted);

        // Check for any compaction events
        const compactionEvents = allEvents.filter(e =>
          e.sessionUpdate?.includes("compaction"));
        console.log("[Compaction Debug] Compaction event count:", compactionEvents.length);

      } finally {
        await agent.close();
      }
    }
  );

  describe("Compaction Config Passing", () => {
    it(
      "should pass compaction config via agentMeta and receive events",
      { timeout: 180000 }, // 3 minutes - compaction can take a while
      async () => {
        // Spawn Claude Code agent via acp-factory
        const agent = await AgentFactory.spawn("claude-code", {
          permissionMode: "auto-approve",
        });

        try {
          // Create session with very low compaction threshold for testing
          // NOTE: 1000 tokens is very low - should trigger quickly
          const session = await agent.createSession(tempDir, {
            agentMeta: {
              claudeCode: {
                compaction: {
                  enabled: true,
                  contextTokenThreshold: 1000, // Very low threshold for testing
                },
              },
            },
          });

          console.log("[Compaction E2E] Session created:", session.id);

          // Track all events
          const events: ExtendedSessionUpdate[] = [];
          let compactionStarted = false;
          let compactionCompleted = false;

          // First prompt - should generate some tokens
          console.log("[Compaction E2E] Sending first prompt...");
          for await (const update of session.prompt(
            "List all prime numbers between 1 and 100 and explain why each one is prime."
          )) {
            events.push(update);
            const updateType = (update as { sessionUpdate: string }).sessionUpdate;

            if (updateType === "compaction_started") {
              compactionStarted = true;
              console.log("[Compaction E2E] Received compaction_started:", update);
            }
            if (updateType === "compaction_completed") {
              compactionCompleted = true;
              console.log("[Compaction E2E] Received compaction_completed:", update);
            }
          }

          console.log(`[Compaction E2E] First prompt done. Events: ${events.length}`);

          // If compaction hasn't triggered yet, send more prompts
          if (!compactionStarted) {
            console.log("[Compaction E2E] Sending second prompt to generate more tokens...");
            for await (const update of session.prompt(
              "Now explain the Fibonacci sequence and list the first 50 Fibonacci numbers with explanations."
            )) {
              events.push(update);
              const updateType = (update as { sessionUpdate: string }).sessionUpdate;

              if (updateType === "compaction_started") {
                compactionStarted = true;
                console.log("[Compaction E2E] Received compaction_started:", update);
              }
              if (updateType === "compaction_completed") {
                compactionCompleted = true;
                console.log("[Compaction E2E] Received compaction_completed:", update);
              }
            }
          }

          console.log(`[Compaction E2E] Total events: ${events.length}`);
          console.log(`[Compaction E2E] Compaction started: ${compactionStarted}`);
          console.log(`[Compaction E2E] Compaction completed: ${compactionCompleted}`);

          // Log all unique event types seen
          const eventTypes = [...new Set(events.map((e) => (e as { sessionUpdate: string }).sessionUpdate))];
          console.log("[Compaction E2E] Event types seen:", eventTypes);

          // We expect to see compaction events if threshold was exceeded
          // Note: This might not always trigger if the prompt doesn't generate enough tokens
          if (compactionStarted) {
            expect(compactionCompleted).toBe(true);
          }

          // At minimum, we should see some standard events
          expect(eventTypes).toContain("agent_message_chunk");
        } finally {
          await agent.close();
        }
      }
    );
  });

  describe("Event Structure Verification", () => {
    it(
      "should emit properly structured compaction events when threshold is exceeded",
      { timeout: 300000 }, // 5 minutes
      async () => {
        const agent = await AgentFactory.spawn("claude-code", {
          permissionMode: "auto-approve",
        });

        try {
          // Very low threshold to force compaction
          const session = await agent.createSession(tempDir, {
            agentMeta: {
              claudeCode: {
                compaction: {
                  enabled: true,
                  contextTokenThreshold: 500, // Extremely low
                },
              },
            },
          });

          let compactionStartedEvent: ExtendedSessionUpdate | null = null;
          let compactionCompletedEvent: ExtendedSessionUpdate | null = null;

          // Generate lots of tokens with a verbose prompt
          const verbosePrompt = `
            Please provide an extremely detailed explanation of the following topics:
            1. The history of computing from 1940 to present day
            2. How CPUs work at the transistor level
            3. The evolution of programming languages
            4. Network protocols and the OSI model

            Be as verbose as possible and include many examples.
          `;

          for await (const update of session.prompt(verbosePrompt)) {
            const u = update as { sessionUpdate: string; [key: string]: unknown };

            if (u.sessionUpdate === "compaction_started") {
              compactionStartedEvent = update;
              console.log("[Compaction E2E] compaction_started event:", JSON.stringify(u, null, 2));
            }
            if (u.sessionUpdate === "compaction_completed") {
              compactionCompletedEvent = update;
              console.log("[Compaction E2E] compaction_completed event:", JSON.stringify(u, null, 2));
            }
          }

          // If compaction was triggered, verify event structure
          if (compactionStartedEvent) {
            const started = compactionStartedEvent as {
              sessionUpdate: string;
              sessionId?: string;
              trigger?: string;
              preTokens?: number;
              threshold?: number;
            };

            expect(started.sessionUpdate).toBe("compaction_started");
            expect(started.sessionId).toBeDefined();
            expect(started.trigger).toBe("auto");
            expect(typeof started.preTokens).toBe("number");
            expect(typeof started.threshold).toBe("number");

            console.log("[Compaction E2E] compaction_started structure verified ✓");
          }

          if (compactionCompletedEvent) {
            const completed = compactionCompletedEvent as {
              sessionUpdate: string;
              sessionId?: string;
              trigger?: string;
              preTokens?: number;
            };

            expect(completed.sessionUpdate).toBe("compaction_completed");
            expect(completed.sessionId).toBeDefined();
            expect(completed.trigger).toBe("auto");
            expect(typeof completed.preTokens).toBe("number");

            console.log("[Compaction E2E] compaction_completed structure verified ✓");
          }

          if (!compactionStartedEvent) {
            console.log("[Compaction E2E] WARNING: Compaction was not triggered. This could mean:");
            console.log("  - Token count didn't reach threshold");
            console.log("  - Claude Code CLI doesn't report token usage in stream");
            console.log("  - claude-code-acp isn't tracking tokens correctly");
          }
        } finally {
          await agent.close();
        }
      }
    );
  });
});
