/**
 * libp2p network initialization and connection management
 */

import { createLibp2p, Libp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { kadDHT } from "@libp2p/kad-dht";
import { multiaddr } from "@multiformats/multiaddr";
import { PeerInfo, PeerConnectionStatus } from "./types.js";

export interface NetworkOptions {
  listenAddresses?: string[];
  enableDHT?: boolean;
}

export class P2PNetwork {
  private node?: Libp2p;
  private connections: Map<string, PeerConnectionStatus> = new Map();
  private eventHandlers: Map<string, Function[]> = new Map();

  /**
   * Initialize libp2p node
   */
  async initialize(options: NetworkOptions = {}): Promise<void> {
    const listenAddresses = options.listenAddresses || [
      "/ip4/0.0.0.0/tcp/0",
      "/ip4/0.0.0.0/tcp/0/ws",
    ];

    try {
      this.node = await createLibp2p({
        addresses: {
          listen: listenAddresses,
        },
        transports: [tcp(), webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          pubsub: gossipsub({
            allowPublishToZeroTopicPeers: false,
            emitSelf: false,
          }) as any,
          ...(options.enableDHT && {
            dht: kadDHT() as any,
          }),
        },
      });

      // Setup event listeners
      this.setupEventListeners();

      console.log("libp2p node initialized");
      console.log("Listening on:", this.node.getMultiaddrs());
    } catch (error) {
      throw new Error(
        `Failed to initialize libp2p node: ${(error as Error).message}`
      );
    }
  }

  /**
   * Setup libp2p event listeners
   */
  private setupEventListeners(): void {
    if (!this.node) return;

    this.node.addEventListener("peer:connect", (event) => {
      const peerId = event.detail.toString();
      console.log(`Connected to peer: ${peerId}`);

      this.connections.set(peerId, {
        peerId,
        agentId: "", // Will be set when agent metadata is received
        status: "connected",
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      });

      this.emit("peer-connected", { peerId });
    });

    this.node.addEventListener("peer:disconnect", (event) => {
      const peerId = event.detail.toString();
      console.log(`Disconnected from peer: ${peerId}`);

      const connection = this.connections.get(peerId);
      if (connection) {
        connection.status = "disconnected";
      }

      this.emit("peer-disconnected", { peerId });
    });
  }

  /**
   * Connect to peers from discovered peer info
   */
  async connectToPeers(peers: Map<string, PeerInfo>): Promise<void> {
    if (!this.node) {
      throw new Error("Node not initialized");
    }

    const connectionPromises: Promise<void>[] = [];

    for (const [agentId, peerInfo] of peers) {
      // Try each multiaddr until one succeeds
      for (const addr of peerInfo.multiaddrs) {
        const promise = this.connectToPeer(agentId, addr)
          .then(() => {
            console.log(`Connected to ${agentId} via ${addr}`);
          })
          .catch((error) => {
            console.warn(`Failed to connect to ${agentId} via ${addr}:`, error);
          });

        connectionPromises.push(promise);
        break; // Try only first address for now
      }
    }

    await Promise.allSettled(connectionPromises);
  }

  /**
   * Connect to a single peer
   */
  async connectToPeer(agentId: string, address: string): Promise<void> {
    if (!this.node) {
      throw new Error("Node not initialized");
    }

    try {
      const ma = multiaddr(address);
      await this.node.dial(ma);

      this.emit("peer-discovered", { agentId, address });
    } catch (error) {
      throw new Error(
        `Failed to connect to peer ${agentId}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Subscribe to a pubsub topic
   */
  async subscribe(
    topic: string,
    handler: (message: { from: string; data: Uint8Array }) => void
  ): Promise<void> {
    if (!this.node) {
      throw new Error("Node not initialized");
    }

    const pubsub = this.node.services.pubsub as any;
    if (!pubsub) {
      throw new Error("Pubsub not initialized");
    }

    pubsub.addEventListener("message", (event: any) => {
      if (event.detail.topic === topic) {
        handler({
          from: event.detail.from.toString(),
          data: event.detail.data,
        });
      }
    });

    pubsub.subscribe(topic);
    console.log(`Subscribed to topic: ${topic}`);
  }

  /**
   * Publish to a pubsub topic
   */
  async publish(topic: string, data: Uint8Array): Promise<void> {
    if (!this.node) {
      throw new Error("Node not initialized");
    }

    const pubsub = this.node.services.pubsub as any;
    if (!pubsub) {
      throw new Error("Pubsub not initialized");
    }

    await pubsub.publish(topic, data);
  }

  /**
   * Get node's multiaddrs
   */
  getMultiaddrs(): string[] {
    if (!this.node) {
      return [];
    }

    return this.node.getMultiaddrs().map((ma) => ma.toString());
  }

  /**
   * Get node's peer ID
   */
  getPeerId(): string {
    if (!this.node) {
      throw new Error("Node not initialized");
    }

    return this.node.peerId.toString();
  }

  /**
   * Get connected peers
   */
  getConnectedPeers(): PeerConnectionStatus[] {
    return Array.from(this.connections.values()).filter(
      (conn) => conn.status === "connected"
    );
  }

  /**
   * Check if node is started
   */
  isStarted(): boolean {
    return !!this.node;
  }

  /**
   * Stop the libp2p node
   */
  async stop(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      console.log("libp2p node stopped");
    }
  }

  /**
   * Register event handler
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Emit event
   */
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }
}
