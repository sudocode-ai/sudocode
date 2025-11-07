/**
 * Integration tests for multi-agent coordination
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CRDTState } from "../../src/crdt-state.js";
import { LeaseManager } from "../../src/lease-manager.js";
import type { ActiveWork } from "../../src/types.js";

describe("Multi-Agent Coordination", () => {
  let state1: CRDTState;
  let state2: CRDTState;
  let leaseManager1: LeaseManager;
  let leaseManager2: LeaseManager;

  beforeEach(() => {
    // Create two agents with separate CRDT states
    state1 = new CRDTState();
    state2 = new CRDTState();

    leaseManager1 = new LeaseManager(state1, {
      agentId: "agent-1",
      defaultLeaseTTL: 300000,
      renewalInterval: 150000,
    });

    leaseManager2 = new LeaseManager(state2, {
      agentId: "agent-2",
      defaultLeaseTTL: 300000,
      renewalInterval: 150000,
    });
  });

  describe("State Synchronization", () => {
    it("should synchronize active work between agents", () => {
      const work1: ActiveWork = {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: ["src/file1.ts"],
        status: "Working on issue #1",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      // Agent 1 sets active work
      state1.setActiveWork("agent-1", work1);

      // Simulate state sync
      const update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 should see agent 1's work
      const syncedWork = state2.getActiveWork("agent-1");
      expect(syncedWork).toBeDefined();
      expect(syncedWork?.issues).toEqual(["#1"]);
      expect(syncedWork?.files).toEqual(["src/file1.ts"]);
    });

    it("should synchronize leases between agents", async () => {
      // Agent 1 acquires lease
      await leaseManager1.acquireLease({
        path: "src/file.ts",
        type: "file",
      });

      // Simulate state sync
      const update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 should see the lease
      const lease = state2.getLease("src/file.ts");
      expect(lease).toBeDefined();
      expect(lease?.holder).toBe("agent-1");

      // Agent 2 should not be able to acquire the same lease
      const acquired = await leaseManager2.acquireLease({
        path: "src/file.ts",
        type: "file",
      });
      expect(acquired).toBe(false);
    });

    it("should synchronize issue updates between agents", () => {
      // Agent 1 updates an issue
      state1.setIssueUpdate("#1", {
        agentId: "agent-1",
        issueId: "#1",
        tempTitle: "Updated by agent 1",
        lastModified: Date.now(),
        version: 1,
      });

      // Simulate state sync
      const update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 should see the update
      const issueUpdate = state2.getIssueUpdate("#1");
      expect(issueUpdate).toBeDefined();
      expect(issueUpdate?.tempTitle).toBe("Updated by agent 1");
      expect(issueUpdate?.agentId).toBe("agent-1");
    });

    it("should handle bidirectional state sync", () => {
      // Agent 1 sets work
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

      // Agent 2 sets work
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

      // Sync agent 1 -> agent 2
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Sync agent 2 -> agent 1
      update = state2.getStateAsUpdate();
      state1.applyUpdate(update);

      // Both agents should see each other's work
      expect(state1.getAllActiveWork().size).toBe(2);
      expect(state2.getAllActiveWork().size).toBe(2);
      expect(state1.getActiveWork("agent-2")).toBeDefined();
      expect(state2.getActiveWork("agent-1")).toBeDefined();
    });
  });

  describe("Conflict Resolution", () => {
    it("should prevent concurrent file modifications", async () => {
      // Agent 1 acquires lease on file
      await leaseManager1.acquireLease({
        path: "src/shared.ts",
        type: "file",
        priority: 5,
      });

      // Sync to agent 2
      const update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 tries to acquire same file
      const acquired = await leaseManager2.acquireLease({
        path: "src/shared.ts",
        type: "file",
        priority: 5,
      });

      expect(acquired).toBe(false);

      // Check conflicts
      const conflicts = leaseManager2.checkConflicts(["src/shared.ts"], [], []);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].holder).toBe("agent-1");
    });

    it("should allow priority override", async () => {
      // Agent 1 acquires low priority lease
      await leaseManager1.acquireLease({
        path: "src/shared.ts",
        type: "file",
        priority: 3,
      });

      // Sync to agent 2
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 acquires with higher priority
      const acquired = await leaseManager2.acquireLease({
        path: "src/shared.ts",
        type: "file",
        priority: 7,
      });

      expect(acquired).toBe(true);

      // Sync back to agent 1
      update = state2.getStateAsUpdate();
      state1.applyUpdate(update);

      // Agent 1 should see agent 2 now holds the lease
      const lease = state1.getLease("src/shared.ts");
      expect(lease?.holder).toBe("agent-2");
      expect(lease?.priority).toBe(7);
    });

    it("should handle lease expiration across agents", async () => {
      // Agent 1 acquires short-lived lease
      state1.setLease("src/temp.ts", {
        holder: "agent-1",
        resourcePath: "src/temp.ts",
        leaseType: "file",
        acquiredAt: Date.now() - 400000,
        expires: Date.now() - 100000, // Already expired
        renewable: false,
        priority: 5,
      });

      // Sync to agent 2
      const update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 should be able to acquire the expired lease
      const acquired = await leaseManager2.acquireLease({
        path: "src/temp.ts",
        type: "file",
      });

      expect(acquired).toBe(true);

      const lease = state2.getLease("src/temp.ts");
      expect(lease?.holder).toBe("agent-2");
    });
  });

  describe("Collaborative Work Scenarios", () => {
    it("should coordinate work on different files in same issue", async () => {
      // Both agents work on same issue but different files
      const work1: ActiveWork = {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: ["src/file1.ts"],
        status: "Implementing feature part 1",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      const work2: ActiveWork = {
        agentId: "agent-2",
        issues: ["#1"],
        specs: [],
        files: ["src/file2.ts"],
        status: "Implementing feature part 2",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      state1.setActiveWork("agent-1", work1);
      state2.setActiveWork("agent-2", work2);

      // Acquire leases on different files
      await leaseManager1.acquireLease({ path: "src/file1.ts", type: "file" });
      await leaseManager2.acquireLease({ path: "src/file2.ts", type: "file" });

      // Sync states
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      update = state2.getStateAsUpdate();
      state1.applyUpdate(update);

      // Both agents should see each other working on same issue
      const allWork1 = state1.getAllActiveWork();
      const allWork2 = state2.getAllActiveWork();

      expect(allWork1.size).toBe(2);
      expect(allWork2.size).toBe(2);

      // But they should hold leases on different files
      const agent1Leases = state1.getLeasesHeldBy("agent-1");
      const agent2Leases = state2.getLeasesHeldBy("agent-2");

      expect(agent1Leases.has("src/file1.ts")).toBe(true);
      expect(agent1Leases.has("src/file2.ts")).toBe(false);
      expect(agent2Leases.has("src/file2.ts")).toBe(true);
      expect(agent2Leases.has("src/file1.ts")).toBe(false);
    });

    it("should update issue checklist collaboratively", () => {
      // Agent 1 updates some checklist items
      state1.setIssueUpdate("#1", {
        agentId: "agent-1",
        issueId: "#1",
        tempChecklist: {
          "task-1": { status: "completed", completedAt: Date.now() },
          "task-2": { status: "in-progress" },
        },
        lastModified: Date.now(),
        version: 1,
      });

      // Sync to agent 2
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 2 updates different checklist items
      const existingUpdate = state2.getIssueUpdate("#1");
      state2.setIssueUpdate("#1", {
        ...existingUpdate!,
        agentId: "agent-2",
        tempChecklist: {
          ...existingUpdate!.tempChecklist,
          "task-3": { status: "completed", completedAt: Date.now() },
        },
        lastModified: Date.now(),
        version: 2,
      });

      // Sync back to agent 1
      update = state2.getStateAsUpdate();
      state1.applyUpdate(update);

      // Both should see all updates (CRDT merge)
      const issueUpdate1 = state1.getIssueUpdate("#1");
      const issueUpdate2 = state2.getIssueUpdate("#1");

      // Verify both have the merged checklist
      expect(issueUpdate1?.tempChecklist).toBeDefined();
      expect(issueUpdate2?.tempChecklist).toBeDefined();
    });
  });

  describe("Lease Cleanup and Recovery", () => {
    it("should clean up expired leases from disconnected agents", async () => {
      // Agent 1 acquires several leases
      await leaseManager1.acquireLease({ path: "file1.ts", type: "file" });
      await leaseManager1.acquireLease({ path: "file2.ts", type: "file" });

      // Sync to agent 2
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Manually expire the leases
      const allLeases = state2.getAllLeases();
      allLeases.forEach((lease, path) => {
        if (lease.holder === "agent-1") {
          state2.setLease(path, {
            ...lease,
            expires: Date.now() - 1000, // Expired
          });
        }
      });

      // Cleanup expired leases
      const cleaned = state2.cleanupExpiredLeases();
      expect(cleaned).toBe(2);

      // Agent 2 should be able to acquire the files now
      const acquired1 = await leaseManager2.acquireLease({
        path: "file1.ts",
        type: "file",
      });
      const acquired2 = await leaseManager2.acquireLease({
        path: "file2.ts",
        type: "file",
      });

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
    });

    it("should handle agent reconnection", () => {
      // Agent 1 sets initial work
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

      // Sync to agent 2
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 1 disconnects (simulated by removing active work)
      state1.removeActiveWork("agent-1");

      // Sync disconnect to agent 2
      update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      expect(state2.getActiveWork("agent-1")).toBeUndefined();

      // Agent 1 reconnects and sets new work
      state1.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: ["#2"],
        specs: [],
        files: [],
        status: "Back online",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      // Sync reconnection to agent 2
      update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      const reconnectedWork = state2.getActiveWork("agent-1");
      expect(reconnectedWork).toBeDefined();
      expect(reconnectedWork?.issues).toEqual(["#2"]);
    });
  });

  describe("State Vector Synchronization", () => {
    it("should efficiently sync only missing updates", () => {
      // Agent 1 makes multiple updates
      state1.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: [],
        specs: [],
        files: [],
        status: "Update 1",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      // Sync first update
      let update = state1.getStateAsUpdate();
      state2.applyUpdate(update);

      // Agent 1 makes more updates
      state1.setActiveWork("agent-1", {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: [],
        status: "Update 2",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      });

      // Get state vector from agent 2
      const stateVector = state2.getStateVector();

      // Encode only missing updates
      const diff = state1.encodeStateAsUpdate(stateVector);

      // Apply diff to agent 2
      state2.applyUpdate(diff);

      // Agent 2 should have latest state
      const work = state2.getActiveWork("agent-1");
      expect(work?.status).toBe("Update 2");
      expect(work?.issues).toEqual(["#1"]);
    });
  });
});
