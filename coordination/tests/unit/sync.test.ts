/**
 * Unit tests for YjsLibp2pSync
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CRDTState } from "../../src/crdt-state.js";
import { YjsLibp2pSync } from "../../src/sync.js";

// Mock P2PNetwork
class MockP2PNetwork {
  private subscriptions: Map<string, Function> = new Map();
  private publishedMessages: Array<{ topic: string; data: Uint8Array }> = [];

  async subscribe(topic: string, handler: Function): Promise<void> {
    this.subscriptions.set(topic, handler);
  }

  async publish(topic: string, data: Uint8Array): Promise<void> {
    this.publishedMessages.push({ topic, data });
  }

  // Test helpers
  simulateMessage(topic: string, data: Uint8Array, from: string = "peer-1") {
    const handler = this.subscriptions.get(topic);
    if (handler) {
      handler({ from, data });
    }
  }

  getPublishedMessages() {
    return this.publishedMessages;
  }

  clearPublishedMessages() {
    this.publishedMessages = [];
  }
}

describe("YjsLibp2pSync", () => {
  let state1: CRDTState;
  let state2: CRDTState;
  let network1: MockP2PNetwork;
  let network2: MockP2PNetwork;
  let sync1: YjsLibp2pSync;
  let sync2: YjsLibp2pSync;

  beforeEach(() => {
    state1 = new CRDTState();
    state2 = new CRDTState();
    network1 = new MockP2PNetwork();
    network2 = new MockP2PNetwork();
    sync1 = new YjsLibp2pSync(network1 as any, state1, "agent-1");
    sync2 = new YjsLibp2pSync(network2 as any, state2, "agent-2");
  });

  describe("Initialization", () => {
    it("should subscribe to sync topics on initialization", async () => {
      await sync1.initialize();

      // Check subscriptions were created
      expect(network1["subscriptions"].has("sudocode/sync")).toBe(true);
      expect(network1["subscriptions"].has("sudocode/sync-requests")).toBe(true);
      expect(network1["subscriptions"].has("sudocode/sync-response/agent-1")).toBe(true);
    });
  });

  describe("State Updates", () => {
    it("should broadcast updates when local state changes", async () => {
      await sync1.initialize();
      network1.clearPublishedMessages();

      // Make a local change
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

      // Should have published an update
      const messages = network1.getPublishedMessages();
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].topic).toBe("sudocode/sync");
    });

    it("should not broadcast updates received from network", async () => {
      await sync1.initialize();

      // Create an update in state2
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

      const update = state2.getStateAsUpdate();

      network1.clearPublishedMessages();

      // Simulate receiving the update from network
      const syncMessage = {
        type: "update",
        agentId: "agent-2",
        data: Array.from(update),
      };

      network1.simulateMessage(
        "sudocode/sync",
        new TextEncoder().encode(JSON.stringify(syncMessage))
      );

      // Should not re-broadcast (avoid infinite loop)
      const messages = network1.getPublishedMessages();
      expect(messages.length).toBe(0);
    });

    it("should apply updates from other agents", async () => {
      await sync1.initialize();
      await sync2.initialize();

      // Agent 2 makes a change
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

      // Get the update and simulate receiving it on agent 1
      const update = state2.getStateAsUpdate();
      const syncMessage = {
        type: "update",
        agentId: "agent-2",
        data: Array.from(update),
      };

      network1.simulateMessage(
        "sudocode/sync",
        new TextEncoder().encode(JSON.stringify(syncMessage))
      );

      // Agent 1 should now have agent 2's work
      const work = state1.getActiveWork("agent-2");
      expect(work).toBeDefined();
      expect(work?.agentId).toBe("agent-2");
      expect(work?.issues).toEqual(["#2"]);
    });
  });

  describe("Initial Sync", () => {
    it("should request initial sync from peers", async () => {
      await sync1.initialize();
      network1.clearPublishedMessages();

      await sync1.requestInitialSync();

      const messages = network1.getPublishedMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].topic).toBe("sudocode/sync-requests");

      const message = JSON.parse(new TextDecoder().decode(messages[0].data));
      expect(message.type).toBe("sync-request");
      expect(message.agentId).toBe("agent-1");
      expect(Array.isArray(message.data)).toBe(true);
    });

    it("should respond to sync requests from other agents", async () => {
      await sync1.initialize();

      // Agent 1 has some state
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

      network1.clearPublishedMessages();

      // Simulate sync request from agent 2
      const stateVector = state2.getStateVector();
      const syncRequest = {
        type: "sync-request",
        agentId: "agent-2",
        data: Array.from(stateVector),
      };

      network1.simulateMessage(
        "sudocode/sync-requests",
        new TextEncoder().encode(JSON.stringify(syncRequest))
      );

      // Should have published a response
      const messages = network1.getPublishedMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].topic).toBe("sudocode/sync-response/agent-2");

      const response = JSON.parse(new TextDecoder().decode(messages[0].data));
      expect(response.type).toBe("sync-response");
      expect(response.agentId).toBe("agent-1");
      expect(Array.isArray(response.data)).toBe(true);
    });

    it("should apply sync response updates", async () => {
      await sync2.initialize();

      // Agent 1 has state
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

      // Get state diff
      const stateVector = state2.getStateVector();
      const diff = state1.encodeStateAsUpdate(stateVector);

      // Simulate sync response
      const syncResponse = {
        type: "sync-response",
        agentId: "agent-1",
        data: Array.from(diff),
      };

      network2.simulateMessage(
        "sudocode/sync-response/agent-2",
        new TextEncoder().encode(JSON.stringify(syncResponse))
      );

      // Agent 2 should now have agent 1's state
      const work = state2.getActiveWork("agent-1");
      expect(work).toBeDefined();
      expect(work?.agentId).toBe("agent-1");
    });
  });

  describe("State Snapshots", () => {
    it("should get state snapshot", async () => {
      await sync1.initialize();

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

      const snapshot = sync1.getStateSnapshot();
      expect(snapshot).toBeInstanceOf(Uint8Array);
      expect(snapshot.length).toBeGreaterThan(0);
    });

    it("should load state from snapshot", async () => {
      await sync1.initialize();

      // Create state and snapshot
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

      const snapshot = sync1.getStateSnapshot();

      // Load into new sync instance
      await sync2.initialize();
      sync2.loadStateSnapshot(snapshot);

      // Should have the state
      const work = state2.getActiveWork("agent-1");
      expect(work).toBeDefined();
      expect(work?.agentId).toBe("agent-1");
    });

    it("should save and load snapshot from storage", async () => {
      await sync1.initialize();

      // Mock storage
      const storage = new Map<string, string>();
      const mockStorage = {
        set: async (key: string, value: string) => {
          storage.set(key, value);
        },
        get: async (key: string) => {
          return storage.get(key) || null;
        },
      };

      // Create state
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

      // Save snapshot
      await sync1.saveStateSnapshot(mockStorage);
      expect(storage.has("sudocode-crdt-snapshot")).toBe(true);

      // Load into new instance
      await sync2.initialize();
      const loaded = await sync2.loadStateSnapshotFromStorage(mockStorage);
      expect(loaded).toBe(true);

      const work = state2.getActiveWork("agent-1");
      expect(work).toBeDefined();
    });
  });

  describe("Lease Cleanup", () => {
    it("should start periodic lease cleanup", async () => {
      await sync1.initialize();

      // Add expired lease
      state1.setLease("expired.ts", {
        holder: "agent-1",
        resourcePath: "expired.ts",
        leaseType: "file",
        acquiredAt: Date.now() - 400000,
        expires: Date.now() - 100000,
        renewable: true,
        priority: 5,
      });

      // Start cleanup with short interval for testing
      sync1.startLeaseCleanup(100);

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Lease should be cleaned up
      expect(state1.getLease("expired.ts")).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed sync messages gracefully", async () => {
      await sync1.initialize();

      // Simulate malformed message
      network1.simulateMessage(
        "sudocode/sync",
        new TextEncoder().encode("not valid json")
      );

      // Should not throw or crash
      expect(state1.getAllActiveWork().size).toBe(0);
    });

    it("should ignore updates from self", async () => {
      await sync1.initialize();

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

      const update = state1.getStateAsUpdate();

      // Simulate receiving own update
      const syncMessage = {
        type: "update",
        agentId: "agent-1", // Same agent!
        data: Array.from(update),
      };

      const workBefore = state1.getAllActiveWork().size;

      network1.simulateMessage(
        "sudocode/sync",
        new TextEncoder().encode(JSON.stringify(syncMessage))
      );

      // Should not cause duplicate data
      const workAfter = state1.getAllActiveWork().size;
      expect(workAfter).toBe(workBefore);
    });
  });
});
