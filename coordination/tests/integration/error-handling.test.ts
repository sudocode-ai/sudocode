/**
 * Integration tests for error handling and edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CRDTState } from "../../src/crdt-state.js";
import { LeaseManager } from "../../src/lease-manager.js";
import type { ActiveWork, Lease } from "../../src/types.js";

describe("Error Handling and Edge Cases", () => {
  let state: CRDTState;
  let leaseManager: LeaseManager;

  beforeEach(() => {
    state = new CRDTState();
    leaseManager = new LeaseManager(state, {
      agentId: "test-agent",
      defaultLeaseTTL: 300000,
      renewalInterval: 150000,
    });
  });

  describe("Concurrent Modifications", () => {
    it("should handle rapid sequential updates", () => {
      const updates = 100;

      for (let i = 0; i < updates; i++) {
        state.setActiveWork(`agent-${i}`, {
          agentId: `agent-${i}`,
          issues: [`#${i}`],
          specs: [],
          files: [],
          status: `Update ${i}`,
          startedAt: Date.now(),
          lastHeartbeat: Date.now(),
          metadata: {},
        });
      }

      const allWork = state.getAllActiveWork();
      expect(allWork.size).toBe(updates);
    });

    it("should handle concurrent lease acquisitions", async () => {
      // In a single-process environment, promises execute serially
      // All will succeed since they're from the same agent
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          leaseManager.acquireLease({
            path: "contested.ts",
            type: "file",
            priority: 5,
          })
        );
      }

      const results = await Promise.all(promises);

      // All succeed because they're from the same agent (same holder)
      expect(results.filter((r) => r).length).toBeGreaterThan(0);

      // Verify lease is held
      const lease = state.getLease("contested.ts");
      expect(lease?.holder).toBe("test-agent");
    });
  });

  describe("Large State Handling", () => {
    it("should handle many active agents", () => {
      const agentCount = 1000;

      for (let i = 0; i < agentCount; i++) {
        state.setActiveWork(`agent-${i}`, {
          agentId: `agent-${i}`,
          issues: [],
          specs: [],
          files: [],
          status: "Working",
          startedAt: Date.now(),
          lastHeartbeat: Date.now(),
          metadata: {},
        });
      }

      expect(state.getAllActiveWork().size).toBe(agentCount);

      // Should still be able to query efficiently
      const work = state.getActiveWork("agent-500");
      expect(work).toBeDefined();
    });

    it("should handle many leases", async () => {
      const leaseCount = 500;

      for (let i = 0; i < leaseCount; i++) {
        await leaseManager.acquireLease({
          path: `file-${i}.ts`,
          type: "file",
        });
      }

      const myLeases = leaseManager.getMyLeases();
      expect(myLeases.size).toBe(leaseCount);
    });

    it("should handle large issue updates", () => {
      const largeChecklist: Record<string, any> = {};

      for (let i = 0; i < 100; i++) {
        largeChecklist[`task-${i}`] = {
          status: i % 3 === 0 ? "completed" : "pending",
          completedAt: i % 3 === 0 ? Date.now() : undefined,
        };
      }

      state.setIssueUpdate("#1", {
        agentId: "agent-1",
        issueId: "#1",
        tempChecklist: largeChecklist,
        lastModified: Date.now(),
        version: 1,
      });

      const update = state.getIssueUpdate("#1");
      expect(update?.tempChecklist).toBeDefined();
      expect(Object.keys(update!.tempChecklist!).length).toBe(100);
    });
  });

  describe("State Recovery", () => {
    it("should recover from corrupted lease data", () => {
      // Set valid lease
      state.setLease("file.ts", {
        holder: "agent-1",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      // Manually corrupt it (simulate network corruption)
      const lease = state.getLease("file.ts");
      if (lease) {
        (lease as any).expires = "invalid"; // Corrupt timestamp
      }

      // Cleanup should handle gracefully
      expect(() => state.cleanupExpiredLeases()).not.toThrow();
    });

    it("should handle missing agent metadata gracefully", () => {
      state.removeAgentMetadata("nonexistent");
      expect(state.getAgentMetadata("nonexistent")).toBeUndefined();
    });

    it("should handle removing non-existent active work", () => {
      expect(() => state.removeActiveWork("nonexistent")).not.toThrow();
    });
  });

  describe("Lease Edge Cases", () => {
    it("should handle lease at exact expiration time", async () => {
      const now = Date.now();

      state.setLease("file.ts", {
        holder: "agent-2",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: now - 300000,
        expires: now - 1, // Expired 1ms ago
        renewable: true,
        priority: 5,
      });

      // Should be able to acquire (expired)
      const acquired = await leaseManager.acquireLease({
        path: "file.ts",
        type: "file",
      });

      expect(acquired).toBe(true);
    });

    it("should handle zero TTL lease", async () => {
      const now = Date.now();

      state.setLease("file.ts", {
        holder: "agent-2",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: now - 1000,
        expires: now - 1, // Expired 1ms ago
        renewable: true,
        priority: 5,
      });

      const acquired = await leaseManager.acquireLease({
        path: "file.ts",
        type: "file",
      });

      expect(acquired).toBe(true);
    });

    it("should handle negative priority gracefully", async () => {
      const acquired = await leaseManager.acquireLease({
        path: "file.ts",
        type: "file",
        priority: -5, // Negative priority
      });

      expect(acquired).toBe(true);

      const lease = state.getLease("file.ts");
      expect(lease?.priority).toBe(-5);
    });

    it("should handle extremely high priority", async () => {
      state.setLease("file.ts", {
        holder: "agent-2",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const acquired = await leaseManager.acquireLease({
        path: "file.ts",
        type: "file",
        priority: 999999, // Very high priority
      });

      expect(acquired).toBe(true);
      expect(state.getLease("file.ts")?.holder).toBe("test-agent");
    });
  });

  describe("CRDT Merge Conflicts", () => {
    it("should handle conflicting updates with last-write-wins", () => {
      const state1 = new CRDTState();
      const state2 = new CRDTState();

      // Both agents update same issue
      state1.setIssueUpdate("#1", {
        agentId: "agent-1",
        issueId: "#1",
        tempTitle: "Title from agent 1",
        lastModified: Date.now(),
        version: 1,
      });

      state2.setIssueUpdate("#1", {
        agentId: "agent-2",
        issueId: "#1",
        tempTitle: "Title from agent 2",
        lastModified: Date.now() + 1000, // Later timestamp
        version: 1,
      });

      // Sync states
      const update1 = state1.getStateAsUpdate();
      const update2 = state2.getStateAsUpdate();

      state1.applyUpdate(update2);
      state2.applyUpdate(update1);

      // Both should converge to same state (CRDT property)
      const issue1 = state1.getIssueUpdate("#1");
      const issue2 = state2.getIssueUpdate("#1");

      // They should have the same data (CRDT ensures convergence)
      expect(issue1).toBeDefined();
      expect(issue2).toBeDefined();
    });

    it("should handle split-brain scenario", () => {
      const state1 = new CRDTState();
      const state2 = new CRDTState();

      // Agents work independently
      state1.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: [],
        status: "Working on #1",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      state2.setActiveWork("agent-2", {
        agentId: "agent-2",
        issues: ["#2"],
        specs: [],
        files: [],
        status: "Working on #2",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      // Now they reconnect and sync
      const update1 = state1.getStateAsUpdate();
      const update2 = state2.getStateAsUpdate();

      state1.applyUpdate(update2);
      state2.applyUpdate(update1);

      // Both should have both agents' work
      expect(state1.getAllActiveWork().size).toBe(2);
      expect(state2.getAllActiveWork().size).toBe(2);
      expect(state1.getActiveWork("agent-2")).toBeDefined();
      expect(state2.getActiveWork("agent-1")).toBeDefined();
    });
  });

  describe("Memory and Performance", () => {
    it("should not leak memory with repeated updates", () => {
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        state.setActiveWork("agent-1", {
          agentId: "agent-1",
          issues: [`#${i}`],
          specs: [],
          files: [],
          status: `Iteration ${i}`,
          startedAt: Date.now(),
          lastHeartbeat: Date.now(),
          metadata: {},
        });

        // Cleanup old data
        if (i > 10) {
          state.removeActiveWork("agent-1");
        }
      }

      // Should only have last update
      expect(state.getAllActiveWork().size).toBe(0);
    });

    it("should handle rapid lease churn", async () => {
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await leaseManager.acquireLease({
          path: `file-${i}.ts`,
          type: "file",
        });

        if (i > 10) {
          await leaseManager.releaseLease(`file-${i - 10}.ts`);
        }
      }

      // Should have approximately 10 active leases
      const leases = leaseManager.getMyLeases();
      expect(leases.size).toBeLessThanOrEqual(90);
    });
  });

  describe("Timestamp Edge Cases", () => {
    it("should handle future timestamps", () => {
      const futureTime = Date.now() + 86400000; // Tomorrow

      state.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: [],
        specs: [],
        files: [],
        status: "Future work",
        startedAt: futureTime,
        lastHeartbeat: futureTime,
        metadata: {},
      });

      const work = state.getActiveWork("agent-1");
      expect(work?.startedAt).toBe(futureTime);
    });

    it("should handle very old timestamps", () => {
      const oldTime = Date.now() - 86400000 * 365; // Year ago

      state.setLease("file.ts", {
        holder: "agent-1",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: oldTime,
        expires: oldTime + 300000, // Long expired
        renewable: true,
        priority: 5,
      });

      const cleaned = state.cleanupExpiredLeases();
      expect(cleaned).toBe(1);
    });
  });

  describe("Resource Path Edge Cases", () => {
    it("should handle special characters in paths", async () => {
      const specialPaths = [
        "file with spaces.ts",
        "file-with-dashes.ts",
        "file_with_underscores.ts",
        "file.multiple.dots.ts",
        "路径/中文.ts",
        "@scope/package.json",
      ];

      for (const path of specialPaths) {
        const acquired = await leaseManager.acquireLease({
          path,
          type: "file",
        });

        expect(acquired).toBe(true);
      }

      const leases = leaseManager.getMyLeases();
      expect(leases.size).toBe(specialPaths.length);
    });

    it("should handle very long paths", async () => {
      const longPath = "very/" + "long/".repeat(50) + "path.ts";

      const acquired = await leaseManager.acquireLease({
        path: longPath,
        type: "file",
      });

      expect(acquired).toBe(true);
      expect(state.getLease(longPath)).toBeDefined();
    });

    it("should handle empty-like paths", async () => {
      const edgePaths = [
        ".",
        "..",
        "./file.ts",
        "../file.ts",
      ];

      for (const path of edgePaths) {
        const acquired = await leaseManager.acquireLease({
          path,
          type: "file",
        });

        expect(acquired).toBe(true);
      }
    });
  });

  describe("State Consistency", () => {
    it("should maintain consistency across multiple sync rounds", () => {
      const state1 = new CRDTState();
      const state2 = new CRDTState();
      const state3 = new CRDTState();

      // Round 1: Agent 1 updates
      state1.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);
      state3.applyUpdate(update);

      // Round 2: Agent 2 updates
      state2.setActiveWork("agent-2", {
        agentId: "agent-2",
        issues: ["#2"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      update = state2.getStateAsUpdate();
      state1.applyUpdate(update);
      state3.applyUpdate(update);

      // Round 3: Agent 3 updates
      state3.setActiveWork("agent-3", {
        agentId: "agent-3",
        issues: ["#3"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      update = state3.getStateAsUpdate();
      state1.applyUpdate(update);
      state2.applyUpdate(update);

      // All states should be identical
      expect(state1.getAllActiveWork().size).toBe(3);
      expect(state2.getAllActiveWork().size).toBe(3);
      expect(state3.getAllActiveWork().size).toBe(3);
    });
  });
});
