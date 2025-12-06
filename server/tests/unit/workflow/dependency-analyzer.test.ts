/**
 * Unit tests for Dependency Analyzer
 *
 * Tests the dependency graph building, topological sort,
 * cycle detection, and parallel group computation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  buildDependencyGraph,
  topologicalSort,
  findParallelGroups,
  analyzeDependencies,
} from "../../../src/workflow/dependency-analyzer.js";

// Mock the CLI relationships module
vi.mock("@sudocode-ai/cli/dist/operations/relationships.js", () => ({
  getOutgoingRelationships: vi.fn(),
}));

import { getOutgoingRelationships } from "@sudocode-ai/cli/dist/operations/relationships.js";

const mockGetOutgoingRelationships = vi.mocked(getOutgoingRelationships);

// Helper to create a mock database (not used directly in most tests)
function createMockDb(): Database.Database {
  return {} as Database.Database;
}

// Helper to set up relationship mocks
// Takes a map of issueId -> { blocks: string[], dependsOn: string[] }
function setupRelationshipMocks(
  relationships: Record<string, { blocks?: string[]; dependsOn?: string[] }>
) {
  mockGetOutgoingRelationships.mockImplementation(
    (db, issueId, entityType, relType) => {
      const rels = relationships[issueId as string];
      if (!rels) return [];

      if (relType === "blocks") {
        return (rels.blocks || []).map((toId) => ({
          from_id: issueId,
          from_uuid: `uuid-${issueId}`,
          from_type: "issue",
          to_id: toId,
          to_uuid: `uuid-${toId}`,
          to_type: "issue",
          relationship_type: "blocks",
          created_at: new Date().toISOString(),
        }));
      }

      if (relType === "depends-on") {
        return (rels.dependsOn || []).map((toId) => ({
          from_id: issueId,
          from_uuid: `uuid-${issueId}`,
          from_type: "issue",
          to_id: toId,
          to_uuid: `uuid-${toId}`,
          to_type: "issue",
          relationship_type: "depends-on",
          created_at: new Date().toISOString(),
        }));
      }

      return [];
    }
  );
}

describe("Dependency Analyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("topologicalSort", () => {
    it("should return empty array for empty input", () => {
      const adjacencyList = new Map<string, string[]>();
      const inDegree = new Map<string, number>();

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.sorted).toEqual([]);
      expect(result.cycles).toBeNull();
      expect(result.valid).toBe(true);
    });

    it("should handle single node with no edges", () => {
      const adjacencyList = new Map<string, string[]>([["i-1", []]]);
      const inDegree = new Map<string, number>([["i-1", 0]]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.sorted).toEqual(["i-1"]);
      expect(result.cycles).toBeNull();
      expect(result.valid).toBe(true);
    });

    it("should sort linear chain correctly", () => {
      // A -> B -> C (A blocks B, B blocks C)
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b"]],
        ["i-b", ["i-c"]],
        ["i-c", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 1],
        ["i-c", 1],
      ]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.valid).toBe(true);
      expect(result.cycles).toBeNull();
      expect(result.sorted).toEqual(["i-a", "i-b", "i-c"]);
    });

    it("should sort diamond pattern correctly", () => {
      // A blocks B and C, both B and C block D
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b", "i-c"]],
        ["i-b", ["i-d"]],
        ["i-c", ["i-d"]],
        ["i-d", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 1],
        ["i-c", 1],
        ["i-d", 2],
      ]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.valid).toBe(true);
      expect(result.cycles).toBeNull();
      // A must come first, D must come last, B and C can be in any order
      expect(result.sorted[0]).toBe("i-a");
      expect(result.sorted[3]).toBe("i-d");
      expect(result.sorted.slice(1, 3).sort()).toEqual(["i-b", "i-c"]);
    });

    it("should detect simple cycle", () => {
      // A -> B -> A (cycle)
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b"]],
        ["i-b", ["i-a"]],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 1],
        ["i-b", 1],
      ]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.valid).toBe(false);
      expect(result.cycles).not.toBeNull();
      expect(result.cycles!.length).toBeGreaterThan(0);
      expect(result.sorted).toEqual([]); // No nodes can be processed
    });

    it("should detect cycle in larger graph", () => {
      // A -> B -> C -> D -> B (B-C-D form a cycle)
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b"]],
        ["i-b", ["i-c"]],
        ["i-c", ["i-d"]],
        ["i-d", ["i-b"]],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 2], // from A and D
        ["i-c", 1],
        ["i-d", 1],
      ]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.valid).toBe(false);
      expect(result.cycles).not.toBeNull();
      // A should be processed (it has no dependencies)
      expect(result.sorted).toContain("i-a");
      // B, C, D are in a cycle so can't all be processed
      expect(result.sorted.length).toBeLessThan(4);
    });

    it("should handle multiple independent components", () => {
      // A -> B (component 1)
      // C -> D (component 2)
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b"]],
        ["i-b", []],
        ["i-c", ["i-d"]],
        ["i-d", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 1],
        ["i-c", 0],
        ["i-d", 1],
      ]);

      const result = topologicalSort(adjacencyList, inDegree);

      expect(result.valid).toBe(true);
      expect(result.sorted.length).toBe(4);
      // A must come before B, C must come before D
      expect(result.sorted.indexOf("i-a")).toBeLessThan(
        result.sorted.indexOf("i-b")
      );
      expect(result.sorted.indexOf("i-c")).toBeLessThan(
        result.sorted.indexOf("i-d")
      );
    });
  });

  describe("findParallelGroups", () => {
    it("should return empty array for empty input", () => {
      const result = findParallelGroups(
        [],
        new Map<string, string[]>(),
        new Map<string, number>()
      );

      expect(result).toEqual([]);
    });

    it("should put single node in single group", () => {
      const sortedIds = ["i-1"];
      const adjacencyList = new Map<string, string[]>([["i-1", []]]);
      const inDegree = new Map<string, number>([["i-1", 0]]);

      const result = findParallelGroups(sortedIds, adjacencyList, inDegree);

      expect(result).toEqual([["i-1"]]);
    });

    it("should group independent nodes together", () => {
      // A, B, C all have no dependencies
      const sortedIds = ["i-a", "i-b", "i-c"];
      const adjacencyList = new Map<string, string[]>([
        ["i-a", []],
        ["i-b", []],
        ["i-c", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 0],
        ["i-c", 0],
      ]);

      const result = findParallelGroups(sortedIds, adjacencyList, inDegree);

      // All should be in level 0
      expect(result.length).toBe(1);
      expect(result[0].sort()).toEqual(["i-a", "i-b", "i-c"]);
    });

    it("should separate sequential dependencies into groups", () => {
      // A -> B -> C (linear chain)
      const sortedIds = ["i-a", "i-b", "i-c"];
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b"]],
        ["i-b", ["i-c"]],
        ["i-c", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 1],
        ["i-c", 1],
      ]);

      const result = findParallelGroups(sortedIds, adjacencyList, inDegree);

      expect(result.length).toBe(3);
      expect(result[0]).toEqual(["i-a"]);
      expect(result[1]).toEqual(["i-b"]);
      expect(result[2]).toEqual(["i-c"]);
    });

    it("should group diamond pattern correctly", () => {
      //     A       level 0
      //    / \
      //   B   C     level 1
      //    \ /
      //     D       level 2
      const sortedIds = ["i-a", "i-b", "i-c", "i-d"];
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-b", "i-c"]],
        ["i-b", ["i-d"]],
        ["i-c", ["i-d"]],
        ["i-d", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 1],
        ["i-c", 1],
        ["i-d", 2],
      ]);

      const result = findParallelGroups(sortedIds, adjacencyList, inDegree);

      expect(result.length).toBe(3);
      expect(result[0]).toEqual(["i-a"]);
      expect(result[1].sort()).toEqual(["i-b", "i-c"]);
      expect(result[2]).toEqual(["i-d"]);
    });

    it("should handle complex graph with multiple paths", () => {
      //   A   B     level 0 (both independent)
      //   |\ /|
      //   | X |
      //   |/ \|
      //   C   D     level 1 (C depends on A and B, D depends on A and B)
      //    \ /
      //     E       level 2
      const sortedIds = ["i-a", "i-b", "i-c", "i-d", "i-e"];
      const adjacencyList = new Map<string, string[]>([
        ["i-a", ["i-c", "i-d"]],
        ["i-b", ["i-c", "i-d"]],
        ["i-c", ["i-e"]],
        ["i-d", ["i-e"]],
        ["i-e", []],
      ]);
      const inDegree = new Map<string, number>([
        ["i-a", 0],
        ["i-b", 0],
        ["i-c", 2],
        ["i-d", 2],
        ["i-e", 2],
      ]);

      const result = findParallelGroups(sortedIds, adjacencyList, inDegree);

      expect(result.length).toBe(3);
      expect(result[0].sort()).toEqual(["i-a", "i-b"]);
      expect(result[1].sort()).toEqual(["i-c", "i-d"]);
      expect(result[2]).toEqual(["i-e"]);
    });
  });

  describe("buildDependencyGraph", () => {
    it("should return empty graph for empty input", () => {
      setupRelationshipMocks({});
      const db = createMockDb();

      const result = buildDependencyGraph(db, []);

      expect(result.issueIds).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.adjacencyList.size).toBe(0);
      expect(result.inDegree.size).toBe(0);
    });

    it("should handle single issue with no relationships", () => {
      setupRelationshipMocks({
        "i-1": { blocks: [], dependsOn: [] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-1"]);

      expect(result.issueIds).toEqual(["i-1"]);
      expect(result.edges).toEqual([]);
      expect(result.adjacencyList.get("i-1")).toEqual([]);
      expect(result.inDegree.get("i-1")).toBe(0);
    });

    it("should build graph from blocks relationships", () => {
      // A blocks B
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { blocks: [] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-a", "i-b"]);

      expect(result.issueIds.sort()).toEqual(["i-a", "i-b"]);
      expect(result.edges).toEqual([["i-a", "i-b"]]);
      expect(result.adjacencyList.get("i-a")).toEqual(["i-b"]);
      expect(result.adjacencyList.get("i-b")).toEqual([]);
      expect(result.inDegree.get("i-a")).toBe(0);
      expect(result.inDegree.get("i-b")).toBe(1);
    });

    it("should build graph from depends-on relationships", () => {
      // B depends-on A (equivalent to A blocks B)
      setupRelationshipMocks({
        "i-a": { dependsOn: [] },
        "i-b": { dependsOn: ["i-a"] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-a", "i-b"]);

      expect(result.edges).toEqual([["i-a", "i-b"]]);
      expect(result.adjacencyList.get("i-a")).toEqual(["i-b"]);
      expect(result.inDegree.get("i-b")).toBe(1);
    });

    it("should handle both blocks and depends-on without duplicates", () => {
      // A blocks B, and B depends-on A (should create only one edge)
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { dependsOn: ["i-a"] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-a", "i-b"]);

      // Should have only one edge despite both relationships
      expect(result.edges.length).toBe(1);
      expect(result.edges).toEqual([["i-a", "i-b"]]);
      expect(result.inDegree.get("i-b")).toBe(1);
    });

    it("should filter out relationships to issues not in the set", () => {
      // A blocks B and C, but C is not in our issue set
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b", "i-c"] },
        "i-b": { blocks: [] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-a", "i-b"]);

      // Should only have edge to i-b, not i-c
      expect(result.edges).toEqual([["i-a", "i-b"]]);
      expect(result.issueIds).not.toContain("i-c");
    });

    it("should deduplicate input issue IDs", () => {
      setupRelationshipMocks({
        "i-1": { blocks: [] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-1", "i-1", "i-1"]);

      expect(result.issueIds).toEqual(["i-1"]);
    });

    it("should build complex diamond pattern", () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b", "i-c"] },
        "i-b": { blocks: ["i-d"] },
        "i-c": { blocks: ["i-d"] },
        "i-d": { blocks: [] },
      });
      const db = createMockDb();

      const result = buildDependencyGraph(db, ["i-a", "i-b", "i-c", "i-d"]);

      expect(result.edges.length).toBe(4);
      expect(result.inDegree.get("i-a")).toBe(0);
      expect(result.inDegree.get("i-b")).toBe(1);
      expect(result.inDegree.get("i-c")).toBe(1);
      expect(result.inDegree.get("i-d")).toBe(2);
    });
  });

  describe("analyzeDependencies", () => {
    it("should return complete analysis for empty input", () => {
      setupRelationshipMocks({});
      const db = createMockDb();

      const result = analyzeDependencies(db, []);

      expect(result.issueIds).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.topologicalOrder).toEqual([]);
      expect(result.cycles).toBeNull();
      expect(result.parallelGroups).toEqual([]);
    });

    it("should analyze linear chain correctly", () => {
      // A -> B -> C
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { blocks: ["i-c"] },
        "i-c": { blocks: [] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b", "i-c"]);

      expect(result.topologicalOrder).toEqual(["i-a", "i-b", "i-c"]);
      expect(result.cycles).toBeNull();
      expect(result.parallelGroups.length).toBe(3);
      expect(result.parallelGroups[0]).toEqual(["i-a"]);
      expect(result.parallelGroups[1]).toEqual(["i-b"]);
      expect(result.parallelGroups[2]).toEqual(["i-c"]);
    });

    it("should analyze diamond pattern with parallel groups", () => {
      //     A       level 0
      //    / \
      //   B   C     level 1 (parallel)
      //    \ /
      //     D       level 2
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b", "i-c"] },
        "i-b": { blocks: ["i-d"] },
        "i-c": { blocks: ["i-d"] },
        "i-d": { blocks: [] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b", "i-c", "i-d"]);

      expect(result.cycles).toBeNull();
      expect(result.topologicalOrder[0]).toBe("i-a");
      expect(result.topologicalOrder[3]).toBe("i-d");
      expect(result.parallelGroups.length).toBe(3);
      expect(result.parallelGroups[0]).toEqual(["i-a"]);
      expect(result.parallelGroups[1].sort()).toEqual(["i-b", "i-c"]);
      expect(result.parallelGroups[2]).toEqual(["i-d"]);
    });

    it("should detect cycles and return empty parallel groups", () => {
      // A -> B -> A (cycle)
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { blocks: ["i-a"] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b"]);

      expect(result.cycles).not.toBeNull();
      expect(result.cycles!.length).toBeGreaterThan(0);
      expect(result.parallelGroups).toEqual([]);
    });

    it("should handle all independent issues as one parallel group", () => {
      // No relationships - all can run in parallel
      setupRelationshipMocks({
        "i-a": { blocks: [] },
        "i-b": { blocks: [] },
        "i-c": { blocks: [] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b", "i-c"]);

      expect(result.cycles).toBeNull();
      expect(result.parallelGroups.length).toBe(1);
      expect(result.parallelGroups[0].sort()).toEqual(["i-a", "i-b", "i-c"]);
    });

    it("should handle mixed relationships (blocks and depends-on)", () => {
      // A blocks B, C depends-on B
      // Result: A -> B -> C
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { blocks: [] },
        "i-c": { dependsOn: ["i-b"] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b", "i-c"]);

      expect(result.topologicalOrder).toEqual(["i-a", "i-b", "i-c"]);
      expect(result.cycles).toBeNull();
    });

    it("should correctly handle cycle with some processable nodes", () => {
      // A -> B -> C -> B (A is processable, B-C cycle)
      setupRelationshipMocks({
        "i-a": { blocks: ["i-b"] },
        "i-b": { blocks: ["i-c"] },
        "i-c": { blocks: ["i-b"] },
      });
      const db = createMockDb();

      const result = analyzeDependencies(db, ["i-a", "i-b", "i-c"]);

      expect(result.cycles).not.toBeNull();
      // A should be in topological order since it has no blockers
      expect(result.topologicalOrder).toContain("i-a");
      // Parallel groups empty due to cycle
      expect(result.parallelGroups).toEqual([]);
    });
  });
});
