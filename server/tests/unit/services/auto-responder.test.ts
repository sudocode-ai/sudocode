/**
 * Unit tests for AutoResponder service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { AutoResponder, DEFAULT_AUTO_RESPONSE_CONFIG } from "../../../src/services/auto-responder.js";
import { PatternMatcher } from "../../../src/services/pattern-matcher.js";
import type {
  AgentRequest,
  UserResponse,
} from "../../../src/services/agent-router-types.js";
import {
  AGENT_PATTERNS_TABLE,
  AGENT_PATTERNS_INDEXES,
  AGENT_PATTERN_RESPONSES_TABLE,
  AGENT_PATTERN_RESPONSES_INDEXES,
} from "@sudocode-ai/types/schema";

describe("AutoResponder", () => {
  let db: Database.Database;
  let matcher: PatternMatcher;
  let responder: AutoResponder;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");

    // Create tables
    db.exec(AGENT_PATTERNS_TABLE);
    db.exec(AGENT_PATTERN_RESPONSES_TABLE);
    db.exec(AGENT_PATTERNS_INDEXES);
    db.exec(AGENT_PATTERN_RESPONSES_INDEXES);

    // Create services
    matcher = new PatternMatcher(db);
    responder = new AutoResponder(matcher);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Helper to create a learned pattern
   */
  async function createLearnedPattern(
    occurrences: number = 5,
    consistent: boolean = true
  ): Promise<AgentRequest> {
    const baseRequest: AgentRequest = {
      id: "req-1",
      executionId: "exec-1",
      type: "permission",
      message: "Can I proceed?",
      keywords: ["proceed", "deploy"],
      priority: 50,
      status: "pending",
      context: {
        issueId: "issue-1",
        codeArea: "deploy",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Learn responses
    for (let i = 0; i < occurrences; i++) {
      const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
      const resp: UserResponse = {
        id: `resp-${i}`,
        requestId: req.id,
        value: consistent ? "yes" : i % 2 === 0 ? "yes" : "no",
        timestamp: new Date(req.createdAt.getTime() + 1000), // Fast response = certain
      };
      await matcher.learn(req, resp);
    }

    return baseRequest;
  }

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const config = responder.getConfig();
      expect(config).toEqual(DEFAULT_AUTO_RESPONSE_CONFIG);
    });

    it("should merge custom config with defaults", () => {
      const customResponder = new AutoResponder(matcher, {
        minConfidence: 85,
        minOccurrences: 3,
      });

      const config = customResponder.getConfig();
      expect(config.minConfidence).toBe(85);
      expect(config.minOccurrences).toBe(3);
      expect(config.enabled).toBe(DEFAULT_AUTO_RESPONSE_CONFIG.enabled);
    });
  });

  describe("shouldAutoRespond", () => {
    it("should return false when auto-response is disabled", async () => {
      responder.updateConfig({ enabled: false });

      const request = await createLearnedPattern();
      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("disabled");
    });

    it("should return false when no pattern exists", async () => {
      const request: AgentRequest = {
        id: "req-new",
        executionId: "exec-1",
        type: "permission",
        message: "New request",
        keywords: ["new", "unknown"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("No matching pattern");
    });

    it("should return false when pattern auto-response is disabled", async () => {
      const request = await createLearnedPattern();
      const pattern = await matcher.findPattern(request);

      // Manually disable auto-response for pattern
      await matcher.setAutoResponse(pattern!.id, false);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("not enabled for this pattern");
      expect(decision.pattern).toBeDefined();
    });

    it("should return false when confidence is too low", async () => {
      // Create pattern with mixed responses (low confidence)
      const request = await createLearnedPattern(5, false);

      // Manually enable auto-response to test confidence check
      const pattern = await matcher.findPattern(request);
      await matcher.setAutoResponse(pattern!.id, true);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("Confidence too low");
    });

    it("should return false when not enough occurrences", async () => {
      // Create pattern with only 2 occurrences
      const request = await createLearnedPattern(2, true);

      // Manually enable auto-response to test occurrence check
      const pattern = await matcher.findPattern(request);
      await matcher.setAutoResponse(pattern!.id, true);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("Not enough occurrences");
    });

    it("should return false when pattern was recently overridden", async () => {
      const request = await createLearnedPattern();
      const pattern = await matcher.findPattern(request);
      const responses = matcher.getPatternResponses(pattern!.id);

      // Mark most recent response as overridden
      await matcher.markResponseAsOverridden(responses[0].id);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(false);
      expect(decision.reason).toContain("recently overridden");
    });

    it("should return true when all conditions are met", async () => {
      const request = await createLearnedPattern();

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(true);
      expect(decision.pattern).toBeDefined();
      expect(decision.response).toBe("yes");
      expect(decision.confidence).toBeGreaterThan(90);
      expect(decision.reason).toBeUndefined();
    });

    it("should ignore recent overrides when config disabled", async () => {
      responder.updateConfig({ respectRecentOverrides: false });

      const request = await createLearnedPattern();
      const pattern = await matcher.findPattern(request);
      const responses = matcher.getPatternResponses(pattern!.id);

      // Mark response as overridden
      await matcher.markResponseAsOverridden(responses[0].id);

      const decision = await responder.shouldAutoRespond(request);

      // Should still auto-respond since we're ignoring overrides
      expect(decision.shouldAutoRespond).toBe(true);
    });

    it("should respect custom confidence threshold", async () => {
      // Lower the threshold
      responder.updateConfig({ minConfidence: 70 });

      // Create pattern with medium confidence (around 75%)
      const request = await createLearnedPattern(5, true);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(true);
    });

    it("should respect custom occurrence threshold", async () => {
      // Lower the threshold
      responder.updateConfig({ minOccurrences: 3 });

      // Create pattern with only 3 occurrences
      const request = await createLearnedPattern(3, true);

      // Manually enable auto-response since PatternMatcher has its own threshold
      const pattern = await matcher.findPattern(request);
      await matcher.setAutoResponse(pattern!.id, true);

      const decision = await responder.shouldAutoRespond(request);

      expect(decision.shouldAutoRespond).toBe(true);
    });

    it("should ignore old overrides outside window", async () => {
      responder.updateConfig({ overrideWindowDays: 1 }); // 1 day window

      const request = await createLearnedPattern();
      const pattern = await matcher.findPattern(request);

      // Create an old override (2 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2);

      // Insert old response directly
      db.prepare(
        `INSERT INTO agent_pattern_responses
         (id, pattern_id, response_value, timestamp, user_confidence, was_overridden)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        "old-override-1",
        pattern!.id,
        "no",
        oldDate.toISOString(),
        "certain",
        1
      );

      const decision = await responder.shouldAutoRespond(request);

      // Should auto-respond since override is outside window
      expect(decision.shouldAutoRespond).toBe(true);
    });
  });

  describe("tryAutoRespond", () => {
    it("should return null when shouldAutoRespond returns false", async () => {
      const request: AgentRequest = {
        id: "req-new",
        executionId: "exec-1",
        type: "permission",
        message: "New request",
        keywords: ["new"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response = await responder.tryAutoRespond(request);

      expect(response).toBeNull();
    });

    it("should return UserResponse when auto-responding", async () => {
      const request = await createLearnedPattern();

      const response = await responder.tryAutoRespond(request);

      expect(response).not.toBeNull();
      expect(response!.requestId).toBe(request.id);
      expect(response!.value).toBe("yes");
      expect(response!.auto).toBe(true);
      expect(response!.patternId).toBeDefined();
      expect(response!.confidence).toBeGreaterThan(90);
      expect(response!.timestamp).toBeInstanceOf(Date);
    });

    it("should emit auto_response event", async () => {
      const request = await createLearnedPattern();

      const eventSpy = vi.fn();
      responder.on("auto_response", eventSpy);

      await responder.tryAutoRespond(request);

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ id: request.id }),
          response: expect.objectContaining({ value: "yes" }),
          pattern: expect.objectContaining({ requestType: "permission" }),
        })
      );
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      responder.updateConfig({
        minConfidence: 85,
        enabled: false,
      });

      const config = responder.getConfig();
      expect(config.minConfidence).toBe(85);
      expect(config.enabled).toBe(false);
      // Other values should remain unchanged
      expect(config.minOccurrences).toBe(DEFAULT_AUTO_RESPONSE_CONFIG.minOccurrences);
    });

    it("should emit config_updated event", () => {
      const eventSpy = vi.fn();
      responder.on("config_updated", eventSpy);

      responder.updateConfig({ minConfidence: 85 });

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          minConfidence: 85,
        })
      );
    });
  });

  describe("getConfig", () => {
    it("should return current configuration", () => {
      const config = responder.getConfig();

      expect(config).toEqual(DEFAULT_AUTO_RESPONSE_CONFIG);
    });

    it("should return a copy of config", () => {
      const config1 = responder.getConfig();
      config1.enabled = false;

      const config2 = responder.getConfig();
      expect(config2.enabled).toBe(true); // Original unchanged
    });
  });

  describe("getStats", () => {
    it("should return stats with no patterns", async () => {
      const stats = await responder.getStats();

      expect(stats).toEqual({
        totalPatterns: 0,
        autoResponseEnabled: 0,
        averageConfidence: 0,
        totalResponses: 0,
      });
    });

    it("should calculate stats correctly", async () => {
      // Create 3 patterns
      const patterns = [
        { keywords: ["deploy"], occurrences: 5, consistent: true },
        { keywords: ["delete"], occurrences: 7, consistent: true },
        { keywords: ["update"], occurrences: 3, consistent: false }, // Low confidence, won't enable
      ];

      for (const [index, p] of patterns.entries()) {
        const req: AgentRequest = {
          id: `base-${index}`,
          executionId: `exec-${index}`,
          type: "permission",
          message: "Test",
          keywords: p.keywords,
          priority: 50,
          status: "pending",
          context: {
            issueId: `issue-${index}`,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        for (let i = 0; i < p.occurrences; i++) {
          const r = { ...req, id: `req-${index}-${i}`, createdAt: new Date() };
          const resp: UserResponse = {
            id: `resp-${index}-${i}`,
            requestId: r.id,
            value: p.consistent ? "yes" : i % 2 === 0 ? "yes" : "no",
            timestamp: new Date(r.createdAt.getTime() + 1000),
          };
          await matcher.learn(r, resp);
        }
      }

      const stats = await responder.getStats();

      expect(stats.totalPatterns).toBe(3);
      expect(stats.autoResponseEnabled).toBe(2); // Only deploy and delete
      expect(stats.totalResponses).toBe(12); // 5 + 7
      expect(stats.averageConfidence).toBeGreaterThan(90);
    });

    it("should handle patterns without auto-response", async () => {
      // Create pattern but manually disable auto-response
      const request = await createLearnedPattern();
      const pattern = await matcher.findPattern(request);
      await matcher.setAutoResponse(pattern!.id, false);

      const stats = await responder.getStats();

      expect(stats.totalPatterns).toBe(1);
      expect(stats.autoResponseEnabled).toBe(0);
      expect(stats.averageConfidence).toBe(0);
    });

    it("should round average confidence to 1 decimal", async () => {
      await createLearnedPattern();

      const stats = await responder.getStats();

      // Check that confidence is a number and formatted to 1 decimal
      expect(typeof stats.averageConfidence).toBe("number");
      expect(stats.averageConfidence).toBeGreaterThan(0);
      // Check that when multiplied by 10, it's close to an integer (1 decimal place)
      expect((stats.averageConfidence * 10) % 1).toBeCloseTo(0, 1);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle pattern lifecycle from learning to auto-response", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed with deployment?",
        keywords: ["proceed", "deployment"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
          codeArea: "deploy",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Step 1: No pattern exists, should not auto-respond
      let response = await responder.tryAutoRespond(baseRequest);
      expect(response).toBeNull();

      // Step 2: Learn 5 consistent responses
      for (let i = 0; i < 5; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(req.createdAt.getTime() + 1000),
        };
        await matcher.learn(req, resp);
      }

      // Step 3: Now should auto-respond
      const newRequest = { ...baseRequest, id: "req-new", createdAt: new Date() };
      response = await responder.tryAutoRespond(newRequest);

      expect(response).not.toBeNull();
      expect(response!.value).toBe("yes");
      expect(response!.auto).toBe(true);

      // Step 4: User manually provides different response (override)
      const manualRequest = { ...baseRequest, id: "req-manual", createdAt: new Date() };
      const manualResponse: UserResponse = {
        id: "resp-manual",
        requestId: manualRequest.id,
        value: "no", // Different from pattern suggestion
        timestamp: new Date(),
      };
      await matcher.learn(manualRequest, manualResponse);

      // Mark it as overridden
      const pattern = await matcher.findPattern(manualRequest);
      const responses = matcher.getPatternResponses(pattern!.id);
      const latestResponse = responses[0]; // Most recent
      await matcher.markResponseAsOverridden(latestResponse.id);

      // Step 5: Should not auto-respond after recent override
      const anotherRequest = {
        ...baseRequest,
        id: "req-another",
        createdAt: new Date(),
      };
      response = await responder.tryAutoRespond(anotherRequest);

      expect(response).toBeNull();
    });

    it("should handle multiple patterns independently", async () => {
      // Create two different patterns
      const deployRequest = await createLearnedPattern();

      const deleteRequest: AgentRequest = {
        id: "req-delete-1",
        executionId: "exec-2",
        type: "permission",
        message: "Can I delete files?",
        keywords: ["delete", "files"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-2",
          codeArea: "filesystem",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn delete pattern
      for (let i = 0; i < 5; i++) {
        const req = { ...deleteRequest, id: `req-del-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-del-${i}`,
          requestId: req.id,
          value: "no", // Different response
          timestamp: new Date(req.createdAt.getTime() + 1000),
        };
        await matcher.learn(req, resp);
      }

      // Both should auto-respond with different values
      const deployResponse = await responder.tryAutoRespond(deployRequest);
      const deleteResponse = await responder.tryAutoRespond(deleteRequest);

      expect(deployResponse!.value).toBe("yes");
      expect(deleteResponse!.value).toBe("no");
    });

    it("should respect dynamic config changes", async () => {
      // Create pattern
      const request = await createLearnedPattern();

      // Should auto-respond with default config
      let response = await responder.tryAutoRespond(request);
      expect(response).not.toBeNull();

      // Disable auto-response
      responder.updateConfig({ enabled: false });

      // Should not auto-respond
      response = await responder.tryAutoRespond(request);
      expect(response).toBeNull();

      // Re-enable
      responder.updateConfig({ enabled: true });

      // Should auto-respond again
      response = await responder.tryAutoRespond(request);
      expect(response).not.toBeNull();
    });
  });
});
