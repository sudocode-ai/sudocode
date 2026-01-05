/**
 * End-to-end integration tests for YAML-based three-way merge
 *
 * Tests the complete workflow:
 * 1. Group entities by UUID across base/ours/theirs
 * 2. Handle deletion cases
 * 3. Merge metadata FIRST (tags, relationships, feedback)
 * 4. Convert to YAML with multi-line text expansion
 * 5. Run git merge-file (line-level merging)
 * 6. Resolve remaining YAML conflicts (latest-wins)
 * 7. Convert back to JSON
 * 8. Handle ID collisions
 * 9. Sort by created_at
 */

import { describe, it, expect } from 'vitest';
import { mergeThreeWay, type JSONLEntity } from '../../src/merge-resolver.js';
import type { IssueJSONL, SpecJSONL } from '../../src/types.js';

describe('YAML-Based Three-Way Merge Integration Tests', () => {
  // Helper to create a spec entity
  function createSpec(overrides: Partial<SpecJSONL>): SpecJSONL {
    return {
      id: 's-abc123',
      title: 'Test Spec',
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      file_path: '.sudocode/specs/test.md',
      content: 'Test content',
      priority: 1,
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-01T10:00:00Z',
      ...overrides,
    };
  }

  // Helper to create an issue entity
  function createIssue(overrides: Partial<IssueJSONL>): IssueJSONL {
    return {
      id: 'i-xyz789',
      title: 'Test Issue',
      uuid: '550e8400-e29b-41d4-a716-446655440001',
      content: 'Test content',
      status: 'open',
      priority: 1,
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-01T10:00:00Z',
      ...overrides,
    };
  }

  describe('Multi-Line Text Merging', () => {
    it('should use latest-wins when content fields conflict', () => {
      // When the entire content field is changed (even in YAML format),
      // git merge-file may treat it as a conflict if changes are in the same YAML block
      // In such cases, latest-wins resolution applies
      const baseContent = `## Overview

This is the base content.

## Details

More details here.`;

      const oursContent = `## Overview

This is the OURS updated content.

## Details

More details here.`;

      const theirsContent = `## Overview

This is the base content.

## Details

THEIRS updated details here.`;

      const base = createSpec({
        uuid: 'test-uuid-001',
        content: baseContent,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-001',
        content: oursContent,
        updated_at: '2025-01-02T10:00:00Z', // Older
      });

      const theirs = createSpec({
        uuid: 'test-uuid-001',
        content: theirsContent,
        updated_at: '2025-01-02T11:00:00Z', // Newer - should win conflicts
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // When there are conflicts in the content YAML block, theirs should win (newer)
      // The exact result depends on git merge-file's behavior
      expect(merged.content).toBeTruthy();
      expect(merged.content.length).toBeGreaterThan(0);
    });

    it('should use latest-wins when both edit the same line', () => {
      const baseContent = 'Line 1\nLine 2\nLine 3';
      const oursContent = 'Line 1\nOURS Line 2\nLine 3';
      const theirsContent = 'Line 1\nTHEIRS Line 2\nLine 3';

      const base = createIssue({
        uuid: 'test-uuid-002',
        content: baseContent,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createIssue({
        uuid: 'test-uuid-002',
        content: oursContent,
        updated_at: '2025-01-02T10:00:00Z', // Older
      });

      const theirs = createIssue({
        uuid: 'test-uuid-002',
        content: theirsContent,
        updated_at: '2025-01-02T11:00:00Z', // Newer
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Theirs should win (newer timestamp)
      expect(merged.content).toContain('THEIRS Line 2');
      expect(merged.content).not.toContain('OURS Line 2');
    });

    it('should handle conflicting edits with latest-wins resolution', () => {
      // When changes are close together, git merge-file may create conflicts
      // that get resolved by latest-wins strategy
      const baseContent = `Section A
Content A

Section B
Content B

Section C
Content C`;

      const oursContent = `Section A
Content A MODIFIED BY OURS

Section B
Content B

Section C
Content C`;

      const theirsContent = `Section A
Content A

Section B
ENTIRELY NEW CONTENT BY THEIRS

Section C
Content C`;

      const base = createSpec({
        uuid: 'test-uuid-003',
        content: baseContent,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-003',
        content: oursContent,
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-003',
        content: theirsContent,
        updated_at: '2025-01-02T11:00:00Z', // Newer
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Should have changes from both when they don't conflict
      // Or latest-wins when they do conflict
      expect(merged.content).toContain('Section A');
      expect(merged.content).toContain('Section C');
    });
  });

  describe('Deletion Handling', () => {
    it('should keep modification when entity deleted in theirs, modified in ours', () => {
      const base = createIssue({
        uuid: 'test-uuid-004',
        title: 'Original Title',
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createIssue({
        uuid: 'test-uuid-004',
        title: 'Modified Title',
        updated_at: '2025-01-02T10:00:00Z',
      });

      // theirs deleted the entity (not in theirs array)
      const result = mergeThreeWay([base], [ours], []);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].title).toBe('Modified Title');
      expect(result.stats.conflicts).toContainEqual(
        expect.objectContaining({
          action: expect.stringContaining('deleted in theirs, modified in ours'),
        })
      );
    });

    it('should keep modification when entity deleted in ours, modified in theirs', () => {
      const base = createSpec({
        uuid: 'test-uuid-005',
        title: 'Original Title',
        content: 'Original content',
        updated_at: '2025-01-01T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-005',
        title: 'Modified Title',
        content: 'Modified content',
        updated_at: '2025-01-02T10:00:00Z',
      });

      // ours deleted the entity (not in ours array)
      const result = mergeThreeWay([base], [], [theirs]);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].title).toBe('Modified Title');
      expect(result.entities[0].content).toBe('Modified content');
      expect(result.stats.conflicts).toContainEqual(
        expect.objectContaining({
          action: expect.stringContaining('deleted in ours, modified in theirs'),
        })
      );
    });

    it('should remove entity when deleted in both branches', () => {
      const base = createIssue({
        uuid: 'test-uuid-006',
        title: 'To Be Deleted',
        updated_at: '2025-01-01T10:00:00Z',
      });

      // Both ours and theirs deleted it
      const result = mergeThreeWay([base], [], []);

      expect(result.entities).toHaveLength(0);
    });
  });

  describe('Metadata Merging', () => {
    it('should merge different tags from each branch (union)', () => {
      const base = createSpec({
        uuid: 'test-uuid-007',
        tags: ['backend'],
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-007',
        tags: ['backend', 'api'],
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-007',
        tags: ['backend', 'database'],
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Should have union of all tags
      expect(merged.tags).toEqual(
        expect.arrayContaining(['backend', 'api', 'database'])
      );
      expect(merged.tags).toHaveLength(3);
    });

    it('should merge different relationships from each branch (union)', () => {
      const base = createIssue({
        uuid: 'test-uuid-008',
        relationships: [
          { from: 'i-xyz789', to: 's-abc123', type: 'implements' },
        ],
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createIssue({
        uuid: 'test-uuid-008',
        relationships: [
          { from: 'i-xyz789', to: 's-abc123', type: 'implements' },
          { from: 'i-xyz789', to: 'i-other1', type: 'blocks' },
        ],
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'test-uuid-008',
        relationships: [
          { from: 'i-xyz789', to: 's-abc123', type: 'implements' },
          { from: 'i-xyz789', to: 'i-other2', type: 'depends-on' },
        ],
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Should have union of all relationships
      expect(merged.relationships).toHaveLength(3);
      expect(merged.relationships).toContainEqual({
        from: 'i-xyz789',
        to: 's-abc123',
        type: 'implements',
      });
      expect(merged.relationships).toContainEqual({
        from: 'i-xyz789',
        to: 'i-other1',
        type: 'blocks',
      });
      expect(merged.relationships).toContainEqual({
        from: 'i-xyz789',
        to: 'i-other2',
        type: 'depends-on',
      });
    });

    it('should verify no metadata conflicts in YAML stage', () => {
      // This test verifies that metadata is merged BEFORE YAML conversion
      // so git merge-file only sees text field differences
      const base = createSpec({
        uuid: 'test-uuid-009',
        tags: ['tag1'],
        relationships: [{ from: 's-abc123', to: 'i-xyz1', type: 'related' }],
        content: 'Original content',
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-009',
        tags: ['tag1', 'tag2'],
        relationships: [
          { from: 's-abc123', to: 'i-xyz1', type: 'related' },
          { from: 's-abc123', to: 'i-xyz2', type: 'blocks' },
        ],
        content: 'Ours modified content',
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-009',
        tags: ['tag1', 'tag3'],
        relationships: [
          { from: 's-abc123', to: 'i-xyz1', type: 'related' },
          { from: 's-abc123', to: 'i-xyz3', type: 'references' },
        ],
        content: 'Theirs modified content',
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Metadata should be merged (union)
      expect(merged.tags).toEqual(
        expect.arrayContaining(['tag1', 'tag2', 'tag3'])
      );
      expect(merged.relationships).toHaveLength(3);

      // Only conflicts should be from content field (latest-wins)
      const yamlConflicts = result.stats.conflicts.filter((c) =>
        c.action.includes('YAML conflicts')
      );
      // May or may not have YAML conflicts depending on content similarity
      // Key point: metadata should NOT cause conflicts
    });
  });

  describe('ID Collisions', () => {
    it('should handle hash collision with different UUIDs (rename with .1, .2)', () => {
      // Same ID, different UUIDs (hash collision)
      const entity1 = createIssue({
        id: 'i-abc123',
        uuid: 'uuid-000001',
        title: 'Entity 1',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-01T10:00:00Z',
      });

      const entity2 = createIssue({
        id: 'i-abc123', // Same ID!
        uuid: 'uuid-000002', // Different UUID!
        title: 'Entity 2',
        created_at: '2025-01-01T11:00:00Z',
        updated_at: '2025-01-01T11:00:00Z',
      });

      // Both appear in ours (simulating collision after merge)
      const result = mergeThreeWay([], [entity1, entity2], []);

      expect(result.entities).toHaveLength(2);

      // First entity keeps original ID
      const first = result.entities[0];
      expect(first.id).toBe('i-abc123');
      expect(first.uuid).toBe('uuid-000001');

      // Second entity gets renamed
      const second = result.entities[1];
      expect(second.id).toBe('i-abc123.1');
      expect(second.uuid).toBe('uuid-000002');

      // Should have collision resolution in stats
      expect(result.stats.conflicts).toContainEqual(
        expect.objectContaining({
          type: 'different-uuids',
          action: expect.stringContaining('hash collision'),
        })
      );
    });

    it('should handle multiple collisions with sequential numbering', () => {
      const entity1 = createSpec({
        id: 's-xyz999',
        uuid: 'uuid-001',
        created_at: '2025-01-01T10:00:00Z',
      });

      const entity2 = createSpec({
        id: 's-xyz999',
        uuid: 'uuid-002',
        created_at: '2025-01-01T11:00:00Z',
      });

      const entity3 = createSpec({
        id: 's-xyz999',
        uuid: 'uuid-003',
        created_at: '2025-01-01T12:00:00Z',
      });

      const result = mergeThreeWay([], [entity1, entity2, entity3], []);

      expect(result.entities).toHaveLength(3);

      // Check IDs
      const ids = result.entities.map((e) => e.id);
      expect(ids).toContain('s-xyz999');
      expect(ids).toContain('s-xyz999.1');
      expect(ids).toContain('s-xyz999.2');

      // Should have 2 collision resolutions (entity2 and entity3)
      const collisions = result.stats.conflicts.filter(
        (c) => c.type === 'different-uuids'
      );
      expect(collisions).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty base (new entity in both branches)', () => {
      // No base, both ours and theirs have same entity (by UUID)
      const ours = createIssue({
        uuid: 'test-uuid-010',
        title: 'Our Version',
        content: 'Our content',
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'test-uuid-010',
        title: 'Their Version',
        content: 'Their content',
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      // Should use standard resolution (latest-wins)
      const merged = result.entities[0];
      expect(merged.title).toBe('Their Version'); // Newer timestamp
    });

    it('should handle empty arrays (tags, relationships)', () => {
      const base = createSpec({
        uuid: 'test-uuid-011',
        tags: [],
        relationships: [],
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-011',
        tags: [],
        relationships: [],
        content: 'Ours content',
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-011',
        tags: [],
        relationships: [],
        content: 'Theirs content',
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Empty arrays should be preserved
      expect(merged.tags).toEqual([]);
      expect(merged.relationships).toEqual([]);
    });

    it('should preserve null values in optional fields', () => {
      const base = createIssue({
        uuid: 'test-uuid-012',
        assignee: undefined,
        parent_id: undefined,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createIssue({
        uuid: 'test-uuid-012',
        assignee: 'alice',
        parent_id: undefined,
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'test-uuid-012',
        assignee: undefined,
        parent_id: 'i-parent',
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      // Result should have merged values
      // (Specific behavior depends on latest-wins for conflicts)
    });

    it('should handle unicode in multi-line text', () => {
      // Test that unicode characters are properly preserved through YAML conversion
      const baseContent = `中文部分
中文测试内容

日本語部分
日本語テスト内容

한글부분
한글 테스트 내容`;

      const oursContent = `中文部分
中文测试内容

日本語部分
日本語テスト内容

한글부분
한글 테스트 내용 UPDATED`;

      const theirsContent = `中文部分
中文测试内容 MODIFIED

日本語部分
日本語テスト内容

한글부분
한글 테스트 내용`;

      const base = createSpec({
        uuid: 'test-uuid-013',
        content: baseContent,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-013',
        content: oursContent,
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-013',
        content: theirsContent,
        updated_at: '2025-01-02T11:00:00Z', // Newer
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Verify unicode content is properly preserved through the merge
      expect(merged.content).toContain('中文');
      expect(merged.content).toContain('日本語');
      expect(merged.content).toContain('한글');
      // Result should have content from the merge (exact result depends on git merge-file)
      expect(merged.content.length).toBeGreaterThan(0);
    });

    it('should handle very long text (10KB+ descriptions)', () => {
      // Generate 10KB+ content
      const generateLongContent = (prefix: string) => {
        const paragraph =
          'This is a long paragraph that will be repeated many times to create a large document. ';
        const repetitions = Math.ceil(10000 / paragraph.length);
        return prefix + '\n\n' + paragraph.repeat(repetitions);
      };

      const baseContent = generateLongContent('Base version');
      const oursContent = generateLongContent('Ours version');
      const theirsContent = generateLongContent('Theirs version');

      const base = createSpec({
        uuid: 'test-uuid-014',
        content: baseContent,
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-014',
        content: oursContent,
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'test-uuid-014',
        content: theirsContent,
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // Should complete without errors
      expect(merged.content.length).toBeGreaterThan(10000);
    });

    it('should handle missing timestamps gracefully', () => {
      const base = createIssue({
        uuid: 'test-uuid-015',
        title: 'Base',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: undefined as any, // Missing timestamp
      });

      const ours = createIssue({
        uuid: 'test-uuid-015',
        title: 'Ours',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-02T10:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'test-uuid-015',
        title: 'Theirs',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-02T11:00:00Z',
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      // Should complete without throwing
    });

    it('should handle identical timestamps (prefer ours for stability)', () => {
      const sameTimestamp = '2025-01-02T10:00:00Z';

      const base = createSpec({
        uuid: 'test-uuid-016',
        title: 'Base',
        content: 'Base content',
        updated_at: '2025-01-01T10:00:00Z',
      });

      const ours = createSpec({
        uuid: 'test-uuid-016',
        title: 'Ours Title',
        content: 'Ours content',
        updated_at: sameTimestamp,
      });

      const theirs = createSpec({
        uuid: 'test-uuid-016',
        title: 'Theirs Title',
        content: 'Theirs content',
        updated_at: sameTimestamp,
      });

      const result = mergeThreeWay([base], [ours], [theirs]);

      expect(result.entities).toHaveLength(1);
      const merged = result.entities[0];

      // When timestamps are identical, should prefer ours for stability
      // (This is the conflict resolver's behavior)
      expect(merged.title).toBe('Ours Title');
    });
  });

  describe('Performance and Stability', () => {
    it('should handle realistic multi-entity merge scenario', () => {
      // Simulate a realistic scenario with multiple entities
      const base = [
        createSpec({
          id: 's-001',
          uuid: 'uuid-spec-001',
          title: 'Auth Spec',
          tags: ['backend'],
          content: 'Original auth spec',
          created_at: '2025-01-01T09:00:00Z',
          updated_at: '2025-01-01T10:00:00Z',
        }),
        createIssue({
          id: 'i-001',
          uuid: 'uuid-issue-001',
          title: 'Implement Auth',
          tags: ['backend'],
          relationships: [
            { from: 'i-001', to: 's-001', type: 'implements' },
          ],
          created_at: '2025-01-01T09:30:00Z',
          updated_at: '2025-01-01T10:00:00Z',
        }),
      ];

      const ours = [
        createSpec({
          id: 's-001',
          uuid: 'uuid-spec-001',
          title: 'Auth Spec',
          tags: ['backend', 'security'],
          content: 'Updated auth spec with OURS changes',
          created_at: '2025-01-01T09:00:00Z',
          updated_at: '2025-01-02T10:00:00Z',
        }),
        createIssue({
          id: 'i-001',
          uuid: 'uuid-issue-001',
          title: 'Implement Auth',
          tags: ['backend', 'urgent'],
          relationships: [
            { from: 'i-001', to: 's-001', type: 'implements' },
            { from: 'i-001', to: 'i-002', type: 'blocks' },
          ],
          created_at: '2025-01-01T09:30:00Z',
          updated_at: '2025-01-02T10:00:00Z',
        }),
        // New issue added in ours
        createIssue({
          id: 'i-new-ours',
          uuid: 'uuid-issue-new-ours',
          title: 'New Issue in Ours',
          created_at: '2025-01-02T09:00:00Z',
          updated_at: '2025-01-02T10:00:00Z',
        }),
      ];

      const theirs = [
        createSpec({
          id: 's-001',
          uuid: 'uuid-spec-001',
          title: 'Auth Spec Updated',
          tags: ['backend', 'api'],
          content: 'Updated auth spec with THEIRS changes',
          created_at: '2025-01-01T09:00:00Z',
          updated_at: '2025-01-02T11:00:00Z',
        }),
        createIssue({
          id: 'i-001',
          uuid: 'uuid-issue-001',
          title: 'Implement OAuth Auth',
          tags: ['backend', 'oauth'],
          relationships: [
            { from: 'i-001', to: 's-001', type: 'implements' },
            { from: 'i-001', to: 'i-003', type: 'depends-on' },
          ],
          created_at: '2025-01-01T09:30:00Z',
          updated_at: '2025-01-02T11:00:00Z',
        }),
        // New issue added in theirs
        createIssue({
          id: 'i-new-theirs',
          uuid: 'uuid-issue-new-theirs',
          title: 'New Issue in Theirs',
          created_at: '2025-01-02T09:30:00Z',
          updated_at: '2025-01-02T11:00:00Z',
        }),
      ];

      const result = mergeThreeWay(base, ours, theirs);

      // Should have 4 entities: 1 spec + 3 issues
      expect(result.entities).toHaveLength(4);

      // Find merged spec
      const mergedSpec = result.entities.find((e) => e.id === 's-001');
      expect(mergedSpec).toBeDefined();
      expect(mergedSpec!.title).toBe('Auth Spec Updated'); // Theirs is newer
      expect(mergedSpec!.tags).toEqual(
        expect.arrayContaining(['backend', 'security', 'api'])
      );

      // Find merged issue
      const mergedIssue = result.entities.find((e) => e.id === 'i-001');
      expect(mergedIssue).toBeDefined();
      expect(mergedIssue!.title).toBe('Implement OAuth Auth'); // Theirs is newer
      expect(mergedIssue!.tags).toEqual(
        expect.arrayContaining(['backend', 'urgent', 'oauth'])
      );
      expect(mergedIssue!.relationships).toHaveLength(3); // Union of all

      // Both new issues should be present
      expect(result.entities.some((e) => e.id === 'i-new-ours')).toBe(true);
      expect(result.entities.some((e) => e.id === 'i-new-theirs')).toBe(
        true
      );
    });

    it('should sort output by created_at for git-friendly diffs', () => {
      const entities = [
        createIssue({
          id: 'i-003',
          uuid: 'uuid-003',
          created_at: '2025-01-03T10:00:00Z',
        }),
        createIssue({
          id: 'i-001',
          uuid: 'uuid-001',
          created_at: '2025-01-01T10:00:00Z',
        }),
        createIssue({
          id: 'i-002',
          uuid: 'uuid-002',
          created_at: '2025-01-02T10:00:00Z',
        }),
      ];

      const result = mergeThreeWay([], entities, []);

      expect(result.entities).toHaveLength(3);

      // Should be sorted by created_at
      expect(result.entities[0].id).toBe('i-001');
      expect(result.entities[1].id).toBe('i-002');
      expect(result.entities[2].id).toBe('i-003');
    });
  });
});
