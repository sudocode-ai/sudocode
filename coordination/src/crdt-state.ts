/**
 * Yjs CRDT document structure and state management
 */

import * as Y from "yjs";
import {
  ActiveWork,
  IssueUpdate,
  SpecUpdate,
  Lease,
  FileDiff,
  AgentMetadata,
} from "./types.js";

export class CRDTState {
  private ydoc: Y.Doc;
  private activeWork: Y.Map<any>;
  private issueUpdates: Y.Map<any>;
  private specUpdates: Y.Map<any>;
  private leases: Y.Map<any>;
  private fileDiffs: Y.Map<any>;
  private agentMetadata: Y.Map<any>;

  constructor() {
    this.ydoc = new Y.Doc();

    // Initialize shared maps
    this.activeWork = this.ydoc.getMap("activeWork");
    this.issueUpdates = this.ydoc.getMap("issueUpdates");
    this.specUpdates = this.ydoc.getMap("specUpdates");
    this.leases = this.ydoc.getMap("leases");
    this.fileDiffs = this.ydoc.getMap("fileDiffs");
    this.agentMetadata = this.ydoc.getMap("agentMetadata");
  }

  /**
   * Get the Yjs document
   */
  getDoc(): Y.Doc {
    return this.ydoc;
  }

  // ===== Active Work =====

  /**
   * Set active work for an agent
   */
  setActiveWork(agentId: string, work: ActiveWork): void {
    this.activeWork.set(agentId, work);
  }

  /**
   * Get active work for an agent
   */
  getActiveWork(agentId: string): ActiveWork | undefined {
    return this.activeWork.get(agentId);
  }

