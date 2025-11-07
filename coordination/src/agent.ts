/**
 * Main coordination agent that orchestrates all components
 */

import * as os from "os";
import * as crypto from "crypto";
import { PeerDiscovery } from "./peer-discovery.js";
import { P2PNetwork } from "./network.js";
import { CRDTState } from "./crdt-state.js";
import { YjsLibp2pSync } from "./sync.js";
import { LeaseManager } from "./lease-manager.js";
import {
  CoordinationConfig,
  AgentStatus,
  PeerInfo,
  ActiveWork,
  AgentMetadata,
} from "./types.js";

export class CoordinationAgent {
  private config: CoordinationConfig;
  private peerDiscovery: PeerDiscovery;
  private network: P2PNetwork;
  private state: CRDTState;
  private sync: YjsLibp2pSync;
  private leaseManager: LeaseManager;
  private status: AgentStatus = "initializing";
  private heartbeatTimer?: NodeJS.Timeout;
  private peerInfoUpdateTimer?: NodeJS.Timeout;

  constructor(config: CoordinationConfig) {
    this.config = config;

    // Initialize components
    this.peerDiscovery = new PeerDiscovery({
      repoPath: process.cwd(),
      coordinationBranch: config.coordinationBranch,
      agentId: config.agentId,
      refreshInterval: config.peerDiscoveryInterval,
    });

    this.network = new P2PNetwork();
    this.state = new CRDTState();
    this.sync = new YjsLibp2pSync(this.network, this.state, config.agentId);

    this.leaseManager = new LeaseManager(this.state, {
      agentId: config.agentId,
      defaultLeaseTTL: config.leaseTTL,
      renewalInterval: config.leaseTTL / 2,
    });
  }

  /**
   * Start the coordination agent
   */
  async start(): Promise<void> {
    try {
      console.log(`Starting coordination agent: ${this.config.agentId}`);
      this.status = "initializing";

      // 1. Initialize peer discovery (Git)
      console.log("Initializing peer discovery...");
      await this.peerDiscovery.initialize();

      // 2. Initialize libp2p network
      console.log("Initializing P2P network...");
      this.status = "connecting";
      await this.network.initialize({
        listenAddresses: this.config.listenAddresses,
        enableDHT: true,
      });

      // 3. Publish our peer info
      console.log("Publishing peer info...");
      await this.publishPeerInfo();

      // 4. Fetch peers from Git
      console.log("Discovering peers...");
      const peers = await this.peerDiscovery.fetchPeers();
      console.log(`Discovered ${peers.size} peers`);

      // 5. Connect to peers
      if (peers.size > 0) {
        console.log("Connecting to peers...");
        await this.network.connectToPeers(peers);
      }

      // 6. Initialize Yjs sync
      console.log("Initializing CRDT synchronization...");
      this.status = "syncing";
      await this.sync.initialize();

      // 7. Request initial state sync
      console.log("Requesting initial state sync...");
      await this.sync.requestInitialSync();

      // Wait a bit for sync responses
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 8. Register our agent metadata
      console.log("Registering agent metadata...");
      this.registerAgentMetadata();

      // 9. Start periodic tasks
      console.log("Starting periodic tasks...");
      this.startHeartbeat();
      this.startPeerInfoUpdates();
      this.startPeerDiscovery();
      this.sync.startLeaseCleanup();

      this.status = "active";
      console.log("Coordination agent started successfully");
    } catch (error) {
      this.status = "error";
      throw new Error(
        `Failed to start coordination agent: ${(error as Error).message}`
      );
    }
  }

  /**
   * Stop the coordination agent
   */
  async stop(): Promise<void> {
    try {
      console.log("Stopping coordination agent...");

      // Stop periodic tasks
      this.stopHeartbeat();
      this.stopPeerInfoUpdates();
      this.peerDiscovery.stopPeriodicDiscovery();

      // Release all leases
      console.log("Releasing all leases...");
      await this.leaseManager.releaseAllLeases();

      // Remove our active work
      this.state.removeActiveWork(this.config.agentId);
      this.state.removeAgentMetadata(this.config.agentId);

      // Remove peer info from Git
      console.log("Removing peer info...");
      await this.peerDiscovery.removePeerInfo();

      // Stop network
      console.log("Stopping P2P network...");
      await this.network.stop();

      this.status = "disconnected";
      console.log("Coordination agent stopped");
    } catch (error) {
      console.error(`Error stopping coordination agent: ${(error as Error).message}`);
    }
  }

