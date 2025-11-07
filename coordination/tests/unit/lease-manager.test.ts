/**
 * Unit tests for Lease Manager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CRDTState } from "../../src/crdt-state.js";
import { LeaseManager } from "../../src/lease-manager.js";
import type { LeaseRequest } from "../../src/types.js";

describe("LeaseManager", () => {
  let state: CRDTState;
  let leaseManager: LeaseManager;

  beforeEach(() => {
    state = new CRDTState();
    leaseManager = new LeaseManager(state, {
      agentId: "agent-1",
      defaultLeaseTTL: 300000, // 5 minutes
      renewalInterval: 150000, // 2.5 minutes
    });
  });

  afterEach(() => {
    leaseManager.stop();
  });

  describe("Lease Acquisition", () => {
    it("should acquire a lease on an available resource", async () => {
      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 5,
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(true);

      const lease = state.getLease("src/file.ts");
      expect(lease).toBeDefined();
      expect(lease?.holder).toBe("agent-1");
      expect(lease?.leaseType).toBe("file");
      expect(lease?.priority).toBe(5);
    });

    it("should fail to acquire a lease on a resource held by another agent", async () => {
      // Agent 2 holds the lease
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 5,
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(false);
    });

    it("should acquire a lease if current holder is the same agent", async () => {
      // Agent 1 already holds the lease
      state.setLease("src/file.ts", {
        holder: "agent-1",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 5,
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(true);
    });

    it("should acquire an expired lease", async () => {
      // Expired lease from agent 2
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now() - 400000,
        expires: Date.now() - 100000, // Expired
        renewable: true,
        priority: 5,
      });

      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 5,
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(true);

      const lease = state.getLease("src/file.ts");
      expect(lease?.holder).toBe("agent-1");
    });

    it("should override lower priority lease with higher priority", async () => {
      // Agent 2 holds lease with priority 3
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 3,
      });

      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 7, // Higher priority
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(true);

      const lease = state.getLease("src/file.ts");
      expect(lease?.holder).toBe("agent-1");
      expect(lease?.priority).toBe(7);
    });

    it("should fail to override higher priority lease", async () => {
      // Agent 2 holds lease with priority 8
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 8,
      });

      const request: LeaseRequest = {
        path: "src/file.ts",
        type: "file",
        priority: 5, // Lower priority
      };

      const acquired = await leaseManager.acquireLease(request);
      expect(acquired).toBe(false);

      const lease = state.getLease("src/file.ts");
      expect(lease?.holder).toBe("agent-2"); // Still held by agent-2
    });
  });

  describe("Lease Release", () => {
    it("should release a lease held by the agent", async () => {
      await leaseManager.acquireLease({
        path: "src/file.ts",
        type: "file",
      });

      const released = await leaseManager.releaseLease("src/file.ts");
      expect(released).toBe(true);

      const lease = state.getLease("src/file.ts");
      expect(lease).toBeUndefined();
    });

    it("should fail to release a lease held by another agent", async () => {
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const released = await leaseManager.releaseLease("src/file.ts");
      expect(released).toBe(false);

      const lease = state.getLease("src/file.ts");
      expect(lease?.holder).toBe("agent-2"); // Still held
    });

    it("should handle releasing non-existent lease", async () => {
      const released = await leaseManager.releaseLease("nonexistent.ts");
      expect(released).toBe(false);
    });
  });

  describe("Lease Renewal", () => {
    it("should renew a lease held by the agent", async () => {
      await leaseManager.acquireLease({
        path: "src/file.ts",
        type: "file",
      });

      const originalLease = state.getLease("src/file.ts");
      const originalExpiry = originalLease?.expires;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const renewed = await leaseManager.renewLease("src/file.ts");
      expect(renewed).toBe(true);

      const renewedLease = state.getLease("src/file.ts");
      expect(renewedLease?.expires).toBeGreaterThan(originalExpiry!);
    });

    it("should fail to renew a lease held by another agent", async () => {
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const renewed = await leaseManager.renewLease("src/file.ts");
      expect(renewed).toBe(false);
    });

    it("should fail to renew a non-renewable lease", async () => {
      state.setLease("src/file.ts", {
        holder: "agent-1",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: false, // Not renewable
        priority: 5,
      });

      const renewed = await leaseManager.renewLease("src/file.ts");
      expect(renewed).toBe(false);
    });
  });

  describe("Conflict Detection", () => {
    it("should detect file conflicts", () => {
      state.setLease("src/file1.ts", {
        holder: "agent-2",
        resourcePath: "src/file1.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const conflicts = leaseManager.checkConflicts(
        ["src/file1.ts", "src/file2.ts"],
        [],
        []
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("file");
      expect(conflicts[0].resource).toBe("src/file1.ts");
      expect(conflicts[0].holder).toBe("agent-2");
    });

    it("should detect issue conflicts", () => {
      state.setIssueUpdate("#1", {
        agentId: "agent-2",
        issueId: "#1",
        lastModified: Date.now(),
        version: 1,
      });

      const conflicts = leaseManager.checkConflicts([], ["#1", "#2"], []);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("issue");
      expect(conflicts[0].resource).toBe("#1");
      expect(conflicts[0].holder).toBe("agent-2");
    });

    it("should detect spec conflicts", () => {
      state.setSpecUpdate("specs/auth.md", {
        agentId: "agent-2",
        specPath: "specs/auth.md",
        lastModified: Date.now(),
        version: 1,
      });

      const conflicts = leaseManager.checkConflicts(
        [],
        [],
        ["specs/auth.md", "specs/api.md"]
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("spec");
      expect(conflicts[0].resource).toBe("specs/auth.md");
      expect(conflicts[0].holder).toBe("agent-2");
    });

    it("should not detect conflicts for expired leases", () => {
      state.setLease("src/file1.ts", {
        holder: "agent-2",
        resourcePath: "src/file1.ts",
        leaseType: "file",
        acquiredAt: Date.now() - 400000,
        expires: Date.now() - 100000, // Expired
        renewable: true,
        priority: 5,
      });

      const conflicts = leaseManager.checkConflicts(["src/file1.ts"], [], []);
      expect(conflicts).toHaveLength(0);
    });

    it("should not detect conflicts for own resources", () => {
      state.setLease("src/file1.ts", {
        holder: "agent-1",
        resourcePath: "src/file1.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      state.setIssueUpdate("#1", {
        agentId: "agent-1",
        issueId: "#1",
        lastModified: Date.now(),
        version: 1,
      });

      const conflicts = leaseManager.checkConflicts(["src/file1.ts"], ["#1"], []);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("Batch Lease Operations", () => {
    it("should acquire multiple leases atomically", async () => {
      const requests: LeaseRequest[] = [
        { path: "src/file1.ts", type: "file" },
        { path: "src/file2.ts", type: "file" },
        { path: "#1", type: "issue" },
      ];

      const acquired = await leaseManager.acquireLeases(requests);
      expect(acquired).toBe(true);

      expect(state.getLease("src/file1.ts")).toBeDefined();
      expect(state.getLease("src/file2.ts")).toBeDefined();
    });

    it("should fail to acquire multiple leases if any conflict", async () => {
      // Agent 2 holds one file
      state.setLease("src/file2.ts", {
        holder: "agent-2",
        resourcePath: "src/file2.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const requests: LeaseRequest[] = [
        { path: "src/file1.ts", type: "file" },
        { path: "src/file2.ts", type: "file" }, // Conflict
        { path: "#1", type: "issue" },
      ];

      const acquired = await leaseManager.acquireLeases(requests);
      expect(acquired).toBe(false);
    });

    it("should release all leases held by agent", async () => {
      await leaseManager.acquireLease({ path: "file1.ts", type: "file" });
      await leaseManager.acquireLease({ path: "file2.ts", type: "file" });
      await leaseManager.acquireLease({ path: "file3.ts", type: "file" });

      expect(state.getLeasesHeldBy("agent-1").size).toBe(3);

      await leaseManager.releaseAllLeases();

      expect(state.getLeasesHeldBy("agent-1").size).toBe(0);
    });
  });

  describe("Resource Availability", () => {
    it("should check if resource is available", () => {
      expect(leaseManager.isResourceAvailable("src/file.ts")).toBe(true);

      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      expect(leaseManager.isResourceAvailable("src/file.ts")).toBe(false);
    });

    it("should consider expired leases as available", () => {
      state.setLease("src/file.ts", {
        holder: "agent-2",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now() - 400000,
        expires: Date.now() - 100000, // Expired
        renewable: true,
        priority: 5,
      });

      expect(leaseManager.isResourceAvailable("src/file.ts")).toBe(true);
    });

    it("should consider own leases as available", () => {
      state.setLease("src/file.ts", {
        holder: "agent-1",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      expect(leaseManager.isResourceAvailable("src/file.ts")).toBe(true);
    });
  });

  describe("Get Leases", () => {
    it("should get all leases held by agent", async () => {
      await leaseManager.acquireLease({ path: "file1.ts", type: "file" });
      await leaseManager.acquireLease({ path: "file2.ts", type: "file" });

      const myLeases = leaseManager.getMyLeases();
      expect(myLeases.size).toBe(2);
      expect(myLeases.has("file1.ts")).toBe(true);
      expect(myLeases.has("file2.ts")).toBe(true);
    });

    it("should get specific lease", async () => {
      await leaseManager.acquireLease({ path: "file.ts", type: "file" });

      const lease = leaseManager.getLease("file.ts");
      expect(lease).toBeDefined();
      expect(lease?.holder).toBe("agent-1");
    });
  });

  describe("Event Handling", () => {
    it("should emit lease-acquired event", async () => {
      const handler = vi.fn();
      leaseManager.on("lease-acquired", handler);

      await leaseManager.acquireLease({ path: "file.ts", type: "file" });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "file.ts",
          lease: expect.any(Object),
        })
      );
    });

    it("should emit lease-released event", async () => {
      await leaseManager.acquireLease({ path: "file.ts", type: "file" });

      const handler = vi.fn();
      leaseManager.on("lease-released", handler);

      await leaseManager.releaseLease("file.ts");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "file.ts",
        })
      );
    });

    it("should emit lease-renewed event", async () => {
      await leaseManager.acquireLease({ path: "file.ts", type: "file" });

      const handler = vi.fn();
      leaseManager.on("lease-renewed", handler);

      await leaseManager.renewLease("file.ts");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "file.ts",
          lease: expect.any(Object),
        })
      );
    });

    it("should emit conflicts-detected event", async () => {
      state.setLease("file.ts", {
        holder: "agent-2",
        resourcePath: "file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      });

      const handler = vi.fn();
      leaseManager.on("conflicts-detected", handler);

      await leaseManager.acquireLeases([{ path: "file.ts", type: "file" }]);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          conflicts: expect.arrayContaining([
            expect.objectContaining({
              type: "file",
              resource: "file.ts",
              holder: "agent-2",
            }),
          ]),
        })
      );
    });
  });
});