  /**
   * Get all active work
   */
  getAllActiveWork(): Map<string, ActiveWork> {
    const result = new Map<string, ActiveWork>();
    this.activeWork.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove active work for an agent
   */
  removeActiveWork(agentId: string): void {
    this.activeWork.delete(agentId);
  }

  /**
   * Update heartbeat for an agent
   */
  updateHeartbeat(agentId: string): void {
    const work = this.getActiveWork(agentId);
    if (work) {
      work.lastHeartbeat = Date.now();
      this.setActiveWork(agentId, work);
    }
  }

  // ===== Issue Updates =====

  /**
   * Set issue update
   */
  setIssueUpdate(issueId: string, update: IssueUpdate): void {
    this.issueUpdates.set(issueId, update);
  }

  /**
   * Get issue update
   */
  getIssueUpdate(issueId: string): IssueUpdate | undefined {
    return this.issueUpdates.get(issueId);
  }

  /**
   * Get all issue updates
   */
  getAllIssueUpdates(): Map<string, IssueUpdate> {
    const result = new Map<string, IssueUpdate>();
    this.issueUpdates.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove issue update
   */
  removeIssueUpdate(issueId: string): void {
    this.issueUpdates.delete(issueId);
  }

  // ===== Spec Updates =====

  /**
   * Set spec update
   */
  setSpecUpdate(specPath: string, update: SpecUpdate): void {
    this.specUpdates.set(specPath, update);
  }

  /**
   * Get spec update
   */
  getSpecUpdate(specPath: string): SpecUpdate | undefined {
    return this.specUpdates.get(specPath);
  }

  /**
   * Get all spec updates
   */
  getAllSpecUpdates(): Map<string, SpecUpdate> {
    const result = new Map<string, SpecUpdate>();
    this.specUpdates.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove spec update
   */
  removeSpecUpdate(specPath: string): void {
    this.specUpdates.delete(specPath);
  }

  // ===== Leases =====

  /**
   * Set lease
   */
  setLease(resourcePath: string, lease: Lease): void {
    this.leases.set(resourcePath, lease);
  }

  /**
   * Get lease
   */
  getLease(resourcePath: string): Lease | undefined {
    return this.leases.get(resourcePath);
  }

  /**
   * Get all leases
   */
  getAllLeases(): Map<string, Lease> {
    const result = new Map<string, Lease>();
    this.leases.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove lease
   */
  removeLease(resourcePath: string): void {
    this.leases.delete(resourcePath);
  }

  /**
   * Get leases held by an agent
   */
  getLeasesHeldBy(agentId: string): Map<string, Lease> {
    const result = new Map<string, Lease>();
    this.leases.forEach((value: Lease, key) => {
      if (value.holder === agentId) {
        result.set(key, value);
      }
    });
    return result;
  }

  /**
   * Clean up expired leases
   */
  cleanupExpiredLeases(): number {
    const now = Date.now();
    let cleanedCount = 0;

    const expiredKeys: string[] = [];
    this.leases.forEach((value: Lease, key) => {
      if (value.expires < now) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach((key) => {
      this.leases.delete(key);
      cleanedCount++;
    });

    return cleanedCount;
  }

  // ===== File Diffs =====

  /**
   * Set file diff
   */
  setFileDiff(filePath: string, diff: FileDiff): void {
    this.fileDiffs.set(filePath, diff);
  }

  /**
   * Get file diff
   */
  getFileDiff(filePath: string): FileDiff | undefined {
    return this.fileDiffs.get(filePath);
  }

  /**
   * Get all file diffs
   */
  getAllFileDiffs(): Map<string, FileDiff> {
    const result = new Map<string, FileDiff>();
    this.fileDiffs.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove file diff
   */
  removeFileDiff(filePath: string): void {
    this.fileDiffs.delete(filePath);
  }

  // ===== Agent Metadata =====

  /**
   * Set agent metadata
   */
  setAgentMetadata(agentId: string, metadata: AgentMetadata): void {
    this.agentMetadata.set(agentId, metadata);
  }

  /**
   * Get agent metadata
   */
  getAgentMetadata(agentId: string): AgentMetadata | undefined {
    return this.agentMetadata.get(agentId);
  }

  /**
   * Get all agent metadata
   */
  getAllAgentMetadata(): Map<string, AgentMetadata> {
    const result = new Map<string, AgentMetadata>();
    this.agentMetadata.forEach((value, key) => {
      result.set(key, value);
    });
    return result;
  }

  /**
   * Remove agent metadata
   */
  removeAgentMetadata(agentId: string): void {
    this.agentMetadata.delete(agentId);
  }

  // ===== Utilities =====

  /**
   * Subscribe to updates
   */
  onUpdate(handler: (update: Uint8Array, origin: any) => void): void {
    this.ydoc.on("update", handler);
  }

  /**
   * Apply update from network
   */
  applyUpdate(update: Uint8Array, origin?: any): void {
    Y.applyUpdate(this.ydoc, update, origin);
  }

  /**
   * Get state as update
   */
  getStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Get state vector
   */
  getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /**
   * Encode state as update from state vector
   */
  encodeStateAsUpdate(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector);
  }

  /**
   * Get document as JSON (for debugging/inspection)
   */
  toJSON(): any {
    return {
      activeWork: Array.from(this.getAllActiveWork().entries()),
      issueUpdates: Array.from(this.getAllIssueUpdates().entries()),
      specUpdates: Array.from(this.getAllSpecUpdates().entries()),
      leases: Array.from(this.getAllLeases().entries()),
      fileDiffs: Array.from(this.getAllFileDiffs().entries()),
      agentMetadata: Array.from(this.getAllAgentMetadata().entries()),
    };
  }

  /**
   * Subscribe to specific map changes
   */
  observeActiveWork(handler: (event: Y.YMapEvent<any>) => void): void {
    this.activeWork.observe(handler);
  }

  observeIssueUpdates(handler: (event: Y.YMapEvent<any>) => void): void {
    this.issueUpdates.observe(handler);
  }

  observeSpecUpdates(handler: (event: Y.YMapEvent<any>) => void): void {
    this.specUpdates.observe(handler);
  }

  observeLeases(handler: (event: Y.YMapEvent<any>) => void): void {
    this.leases.observe(handler);
  }

  observeFileDiffs(handler: (event: Y.YMapEvent<any>) => void): void {
    this.fileDiffs.observe(handler);
  }

  observeAgentMetadata(handler: (event: Y.YMapEvent<any>) => void): void {
    this.agentMetadata.observe(handler);
  }
}
