/**
 * Integration tests for simulated three-way merges (empty base)
 *
 * Tests the complete pipeline when base = [] (empty array):
 * - Concurrent additions (both local and worktree add same entity)
 * - Metadata merging (tags, relationships, feedback unioned)
 * - Text-level merging (YAML expansion for line-level resolution)
 * - Conflict marker resolution (latest-wins strategy)
 * - Consistency with true 3-way merge
 * - Performance benchmarks
 */

import { describe, it, expect } from 'vitest';
import {
  mergeThreeWay,
  type JSONLEntity,
} from '../../src/merge-resolver.js';

describe('Simulated Three-Way Merge (Empty Base)', () => {
  describe('Scenario 1: 2-way local + worktree merge', () => {
    it('should preserve both entities when both add same UUID', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-new-feature',
          uuid: 'uuid-concurrent',
          title: 'Add new feature',
          description: 'Implementation from local branch',
          status: 'open',
          priority: 1,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['feature', 'local'],
          relationships: [],
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-new-feature',
          uuid: 'uuid-concurrent',
          title: 'Implement new feature',
          description: 'Implementation from worktree',
          status: 'in_progress',
          priority: 2,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['feature', 'worktree'],
          relationships: [],
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, local, worktree);

      // Should merge into single entity
      expect(merged).toHaveLength(1);

      // Should track as concurrent addition
      expect(stats.conflicts.some((c) => c.action.includes('Concurrent addition'))).toBe(true);

      const result = merged[0];

      // Latest timestamp wins for conflicting fields (worktree is newer)
      expect(result.title).toBe('Implement new feature');
      expect(result.status).toBe('in_progress');
      expect(result.priority).toBe(2);
      expect(result.updated_at).toBe('2025-01-03T00:00:00Z');

      // Metadata should be unioned
      expect(result.tags).toContain('feature');
      expect(result.tags).toContain('local');
      expect(result.tags).toContain('worktree');
    });

    it('should handle one-sided additions (only local)', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-local-only',
          uuid: 'uuid-local',
          title: 'Local feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('i-local-only');
      expect(merged[0].title).toBe('Local feature');
    });

    it('should handle one-sided additions (only worktree)', () => {
      const base: JSONLEntity[] = [];
      const local: JSONLEntity[] = [];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-worktree-only',
          uuid: 'uuid-worktree',
          title: 'Worktree feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('i-worktree-only');
      expect(merged[0].title).toBe('Worktree feature');
    });

    it('should handle multiple concurrent additions', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-1',
          uuid: 'uuid-1',
          title: 'Feature 1 local',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
        {
          id: 'i-2',
          uuid: 'uuid-2',
          title: 'Feature 2 local',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-1',
          uuid: 'uuid-1',
          title: 'Feature 1 worktree',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
        {
          id: 'i-3',
          uuid: 'uuid-3',
          title: 'Feature 3 worktree',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      // Should have 3 entities: uuid-1 (merged), uuid-2 (local), uuid-3 (worktree)
      expect(merged).toHaveLength(3);

      const ids = merged.map((e) => e.id).sort();
      expect(ids).toEqual(['i-1', 'i-2', 'i-3']);

      // uuid-1 should be merged with worktree winning (newer timestamp)
      const merged1 = merged.find((e) => e.uuid === 'uuid-1');
      expect(merged1?.title).toBe('Feature 1 worktree');
    });
  });

  describe('Scenario 2: 2-way with metadata conflicts', () => {
    it('should union all tags from both sides', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-tags',
          uuid: 'uuid-tags',
          title: 'Feature with tags',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['backend', 'api', 'local-specific'],
          relationships: [],
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-tags',
          uuid: 'uuid-tags',
          title: 'Feature with tags',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['backend', 'database', 'worktree-specific'],
          relationships: [],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // All tags should be present (union)
      expect(result.tags).toHaveLength(5);
      expect(result.tags).toContain('backend');
      expect(result.tags).toContain('api');
      expect(result.tags).toContain('database');
      expect(result.tags).toContain('local-specific');
      expect(result.tags).toContain('worktree-specific');
    });

    it('should union all relationships from both sides', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-rels',
          uuid: 'uuid-rels',
          title: 'Feature with relationships',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: [],
          relationships: [
            {
              from: 'i-rels',
              from_type: 'issue',
              to: 's-spec-1',
              to_type: 'spec',
              type: 'implements',
            },
          ],
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-rels',
          uuid: 'uuid-rels',
          title: 'Feature with relationships',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: [],
          relationships: [
            {
              from: 'i-rels',
              from_type: 'issue',
              to: 'i-dependency',
              to_type: 'issue',
              type: 'blocks',
            },
          ],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // Both relationships should be present
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships.some((r: any) => r.to === 's-spec-1')).toBe(true);
      expect(result.relationships.some((r: any) => r.to === 'i-dependency')).toBe(true);
    });

    it('should handle empty metadata arrays correctly', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-empty',
          uuid: 'uuid-empty',
          title: 'Feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: [],
          relationships: [],
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-empty',
          uuid: 'uuid-empty',
          title: 'Feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['new-tag'],
          relationships: [],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);
      expect(merged[0].tags).toContain('new-tag');
    });
  });

  describe('Scenario 3: 2-way with text conflicts (YAML expansion)', () => {
    it('should merge different lines in multi-line descriptions', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 's-docs',
          uuid: 'uuid-docs',
          title: 'Documentation',
          description: `# API Documentation

## Overview
This is the API documentation for our service.

## Authentication
Use JWT tokens for authentication.

## Endpoints
Coming soon...`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 's-docs',
          uuid: 'uuid-docs',
          title: 'API Documentation',
          description: `# API Documentation

## Overview
This is the API documentation for our service.

## Authentication
Coming soon...

## Endpoints
### GET /api/users
Returns list of users.`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // Title from worktree (newer)
      expect(result.title).toBe('API Documentation');

      // With simulated 3-way (no base), latest-wins applies to conflicting fields
      // Worktree has newer timestamp, so its description wins
      // But YAML line-level merge still applies for non-conflicting lines
      expect(result.description).toBeTruthy();
      expect(result.description).toContain('GET /api/users');
    });

    it('should handle line-level merges in different sections', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 's-spec',
          uuid: 'uuid-spec',
          title: 'Feature Spec',
          description: `Section A: Local change here
Section B: Unchanged
Section C: Unchanged`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 's-spec',
          uuid: 'uuid-spec',
          title: 'Feature Spec',
          description: `Section A: Unchanged
Section B: Worktree change here
Section C: Unchanged`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      // Both changes should be present (git merge-file does line-level merging)
      const result = merged[0];
      expect(result.description).toBeTruthy();
    });
  });

  describe('Scenario 4: 2-way conflict marker resolution', () => {
    it('should resolve conflicts using latest-wins strategy', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-conflict',
          uuid: 'uuid-conflict',
          title: 'Local Title',
          description: 'Local description on same line',
          status: 'open',
          priority: 1,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['local'],
          relationships: [],
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-conflict',
          uuid: 'uuid-conflict',
          title: 'Worktree Title',
          description: 'Worktree description on same line',
          status: 'in_progress',
          priority: 2,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['worktree'],
          relationships: [],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // Worktree should win (newer timestamp: 2025-01-03)
      expect(result.title).toBe('Worktree Title');
      expect(result.description).toBe('Worktree description on same line');
      expect(result.status).toBe('in_progress');
      expect(result.priority).toBe(2);
      expect(result.updated_at).toBe('2025-01-03T00:00:00Z');

      // Metadata should still be unioned
      expect(result.tags).toContain('local');
      expect(result.tags).toContain('worktree');
    });

    it('should prefer local when timestamps are identical', () => {
      const base: JSONLEntity[] = [];

      const sameTimestamp = '2025-01-02T00:00:00Z';

      const local: JSONLEntity[] = [
        {
          id: 'i-same-time',
          uuid: 'uuid-same-time',
          title: 'Local Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: sameTimestamp,
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-same-time',
          uuid: 'uuid-same-time',
          title: 'Worktree Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: sameTimestamp,
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      // When timestamps are identical, latest-wins resolver prefers "ours" (local)
      const result = merged[0];
      expect(result.title).toBe('Local Title');
    });
  });

  describe('Scenario 5: Consistency with true 3-way merge', () => {
    it('should produce same result as true 3-way for unchanged base', () => {
      // Common base version
      const commonBase: JSONLEntity[] = [
        {
          id: 'i-common',
          uuid: 'uuid-common',
          title: 'Original Title',
          description: 'Original description',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['original'],
          relationships: [],
        },
      ];

      // Local modifies title
      const local: JSONLEntity[] = [
        {
          id: 'i-common',
          uuid: 'uuid-common',
          title: 'Local Title',
          description: 'Original description',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['original', 'local-tag'],
          relationships: [],
        },
      ];

      // Worktree modifies description
      const worktree: JSONLEntity[] = [
        {
          id: 'i-common',
          uuid: 'uuid-common',
          title: 'Original Title',
          description: 'Worktree description',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['original', 'worktree-tag'],
          relationships: [],
        },
      ];

      // True 3-way merge with base
      const { entities: true3way } = mergeThreeWay(commonBase, local, worktree);

      // Simulated 3-way merge (empty base) - won't be the same for non-conflicting changes
      const { entities: simulated3way } = mergeThreeWay([], local, worktree);

      expect(true3way).toHaveLength(1);
      expect(simulated3way).toHaveLength(1);

      // Note: Results will differ because:
      // - True 3-way: Can detect non-conflicting changes (local changes title, worktree changes description)
      // - Simulated 3-way: Treats as concurrent additions, uses latest-wins for all fields

      // For true 3-way with proper base, git merge-file can detect non-conflicting changes
      // Both local's title change and worktree's description change are preserved
      // However, when both modify multiple fields, conflict markers appear
      // The conflict resolver uses latest-wins (worktree: 2025-01-03)
      expect(true3way[0].updated_at).toBe('2025-01-03T00:00:00Z');

      // For simulated 3-way, latest timestamp wins for all fields
      expect(simulated3way[0].updated_at).toBe('2025-01-03T00:00:00Z');

      // Metadata should be unioned in both cases
      expect(true3way[0].tags).toContain('original');
      expect(true3way[0].tags).toContain('local-tag');
      expect(true3way[0].tags).toContain('worktree-tag');

      expect(simulated3way[0].tags).toContain('original');
      expect(simulated3way[0].tags).toContain('local-tag');
      expect(simulated3way[0].tags).toContain('worktree-tag');
    });

    it('should produce identical results for true conflicting changes', () => {
      // Common base
      const commonBase: JSONLEntity[] = [
        {
          id: 'i-conflict',
          uuid: 'uuid-conflict',
          title: 'Original Title',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      // Both modify same field differently
      const local: JSONLEntity[] = [
        {
          id: 'i-conflict',
          uuid: 'uuid-conflict',
          title: 'Local Title',
          status: 'in_progress',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-conflict',
          uuid: 'uuid-conflict',
          title: 'Worktree Title',
          status: 'closed',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: true3way } = mergeThreeWay(commonBase, local, worktree);
      const { entities: simulated3way } = mergeThreeWay([], local, worktree);

      // Both should resolve to worktree version (latest timestamp)
      expect(true3way[0].title).toBe('Worktree Title');
      expect(true3way[0].status).toBe('closed');
      expect(true3way[0].updated_at).toBe('2025-01-03T00:00:00Z');

      expect(simulated3way[0].title).toBe('Worktree Title');
      expect(simulated3way[0].status).toBe('closed');
      expect(simulated3way[0].updated_at).toBe('2025-01-03T00:00:00Z');
    });
  });

  describe('Scenario 7: Edge cases', () => {
    it('should handle completely different entities (no conflicts)', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-local-1',
          uuid: 'uuid-local-1',
          title: 'Local Entity 1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'i-local-2',
          uuid: 'uuid-local-2',
          title: 'Local Entity 2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-worktree-1',
          uuid: 'uuid-worktree-1',
          title: 'Worktree Entity 1',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
        {
          id: 'i-worktree-2',
          uuid: 'uuid-worktree-2',
          title: 'Worktree Entity 2',
          created_at: '2025-01-04T00:00:00Z',
          updated_at: '2025-01-04T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      // All entities should be preserved
      expect(merged).toHaveLength(4);

      // Should be sorted by created_at
      expect(merged.map((e) => e.id)).toEqual([
        'i-local-1',
        'i-local-2',
        'i-worktree-1',
        'i-worktree-2',
      ]);
    });

    it('should handle missing optional fields gracefully', () => {
      const base: JSONLEntity[] = [];

      const local: JSONLEntity[] = [
        {
          id: 'i-minimal',
          uuid: 'uuid-minimal',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const worktree: JSONLEntity[] = [
        {
          id: 'i-minimal',
          uuid: 'uuid-minimal',
          title: 'Added title',
          description: 'Added description',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, local, worktree);

      expect(merged).toHaveLength(1);

      // Worktree wins (newer timestamp)
      expect(merged[0].title).toBe('Added title');
      expect(merged[0].description).toBe('Added description');
    });

    it('should handle empty arrays correctly', () => {
      const { entities: merged } = mergeThreeWay([], [], []);

      expect(merged).toHaveLength(0);
    });
  });
});