  /**
   * Publish peer info to Git
   */
  private async publishPeerInfo(): Promise<void> {
    const multiaddrs = this.network.getMultiaddrs();

    const peerInfo: PeerInfo = {
      agentId: this.config.agentId,
      multiaddrs,
      publicKey: "", // TODO: Get from libp2p
      capabilities: this.config.capabilities,
      lastSeen: new Date().toISOString(),
      ttl: this.config.peerDiscoveryInterval * 2, // 2x discovery interval
    };

    await this.peerDiscovery.publishPeerInfo(peerInfo);
  }

  /**
   * Start periodic peer info updates
   */
  private startPeerInfoUpdates(): void {
    // Update peer info every 30 seconds
    this.peerInfoUpdateTimer = setInterval(() => {
      this.publishPeerInfo().catch((error) =>
        console.error("Failed to update peer info:", error)
      );
    }, 30000);
  }

  /**
   * Stop peer info updates
   */
  private stopPeerInfoUpdates(): void {
    if (this.peerInfoUpdateTimer) {
      clearInterval(this.peerInfoUpdateTimer);
      this.peerInfoUpdateTimer = undefined;
    }
  }

  /**
   * Register agent metadata
   */
  private registerAgentMetadata(): void {
    const metadata: AgentMetadata = {
      agentId: this.config.agentId,
      hostname: os.hostname(),
      platform: os.platform(),
      version: "0.1.0", // TODO: Get from package.json
      capabilities: this.config.capabilities,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };

    this.state.setAgentMetadata(this.config.agentId, metadata);
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    // Send heartbeat every 15 seconds
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    // Update agent metadata last seen
    const metadata = this.state.getAgentMetadata(this.config.agentId);
    if (metadata) {
      metadata.lastSeen = Date.now();
      this.state.setAgentMetadata(this.config.agentId, metadata);
    }

    // Update active work heartbeat
    this.state.updateHeartbeat(this.config.agentId);
  }

  /**
   * Start periodic peer discovery
   */
  private startPeerDiscovery(): void {
    this.peerDiscovery.startPeriodicDiscovery(async (peers) => {
      console.log(`Discovered ${peers.size} peers`);

      // Connect to new peers
      await this.network.connectToPeers(peers);
    });
  }

  /**
   * Set active work
   */
  setActiveWork(work: Omit<ActiveWork, "agentId" | "lastHeartbeat">): void {
    const activeWork: ActiveWork = {
      ...work,
      agentId: this.config.agentId,
      lastHeartbeat: Date.now(),
    };

    this.state.setActiveWork(this.config.agentId, activeWork);
  }

  /**
   * Clear active work
   */
  clearActiveWork(): void {
    this.state.removeActiveWork(this.config.agentId);
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.config.agentId;
  }

  /**
   * Get CRDT state
   */
  getState(): CRDTState {
    return this.state;
  }

  /**
   * Get lease manager
   */
  getLeaseManager(): LeaseManager {
    return this.leaseManager;
  }

  /**
   * Get network
   */
  getNetwork(): P2PNetwork {
    return this.network;
  }

  /**
   * Get connected peers
   */
  getConnectedPeers() {
    return this.network.getConnectedPeers();
  }

  /**
   * Get all agents' active work
   */
  getAllActiveWork() {
    return this.state.getAllActiveWork();
  }

  /**
   * Get all agents' metadata
   */
  getAllAgentMetadata() {
    return this.state.getAllAgentMetadata();
  }
}

/**
 * Generate a unique agent ID
 */
export function generateAgentId(prefix: string = "agent"): string {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, "-");
  const randomId = crypto.randomBytes(6).toString("hex");
  return `${prefix}-${hostname}-${randomId}`;
}

/**
 * Create default coordination config
 */
export function createDefaultConfig(
  agentId?: string,
  options: Partial<CoordinationConfig> = {}
): CoordinationConfig {
  return {
    agentId: agentId || generateAgentId(),
    gitRemote: "origin",
    coordinationBranch: "coordination",
    peerDiscoveryInterval: 60000, // 60 seconds
    heartbeatInterval: 15000, // 15 seconds
    leaseTTL: 300000, // 5 minutes
    capabilities: ["code", "review", "test"],
    listenAddresses: ["/ip4/0.0.0.0/tcp/0", "/ip4/0.0.0.0/tcp/0/ws"],
    enableFileDiffs: false,
    ...options,
  };
}
