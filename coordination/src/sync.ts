/**
 * Yjs-libp2p synchronization bridge
 */

import { P2PNetwork } from "./network.js";
import { CRDTState } from "./crdt-state.js";
import { toString as uint8ArrayToString, fromString as uint8ArrayFromString } from "uint8arrays";

const SYNC_TOPIC = "sudocode/sync";
const SYNC_REQUEST_TOPIC = "sudocode/sync-requests";

interface SyncMessage {
  type: "update" | "sync-request" | "sync-response";
  agentId: string;
  data: number[]; // Uint8Array as number array for JSON serialization
}

export class YjsLibp2pSync {
  private network: P2PNetwork;
  private state: CRDTState;
  private agentId: string;
  private isInitialized = false;

  constructor(network: P2PNetwork, state: CRDTState, agentId: string) {
    this.network = network;
    this.state = state;
    this.agentId = agentId;
  }

  /**
   * Initialize synchronization
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Subscribe to sync topic
    await this.network.subscribe(SYNC_TOPIC, this.handleSyncMessage.bind(this));

    // Subscribe to sync request topic
    await this.network.subscribe(
      SYNC_REQUEST_TOPIC,
      this.handleSyncRequest.bind(this)
    );

    // Subscribe to direct messages for this agent
    const directTopic = `sudocode/sync-response/${this.agentId}`;
    await this.network.subscribe(
      directTopic,
      this.handleSyncResponse.bind(this)
    );

    // Setup Yjs update handler
    this.state.onUpdate((update: Uint8Array, origin: any) => {
      // Don't broadcast updates we received from the network
      if (origin !== "network") {
        this.broadcastUpdate(update);
      }
    });

    this.isInitialized = true;
    console.log("Yjs-libp2p sync initialized");
  }

  /**
   * Handle sync message from network
   */
  private async handleSyncMessage(message: {
    from: string;
    data: Uint8Array;
  }): Promise<void> {
    try {
      const text = new TextDecoder().decode(message.data);
      const syncMessage: SyncMessage = JSON.parse(text);

      if (syncMessage.type === "update" && syncMessage.agentId !== this.agentId) {
        // Apply update from remote peer
        const update = new Uint8Array(syncMessage.data);
        this.state.applyUpdate(update, "network");
      }
    } catch (error) {
      console.error("Failed to handle sync message:", error);
    }
  }

  /**
   * Handle sync request from network
   */
  private async handleSyncRequest(message: {
    from: string;
    data: Uint8Array;
  }): Promise<void> {
    try {
      const text = new TextDecoder().decode(message.data);
      const syncMessage: SyncMessage = JSON.parse(text);

      if (syncMessage.type === "sync-request") {
        // Compute diff based on remote state vector
        const remoteStateVector = new Uint8Array(syncMessage.data);
        const diff = this.state.encodeStateAsUpdate(remoteStateVector);

        // Send diff back to requester
        const response: SyncMessage = {
          type: "sync-response",
          agentId: this.agentId,
          data: Array.from(diff),
        };

        const responseTopic = `sudocode/sync-response/${syncMessage.agentId}`;
        await this.network.publish(
          responseTopic,
          new TextEncoder().encode(JSON.stringify(response))
        );

        console.log(`Sent sync response to ${syncMessage.agentId}`);
      }
    } catch (error) {
      console.error("Failed to handle sync request:", error);
    }
  }

  /**
   * Handle sync response from network
   */
  private async handleSyncResponse(message: {
    from: string;
    data: Uint8Array;
  }): Promise<void> {
    try {
      const text = new TextDecoder().decode(message.data);
      const syncMessage: SyncMessage = JSON.parse(text);

      if (syncMessage.type === "sync-response") {
        // Apply diff from peer
        const update = new Uint8Array(syncMessage.data);
        this.state.applyUpdate(update, "network");

        console.log(`Applied sync response from ${syncMessage.agentId}`);
      }
    } catch (error) {
      console.error("Failed to handle sync response:", error);
    }
  }

  /**
   * Broadcast update to network
   */
  private async broadcastUpdate(update: Uint8Array): Promise<void> {
    try {
      const message: SyncMessage = {
        type: "update",
        agentId: this.agentId,
        data: Array.from(update),
      };

      await this.network.publish(
        SYNC_TOPIC,
        new TextEncoder().encode(JSON.stringify(message))
      );
    } catch (error) {
      console.error("Failed to broadcast update:", error);
    }
  }

  /**
   * Request initial sync from peers
   */
  async requestInitialSync(): Promise<void> {
    try {
      // Get our current state vector
      const stateVector = this.state.getStateVector();

      const message: SyncMessage = {
        type: "sync-request",
        agentId: this.agentId,
        data: Array.from(stateVector),
      };

      await this.network.publish(
        SYNC_REQUEST_TOPIC,
        new TextEncoder().encode(JSON.stringify(message))
      );

      console.log("Requested initial sync from peers");
    } catch (error) {
      console.error("Failed to request initial sync:", error);
    }
  }

  /**
   * Get current state snapshot (for persistence)
   */
  getStateSnapshot(): Uint8Array {
    return this.state.getStateAsUpdate();
  }

  /**
   * Load state from snapshot
   */
  loadStateSnapshot(snapshot: Uint8Array): void {
    this.state.applyUpdate(snapshot, "snapshot");
    console.log("Loaded state from snapshot");
  }

  /**
   * Save state snapshot to storage
   */
  async saveStateSnapshot(storage: { set: (key: string, value: string) => Promise<void> }): Promise<void> {
    const snapshot = this.getStateSnapshot();
    const base64 = uint8ArrayToString(snapshot, "base64");
    await storage.set("sudocode-crdt-snapshot", base64);
    console.log("Saved state snapshot");
  }

  /**
   * Load state snapshot from storage
   */
  async loadStateSnapshotFromStorage(storage: { get: (key: string) => Promise<string | null> }): Promise<boolean> {
    const base64 = await storage.get("sudocode-crdt-snapshot");
    if (base64) {
      const snapshot = uint8ArrayFromString(base64, "base64");
      this.loadStateSnapshot(snapshot);
      return true;
    }
    return false;
  }

  /**
   * Cleanup expired leases periodically
   */
  startLeaseCleanup(intervalMs: number = 60000): void {
    setInterval(() => {
      const cleaned = this.state.cleanupExpiredLeases();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired leases`);
      }
    }, intervalMs);
  }
}
