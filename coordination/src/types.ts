/**
 * Type definitions for P2P Agent Coordination System
 */

/**
 * Peer connection information published to Git
 */
export interface PeerInfo {
  agentId: string;
  multiaddrs: string[];
  publicKey: string;
  capabilities: string[];
  lastSeen: string;
  ttl: number;
}

/**
 * Active work tracked for each agent in CRDT
 */
export interface ActiveWork {
  agentId: string;
  issues: string[];
  specs: string[];
  files: string[];
  status: string;
  startedAt: number;
  lastHeartbeat: number;
  metadata: Record<string, any>;
}

/**
 * Checklist item status
 */
export interface ChecklistItem {
  status: "pending" | "in-progress" | "completed" | "blocked";
  completedAt?: number;
  note?: string;
}

/**
 * Temporary issue updates visible to all agents
 */
export interface IssueUpdate {
  agentId: string;
  issueId: string;
  tempTitle?: string;
  tempDescription?: string;
  tempLabels?: string[];
  tempAssignees?: string[];
  tempChecklist?: Record<string, ChecklistItem>;
  lastModified: number;
  version: number;
}

/**
 * Temporary specification updates visible to all agents
 */
export interface SpecUpdate {
  agentId: string;
  specPath: string;
  tempDiff?: string;
  tempContent?: string;
  tempSections?: Record<string, string>;
  lastModified: number;
  version: number;
}

/**
 * Resource lease for distributed locking
 */
export interface Lease {
  holder: string;
  resourcePath: string;
  leaseType: "file" | "issue" | "spec" | "component";
  acquiredAt: number;
  expires: number;
  renewable: boolean;
  priority: number;
  metadata?: Record<string, any>;
}

/**
 * Diff hunk for file changes
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Real-time file changes (optional feature)
 */
export interface FileDiff {
  agentId: string;
  filePath: string;
  hunks: DiffHunk[];
  lastModified: number;
}

/**
 * Agent metadata for presence tracking
 */
export interface AgentMetadata {
  agentId: string;
  hostname?: string;
  platform?: string;
  version?: string;
  capabilities: string[];
  connectedAt: number;
  lastSeen: number;
}

/**
 * Conflict detection result
 */
export interface Conflict {
  type: "file" | "issue" | "spec";
  resource: string;
  holder: string;
  expiresIn?: number;
}

/**
 * Resource to acquire lease for
 */
export interface LeaseRequest {
  path: string;
  type: "file" | "issue" | "spec" | "component";
  priority?: number;
  metadata?: Record<string, any>;
}

/**
 * Coordination agent configuration
 */
export interface CoordinationConfig {
  agentId: string;
  gitRemote: string;
  coordinationBranch: string;
  peerDiscoveryInterval: number;
  heartbeatInterval: number;
  leaseTTL: number;
  capabilities: string[];
  listenAddresses: string[];
  enableFileDiffs: boolean;
}

/**
 * Agent status
 */
export type AgentStatus =
  | "initializing"
  | "connecting"
  | "syncing"
  | "active"
  | "disconnected"
  | "error";

/**
 * Coordination event types
 */
export type CoordinationEventType =
  | "peer-discovered"
  | "peer-connected"
  | "peer-disconnected"
  | "lease-acquired"
  | "lease-renewed"
  | "lease-released"
  | "lease-expired"
  | "conflict-detected"
  | "sync-completed"
  | "heartbeat-sent"
  | "work-started"
  | "work-completed";

/**
 * Coordination event
 */
export interface CoordinationEvent {
  type: CoordinationEventType;
  agentId: string;
  timestamp: number;
  data: any;
}

/**
 * Peer connection status
 */
export interface PeerConnectionStatus {
  peerId: string;
  agentId: string;
  status: "connecting" | "connected" | "disconnected";
  multiaddr?: string;
  connectedAt?: number;
  lastSeen?: number;
  latency?: number;
}
