/**
 * Tests for Overlay Service
 *
 * Tests overlay computation that applies checkpoint snapshots to compute projected state.
 */

import { describe, it, expect } from 'vitest';
import { computeOverlay, type OverlayResult } from '../../../src/services/overlay-service.js';
import type { CheckpointWithStreamData } from '../../../src/services/dataplane-adapter.js';
import type { Issue, Spec, IssueJSONL, SpecJSONL } from '@sudocode-ai/types';

// Helper to create test issues
function createIssue(id: string, title: string, status: string = 'open'): Issue {
  return {
    id,
    uuid: `uuid-${id}`,
    title,
    status: status as Issue['status'],
    content: `Content for ${title}`,
    priority: 2,
    archived: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

// Helper to create test specs
function createSpec(id: string, title: string): Spec {
  return {
    id,
    uuid: `uuid-${id}`,
    title,
    file_path: `/specs/${id}.md`,
    content: `Content for ${title}`,
    priority: 2,
    archived: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

// Helper to create checkpoint with stream data
function createCheckpointData(
  checkpointId: string,
  streamId: string,
  parentStream: string | null,
  issueSnapshot: string | null,
  specSnapshot: string | null,
  createdAt: number = Date.now()
): CheckpointWithStreamData {
  return {
    checkpoint: {
      id: checkpointId,
      issue_id: 'i-test',
      execution_id: 'e-test',
      stream_id: streamId,
      commit_sha: `sha-${checkpointId}`,
      parent_commit: null,
      changed_files: 0,
      additions: 0,
      deletions: 0,
      message: `Checkpoint ${checkpointId}`,
      checkpointed_at: new Date().toISOString(),
      checkpointed_by: 'test',
      review_status: 'pending' as const,
      issue_snapshot: issueSnapshot,
      spec_snapshot: specSnapshot,
    },
    stream: {
      id: streamId,
      parentStream,
      createdAt,
    },
    execution: {
      id: 'e-test',
      worktree_path: '/test/worktree',
      branch_name: 'test-branch',
    },
  };
}

// Helper to create snapshot JSON
function createIssueSnapshot(
  id: string,
  changeType: 'created' | 'modified' | 'deleted',
  issue: Partial<IssueJSONL>
): string {
  const entry = {
    id,
    changeType,
    entity: {
      id,
      uuid: issue.uuid || `uuid-${id}`,
      title: issue.title || `Title ${id}`,
      status: issue.status || 'open',
      content: issue.content || '',
      priority: issue.priority ?? 2,
      archived: issue.archived ?? false,
      created_at: issue.created_at || '2024-01-01T00:00:00Z',
      updated_at: issue.updated_at || '2024-01-01T00:00:00Z',
    },
  };
  return JSON.stringify([entry]);
}

function createSpecSnapshot(
  id: string,
  changeType: 'created' | 'modified' | 'deleted',
  spec: Partial<SpecJSONL>
): string {
  const entry = {
    id,
    changeType,
    entity: {
      id,
      uuid: spec.uuid || `uuid-${id}`,
      title: spec.title || `Title ${id}`,
      file_path: spec.file_path || `/specs/${id}.md`,
      content: spec.content || '',
      priority: spec.priority ?? 2,
      archived: spec.archived ?? false,
      created_at: spec.created_at || '2024-01-01T00:00:00Z',
      updated_at: spec.updated_at || '2024-01-01T00:00:00Z',
    },
  };
  return JSON.stringify([entry]);
}

describe('Overlay Service', () => {
  describe('computeOverlay', () => {
    it('should return base issues/specs when no checkpoints', () => {
      const baseIssues = [createIssue('i-1', 'Issue 1'), createIssue('i-2', 'Issue 2')];
      const baseSpecs = [createSpec('s-1', 'Spec 1')];

      const result = computeOverlay(baseIssues, baseSpecs, []);

      expect(result.issues).toHaveLength(2);
      expect(result.specs).toHaveLength(1);
      expect(result.projectedIssueCount).toBe(0);
      expect(result.projectedSpecCount).toBe(0);
      // Base issues should not have projection attributes
      expect(result.issues[0]._isProjected).toBeUndefined();
    });

    it('should apply created issue from checkpoint', () => {
      const baseIssues: Issue[] = [];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-new', 'created', {
          title: 'New Issue',
          status: 'open',
        }),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('i-new');
      expect(result.issues[0].title).toBe('New Issue');
      expect(result.issues[0]._isProjected).toBe(true);
      expect(result.issues[0]._changeType).toBe('created');
      expect(result.issues[0]._attribution).toBeDefined();
      expect(result.issues[0]._attribution?.streamId).toBe('stream-a');
      expect(result.projectedIssueCount).toBe(1);
    });

    it('should apply modified issue from checkpoint', () => {
      const baseIssues = [createIssue('i-1', 'Original Title', 'open')];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-1', 'modified', {
          title: 'Modified Title',
          status: 'in_progress',
        }),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('i-1');
      expect(result.issues[0].title).toBe('Modified Title');
      expect(result.issues[0].status).toBe('in_progress');
      expect(result.issues[0]._isProjected).toBe(true);
      expect(result.issues[0]._changeType).toBe('modified');
    });

    it('should apply deleted issue from checkpoint', () => {
      const baseIssues = [createIssue('i-1', 'To Be Deleted')];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-1', 'deleted', {}),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('i-1');
      expect(result.issues[0].archived).toBe(true);
      expect(result.issues[0]._isProjected).toBe(true);
      expect(result.issues[0]._changeType).toBe('deleted');
    });

    it('should apply spec changes from checkpoint', () => {
      const baseIssues: Issue[] = [];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        null,
        createSpecSnapshot('s-new', 'created', {
          title: 'New Spec',
          content: 'Spec content',
        })
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      expect(result.specs).toHaveLength(1);
      expect(result.specs[0].id).toBe('s-new');
      expect(result.specs[0].title).toBe('New Spec');
      expect(result.specs[0]._isProjected).toBe(true);
      expect(result.specs[0]._changeType).toBe('created');
      expect(result.projectedSpecCount).toBe(1);
    });

    it('should apply checkpoints in topological order (parent before child)', () => {
      const baseIssues = [createIssue('i-1', 'Original', 'open')];
      const baseSpecs: Spec[] = [];

      // Child checkpoint comes first in array but should be applied after parent
      const childCheckpoint = createCheckpointData(
        'cp-child',
        'stream-b',
        'stream-a',
        createIssueSnapshot('i-1', 'modified', {
          title: 'Child Modified',
          status: 'blocked',
        }),
        null,
        2000
      );

      const parentCheckpoint = createCheckpointData(
        'cp-parent',
        'stream-a',
        null,
        createIssueSnapshot('i-1', 'modified', {
          title: 'Parent Modified',
          status: 'in_progress',
        }),
        null,
        1000
      );

      // Pass child first to test ordering
      const result = computeOverlay(baseIssues, baseSpecs, [childCheckpoint, parentCheckpoint]);

      // Child should override parent (applied last)
      expect(result.issues[0].title).toBe('Child Modified');
      expect(result.issues[0].status).toBe('blocked');
    });

    it('should handle multiple checkpoints in same stream', () => {
      const baseIssues = [createIssue('i-1', 'Original', 'open')];
      const baseSpecs: Spec[] = [];

      const checkpoint1 = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-1', 'modified', {
          title: 'First Modification',
          status: 'in_progress',
        }),
        null,
        1000
      );
      // Make checkpoint2's checkpointed_at later
      checkpoint1.checkpoint.checkpointed_at = '2024-01-01T00:00:00Z';

      const checkpoint2 = createCheckpointData(
        'cp-2',
        'stream-a',
        null,
        createIssueSnapshot('i-1', 'modified', {
          title: 'Second Modification',
          status: 'closed',
        }),
        null,
        1000
      );
      checkpoint2.checkpoint.checkpointed_at = '2024-01-02T00:00:00Z';

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint2, checkpoint1]);

      // Later checkpoint should win (applied last within same stream)
      expect(result.issues[0].title).toBe('Second Modification');
      expect(result.issues[0].status).toBe('closed');
    });

    it('should handle issue that does not exist in base being modified', () => {
      // This can happen if an issue was created and modified in the same worktree
      // but we only have the 'modified' snapshot
      const baseIssues: Issue[] = [];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-new', 'modified', {
          title: 'New Issue (via modified)',
          status: 'open',
        }),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      // Should treat as created since base doesn't have it
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('i-new');
      expect(result.issues[0]._isProjected).toBe(true);
      expect(result.issues[0]._changeType).toBe('created');
    });

    it('should preserve attribution with all fields', () => {
      const baseIssues: Issue[] = [];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-new', 'created', { title: 'New Issue' }),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      const attribution = result.issues[0]._attribution;
      expect(attribution).toBeDefined();
      expect(attribution?.streamId).toBe('stream-a');
      expect(attribution?.executionId).toBe('e-test');
      expect(attribution?.checkpointId).toBe('cp-1');
      expect(attribution?.worktreePath).toBe('/test/worktree');
      expect(attribution?.branchName).toBe('test-branch');
    });

    it('should handle malformed snapshot gracefully', () => {
      const baseIssues = [createIssue('i-1', 'Original')];
      const baseSpecs: Spec[] = [];

      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        'not valid json',
        null
      );

      // Should not throw, should return base issues
      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe('i-1');
      expect(result.issues[0].title).toBe('Original');
      expect(result.issues[0]._isProjected).toBeUndefined();
    });

    it('should not mark base issues as projected', () => {
      const baseIssues = [createIssue('i-1', 'Base Issue')];
      const baseSpecs = [createSpec('s-1', 'Base Spec')];

      // Checkpoint only modifies i-2, not i-1
      const checkpoint = createCheckpointData(
        'cp-1',
        'stream-a',
        null,
        createIssueSnapshot('i-2', 'created', { title: 'New Issue' }),
        null
      );

      const result = computeOverlay(baseIssues, baseSpecs, [checkpoint]);

      // i-1 should not be projected
      const baseIssue = result.issues.find((i) => i.id === 'i-1');
      expect(baseIssue?._isProjected).toBeUndefined();

      // i-2 should be projected
      const projectedIssue = result.issues.find((i) => i.id === 'i-2');
      expect(projectedIssue?._isProjected).toBe(true);

      // s-1 should not be projected
      expect(result.specs[0]._isProjected).toBeUndefined();
    });
  });
});
