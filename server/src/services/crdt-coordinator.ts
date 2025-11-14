/**
 * CRDT Coordinator Service
 *
 * Manages the authoritative Yjs CRDT document and coordinates state synchronization
 * between worktree agents and frontend clients via WebSocket.
 */

import * as Y from 'yjs';
import { WebSocketServer, WebSocket } from 'ws';
import * as Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getAllIssues, createNewIssue, updateExistingIssue } from './issues.js';
import { getAllSpecs, createNewSpec, updateExistingSpec } from './specs.js';
import { getAllFeedback, createNewFeedback, updateExistingFeedback } from './feedback.js';
import type { Issue, Spec, IssueFeedback, IssueStatus } from '@sudocode-ai/types';

/**
 * CRDT state schemas
 */
export interface IssueState {
  id: string;
  title: string;
  content: string; // Changed from description
  status: IssueStatus;
  priority: number; // 0-4
  parent?: string;
  archived: boolean;

  // Metadata
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
  version: number;

  // Execution tracking
  tempStatus?: string;
  tempProgress?: {
    current: number;
    total: number;
    message?: string;
  };
}

export interface SpecState {
  id: string;
  title: string;
  content: string; // Changed from description
  priority: number;
  parent?: string;

  // Metadata
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
  version: number;

  // Temporary updates
  tempSections?: Record<string, string>;
  tempDiff?: string;
}

export interface ExecutionState {
  executionId: string;
  issueId?: string;
  specId?: string;
  status: 'preparing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

  worktreePath: string;
  branch: string;

  startedAt: number;
  completedAt?: number;

  // Agent info
  agentId: string;
  lastHeartbeat: number;

  // Progress tracking
  currentTask?: string;
  progress?: {
    completedSteps: number;
    totalSteps: number;
    currentStep: string;
  };

  // Logs
  recentLogs?: Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
}

export interface AgentMetadata {
  agentId: string;
  executionId: string;
  worktreePath: string;

  // Heartbeat
  startedAt: number;
  lastHeartbeat: number;

  // Status
  status: 'initializing' | 'idle' | 'working' | 'disconnected';
  currentActivity?: string;

  // Capabilities (for future P2P)
  capabilities?: string[];
}

export interface FeedbackState {
  id: string;
  specId: string;
  issueId: string;
  type: 'comment' | 'suggestion' | 'request';
  content: string;

  // Anchoring
  anchorLine?: number;
  anchorText?: string;

  // Metadata
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
}

/**
 * WebSocket message types
 */
interface SyncMessage {
  type: 'sync-init' | 'sync-update';
  data: number[]; // Uint8Array as number array for JSON
}

/**
 * CRDT Coordinator configuration
 */
export interface CRDTCoordinatorConfig {
  port?: number;
  host?: string;
  persistInterval?: number;
  gcInterval?: number;
}

/**
 * CRDT Coordinator
 *
 * Manages the authoritative Yjs document and synchronizes state with all clients.
 */
export class CRDTCoordinator {
  private ydoc: Y.Doc;
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket>;
  private persistTimer?: NodeJS.Timeout;
  private gcTimer?: NodeJS.Timeout;
  public lastPersistTime: number = 0;

  constructor(
    private db: Database.Database,
    private config: CRDTCoordinatorConfig = {}
  ) {
    const port = config.port || 3001;
    const host = config.host || 'localhost';

    this.ydoc = new Y.Doc();
    this.wss = new WebSocketServer({ port, host });
    this.clients = new Map();

    console.log(`[CRDT Coordinator] Initializing on ${host}:${port}`);

    this.setupYjsMaps();
    this.setupWebSocketServer();
    this.setupPersistence();
    this.loadInitialState();
    this.startGarbageCollection();

    console.log('[CRDT Coordinator] Initialized successfully');
  }

