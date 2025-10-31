/**
 * In-Memory Workflow Storage Implementation
 *
 * Simple in-memory implementation of IWorkflowStorage for testing and development.
 *
 * @module execution/workflow/memory-storage
 */

import type { IWorkflowStorage } from './orchestrator.js';
import type { WorkflowCheckpoint } from './types.js';

/**
 * InMemoryWorkflowStorage - In-memory checkpoint storage
 *
 * Simple implementation that stores checkpoints in a Map.
 * Suitable for testing and single-process workflows.
 * Not suitable for production use with multiple processes.
 */
export class InMemoryWorkflowStorage implements IWorkflowStorage {
  public _checkpoints = new Map<string, WorkflowCheckpoint>();

  /**
   * Save a checkpoint to memory
   *
   * @param checkpoint - Checkpoint to save
   */
  async saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    this._checkpoints.set(checkpoint.executionId, checkpoint);
  }

  /**
   * Load a checkpoint from memory
   *
   * @param executionId - Execution ID to load
   * @returns Checkpoint or null if not found
   */
  async loadCheckpoint(
    executionId: string
  ): Promise<WorkflowCheckpoint | null> {
    return this._checkpoints.get(executionId) || null;
  }

  /**
   * List all checkpoints, optionally filtered by workflow ID
   *
   * @param workflowId - Optional workflow ID to filter by
   * @returns Array of checkpoints
   */
  async listCheckpoints(workflowId?: string): Promise<WorkflowCheckpoint[]> {
    const all = Array.from(this._checkpoints.values());
    if (workflowId) {
      return all.filter((cp) => cp.workflowId === workflowId);
    }
    return all;
  }

  /**
   * Delete a checkpoint from memory
   *
   * @param executionId - Execution ID to delete
   */
  async deleteCheckpoint(executionId: string): Promise<void> {
    this._checkpoints.delete(executionId);
  }

  /**
   * Clear all checkpoints (useful for testing)
   */
  clear(): void {
    this._checkpoints.clear();
  }

  /**
   * Get the number of stored checkpoints (useful for testing)
   */
  size(): number {
    return this._checkpoints.size;
  }
}
