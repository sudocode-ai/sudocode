/**
 * Tests for BatchingEngine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BatchingEngine } from "../../../src/services/batching-engine.js";
import type { AgentRequest } from "../../../src/services/agent-router-types.js";

describe("BatchingEngine", () => {
  let batchingEngine: BatchingEngine;

  beforeEach(() => {
    batchingEngine = new BatchingEngine({
      similarityThreshold: 0.7,
      minBatchSize: 2,
      batchTimeWindowMs: 30000,
    });
  });

  describe("findBatchable", () => {
    it("should return empty array for requests below min batch size", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          keywords: ["test"],
        }),
      ];

      const batches = batchingEngine.findBatchable(requests);
      expect(batches).toEqual([]);
    });

    it("should batch requests with same batching key", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          batchingKey: "delete-deprecated",
          keywords: ["delete"],
        }),
        createMockRequest({
          id: "2",
          batchingKey: "delete-deprecated",
          keywords: ["delete"],
        }),
        createMockRequest({
          id: "3",
          batchingKey: "delete-deprecated",
          keywords: ["delete"],
        }),
      ];

      const batches = batchingEngine.findBatchable(requests);

      expect(batches.length).toBe(1);
      expect(batches[0].requests.length).toBe(3);
      expect(batches[0].requests.map((r) => r.id)).toEqual(["1", "2", "3"]);
    });

    it("should batch requests with similar keywords", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          keywords: ["create", "test", "file"],
          type: "confirmation",
        }),
        createMockRequest({
          id: "2",
          keywords: ["create", "test", "function"],
          type: "confirmation",
        }),
        createMockRequest({
          id: "3",
          keywords: ["delete", "deprecated"],
          type: "confirmation",
        }),
      ];

      const batches = batchingEngine.findBatchable(requests);

      // Should batch requests 1 and 2 (similar keywords: create, test)
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const batch = batches.find(
        (b) =>
          b.requests.some((r) => r.id === "1") &&
          b.requests.some((r) => r.id === "2")
      );
      expect(batch).toBeDefined();
    });

    it("should batch requests with same context area", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          context: { codeArea: "src/auth" },
        }),
        createMockRequest({
          id: "2",
          context: { codeArea: "src/auth" },
        }),
        createMockRequest({
          id: "3",
          context: { codeArea: "src/api" },
        }),
      ];

      const batches = batchingEngine.findBatchable(requests);

      // Should batch requests 1 and 2 (same code area)
      expect(batches.length).toBeGreaterThanOrEqual(1);
      const authBatch = batches.find(
        (b) =>
          b.requests.some((r) => r.id === "1") &&
          b.requests.some((r) => r.id === "2")
      );
      expect(authBatch).toBeDefined();
    });

    it("should filter requests outside time window", () => {
      const now = Date.now();
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          createdAt: new Date(now - 60000), // 1 minute ago
          batchingKey: "test",
        }),
        createMockRequest({
          id: "2",
          createdAt: new Date(now - 10000), // 10 seconds ago
          batchingKey: "test",
        }),
      ];

      const engine = new BatchingEngine({
        batchTimeWindowMs: 15000, // 15 second window
        minBatchSize: 2,
      });

      const batches = engine.findBatchable(requests);

      // Request 1 is outside time window, so should not be batched
      expect(batches.length).toBe(0);
    });

    it("should sort batches by oldest request time", () => {
      const now = Date.now();
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          createdAt: new Date(now - 5000),
          batchingKey: "batch-a",
        }),
        createMockRequest({
          id: "2",
          createdAt: new Date(now - 4000),
          batchingKey: "batch-a",
        }),
        createMockRequest({
          id: "3",
          createdAt: new Date(now - 2000),
          batchingKey: "batch-b",
        }),
        createMockRequest({
          id: "4",
          createdAt: new Date(now - 1000),
          batchingKey: "batch-b",
        }),
      ];

      const batches = batchingEngine.findBatchable(requests);

      expect(batches.length).toBe(2);
      // batch-a should come first (older)
      expect(batches[0].requests[0].id).toBe("1");
      expect(batches[1].requests[0].id).toBe("3");
    });
  });

  describe("extractCommonPatterns", () => {
    it("should extract common keywords", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          keywords: ["delete", "deprecated", "function"],
        }),
        createMockRequest({
          id: "2",
          keywords: ["delete", "deprecated", "method"],
        }),
        createMockRequest({
          id: "3",
          keywords: ["delete", "deprecated", "class"],
        }),
      ];

      const batch = {
        id: "batch-1",
        requests,
        similarityScore: 0.8,
        createdAt: new Date(),
      };

      const patterns = batchingEngine.extractCommonPatterns(batch);

      expect(patterns.commonKeywords).toContain("delete");
      expect(patterns.commonKeywords).toContain("deprecated");
      expect(patterns.summary).toContain("3 agents");
    });

    it("should identify common type", () => {
      const requests: AgentRequest[] = [
        createMockRequest({ id: "1", type: "confirmation" }),
        createMockRequest({ id: "2", type: "confirmation" }),
      ];

      const batch = {
        id: "batch-1",
        requests,
        similarityScore: 0.8,
        createdAt: new Date(),
      };

      const patterns = batchingEngine.extractCommonPatterns(batch);

      expect(patterns.commonType).toBe("confirmation");
      expect(patterns.summary).toContain("confirmation");
    });

    it("should identify common context", () => {
      const requests: AgentRequest[] = [
        createMockRequest({ id: "1", context: { codeArea: "src/auth" } }),
        createMockRequest({ id: "2", context: { codeArea: "src/auth" } }),
        createMockRequest({ id: "3", context: { codeArea: "src/auth" } }),
      ];

      const batch = {
        id: "batch-1",
        requests,
        similarityScore: 0.8,
        createdAt: new Date(),
      };

      const patterns = batchingEngine.extractCommonPatterns(batch);

      expect(patterns.commonContext).toBe("src/auth");
      expect(patterns.summary).toContain("src/auth");
    });

    it("should generate comprehensive summary", () => {
      const requests: AgentRequest[] = [
        createMockRequest({
          id: "1",
          type: "confirmation",
          keywords: ["delete", "deprecated"],
          context: { codeArea: "src/api" },
        }),
        createMockRequest({
          id: "2",
          type: "confirmation",
          keywords: ["delete", "deprecated"],
          context: { codeArea: "src/api" },
        }),
      ];

      const batch = {
        id: "batch-1",
        requests,
        similarityScore: 0.9,
        createdAt: new Date(),
      };

      const patterns = batchingEngine.extractCommonPatterns(batch);

      expect(patterns.summary).toMatch(/2 agents/);
      expect(patterns.summary).toMatch(/confirmation/);
      expect(patterns.summary).toMatch(/delete/);
      expect(patterns.summary).toMatch(/deprecated/);
      expect(patterns.summary).toMatch(/src\/api/);
    });
  });

  describe("shouldAddToBatch", () => {
    it("should add similar request to batch", () => {
      const batch = {
        id: "batch-1",
        requests: [
          createMockRequest({
            id: "1",
            keywords: ["create", "test"],
            type: "confirmation",
          }),
        ],
        similarityScore: 0.8,
        createdAt: new Date(),
      };

      const newRequest = createMockRequest({
        id: "2",
        keywords: ["create", "test"],
        type: "confirmation",
      });

      const should Add = batchingEngine.shouldAddToBatch(newRequest, batch);
      expect(shouldAdd).toBe(true);
    });

    it("should not add dissimilar request to batch", () => {
      const batch = {
        id: "batch-1",
        requests: [
          createMockRequest({
            id: "1",
            keywords: ["create", "test"],
            type: "confirmation",
          }),
        ],
        similarityScore: 0.8,
        createdAt: new Date(),
      };

      const newRequest = createMockRequest({
        id: "2",
        keywords: ["delete", "deprecated"],
        type: "guidance",
      });

      const shouldAdd = batchingEngine.shouldAddToBatch(newRequest, batch);
      expect(shouldAdd).toBe(false);
    });

    it("should not add request outside time window", () => {
      const now = Date.now();
      const batch = {
        id: "batch-1",
        requests: [
          createMockRequest({
            id: "1",
            createdAt: new Date(now - 40000), // 40 seconds ago
          }),
        ],
        similarityScore: 0.8,
        createdAt: new Date(now - 40000),
      };

      const newRequest = createMockRequest({
        id: "2",
        createdAt: new Date(now),
      });

      const engine = new BatchingEngine({
        batchTimeWindowMs: 30000, // 30 second window
      });

      const shouldAdd = engine.shouldAddToBatch(newRequest, batch);
      expect(shouldAdd).toBe(false);
    });
  });
});

// Helper function to create mock requests
function createMockRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    id: "mock-id",
    executionId: "mock-execution",
    issueId: "mock-issue",
    issuePriority: "medium",
    type: "confirmation",
    message: "Mock message",
    keywords: [],
    urgency: "blocking",
    estimatedImpact: 50,
    status: "queued",
    createdAt: new Date(),
    ...overrides,
  };
}