  /**
   * Initialize Yjs maps
   */
  private setupYjsMaps(): void {
    this.ydoc.getMap('issueUpdates');
    this.ydoc.getMap('specUpdates');
    this.ydoc.getMap('executionState');
    this.ydoc.getMap('agentMetadata');
    this.ydoc.getMap('feedbackUpdates');
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.extractClientId(req);
      this.clients.set(clientId, ws);

      console.log(`[CRDT Coordinator] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send initial state sync
      this.sendInitialSync(ws);

      // Handle incoming updates
      ws.on('message', (data: Buffer) => {
        this.handleClientUpdate(clientId, data);
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[CRDT Coordinator] Client disconnected: ${clientId} (remaining: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        console.error(`[CRDT Coordinator] WebSocket error for ${clientId}:`, error.message);
      });
    });

    this.wss.on('error', (error: Error) => {
      console.error('[CRDT Coordinator] WebSocket server error:', error);
    });
  }

  /**
   * Send initial state sync to new client
   */
  private sendInitialSync(ws: WebSocket): void {
    const stateVector = Y.encodeStateAsUpdate(this.ydoc);
    const message: SyncMessage = {
      type: 'sync-init',
      data: Array.from(stateVector)
    };

    ws.send(JSON.stringify(message));
    console.log(`[CRDT Coordinator] Sent initial sync (${stateVector.byteLength} bytes)`);
  }

  /**
   * Handle update from client
   */
  private handleClientUpdate(clientId: string, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as SyncMessage;

      if (message.type === 'sync-update') {
        const update = new Uint8Array(message.data);

        // Apply update to main document
        Y.applyUpdate(this.ydoc, update, clientId);

        // Broadcast to all other clients
        this.broadcastUpdate(update, clientId);

        console.log(`[CRDT Coordinator] Applied update from ${clientId} (${update.byteLength} bytes)`);
      }
    } catch (error) {
      console.error(`[CRDT Coordinator] Failed to handle update from ${clientId}:`, error);
    }
  }

  /**
   * Broadcast update to all clients except sender
   */
  private broadcastUpdate(update: Uint8Array, excludeClient?: string): void {
    const message: SyncMessage = {
      type: 'sync-update',
      data: Array.from(update)
    };
    const messageStr = JSON.stringify(message);

    let broadcastCount = 0;
    this.clients.forEach((ws, clientId) => {
      if (clientId !== excludeClient && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
        broadcastCount++;
      }
    });

    if (broadcastCount > 0) {
      console.log(`[CRDT Coordinator] Broadcast update to ${broadcastCount} clients`);
    }
  }

  /**
   * Setup persistence layer
   */
  private setupPersistence(): void {
    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      // Don't persist updates we just loaded from DB
      if (origin === 'db-load') return;

      // Broadcast local updates to all clients (exclude origin client if specified)
      if (typeof origin === 'string') {
        // Update came from a client, already broadcast by handleClientUpdate
      } else {
        // Local update from public API - broadcast to all clients
        this.broadcastUpdate(update);
      }

      // Debounce persistence
      this.debouncedPersist();
    });
  }

  /**
   * Debounced persistence
   */
  private debouncedPersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);

    const interval = this.config.persistInterval || 500;
    this.persistTimer = setTimeout(() => {
      this.persistToDatabase().catch(error => {
        console.error('[CRDT Coordinator] Persistence failed:', error);
      });
    }, interval);
  }

  /**
   * Persist CRDT state to database
   */
  private async persistToDatabase(): Promise<void> {
    try {
      const issues = this.extractIssues();
      const specs = this.extractSpecs();
      const feedback = this.extractFeedback();

      // Update database in transaction
      this.db.transaction(() => {
        for (const issue of issues) {
          const dbIssue = this.stateToIssue(issue);
          // Check if exists
          const existing = this.db.prepare('SELECT id FROM issues WHERE id = ?').get(issue.id);
          if (existing) {
            updateExistingIssue(this.db, issue.id, dbIssue);
          } else {
            createNewIssue(this.db, dbIssue);
          }
        }

        for (const spec of specs) {
          const dbSpec = this.stateToSpec(spec);
          const existing = this.db.prepare('SELECT id FROM specs WHERE id = ?').get(spec.id);
          if (existing) {
            updateExistingSpec(this.db, spec.id, dbSpec);
          } else {
            createNewSpec(this.db, dbSpec);
          }
        }

        for (const fb of feedback) {
          const dbFeedback = this.stateToFeedback(fb);
          const existing = this.db.prepare('SELECT id FROM feedback WHERE id = ?').get(fb.id);
          if (existing) {
            updateExistingFeedback(this.db, fb.id, dbFeedback);
          } else {
            createNewFeedback(this.db, dbFeedback);
          }
        }
      })();

      this.lastPersistTime = Date.now();
      console.log(`[CRDT Coordinator] Persisted ${issues.length} issues, ${specs.length} specs, ${feedback.length} feedback`);
    } catch (error) {
      console.error('[CRDT Coordinator] Persistence error:', error);
      // Don't throw - log and continue
    }
  }

  /**
   * Extract issues from CRDT
   */
  private extractIssues(): IssueState[] {
    const issueMap = this.ydoc.getMap<IssueState>('issueUpdates');
    const issues: IssueState[] = [];

    issueMap.forEach((value) => {
      issues.push(value);
    });

    return issues;
  }

  /**
   * Extract specs from CRDT
   */
  private extractSpecs(): SpecState[] {
    const specMap = this.ydoc.getMap<SpecState>('specUpdates');
    const specs: SpecState[] = [];

    specMap.forEach((value) => {
      specs.push(value);
    });

    return specs;
  }

  /**
   * Extract feedback from CRDT
   */
  private extractFeedback(): FeedbackState[] {
    const feedbackMap = this.ydoc.getMap<FeedbackState>('feedbackUpdates');
    const feedback: FeedbackState[] = [];

    feedbackMap.forEach((value) => {
      feedback.push(value);
    });

    return feedback;
  }

  /**
   * Load initial state from database
   */
  private loadInitialState(): void {
    try {
      const issues = getAllIssues(this.db, {});
      const specs = getAllSpecs(this.db, {});
      const feedback = getAllFeedback(this.db, {});

      const issueMap = this.ydoc.getMap<IssueState>('issueUpdates');
      const specMap = this.ydoc.getMap<SpecState>('specUpdates');
      const feedbackMap = this.ydoc.getMap<FeedbackState>('feedbackUpdates');

      // Populate CRDT
      this.ydoc.transact(() => {
        issues.forEach(issue => {
          issueMap.set(issue.id, this.issueToState(issue));
        });
        specs.forEach(spec => {
          specMap.set(spec.id, this.specToState(spec));
        });
        feedback.forEach(fb => {
          feedbackMap.set(fb.id, this.feedbackToState(fb));
        });
      }, 'db-load');

      console.log(`[CRDT Coordinator] Loaded ${issues.length} issues, ${specs.length} specs, ${feedback.length} feedback`);
    } catch (error) {
      console.error('[CRDT Coordinator] Failed to load initial state:', error);
      throw error;
    }
  }

  /**
   * Convert DB issue to CRDT state
   */
  private issueToState(issue: Issue): IssueState {
    return {
      id: issue.id,
      title: issue.title,
      content: issue.content,
      status: issue.status,
      priority: issue.priority,
      parent: issue.parent_id || undefined,
      archived: issue.archived || false,
      createdAt: new Date(issue.created_at).getTime(),
      updatedAt: new Date(issue.updated_at).getTime(),
      lastModifiedBy: 'system',
      version: 1
    };
  }

  /**
   * Convert DB spec to CRDT state
   */
  private specToState(spec: Spec): SpecState {
    return {
      id: spec.id,
      title: spec.title,
      content: spec.content,
      priority: spec.priority,
      parent: spec.parent_id || undefined,
      createdAt: new Date(spec.created_at).getTime(),
      updatedAt: new Date(spec.updated_at).getTime(),
      lastModifiedBy: 'system',
      version: 1
    };
  }

  /**
   * Convert DB feedback to CRDT state
   */
  private feedbackToState(fb: IssueFeedback): FeedbackState {
    return {
      id: fb.id,
      specId: fb.spec_id,
      issueId: fb.issue_id,
      type: fb.feedback_type,
      content: fb.content,
      anchorLine: fb.anchor ? JSON.parse(fb.anchor).line_number : undefined,
      anchorText: fb.anchor ? JSON.parse(fb.anchor).text_snippet : undefined,
      createdAt: new Date(fb.created_at).getTime(),
      updatedAt: new Date(fb.updated_at).getTime(),
      lastModifiedBy: 'system'
    };
  }

  /**
   * Convert CRDT state to DB issue
   */
  private stateToIssue(state: IssueState): any {
    return {
      id: state.id,
      title: state.title,
      content: state.content,
      status: state.status,
      priority: state.priority,
      parent_id: state.parent || null,
      archived: state.archived
    };
  }

  /**
   * Convert CRDT state to DB spec
   */
  private stateToSpec(state: SpecState): any {
    return {
      id: state.id,
      title: state.title,
      content: state.content,
      priority: state.priority,
      parent_id: state.parent || null,
      file_path: `.sudocode/specs/${state.id}.md`
    };
  }

  /**
   * Convert CRDT state to DB feedback
   */
  private stateToFeedback(state: FeedbackState): any {
    const anchor = (state.anchorLine || state.anchorText) ? JSON.stringify({
      line_number: state.anchorLine,
      text_snippet: state.anchorText
    }) : undefined;

    return {
      issue_id: state.issueId,
      spec_id: state.specId,
      feedback_type: state.type,
      content: state.content,
      anchor
    };
  }

  /**
   * Extract client ID from request
   */
  private extractClientId(req: any): string {
    try {
      const url = new URL(req.url!, `ws://localhost:${this.config.port || 3001}`);
      return url.searchParams.get('clientId') || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch (error) {
      return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  /**
   * Start garbage collection
   */
  private startGarbageCollection(): void {
    const interval = this.config.gcInterval || 300000; // 5 minutes

    this.gcTimer = setInterval(() => {
      this.runGarbageCollection();
    }, interval);

    console.log(`[CRDT Coordinator] Garbage collection scheduled every ${interval}ms`);
  }

  /**
   * Run garbage collection
   */
  private runGarbageCollection(): void {
    const execMap = this.ydoc.getMap<ExecutionState>('executionState');
    const agentMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const now = Date.now();
    const executionTimeout = 3600000; // 1 hour
    const agentTimeout = 120000; // 2 minutes

    let removedExecutions = 0;
    let removedAgents = 0;

    // Clean up stale executions
    execMap.forEach((exec, id) => {
      if ((exec.status === 'completed' || exec.status === 'failed') && exec.completedAt) {
        if (now - exec.completedAt > executionTimeout) {
          execMap.delete(id);
          removedExecutions++;
        }
      }
    });

    // Clean up disconnected agents
    agentMap.forEach((agent, id) => {
      if (now - agent.lastHeartbeat > agentTimeout) {
        agentMap.delete(id);
        removedAgents++;
      }
    });

    if (removedExecutions > 0 || removedAgents > 0) {
      console.log(`[CRDT Coordinator] GC: Removed ${removedExecutions} executions, ${removedAgents} agents`);
    }
  }

  /**
   * Public API: Update issue
   */
  public updateIssue(issueId: string, updates: Partial<IssueState>): void {
    const issueMap = this.ydoc.getMap<IssueState>('issueUpdates');
    const existing = issueMap.get(issueId);

    if (existing) {
      issueMap.set(issueId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
        version: existing.version + 1
      });
    } else {
      // Create new issue if it doesn't exist
      const newIssue: IssueState = {
        id: issueId,
        title: updates.title || '',
        content: updates.content || '',
        status: updates.status || 'open',
        priority: updates.priority ?? 2,
        archived: updates.archived || false,
        createdAt: updates.createdAt || Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: updates.lastModifiedBy || 'system',
        version: 1,
        ...updates
      };
      issueMap.set(issueId, newIssue);
    }
  }

  /**
   * Public API: Update spec
   */
  public updateSpec(specId: string, updates: Partial<SpecState>): void {
    const specMap = this.ydoc.getMap<SpecState>('specUpdates');
    const existing = specMap.get(specId);

    if (existing) {
      specMap.set(specId, {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
        version: existing.version + 1
      });
    } else {
      // Create new spec if it doesn't exist
      const newSpec: SpecState = {
        id: specId,
        title: updates.title || '',
        content: updates.content || '',
        priority: updates.priority ?? 2,
        createdAt: updates.createdAt || Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: updates.lastModifiedBy || 'system',
        version: 1,
        ...updates
      };
      specMap.set(specId, newSpec);
    }
  }

  /**
   * Export CRDT to JSONL for Git commits
   */
  public async exportToJSONL(outputDir: string): Promise<void> {
    try {
      const issues = this.extractIssues();
      const specs = this.extractSpecs();

      const issuesPath = path.join(outputDir, '.sudocode', 'issues.jsonl');
      const specsPath = path.join(outputDir, '.sudocode', 'specs.jsonl');

      const issuesData = issues.map(i => {
        const dbIssue = this.stateToIssue(i);
        return JSON.stringify({
          id: i.id,
          ...dbIssue,
          created_at: new Date(i.createdAt).toISOString(),
          updated_at: new Date(i.updatedAt).toISOString()
        });
      }).join('\n');

      const specsData = specs.map(s => {
        const dbSpec = this.stateToSpec(s);
        return JSON.stringify({
          id: s.id,
          ...dbSpec,
          created_at: new Date(s.createdAt).toISOString(),
          updated_at: new Date(s.updatedAt).toISOString()
        });
      }).join('\n');

      await fs.writeFile(issuesPath, issuesData);
      await fs.writeFile(specsPath, specsData);

      console.log('[CRDT Coordinator] Exported to JSONL');
    } catch (error) {
      console.error('[CRDT Coordinator] JSONL export failed:', error);
      throw error;
    }
  }

  /**
   * Get all agent metadata (for testing/monitoring)
   */
  public getAgentMetadata(): AgentMetadata[] {
    const metadataMap = this.ydoc.getMap<AgentMetadata>('agentMetadata');
    const agents: AgentMetadata[] = [];

    metadataMap.forEach((metadata) => {
      agents.push(metadata);
    });

    return agents;
  }

  /**
   * Get all execution states (for testing/monitoring)
   */
  public getExecutionState(): ExecutionState[] {
    const execMap = this.ydoc.getMap<ExecutionState>('executionState');
    const states: ExecutionState[] = [];

    execMap.forEach((state) => {
      states.push(state);
    });

    return states;
  }

  /**
   * Shutdown coordinator
   */
  public async shutdown(): Promise<void> {
    console.log('[CRDT Coordinator] Shutting down...');

    // Clear timers
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
    }

    // Final persistence
    await this.persistToDatabase();

    // Close all client connections
    this.clients.forEach(ws => ws.close());

    // Wait for all connections to close
    await new Promise<void>((resolve) => {
      if (this.clients.size === 0) {
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.clients.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      // Timeout after 2 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        this.clients.clear();
        resolve();
      }, 2000);
    });

    // Close WebSocket server
    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });

    console.log('[CRDT Coordinator] Shutdown complete');
  }
}
