/**
 * Unit tests for PatternMatcher service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
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

describe("PatternMatcher", () => {
  let db: Database.Database;
  let matcher: PatternMatcher;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");

    // Create tables
    db.exec(AGENT_PATTERNS_TABLE);
    db.exec(AGENT_PATTERN_RESPONSES_TABLE);
    db.exec(AGENT_PATTERNS_INDEXES);
    db.exec(AGENT_PATTERN_RESPONSES_INDEXES);

    // Create matcher with default config
    matcher = new PatternMatcher(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("findPattern", () => {
    it("should return null when no pattern exists", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed", "permission"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
          codeArea: "auth",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const pattern = await matcher.findPattern(request);
      expect(pattern).toBeNull();
    });

    it("should find pattern by exact signature match", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed", "permission"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
          codeArea: "auth",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response: UserResponse = {
        id: "resp-1",
        requestId: request.id,
        value: "yes",
        timestamp: new Date(request.createdAt.getTime() + 1000),
      };

      // Learn pattern
      await matcher.learn(request, response);

      // Find pattern with exact match
      const pattern = await matcher.findPattern(request);
      expect(pattern).not.toBeNull();
      expect(pattern!.requestType).toBe("permission");
      // Keywords are sorted in signature generation
      expect(pattern!.keywords.sort()).toEqual(["permission", "proceed"]);
    });

    it("should find pattern by fuzzy match", async () => {
      // Create pattern
      const request1: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed with deployment?",
        keywords: ["proceed", "deployment", "permission"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
          codeArea: "deploy",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response1: UserResponse = {
        id: "resp-1",
        requestId: request1.id,
        value: "yes",
        timestamp: new Date(request1.createdAt.getTime() + 1000),
      };

      await matcher.learn(request1, response1);

      // Try to find with similar but not identical request
      const request2: AgentRequest = {
        id: "req-2",
        executionId: "exec-2",
        type: "permission",
        message: "Should I proceed with deployment?",
        keywords: ["proceed", "deployment"], // Similar keywords
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-2",
          codeArea: "deploy", // Same code area
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const pattern = await matcher.findPattern(request2);
      expect(pattern).not.toBeNull();
      expect(pattern!.requestType).toBe("permission");
    });

    it("should not match patterns with different types", async () => {
      const request1: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed", "deploy"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response1: UserResponse = {
        id: "resp-1",
        requestId: request1.id,
        value: "yes",
        timestamp: new Date(),
      };

      await matcher.learn(request1, response1);

      // Different type
      const request2: AgentRequest = {
        ...request1,
        id: "req-2",
        type: "guidance",
      };

      const pattern = await matcher.findPattern(request2);
      expect(pattern).toBeNull();
    });
  });

  describe("learn", () => {
    it("should create new pattern for first occurrence", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed", "permission"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
          codeArea: "auth",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response: UserResponse = {
        id: "resp-1",
        requestId: request.id,
        value: "yes",
        timestamp: new Date(request.createdAt.getTime() + 1000),
      };

      await matcher.learn(request, response);

      const patterns = matcher.getAllPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].requestType).toBe("permission");
      // Keywords are sorted in signature generation
      expect(patterns[0].keywords.sort()).toEqual(["permission", "proceed"]);
      expect(patterns[0].totalOccurrences).toBe(1);
    });

    it("should add response to existing pattern", async () => {
      const request1: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed", "permission"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response1: UserResponse = {
        id: "resp-1",
        requestId: request1.id,
        value: "yes",
        timestamp: new Date(),
      };

      await matcher.learn(request1, response1);

      // Second identical request
      const request2: AgentRequest = {
        ...request1,
        id: "req-2",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response2: UserResponse = {
        id: "resp-2",
        requestId: request2.id,
        value: "yes",
        timestamp: new Date(),
      };

      await matcher.learn(request2, response2);

      const patterns = matcher.getAllPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].totalOccurrences).toBe(2);
    });

    it("should update suggested response based on consensus", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 3 "yes" responses
      for (let i = 0; i < 3; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(),
        };
        await matcher.learn(req, resp);
      }

      const patterns = matcher.getAllPatterns();
      expect(patterns[0].suggestedResponse).toBe("yes");
    });

    it("should calculate confidence score correctly", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 5 identical responses (should have high confidence)
      for (let i = 0; i < 5; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(req.createdAt.getTime() + 1000), // Fast response = certain
        };
        await matcher.learn(req, resp);
      }

      const patterns = matcher.getAllPatterns();
      expect(patterns[0].confidenceScore).toBeGreaterThan(90);
    });

    it("should enable auto-response when thresholds met", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 5 consistent responses (meets min occurrences)
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

      const patterns = matcher.getAllPatterns();
      expect(patterns[0].autoResponseEnabled).toBe(true);
    });

    it("should not enable auto-response when confidence too low", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 5 mixed responses (low confidence)
      for (let i = 0; i < 5; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: i % 2 === 0 ? "yes" : "no", // 3 yes, 2 no
          timestamp: new Date(),
        };
        await matcher.learn(req, resp);
      }

      const patterns = matcher.getAllPatterns();
      expect(patterns[0].autoResponseEnabled).toBe(false);
    });

    it("should infer user confidence from response time", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: {
          issueId: "issue-1",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Fast response (< 5 seconds) = certain
      const fastResponse: UserResponse = {
        id: "resp-1",
        requestId: request.id,
        value: "yes",
        timestamp: new Date(request.createdAt.getTime() + 2000), // 2 seconds
      };

      await matcher.learn(request, fastResponse);

      const pattern = await matcher.findPattern(request);
      const responses = matcher.getPatternResponses(pattern!.id);
      expect(responses[0].userConfidence).toBe("certain");
    });
  });

  describe("getAllPatterns", () => {
    beforeEach(async () => {
      // Create multiple patterns
      const patterns = [
        {
          type: "permission" as const,
          keywords: ["deploy"],
          confidence: 95,
          occurrences: 10,
          autoResponse: true,
        },
        {
          type: "guidance" as const,
          keywords: ["implement"],
          confidence: 70,
          occurrences: 5,
          autoResponse: false,
        },
        {
          type: "permission" as const,
          keywords: ["delete"],
          confidence: 85,
          occurrences: 7,
          autoResponse: true,
        },
      ];

      for (const [index, p] of patterns.entries()) {
        const req: AgentRequest = {
          id: `req-${index}`,
          executionId: `exec-${index}`,
          type: p.type,
          message: "Test",
          keywords: p.keywords,
          priority: 50,
          status: "pending",
          context: { issueId: `issue-${index}` },
          createdAt: new Date(Date.now() - (3 - index) * 86400000), // Stagger dates
          updatedAt: new Date(),
        };

        for (let i = 0; i < p.occurrences; i++) {
          const resp: UserResponse = {
            id: `resp-${index}-${i}`,
            requestId: req.id,
            // For the pattern that shouldn't have auto-response, use mixed values
            value: !p.autoResponse && i % 2 === 0 ? "no" : "yes",
            timestamp: new Date(req.createdAt.getTime() + 1000),
          };
          await matcher.learn(req, resp);
        }
      }
    });

    it("should return all patterns", () => {
      const patterns = matcher.getAllPatterns();
      expect(patterns).toHaveLength(3);
    });

    it("should filter by auto-response enabled", () => {
      const patterns = matcher.getAllPatterns({ autoResponseOnly: true });
      expect(patterns).toHaveLength(2);
      expect(patterns.every((p) => p.autoResponseEnabled)).toBe(true);
    });

    it("should order by confidence", () => {
      const patterns = matcher.getAllPatterns({ orderBy: "confidence" });
      expect(patterns[0].confidenceScore).toBeGreaterThanOrEqual(
        patterns[1].confidenceScore
      );
    });

    it("should order by occurrences", () => {
      const patterns = matcher.getAllPatterns({ orderBy: "occurrences" });
      expect(patterns[0].totalOccurrences).toBeGreaterThanOrEqual(
        patterns[1].totalOccurrences
      );
    });

    it("should order by recent", () => {
      const patterns = matcher.getAllPatterns({ orderBy: "recent" });
      expect(patterns[0].lastSeen.getTime()).toBeGreaterThanOrEqual(
        patterns[1].lastSeen.getTime()
      );
    });

    it("should limit results", () => {
      const patterns = matcher.getAllPatterns({ limit: 2 });
      expect(patterns).toHaveLength(2);
    });
  });

  describe("setAutoResponse", () => {
    it("should enable auto-response for pattern", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response: UserResponse = {
        id: "resp-1",
        requestId: request.id,
        value: "yes",
        timestamp: new Date(),
      };

      await matcher.learn(request, response);

      const pattern = await matcher.findPattern(request);
      expect(pattern!.autoResponseEnabled).toBe(false);

      await matcher.setAutoResponse(pattern!.id, true);

      const updated = await matcher.findPattern(request);
      expect(updated!.autoResponseEnabled).toBe(true);
    });

    it("should disable auto-response for pattern", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn enough to enable auto-response
      for (let i = 0; i < 5; i++) {
        const req = { ...request, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(req.createdAt.getTime() + 1000),
        };
        await matcher.learn(req, resp);
      }

      const pattern = await matcher.findPattern(request);
      expect(pattern!.autoResponseEnabled).toBe(true);

      await matcher.setAutoResponse(pattern!.id, false);

      const updated = await matcher.findPattern(request);
      expect(updated!.autoResponseEnabled).toBe(false);
    });
  });

  describe("deletePattern", () => {
    it("should delete pattern and its responses", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response: UserResponse = {
        id: "resp-1",
        requestId: request.id,
        value: "yes",
        timestamp: new Date(),
      };

      await matcher.learn(request, response);

      const pattern = await matcher.findPattern(request);
      expect(pattern).not.toBeNull();

      await matcher.deletePattern(pattern!.id);

      const deleted = await matcher.findPattern(request);
      expect(deleted).toBeNull();

      const patterns = matcher.getAllPatterns();
      expect(patterns).toHaveLength(0);
    });
  });

  describe("getPatternResponses", () => {
    it("should return all responses for a pattern", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add 3 responses
      for (let i = 0; i < 3; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(),
        };
        await matcher.learn(req, resp);
      }

      const pattern = await matcher.findPattern(baseRequest);
      const responses = matcher.getPatternResponses(pattern!.id);

      expect(responses).toHaveLength(3);
      expect(responses.every((r) => r.responseValue === "yes")).toBe(true);
    });

    it("should order responses by timestamp descending", async () => {
      const baseRequest: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add responses with different timestamps
      const timestamps = [
        new Date(Date.now() - 3000),
        new Date(Date.now() - 2000),
        new Date(Date.now() - 1000),
      ];

      for (let i = 0; i < 3; i++) {
        const req = { ...baseRequest, id: `req-${i}`, createdAt: timestamps[i] };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: timestamps[i],
        };
        await matcher.learn(req, resp);
      }

      const pattern = await matcher.findPattern(baseRequest);
      const responses = matcher.getPatternResponses(pattern!.id);

      // Most recent first
      expect(responses[0].timestamp.getTime()).toBeGreaterThan(
        responses[1].timestamp.getTime()
      );
      expect(responses[1].timestamp.getTime()).toBeGreaterThan(
        responses[2].timestamp.getTime()
      );
    });
  });

  describe("markResponseAsOverridden", () => {
    it("should mark response as overridden and recalculate confidence", async () => {
      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 5 responses to get high confidence
      for (let i = 0; i < 5; i++) {
        const req = { ...request, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(req.createdAt.getTime() + 1000),
        };
        await matcher.learn(req, resp);
      }

      const pattern = await matcher.findPattern(request);
      const initialConfidence = pattern!.confidenceScore;

      // Get actual response IDs from database
      const patternResponses = matcher.getPatternResponses(pattern!.id);

      // Mark one as overridden
      await matcher.markResponseAsOverridden(patternResponses[0].id);

      const updated = await matcher.findPattern(request);
      const responses = matcher.getPatternResponses(updated!.id);

      expect(responses.some((r) => r.wasOverridden)).toBe(true);
      expect(updated!.confidenceScore).toBeLessThan(initialConfidence);
    });
  });

  describe("Pattern matching with custom config", () => {
    it("should use custom thresholds for auto-response", async () => {
      // Custom config with lower thresholds
      const customMatcher = new PatternMatcher(db, {
        minOccurrencesForAutoResponse: 2,
        minConfidenceForAutoResponse: 80,
      });

      const request: AgentRequest = {
        id: "req-1",
        executionId: "exec-1",
        type: "permission",
        message: "Can I proceed?",
        keywords: ["proceed"],
        priority: 50,
        status: "pending",
        context: { issueId: "issue-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Learn 2 responses (meets custom threshold)
      for (let i = 0; i < 2; i++) {
        const req = { ...request, id: `req-${i}`, createdAt: new Date() };
        const resp: UserResponse = {
          id: `resp-${i}`,
          requestId: req.id,
          value: "yes",
          timestamp: new Date(req.createdAt.getTime() + 1000),
        };
        await customMatcher.learn(req, resp);
      }

      const patterns = customMatcher.getAllPatterns();
      // Should enable auto-response with only 2 occurrences
      expect(patterns[0].autoResponseEnabled).toBe(true);
    });
  });
});
