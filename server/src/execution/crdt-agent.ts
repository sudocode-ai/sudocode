/**
 * CRDT Agent
 *
 * Runs in worktree execution contexts and synchronizes state with the main CRDT Coordinator.
 * Handles bidirectional sync, reconnection logic, and local-only fallback.
 */

import * as Y from 'yjs';
import { WebSocket } from 'ws';
import {
  IssueState,
  SpecState,
  ExecutionState,
  AgentMetadata,
  FeedbackState,
  CRDTAgentConfig
} from '@sudocode-ai/types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CRDT Agent
 *
 * Synchronizes local Yjs document with the main CRDT Coordinator via WebSocket.
 */
export class CRDTAgent {
  private ydoc: Y.Doc;
  private ws?: WebSocket;
  private config: Required<CRDTAgentConfig>;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private isConnected: boolean = false;
  private localOnlyMode: boolean = false;

  constructor(config: CRDTAgentConfig) {
    this.config = {
      agentId: config.agentId,
      coordinatorUrl: config.coordinatorUrl || '',
      coordinatorHost: config.coordinatorHost || 'localhost',
      coordinatorPort: config.coordinatorPort || 3001,
      heartbeatInterval: config.heartbeatInterval || 30000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      reconnectBaseDelay: config.reconnectBaseDelay || 1000,
      reconnectMaxDelay: config.reconnectMaxDelay || 30000,
      connectionTimeout: config.connectionTimeout || 10000
    };

    // Build coordinator URL if not provided
    if (!this.config.coordinatorUrl) {
      this.config.coordinatorUrl = `ws://${this.config.coordinatorHost}:${this.config.coordinatorPort}/sync`;
    }

    this.ydoc = new Y.Doc();
    this.setupYjsMaps();

    console.log(`[CRDT Agent ${this.config.agentId}] Initialized`);
  }

  /**
   * Setup Yjs maps - must match coordinator
   */
  private setupYjsMaps(): void {
    this.ydoc.getMap<IssueState>('issueUpdates');
    this.ydoc.getMap<SpecState>('specUpdates');
    this.ydoc.getMap<ExecutionState>('executionState');
    this.ydoc.getMap<AgentMetadata>('agentMetadata');
    this.ydoc.getMap<FeedbackState>('feedbackUpdates');
  }

