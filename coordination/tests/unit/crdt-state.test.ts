/**
 * Unit tests for CRDT State management
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CRDTState } from "../../src/crdt-state.js";
import type {
  ActiveWork,
  IssueUpdate,
  SpecUpdate,
  Lease,
  AgentMetadata,
} from "../../src/types.js";

describe("CRDTState", () => {
  let state: CRDTState;

  beforeEach(() => {
    state = new CRDTState();
  });

  describe("Active Work", () => {
    it("should set and get active work", () => {
      const work: ActiveWork = {
        agentId: "agent-1",
        issues: ["#1", "#2"],
        specs: ["spec1.md"],
        files: ["src/file.ts"],
        status: "Working on issue #1",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: { branch: "feature/test" },
      };

      state.setActiveWork("agent-1", work);
      const retrieved = state.getActiveWork("agent-1");

      expect(retrieved).toEqual(work);
    });

    it("should get all active work", () => {
      const work1: ActiveWork = {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      const work2: ActiveWork = {
        agentId: "agent-2",
        issues: ["#2"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      state.setActiveWork("agent-1", work1);
      state.setActiveWork("agent-2", work2);

      const allWork = state.getAllActiveWork();
      expect(allWork.size).toBe(2);
      expect(allWork.get("agent-1")).toEqual(work1);
      expect(allWork.get("agent-2")).toEqual(work2);
    });

    it("should remove active work", () => {
      const work: ActiveWork = {
        agentId: "agent-1",
        issues: [],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      state.setActiveWork("agent-1", work);
      expect(state.getActiveWork("agent-1")).toBeDefined();

      state.removeActiveWork("agent-1");
      expect(state.getActiveWork("agent-1")).toBeUndefined();
    });

    it("should update heartbeat", () => {
      const work: ActiveWork = {
        agentId: "agent-1",
        issues: [],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: 1000,
        metadata: {},
      };

      state.setActiveWork("agent-1", work);

      // Wait a bit to ensure timestamp changes
      const before = state.getActiveWork("agent-1")?.lastHeartbeat;
      state.updateHeartbeat("agent-1");
      const after = state.getActiveWork("agent-1")?.lastHeartbeat;

      expect(after).toBeGreaterThan(before!);
    });
  });

  describe("Issue Updates", () => {
    it("should set and get issue updates", () => {
      const update: IssueUpdate = {
        agentId: "agent-1",
        issueId: "#1",
        tempTitle: "Updated title",
        tempDescription: "Updated description",
        lastModified: Date.now(),
        version: 1,
      };

      state.setIssueUpdate("#1", update);
      const retrieved = state.getIssueUpdate("#1");

      expect(retrieved).toEqual(update);
    });

    it("should handle checklist items in issue updates", () => {
      const update: IssueUpdate = {
        agentId: "agent-1",
        issueId: "#1",
        tempChecklist: {
          "task-1": { status: "completed", completedAt: Date.now() },
          "task-2": { status: "in-progress", note: "Working on it" },
        },
        lastModified: Date.now(),
        version: 1,
      };

      state.setIssueUpdate("#1", update);
      const retrieved = state.getIssueUpdate("#1");

      expect(retrieved?.tempChecklist).toBeDefined();
      expect(retrieved?.tempChecklist?.["task-1"].status).toBe("completed");
      expect(retrieved?.tempChecklist?.["task-2"].status).toBe("in-progress");
    });

    it("should remove issue updates", () => {
      const update: IssueUpdate = {
        agentId: "agent-1",
        issueId: "#1",
        lastModified: Date.now(),
        version: 1,
      };

      state.setIssueUpdate("#1", update);
      expect(state.getIssueUpdate("#1")).toBeDefined();

      state.removeIssueUpdate("#1");
      expect(state.getIssueUpdate("#1")).toBeUndefined();
    });
  });

  describe("Spec Updates", () => {
    it("should set and get spec updates", () => {
      const update: SpecUpdate = {
        agentId: "agent-1",
        specPath: "specs/auth.md",
        tempDiff: "+new line\n-old line",
        lastModified: Date.now(),
        version: 1,
      };

      state.setSpecUpdate("specs/auth.md", update);
      const retrieved = state.getSpecUpdate("specs/auth.md");

      expect(retrieved).toEqual(update);
    });

    it("should handle section updates", () => {
      const update: SpecUpdate = {
        agentId: "agent-1",
        specPath: "specs/auth.md",
        tempSections: {
          "authentication": "New auth section content",
          "authorization": "New authz section content",
        },
        lastModified: Date.now(),
        version: 1,
      };

      state.setSpecUpdate("specs/auth.md", update);
      const retrieved = state.getSpecUpdate("specs/auth.md");

      expect(retrieved?.tempSections).toBeDefined();
      expect(retrieved?.tempSections?.["authentication"]).toBe("New auth section content");
    });
  });

  describe("Leases", () => {
    it("should set and get leases", () => {
      const lease: Lease = {
        holder: "agent-1",
        resourcePath: "src/file.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      };

      state.setLease("src/file.ts", lease);
      const retrieved = state.getLease("src/file.ts");

      expect(retrieved).toEqual(lease);
    });

    it("should get leases held by an agent", () => {
      const lease1: Lease = {
        holder: "agent-1",
        resourcePath: "file1.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      };

      const lease2: Lease = {
        holder: "agent-1",
        resourcePath: "file2.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      };

      const lease3: Lease = {
        holder: "agent-2",
        resourcePath: "file3.ts",
        leaseType: "file",
        acquiredAt: Date.now(),
        expires: Date.now() + 300000,
        renewable: true,
        priority: 5,
      };

      state.setLease("file1.ts", lease1);
      state.setLease("file2.ts", lease2);
      state.setLease("file3.ts", lease3);

      const agent1Leases = state.getLeasesHeldBy("agent-1");
      expect(agent1Leases.size).toBe(2);
      expect(agent1Leases.has("file1.ts")).toBe(true);
      expect(agent1Leases.has("file2.ts")).toBe(true);
      expect(agent1Leases.has("file3.ts")).toBe(false);
    });

    it("should cleanup expired leases", () => {
      const now = Date.now();

      const expiredLease: Lease = {
        holder: "agent-1",
        resourcePath: "expired.ts",
        leaseType: "file",
        acquiredAt: now - 400000,
        expires: now - 100000, // Expired 100s ago
        renewable: true,
        priority: 5,
      };

      const validLease: Lease = {
        holder: "agent-1",
        resourcePath: "valid.ts",
        leaseType: "file",
        acquiredAt: now,
        expires: now + 300000, // Expires in 300s
        renewable: true,
        priority: 5,
      };

      state.setLease("expired.ts", expiredLease);
      state.setLease("valid.ts", validLease);

      const cleaned = state.cleanupExpiredLeases();

      expect(cleaned).toBe(1);
      expect(state.getLease("expired.ts")).toBeUndefined();
      expect(state.getLease("valid.ts")).toBeDefined();
    });
  });

  describe("Agent Metadata", () => {
    it("should set and get agent metadata", () => {
      const metadata: AgentMetadata = {
        agentId: "agent-1",
        hostname: "test-host",
        platform: "linux",
        version: "0.1.0",
        capabilities: ["code", "review"],
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      };

      state.setAgentMetadata("agent-1", metadata);
      const retrieved = state.getAgentMetadata("agent-1");

      expect(retrieved).toEqual(metadata);
    });

    it("should get all agent metadata", () => {
      const metadata1: AgentMetadata = {
        agentId: "agent-1",
        capabilities: ["code"],
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      };

      const metadata2: AgentMetadata = {
        agentId: "agent-2",
        capabilities: ["review"],
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      };

      state.setAgentMetadata("agent-1", metadata1);
      state.setAgentMetadata("agent-2", metadata2);

      const allMetadata = state.getAllAgentMetadata();
      expect(allMetadata.size).toBe(2);
    });
  });

  describe("State Serialization", () => {
    it("should encode and decode state", () => {
      const work: ActiveWork = {
        agentId: "agent-1",
        issues: ["#1"],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      state.setActiveWork("agent-1", work);

      // Get state as update
      const update = state.getStateAsUpdate();
      expect(update).toBeInstanceOf(Uint8Array);
      expect(update.length).toBeGreaterThan(0);

      // Create new state and apply update
      const newState = new CRDTState();
      newState.applyUpdate(update);

      const retrieved = newState.getActiveWork("agent-1");
      expect(retrieved?.agentId).toBe("agent-1");
      expect(retrieved?.issues).toEqual(["#1"]);
    });

    it("should get state vector", () => {
      const stateVector = state.getStateVector();
      expect(stateVector).toBeInstanceOf(Uint8Array);
    });

    it("should export to JSON", () => {
      const work: ActiveWork = {
        agentId: "agent-1",
        issues: [],
        specs: [],
        files: [],
        status: "Working",
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        metadata: {},
      };

      state.setActiveWork("agent-1", work);

      const json = state.toJSON();
      expect(json).toHaveProperty("activeWork");
      expect(json).toHaveProperty("leases");
      expect(json).toHaveProperty("issueUpdates");
      expect(Array.isArray(json.activeWork)).toBe(true);
    });
  });
});
