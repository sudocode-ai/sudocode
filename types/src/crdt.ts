/**
 * CRDT Type Definitions
 *
 * Shared type definitions for CRDT state synchronization between
 * the coordinator and agents.
 */

import { IssueStatus } from './index.js';

/**
 * Issue state in CRDT
 */
export interface IssueState {
  id: string;
  title: string;
  content: string;
  status: IssueStatus;
  priority: number;
  parent?: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
  version: number;
  // Temporary execution state
  tempStatus?: string;
  tempProgress?: {
    current: number;
    total: number;
    message?: string;
  };
}

/**
 * Spec state in CRDT
 */
export interface SpecState {
  id: string;
  title: string;
  content: string;
  priority: number;
  parent?: string;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
  version: number;
  // Temporary working state
  tempSections?: Record<string, string>;
  tempDiff?: string;
}

/**
 * Execution state in CRDT
 */
export interface ExecutionState {
  id: string;
  issueId?: string;
  specId?: string;
  status: 'preparing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  phase?: string;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  agentId: string;
}

/**
 * Agent metadata in CRDT
 */
export interface AgentMetadata {
  id: string;
  executionId?: string;
  status: 'initializing' | 'idle' | 'working' | 'disconnected';
  lastHeartbeat: number;
  connectedAt: number;
  disconnectedAt?: number;
  worktreePath?: string;
}

/**
 * Feedback state in CRDT
 */
export interface FeedbackState {
  id: string;
  specId: string;
  issueId: string;
  type: 'comment' | 'suggestion' | 'request';
  content: string;
  anchorLine?: number;
  anchorText?: string;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
}

/**
 * CRDT Agent configuration
 */
export interface CRDTAgentConfig {
  agentId: string;
  coordinatorUrl?: string;
  coordinatorHost?: string;
  coordinatorPort?: number;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  connectionTimeout?: number;
}

/**
 * CRDT Coordinator configuration
 */
export interface CRDTCoordinatorConfig {
  port?: number;
  host?: string;
  persistInterval?: number;
  gcInterval?: number;
  executionTTL?: number;
  agentTTL?: number;
}