  /**
   * Connect to coordinator
   */
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.coordinatorUrl}?clientId=${this.config.agentId}`;
      console.log(`[CRDT Agent ${this.config.agentId}] Connecting to ${url}`);

      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          console.error(`[CRDT Agent ${this.config.agentId}] Connection timeout`);
          this.handleConnectionFailure();
          reject(new Error('Connection timeout'));
        }
      }, this.config.connectionTimeout);

      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        clearTimeout(timeout);
        console.error(`[CRDT Agent ${this.config.agentId}] Invalid URL:`, error);
        this.handleConnectionFailure();
        reject(new Error('Connection timeout'));
        return;
      }

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.localOnlyMode = false;
        console.log(`[CRDT Agent ${this.config.agentId}] Connected`);

        // Setup message handler
        this.setupMessageHandler();

        // Setup update listener
        this.setupUpdateListener();

        // Start heartbeat
        this.startHeartbeat();

        // Register agent metadata
        this.registerAgent();

        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`[CRDT Agent ${this.config.agentId}] WebSocket error:`, error.message);
        if (!this.isConnected) {
          this.handleConnectionFailure();
          reject(error);
        }
      });

      this.ws.on('close', () => {
        clearTimeout(timeout);
        this.isConnected = false;
        console.log(`[CRDT Agent ${this.config.agentId}] Disconnected`);
        this.stopHeartbeat();
        this.attemptReconnect();
      });
    });
  }

  /**
   * Setup message handler for incoming updates
   */
  private setupMessageHandler(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'sync-init') {
          // Initial state sync from coordinator
          const update = new Uint8Array(message.data);
          Y.applyUpdate(this.ydoc, update, 'server');
          console.log(`[CRDT Agent ${this.config.agentId}] Received initial sync (${update.length} bytes)`);
        } else if (message.type === 'sync-update') {
          // Incremental update from coordinator
          const update = new Uint8Array(message.data);
          Y.applyUpdate(this.ydoc, update, 'server');
          console.log(`[CRDT Agent ${this.config.agentId}] Received update (${update.length} bytes)`);
        }
      } catch (error) {
        console.error(`[CRDT Agent ${this.config.agentId}] Failed to handle message:`, error);
      }
    });
  }

  /**
   * Setup update listener for local changes
   */
  private setupUpdateListener(): void {
    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      // Don't send updates we just received from server
      if (origin === 'server') return;

      // Don't send if not connected
      if (!this.isConnected || !this.ws) {
        console.log(`[CRDT Agent ${this.config.agentId}] Local update queued (offline)`);
        return;
      }

      // Send update to coordinator
      try {
        const message = JSON.stringify({
          type: 'sync-update',
          data: Array.from(update)
        });
        this.ws.send(message);
        console.log(`[CRDT Agent ${this.config.agentId}] Sent update (${update.length} bytes)`);
      } catch (error) {
        console.error(`[CRDT Agent ${this.config.agentId}] Failed to send update:`, error);
      }
    });
  }

  /**
   * Register agent in metadata map
   */
  private registerAgent(): void {
    const metadataMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const metadata: AgentMetadata = {
      id: this.config.agentId,
      status: 'idle',
      lastHeartbeat: Date.now(),
      connectedAt: Date.now()
    };
    metadataMap.set(this.config.agentId, metadata);
    console.log(`[CRDT Agent ${this.config.agentId}] Registered agent metadata`);
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
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
   * Send heartbeat update
   */
  private sendHeartbeat(): void {
    const metadataMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const existing = metadataMap.get(this.config.agentId);

    if (existing) {
      metadataMap.set(this.config.agentId, {
        ...existing,
        lastHeartbeat: Date.now()
      });
    }
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    if (this.config.maxReconnectAttempts === 0 || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn(`[CRDT Agent ${this.config.agentId}] Max reconnect attempts reached, switching to local-only mode`);
      this.localOnlyMode = true;
    } else {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.localOnlyMode) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn(`[CRDT Agent ${this.config.agentId}] Max reconnect attempts reached`);
      this.localOnlyMode = true;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectMaxDelay
    );

    console.log(`[CRDT Agent ${this.config.agentId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        console.error(`[CRDT Agent ${this.config.agentId}] Reconnection failed:`, error.message);
      });
    }, delay);
  }

  /**
   * Update issue in CRDT
   */
  public updateIssue(issueId: string, updates: Partial<IssueState>): void {
    const issueMap = this.ydoc.getMap<IssueState>('issueUpdates');
    const existing = issueMap.get(issueId);

    if (existing) {
      issueMap.set(issueId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
        version: existing.version + 1,
        lastModifiedBy: this.config.agentId
      });
    } else {
      // Create new issue
      const newIssue: IssueState = {
        id: issueId,
        title: updates.title || '',
        content: updates.content || '',
        status: updates.status || 'open',
        priority: updates.priority ?? 2,
        archived: updates.archived || false,
        createdAt: updates.createdAt || Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: this.config.agentId,
        version: 1,
        ...updates
      };
      issueMap.set(issueId, newIssue);
    }

    console.log(`[CRDT Agent ${this.config.agentId}] Updated issue ${issueId}`);
  }

  /**
   * Update spec in CRDT
   */
  public updateSpec(specId: string, updates: Partial<SpecState>): void {
    const specMap = this.ydoc.getMap<SpecState>('specUpdates');
    const existing = specMap.get(specId);

    if (existing) {
      specMap.set(specId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
        version: existing.version + 1,
        lastModifiedBy: this.config.agentId
      });
    } else {
      // Create new spec
      const newSpec: SpecState = {
        id: specId,
        title: updates.title || '',
        content: updates.content || '',
        priority: updates.priority ?? 2,
        createdAt: updates.createdAt || Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: this.config.agentId,
        version: 1,
        ...updates
      };
      specMap.set(specId, newSpec);
    }

    console.log(`[CRDT Agent ${this.config.agentId}] Updated spec ${specId}`);
  }

  /**
   * Update execution state in CRDT
   */
  public updateExecutionState(executionId: string, updates: Partial<ExecutionState>): void {
    const execMap = this.ydoc.getMap<ExecutionState>('executionState');
    const existing = execMap.get(executionId);

    if (existing) {
      execMap.set(executionId, {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      });
    } else {
      // Create new execution state
      const newState: ExecutionState = {
        id: executionId,
        status: updates.status || 'preparing',
        startedAt: updates.startedAt || Date.now(),
        updatedAt: Date.now(),
        agentId: this.config.agentId,
        ...updates
      };
      execMap.set(executionId, newState);
    }

    console.log(`[CRDT Agent ${this.config.agentId}] Updated execution ${executionId}`);
  }

  /**
   * Add feedback to CRDT
   */
  public addFeedback(feedbackId: string, feedback: Omit<FeedbackState, 'id' | 'createdAt' | 'updatedAt' | 'lastModifiedBy'>): void {
    const feedbackMap = this.ydoc.getMap<FeedbackState>('feedbackUpdates');

    const newFeedback: FeedbackState = {
      id: feedbackId,
      ...feedback,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastModifiedBy: this.config.agentId
    };

    feedbackMap.set(feedbackId, newFeedback);
    console.log(`[CRDT Agent ${this.config.agentId}] Added feedback ${feedbackId}`);
  }

  /**
   * Update agent status
   */
  public updateAgentStatus(status: AgentMetadata['status']): void {
    const metadataMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const existing = metadataMap.get(this.config.agentId);

    if (existing) {
      metadataMap.set(this.config.agentId, {
        ...existing,
        status,
        lastHeartbeat: Date.now()
      });
    }

    console.log(`[CRDT Agent ${this.config.agentId}] Status updated to ${status}`);
  }

  /**
   * Export local state to JSONL files
   */
  public async exportToLocalJSONL(outputDir: string): Promise<void> {
    try {
      const issueMap = this.ydoc.getMap<IssueState>('issueUpdates');
      const specMap = this.ydoc.getMap<SpecState>('specUpdates');

      const issues: IssueState[] = [];
      const specs: SpecState[] = [];

      issueMap.forEach((issue) => issues.push(issue));
      specMap.forEach((spec) => specs.push(spec));

      const issuesPath = path.join(outputDir, '.sudocode', 'issues.jsonl');
      const specsPath = path.join(outputDir, '.sudocode', 'specs.jsonl');

      // Ensure directory exists
      const dir = path.dirname(issuesPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Export issues
      const issuesData = issues.map(i => JSON.stringify({
        id: i.id,
        title: i.title,
        content: i.content,
        status: i.status,
        priority: i.priority,
        parent_id: i.parent || null,
        archived: i.archived,
        created_at: new Date(i.createdAt).toISOString(),
        updated_at: new Date(i.updatedAt).toISOString()
      })).join('\n');

      fs.writeFileSync(issuesPath, issuesData);

      // Export specs
      const specsData = specs.map(s => JSON.stringify({
        id: s.id,
        title: s.title,
        content: s.content,
        priority: s.priority,
        parent_id: s.parent || null,
        file_path: `.sudocode/specs/${s.id}.md`,
        created_at: new Date(s.createdAt).toISOString(),
        updated_at: new Date(s.updatedAt).toISOString()
      })).join('\n');

      fs.writeFileSync(specsPath, specsData);

      console.log(`[CRDT Agent ${this.config.agentId}] Exported to local JSONL`);
    } catch (error) {
      console.error(`[CRDT Agent ${this.config.agentId}] Failed to export JSONL:`, error);
    }
  }

  /**
   * Disconnect from coordinator
   */
  public async disconnect(): Promise<void> {
    console.log(`[CRDT Agent ${this.config.agentId}] Disconnecting...`);

    // Stop heartbeat
    this.stopHeartbeat();

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Update agent metadata to disconnected
    const metadataMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const existing = metadataMap.get(this.config.agentId);

    if (existing) {
      metadataMap.set(this.config.agentId, {
        ...existing,
        status: 'disconnected',
        disconnectedAt: Date.now()
      });
    }

    // Wait a moment for final updates to be sent
    await new Promise(resolve => setTimeout(resolve, 100));

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.isConnected = false;

    console.log(`[CRDT Agent ${this.config.agentId}] Disconnected`);
  }

  /**
   * Check if agent is connected
   */
  public get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Check if agent is in local-only mode
   */
  public get isLocalOnly(): boolean {
    return this.localOnlyMode;
  }

  /**
   * Get agent ID
   */
  public get agentId(): string {
    return this.config.agentId;
  }
}
