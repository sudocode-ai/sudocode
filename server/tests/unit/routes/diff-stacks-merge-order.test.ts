/**
 * Unit tests for getCheckpointsInMergeOrder function
 *
 * Tests the Phase 3 topological ordering algorithm for merging checkpoints
 * from diff stacks. The algorithm uses Kahn's algorithm with timestamp
 * tiebreaker for independent checkpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCheckpointsInMergeOrder } from "../../../src/routes/diff-stacks.js";

describe("getCheckpointsInMergeOrder", () => {
  let mockAdapter: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    // Create mock adapter with tracker
    mockAdapter = {
      tracker: {
        getStream: vi.fn(),
      },
    };

    // Spy on console.warn for cycle detection tests
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic ordering", () => {
    it("returns empty array for empty input", () => {
      const result = getCheckpointsInMergeOrder([], mockAdapter);
      expect(result).toEqual([]);
    });

    it("returns single checkpoint unchanged", () => {
      const checkpoints = [
        {
          id: "cp-1",
          streamId: "stream-1",
          commitSha: "abc123",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);
      expect(result).toEqual(checkpoints);
    });

    it("orders independent checkpoints by createdAt (timestamp tiebreaker)", () => {
      const checkpoints = [
        {
          id: "cp-3",
          streamId: "stream-1",
          commitSha: "commit3",
          parentCommit: null,
          createdAt: 3000,
          position: 2,
        },
        {
          id: "cp-1",
          streamId: "stream-2",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-2",
          streamId: "stream-3",
          commitSha: "commit2",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      expect(result[0].id).toBe("cp-1"); // createdAt: 1000
      expect(result[1].id).toBe("cp-2"); // createdAt: 2000
      expect(result[2].id).toBe("cp-3"); // createdAt: 3000
    });
  });

  describe("parentCommit dependencies", () => {
    it("orders checkpoints by parentCommit chain", () => {
      const checkpoints = [
        {
          id: "cp-3",
          streamId: "stream-1",
          commitSha: "commit3",
          parentCommit: "commit2",
          createdAt: 3000,
          position: 2,
        },
        {
          id: "cp-1",
          streamId: "stream-1",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-2",
          streamId: "stream-1",
          commitSha: "commit2",
          parentCommit: "commit1",
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Should order: cp-1 -> cp-2 -> cp-3 (following parentCommit chain)
      expect(result[0].id).toBe("cp-1");
      expect(result[1].id).toBe("cp-2");
      expect(result[2].id).toBe("cp-3");
    });

    it("handles parentCommit pointing to commit outside stack", () => {
      const checkpoints = [
        {
          id: "cp-1",
          streamId: "stream-1",
          commitSha: "commit1",
          parentCommit: "external-commit",
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-2",
          streamId: "stream-1",
          commitSha: "commit2",
          parentCommit: "commit1",
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // external-commit is not in the stack, so cp-1 has no in-stack dependency
      // cp-2 depends on cp-1
      expect(result[0].id).toBe("cp-1");
      expect(result[1].id).toBe("cp-2");
    });
  });

  describe("stream lineage dependencies", () => {
    it("orders child stream checkpoints after parent stream checkpoints", () => {
      // Setup: stream-child is a child of stream-parent
      mockAdapter.tracker.getStream
        .mockReturnValueOnce(null) // First call returns null (for initial loop)
        .mockReturnValueOnce({ parentStream: "stream-parent" }) // stream-child
        .mockReturnValueOnce({ parentStream: null }); // stream-parent

      const checkpoints = [
        {
          id: "cp-child",
          streamId: "stream-child",
          commitSha: "child-commit",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
        {
          id: "cp-parent",
          streamId: "stream-parent",
          commitSha: "parent-commit",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Parent stream checkpoint should come first
      expect(result[0].id).toBe("cp-parent");
      expect(result[1].id).toBe("cp-child");
    });

    it("handles multiple checkpoints from parent and child streams", () => {
      mockAdapter.tracker.getStream
        .mockImplementation((streamId: string) => {
          if (streamId === "stream-child") {
            return { parentStream: "stream-parent" };
          }
          return { parentStream: null };
        });

      const checkpoints = [
        {
          id: "cp-child-2",
          streamId: "stream-child",
          commitSha: "child-2",
          parentCommit: "child-1",
          createdAt: 4000,
          position: 3,
        },
        {
          id: "cp-parent-1",
          streamId: "stream-parent",
          commitSha: "parent-1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-child-1",
          streamId: "stream-child",
          commitSha: "child-1",
          parentCommit: null,
          createdAt: 3000,
          position: 2,
        },
        {
          id: "cp-parent-2",
          streamId: "stream-parent",
          commitSha: "parent-2",
          parentCommit: "parent-1",
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // All parent stream checkpoints should come before child stream
      // Within each stream, parentCommit ordering applies
      const parentCheckpoints = result.filter((cp) => cp.streamId === "stream-parent");
      const childCheckpoints = result.filter((cp) => cp.streamId === "stream-child");

      // Verify parent checkpoints are first
      expect(result.slice(0, 2).every((cp) => cp.streamId === "stream-parent")).toBe(true);

      // Verify ordering within each stream
      expect(parentCheckpoints[0].id).toBe("cp-parent-1");
      expect(parentCheckpoints[1].id).toBe("cp-parent-2");
      expect(childCheckpoints[0].id).toBe("cp-child-1");
      expect(childCheckpoints[1].id).toBe("cp-child-2");
    });
  });

  describe("complex DAG scenarios", () => {
    it("handles diamond dependency pattern", () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      // A is the root, D depends on both B and C
      mockAdapter.tracker.getStream.mockReturnValue({ parentStream: null });

      const checkpoints = [
        {
          id: "D",
          streamId: "stream-1",
          commitSha: "d-commit",
          parentCommit: "b-commit", // Also implicitly depends on C via other edges
          createdAt: 4000,
          position: 3,
        },
        {
          id: "A",
          streamId: "stream-1",
          commitSha: "a-commit",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "C",
          streamId: "stream-1",
          commitSha: "c-commit",
          parentCommit: "a-commit",
          createdAt: 3000,
          position: 2,
        },
        {
          id: "B",
          streamId: "stream-1",
          commitSha: "b-commit",
          parentCommit: "a-commit",
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // A must come first
      expect(result[0].id).toBe("A");

      // B and C can be in either order (both depend only on A)
      // but timestamp tiebreaker should put B (2000) before C (3000)
      const middleIds = [result[1].id, result[2].id];
      expect(middleIds).toContain("B");
      expect(middleIds).toContain("C");
      expect(result[1].id).toBe("B"); // B has earlier timestamp

      // D must come last
      expect(result[3].id).toBe("D");
    });

    it("handles multi-level stream hierarchy", () => {
      // stream-grandchild -> stream-child -> stream-parent
      mockAdapter.tracker.getStream
        .mockImplementation((streamId: string) => {
          if (streamId === "stream-grandchild") {
            return { parentStream: "stream-child" };
          }
          if (streamId === "stream-child") {
            return { parentStream: "stream-parent" };
          }
          return { parentStream: null };
        });

      const checkpoints = [
        {
          id: "cp-grandchild",
          streamId: "stream-grandchild",
          commitSha: "gc-commit",
          parentCommit: null,
          createdAt: 3000,
          position: 2,
        },
        {
          id: "cp-child",
          streamId: "stream-child",
          commitSha: "c-commit",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
        {
          id: "cp-parent",
          streamId: "stream-parent",
          commitSha: "p-commit",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Order should be: parent -> child -> grandchild
      expect(result[0].id).toBe("cp-parent");
      expect(result[1].id).toBe("cp-child");
      expect(result[2].id).toBe("cp-grandchild");
    });
  });

  describe("cycle detection", () => {
    it("falls back to position order when cycle detected", () => {
      mockAdapter.tracker.getStream.mockReturnValue({ parentStream: null });

      // Create a cycle: A -> B -> A
      const checkpoints = [
        {
          id: "A",
          streamId: "stream-1",
          commitSha: "a-commit",
          parentCommit: "b-commit", // A depends on B
          createdAt: 1000,
          position: 0,
        },
        {
          id: "B",
          streamId: "stream-1",
          commitSha: "b-commit",
          parentCommit: "a-commit", // B depends on A - creates cycle
          createdAt: 2000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Should fall back to position order due to cycle
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[getCheckpointsInMergeOrder] Cycle detected, falling back to position order"
      );
      expect(result[0].id).toBe("A"); // position: 0
      expect(result[1].id).toBe("B"); // position: 1
    });

    it("handles larger cycle gracefully", () => {
      mockAdapter.tracker.getStream.mockReturnValue({ parentStream: null });

      // Create a cycle: A -> B -> C -> A
      const checkpoints = [
        {
          id: "A",
          streamId: "stream-1",
          commitSha: "a-commit",
          parentCommit: "c-commit",
          createdAt: 1000,
          position: 2,
        },
        {
          id: "B",
          streamId: "stream-1",
          commitSha: "b-commit",
          parentCommit: "a-commit",
          createdAt: 2000,
          position: 0,
        },
        {
          id: "C",
          streamId: "stream-1",
          commitSha: "c-commit",
          parentCommit: "b-commit",
          createdAt: 3000,
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Should fall back to position order
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(result[0].id).toBe("B"); // position: 0
      expect(result[1].id).toBe("C"); // position: 1
      expect(result[2].id).toBe("A"); // position: 2
    });
  });

  describe("edge cases", () => {
    it("handles checkpoints with same timestamp", () => {
      mockAdapter.tracker.getStream.mockReturnValue({ parentStream: null });

      const checkpoints = [
        {
          id: "cp-a",
          streamId: "stream-1",
          commitSha: "a-commit",
          parentCommit: null,
          createdAt: 1000, // Same timestamp
          position: 0,
        },
        {
          id: "cp-b",
          streamId: "stream-2",
          commitSha: "b-commit",
          parentCommit: null,
          createdAt: 1000, // Same timestamp
          position: 1,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Both should be in result
      expect(result).toHaveLength(2);
      expect(result.map((cp) => cp.id).sort()).toEqual(["cp-a", "cp-b"]);
    });

    it("handles null parentCommit consistently", () => {
      mockAdapter.tracker.getStream.mockReturnValue({ parentStream: null });

      const checkpoints = [
        {
          id: "cp-1",
          streamId: "stream-1",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
        {
          id: "cp-2",
          streamId: "stream-2",
          commitSha: "commit2",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Should order by timestamp when no dependencies
      expect(result[0].id).toBe("cp-2"); // Earlier timestamp
      expect(result[1].id).toBe("cp-1");
    });

    it("handles tracker.getStream returning undefined", () => {
      mockAdapter.tracker.getStream.mockReturnValue(undefined);

      const checkpoints = [
        {
          id: "cp-1",
          streamId: "unknown-stream",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Should still work without stream info
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("cp-1");
    });

    it("handles tracker.getStream throwing error", () => {
      mockAdapter.tracker.getStream.mockImplementation(() => {
        throw new Error("Stream not found");
      });

      const checkpoints = [
        {
          id: "cp-1",
          streamId: "error-stream",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-2",
          streamId: "error-stream",
          commitSha: "commit2",
          parentCommit: "commit1",
          createdAt: 2000,
          position: 1,
        },
      ];

      // Should handle error gracefully and still order by parentCommit
      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("cp-1");
      expect(result[1].id).toBe("cp-2");
    });

    it("handles missing tracker gracefully", () => {
      const adapterWithoutTracker = { tracker: null };

      const checkpoints = [
        {
          id: "cp-1",
          streamId: "stream-1",
          commitSha: "commit1",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
        {
          id: "cp-2",
          streamId: "stream-2",
          commitSha: "commit2",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, adapterWithoutTracker);

      // Should still work, ordering by timestamp
      expect(result[0].id).toBe("cp-2");
      expect(result[1].id).toBe("cp-1");
    });
  });

  describe("mixed dependencies", () => {
    it("combines parentCommit and stream lineage dependencies", () => {
      mockAdapter.tracker.getStream
        .mockImplementation((streamId: string) => {
          if (streamId === "stream-child") {
            return { parentStream: "stream-parent" };
          }
          return { parentStream: null };
        });

      const checkpoints = [
        {
          id: "cp-child-2",
          streamId: "stream-child",
          commitSha: "child-2",
          parentCommit: "child-1",
          createdAt: 4000,
          position: 3,
        },
        {
          id: "cp-parent-1",
          streamId: "stream-parent",
          commitSha: "parent-1",
          parentCommit: null,
          createdAt: 1000,
          position: 0,
        },
        {
          id: "cp-child-1",
          streamId: "stream-child",
          commitSha: "child-1",
          parentCommit: null,
          createdAt: 2000,
          position: 1,
        },
        {
          id: "cp-parent-2",
          streamId: "stream-parent",
          commitSha: "parent-2",
          parentCommit: "parent-1",
          createdAt: 3000,
          position: 2,
        },
      ];

      const result = getCheckpointsInMergeOrder(checkpoints, mockAdapter);

      // Expected order based on combined dependencies:
      // 1. cp-parent-1 (no deps)
      // 2. cp-parent-2 (depends on parent-1)
      // 3. cp-child-1 (depends on parent stream being done)
      // 4. cp-child-2 (depends on child-1)
      expect(result[0].id).toBe("cp-parent-1");
      expect(result[1].id).toBe("cp-parent-2");
      expect(result[2].id).toBe("cp-child-1");
      expect(result[3].id).toBe("cp-child-2");
    });
  });
});
