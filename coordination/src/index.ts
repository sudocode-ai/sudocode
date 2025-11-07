/**
 * P2P Agent Coordination System
 *
 * This package provides decentralized coordination for software development
 * agents and developers working across distributed repositories.
 */

export { CoordinationAgent, generateAgentId, createDefaultConfig } from "./agent.js";
export { PeerDiscovery } from "./peer-discovery.js";
export { P2PNetwork } from "./network.js";
export { CRDTState } from "./crdt-state.js";
export { YjsLibp2pSync } from "./sync.js";
export { LeaseManager } from "./lease-manager.js";

export type {
  PeerInfo,
  ActiveWork,
  ChecklistItem,
  IssueUpdate,
  SpecUpdate,
  Lease,
  DiffHunk,
  FileDiff,
  AgentMetadata,
  Conflict,
  LeaseRequest,
  CoordinationConfig,
  AgentStatus,
  CoordinationEventType,
  CoordinationEvent,
  PeerConnectionStatus,
} from "./types.js";
