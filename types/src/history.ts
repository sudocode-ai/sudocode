/**
 * CRDT History Type Definitions
 *
 * Types for in-memory CRDT update history tracking.
 */

/**
 * Record of a single CRDT update with metadata
 */
export interface CRDTUpdateRecord {
  id: string;
  entityType: 'issue' | 'spec' | 'feedback';
  entityId: string;
  updateData: Uint8Array;
  clientId: string;
  timestamp: number;
  contentSnapshot?: {
    title: string;
    content: string;
    [key: string]: any;
  };
}

/**
 * In-memory history storage structure
 */
export interface UpdateHistory {
  updates: CRDTUpdateRecord[];
  entityIndex: Map<string, number[]>;
  clientIndex: Map<string, number[]>;
  oldestTimestamp: number;
  newestTimestamp: number;
}

/**
 * Metadata about the history state
 */
export interface HistoryMetadata {
  oldestTimestamp: number;
  newestTimestamp: number;
  totalUpdates: number;
  retentionWindowMs: number;
  entitiesTracked: number;
  memoryUsageMB: number;
}

/**
 * Document version at a specific timestamp
 */
export interface VersionInfo {
  timestamp: number;
  title: string;
  content: string;
  lastModifiedBy: string;
  [key: string]: any;
}

/**
 * Diff chunk between two versions
 */
export interface DiffChunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
  count: number;
}

/**
 * Line-by-line blame/attribution information
 */
export interface BlameInfo {
  lines: Array<{
    lineNumber: number;
    author: string;
    timestamp: number;
    line: string;
  }>;
}
