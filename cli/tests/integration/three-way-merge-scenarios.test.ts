/**
 * Integration tests for YAML three-way merge user scenarios
 *
 * This test file covers end-to-end scenarios that would be encountered
 * by users in real git merge situations. These tests verify that:
 *
 * 1. Multi-line text fields merge correctly when changes are to different lines
 * 2. Metadata fields are properly three-way merged
 * 3. Array fields (tags, relationships) are merged as union
 * 4. resolve-conflicts and merge-driver produce consistent results
 * 5. Edge cases are handled gracefully
 *
 * These tests are designed to catch bugs like i-1mnm and i-3dcj where
 * the implementation doesn't match the expected three-way merge semantics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  mergeThreeWay,
  resolveEntities,
  type JSONLEntity,
} from '../../src/merge-resolver.js';
import type { IssueJSONL, SpecJSONL } from '../../src/types.js';
import { readJSONL, writeJSONL } from '../../src/jsonl.js';
import {
  handleMergeDriver,
  handleResolveConflicts,
  type CommandContext,
} from '../../src/cli/merge-commands.js';
import { initDatabase } from '../../src/db.js';
import type Database from 'better-sqlite3';

describe('Three-Way Merge User Scenarios', () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-scenarios-'));
    const dbPath = path.join(tmpDir, 'cache.db');
    db = initDatabase({ path: dbPath });
    ctx = {
      db,
      outputDir: tmpDir,
      jsonOutput: false,
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Helper to create a test issue
  function createIssue(overrides: Partial<IssueJSONL>): IssueJSONL {
    return {
      id: 'i-test',
      uuid: 'test-uuid',
      title: 'Test Issue',
      content: 'Test content',
      status: 'open',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      relationships: [],
      tags: [],
      ...overrides,
    };
  }

  // Helper to create a test spec
  function createSpec(overrides: Partial<SpecJSONL>): SpecJSONL {
    return {
      id: 's-test',
      uuid: 'test-uuid',
      title: 'Test Spec',
      file_path: '.sudocode/specs/test.md',
      content: 'Test content',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      relationships: [],
      tags: [],
      ...overrides,
    };
  }

  describe('Multi-line text fields', () => {
    it('should preserve changes to different lines', () => {
      // This is the key test case from i-sdt7 #1
      const base = createIssue({
        uuid: 'uuid-test',
        content: 'Line 1\nLine 2\nLine 3',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        content: 'Line 1 MODIFIED\nLine 2\nLine 3',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        content: 'Line 1\nLine 2\nLine 3 MODIFIED',
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Both modifications preserved (git merge-file should handle this)
      // This tests whether YAML line-level merging works
      // NOTE: This may fail if i-3dcj is not fixed (metadata merged before git merge-file)
      const merged = entities[0];
      expect(merged.content).toContain('Line 1 MODIFIED');
      expect(merged.content).toContain('Line 3 MODIFIED');
    });

    it('should create conflict for changes to same line', () => {
      const base = createSpec({
        uuid: 'uuid-test',
        content: 'Line 1\nLine 2\nLine 3',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        content: 'Line 1\nOURS Line 2\nLine 3',
        updated_at: '2025-01-02T00:00:00Z', // Older
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        content: 'Line 1\nTHEIRS Line 2\nLine 3',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // When same line edited, git merge-file creates conflict
      // yaml-conflict-resolver applies latest-wins
      // EXPECTED: theirs wins (newer timestamp)
      const merged = entities[0];
      expect(merged.content).toContain('THEIRS Line 2');
      expect(merged.content).not.toContain('OURS Line 2');
    });

    it('should handle additions at different positions', () => {
      const base = createIssue({
        uuid: 'uuid-test',
        content: 'Section 1\n\nSection 2',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        content: 'Section 1\nAdded by OURS\n\nSection 2',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        content: 'Section 1\n\nSection 2\n\nAdded by THEIRS',
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Both additions preserved
      const merged = entities[0];
      expect(merged.content).toContain('Added by OURS');
      expect(merged.content).toContain('Added by THEIRS');
    });

    it('should handle multi-paragraph changes in different sections', () => {
      const baseContent = `## Introduction
This is the introduction.

## Details
This is the details section.

## Conclusion
This is the conclusion.`;

      const oursContent = `## Introduction
This is the UPDATED introduction.

## Details
This is the details section.

## Conclusion
This is the conclusion.`;

      const theirsContent = `## Introduction
This is the introduction.

## Details
This is the details section.

## Conclusion
This is the UPDATED conclusion.`;

      const base = createSpec({
        uuid: 'uuid-test',
        content: baseContent,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        content: oursContent,
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        content: theirsContent,
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Both paragraph changes preserved
      const merged = entities[0];
      expect(merged.content).toContain('UPDATED introduction');
      expect(merged.content).toContain('UPDATED conclusion');
    });
  });

  describe('Metadata fields', () => {
    it('should preserve change when only one branch modified', () => {
      // This is test case #2 from i-sdt7
      const base = createIssue({
        uuid: 'uuid-test',
        status: 'open',
        priority: 2,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        status: 'in_progress', // Changed status
        priority: 2,
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        status: 'open', // Unchanged
        priority: 2,
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: in_progress (git three-way merge: only we changed it)
      // NOTE: This might work by accident if metadata merged before YAML (i-3dcj bug)
      // The test passes but for the wrong reason - we need git to see the change!
      expect(entities[0].status).toBe('in_progress');
    });

    it('should resolve conflict with latest-wins when both modified', () => {
      // This is test case #3 from i-sdt7
      const base = createIssue({
        uuid: 'uuid-test',
        status: 'open',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        status: 'in_progress',
        updated_at: '2025-01-02T00:00:00Z', // Older
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        status: 'blocked',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: blocked (latest-wins applied AFTER git merge-file detects conflict)
      // NOTE: Currently fails due to i-3dcj - metadata merged BEFORE git merge-file
      expect(entities[0].status).toBe('blocked');
    });

    it('should handle multiple metadata changes', () => {
      const base = createIssue({
        uuid: 'uuid-test',
        status: 'open',
        priority: 2,
        assignee: undefined,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        status: 'in_progress', // Changed
        priority: 1, // Changed
        assignee: 'alice', // Changed
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        status: 'blocked', // Different change
        priority: 2, // Unchanged
        assignee: 'bob', // Different change
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED (with field-level three-way merge):
      // - status: blocked (both changed, theirs newer via latest-wins)
      // - priority: 1 (only ours changed, so ours wins via three-way merge)
      // - assignee: bob (both changed, theirs newer via latest-wins)
      //
      // NOTE: With proper field-level three-way merge, each scalar field
      // is merged independently. Only fields that conflict (both branches
      // changed them) use latest-wins. Fields changed by only one branch
      // get that branch's value.
      const merged = entities[0];
      expect(merged.status).toBe('blocked');
      expect(merged.priority).toBe(1); // Only ours changed - ours wins
      expect(merged.assignee).toBe('bob');
    });

    it('should handle title changes in both branches', () => {
      const base = createSpec({
        uuid: 'uuid-test',
        title: 'Original Title',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        title: 'Our Title',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        title: 'Their Title',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);
      expect(entities[0].title).toBe('Their Title');
    });
  });

  describe('Array fields', () => {
    it('should merge tags from both branches (union)', () => {
      // This is test case #4 from i-sdt7
      const base = createSpec({
        uuid: 'uuid-test',
        tags: ['backend'],
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        tags: ['backend', 'security'], // Added security
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        tags: ['backend', 'api'], // Added api
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Union of all tags
      const merged = entities[0];
      expect(merged.tags).toEqual(
        expect.arrayContaining(['backend', 'security', 'api'])
      );
      expect(merged.tags).toHaveLength(3);
    });

    it('should merge relationships from both branches', () => {
      const base = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-abc', type: 'implements' },
        ],
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-abc', type: 'implements' },
          { from: 'i-test', to: 'i-other1', type: 'blocks' },
        ],
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-abc', type: 'implements' },
          { from: 'i-test', to: 'i-other2', type: 'depends-on' },
        ],
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Union of all relationships (3 total)
      const merged = entities[0];
      expect(merged.relationships).toHaveLength(3);
      expect(merged.relationships).toContainEqual({
        from: 'i-test',
        to: 's-abc',
        type: 'implements',
      });
      expect(merged.relationships).toContainEqual({
        from: 'i-test',
        to: 'i-other1',
        type: 'blocks',
      });
      expect(merged.relationships).toContainEqual({
        from: 'i-test',
        to: 'i-other2',
        type: 'depends-on',
      });
    });

    it('should handle feedback arrays', () => {
      const baseFeedback = [
        {
          id: 'fb-1',
          from_id: 'i-1',
          to_id: 's-1',
          feedback_type: 'comment' as const,
          content: 'Base feedback',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const oursFeedback = [
        ...baseFeedback,
        {
          id: 'fb-2',
          from_id: 'i-2',
          to_id: 's-1',
          feedback_type: 'suggestion' as const,
          content: 'Our feedback',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirsFeedback = [
        ...baseFeedback,
        {
          id: 'fb-3',
          from_id: 'i-3',
          to_id: 's-1',
          feedback_type: 'request' as const,
          content: 'Their feedback',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const base = createSpec({
        uuid: 'uuid-test',
        feedback: baseFeedback,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        feedback: oursFeedback,
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        feedback: theirsFeedback,
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Union of all feedback (3 total)
      const merged = entities[0];
      expect(merged.feedback).toHaveLength(3);
    });
  });

  describe('resolve-conflicts vs merge-driver', () => {
    it.skip('should produce identical results for same conflict', async () => {
      // This is test case #5 from i-sdt7
      // NOTE: This test will FAIL until i-1mnm is fixed!

      const baseEntity = createIssue({
        id: 'i-conflict',
        uuid: 'uuid-conflict',
        title: 'Base',
        content: 'Line 1\nLine 2\nLine 3',
        status: 'open',
        tags: ['base'],
        updated_at: '2025-01-01T00:00:00Z',
      });

      const oursEntity = createIssue({
        id: 'i-conflict',
        uuid: 'uuid-conflict',
        title: 'Ours',
        content: 'Line 1 MODIFIED\nLine 2\nLine 3',
        status: 'in_progress',
        tags: ['base', 'ours'],
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirsEntity = createIssue({
        id: 'i-conflict',
        uuid: 'uuid-conflict',
        title: 'Theirs',
        content: 'Line 1\nLine 2\nLine 3 MODIFIED',
        status: 'blocked',
        tags: ['base', 'theirs'],
        updated_at: '2025-01-03T00:00:00Z',
      });

      // Method 1: merge-driver (uses mergeThreeWay)
      const basePath = path.join(tmpDir, 'base.jsonl');
      const oursPath = path.join(tmpDir, 'ours.jsonl');
      const theirsPath = path.join(tmpDir, 'theirs.jsonl');

      await writeJSONL(basePath, [baseEntity]);
      await writeJSONL(oursPath, [oursEntity]);
      await writeJSONL(theirsPath, [theirsEntity]);

      const originalExit = process.exit;
      process.exit = (() => {}) as any;

      try {
        await handleMergeDriver({ base: basePath, ours: oursPath, theirs: theirsPath });
      } finally {
        process.exit = originalExit;
      }

      const driverResult = await readJSONL(oursPath);

      // Method 2: resolve-conflicts (currently uses resolveEntities, should use mergeThreeWay!)
      // Create conflict markers manually
      const conflictPath = path.join(tmpDir, 'conflict.jsonl');
      const conflictContent = `<<<<<<< HEAD
${JSON.stringify(oursEntity)}
=======
${JSON.stringify(theirsEntity)}
>>>>>>> feature`;

      fs.writeFileSync(conflictPath, conflictContent);

      await handleResolveConflicts(ctx, {});

      const resolveResult = await readJSONL(conflictPath);

      // EXPECTED: Same result from both methods
      // NOTE: This will FAIL because resolve-conflicts uses resolveEntities (two-way)
      // instead of mergeThreeWay (three-way)
      expect(resolveResult).toHaveLength(driverResult.length);

      // Both should preserve line changes from different lines
      expect(driverResult[0].content).toContain('Line 1 MODIFIED');
      expect(driverResult[0].content).toContain('Line 3 MODIFIED');

      // This expectation will FAIL until i-1mnm is fixed
      expect(resolveResult[0].content).toContain('Line 1 MODIFIED');
      expect(resolveResult[0].content).toContain('Line 3 MODIFIED');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty base (both added)', () => {
      // Test case #6 from i-sdt7
      const ours = createIssue({
        uuid: 'uuid-test',
        title: 'Our Version',
        content: 'Our content',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        title: 'Their Version',
        content: 'Their content',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: theirs wins (newer timestamp)
      expect(entities[0].title).toBe('Their Version');
    });

    it('should handle deletion in one branch, modification in other', () => {
      const base = createSpec({
        uuid: 'uuid-test',
        title: 'Original',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        title: 'Modified',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs: SpecJSONL[] = []; // Deleted

      const { entities } = mergeThreeWay([base], [ours], theirs);

      expect(entities).toHaveLength(1);

      // EXPECTED: modification wins
      expect(entities[0].title).toBe('Modified');
    });

    it('should handle very long text (> 1000 lines)', () => {
      const generateLongText = (prefix: string, lines: number) => {
        return Array.from({ length: lines }, (_, i) => `${prefix} line ${i + 1}`).join('\n');
      };

      const base = createIssue({
        uuid: 'uuid-test',
        content: generateLongText('Base', 1000),
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        content: generateLongText('Base', 1000).replace('Base line 10', 'OURS line 10'),
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        content: generateLongText('Base', 1000).replace('Base line 900', 'THEIRS line 900'),
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Both changes preserved
      expect(entities[0].content).toContain('OURS line 10');
      expect(entities[0].content).toContain('THEIRS line 900');
    });

    it('should handle unicode in multi-line text', () => {
      const baseContent = `中文段落
这是中文内容

日本語段落
これは日本語の内容です

한글 단락
이것은 한글 내용입니다`;

      const oursContent = baseContent.replace('这是中文内容', '这是修改的中文内容');
      const theirsContent = baseContent.replace('이것은 한글 내용입니다', '이것은 수정된 한글 내용입니다');

      const base = createSpec({
        uuid: 'uuid-test',
        content: baseContent,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        content: oursContent,
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        content: theirsContent,
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Both unicode changes preserved
      const merged = entities[0];
      expect(merged.content).toContain('这是修改的中文内容');
      expect(merged.content).toContain('이것은 수정된 한글 내용입니다');
    });

    it('should handle nested arrays in relationships', () => {
      const base = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-1', type: 'implements' },
        ],
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-1', type: 'implements' },
          { from: 'i-test', to: 's-2', type: 'implements' },
          { from: 'i-test', to: 'i-1', type: 'blocks' },
        ],
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        relationships: [
          { from: 'i-test', to: 's-1', type: 'implements' },
          { from: 'i-test', to: 's-3', type: 'implements' },
          { from: 'i-test', to: 'i-2', type: 'depends-on' },
        ],
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED: Union of all relationships (5 unique)
      const merged = entities[0];
      expect(merged.relationships).toHaveLength(5);
    });

    it('should handle same UUID with different IDs', () => {
      const base = createIssue({
        id: 'i-old',
        uuid: 'same-uuid',
        title: 'Base',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        id: 'i-ours',
        uuid: 'same-uuid',
        title: 'Ours',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        id: 'i-theirs',
        uuid: 'same-uuid',
        title: 'Theirs',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities, stats } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(2);

      // EXPECTED: One entity keeps newer version, other gets renamed
      const titles = entities.map(e => e.title).sort();
      expect(titles).toContain('Theirs');
    });

    it('should handle completely empty arrays', () => {
      const base = createSpec({
        uuid: 'uuid-test',
        tags: [],
        relationships: [],
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createSpec({
        uuid: 'uuid-test',
        tags: [],
        relationships: [],
        content: 'Ours content',
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createSpec({
        uuid: 'uuid-test',
        tags: [],
        relationships: [],
        content: 'Theirs content',
        updated_at: '2025-01-03T00:00:00Z',
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);
      expect(entities[0].tags).toEqual([]);
      expect(entities[0].relationships).toEqual([]);
    });

    it('should handle missing optional fields', () => {
      const base = createIssue({
        uuid: 'uuid-test',
        assignee: undefined,
        parent_id: undefined,
        updated_at: '2025-01-01T00:00:00Z',
      });

      const ours = createIssue({
        uuid: 'uuid-test',
        assignee: 'alice',
        parent_id: undefined,
        updated_at: '2025-01-02T00:00:00Z',
      });

      const theirs = createIssue({
        uuid: 'uuid-test',
        assignee: undefined,
        parent_id: 'i-parent',
        updated_at: '2025-01-03T00:00:00Z', // Newer
      });

      const { entities } = mergeThreeWay([base], [ours], [theirs]);

      expect(entities).toHaveLength(1);

      // EXPECTED (with field-level three-way merge):
      // - assignee: 'alice' (only ours changed, so ours wins)
      // - parent_id: 'i-parent' (only theirs changed, so theirs wins)
      //
      // NOTE: With proper field-level three-way merge, each field is evaluated
      // independently. No need to apply latest-wins to the entire entity.
      const merged = entities[0];
      expect(merged.assignee).toBe('alice'); // Only ours changed - ours wins
      expect(merged.parent_id).toBe('i-parent');
    });
  });

  describe('Performance and stability', () => {
    it('should handle realistic multi-entity merge scenario', () => {
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
        createIssue({
          id: 'i-new-theirs',
          uuid: 'uuid-issue-new-theirs',
          title: 'New Issue in Theirs',
          created_at: '2025-01-02T09:30:00Z',
          updated_at: '2025-01-02T11:00:00Z',
        }),
      ];

      const { entities } = mergeThreeWay(base, ours, theirs);

      // Should have 4 entities: 1 spec + 3 issues
      expect(entities).toHaveLength(4);

      // Find merged spec
      const mergedSpec = entities.find((e) => e.id === 's-001');
      expect(mergedSpec).toBeDefined();
      expect(mergedSpec!.title).toBe('Auth Spec Updated'); // Theirs is newer
      expect(mergedSpec!.tags).toEqual(
        expect.arrayContaining(['backend', 'security', 'api'])
      );

      // Find merged issue
      const mergedIssue = entities.find((e) => e.id === 'i-001');
      expect(mergedIssue).toBeDefined();
      expect(mergedIssue!.title).toBe('Implement OAuth Auth'); // Theirs is newer
      expect(mergedIssue!.tags).toEqual(
        expect.arrayContaining(['backend', 'urgent', 'oauth'])
      );
      expect(mergedIssue!.relationships).toHaveLength(3); // Union of all

      // Both new issues should be present
      expect(entities.some((e) => e.id === 'i-new-ours')).toBe(true);
      expect(entities.some((e) => e.id === 'i-new-theirs')).toBe(true);
    });

    it('should maintain data integrity through multiple merges', () => {
      // Simulate a series of merges
      const initial = createIssue({
        uuid: 'uuid-test',
        title: 'Initial',
        tags: ['tag1'],
        content: 'Line 1\nLine 2\nLine 3',
        updated_at: '2025-01-01T00:00:00Z',
      });

      // First merge
      const merge1Base = initial;
      const merge1Ours = createIssue({
        uuid: 'uuid-test',
        title: 'Initial',
        tags: ['tag1', 'tag2'],
        content: 'Line 1 MOD\nLine 2\nLine 3',
        updated_at: '2025-01-02T00:00:00Z',
      });
      const merge1Theirs = createIssue({
        uuid: 'uuid-test',
        title: 'Initial',
        tags: ['tag1', 'tag3'],
        content: 'Line 1\nLine 2\nLine 3 MOD',
        updated_at: '2025-01-03T00:00:00Z',
      });

      const result1 = mergeThreeWay([merge1Base], [merge1Ours], [merge1Theirs]);
      expect(result1.entities).toHaveLength(1);
      expect(result1.entities[0].tags).toHaveLength(3);

      // Second merge building on first
      const merge2Base = result1.entities[0];
      const merge2Ours = createIssue({
        uuid: 'uuid-test',
        title: 'Updated Title',
        tags: result1.entities[0].tags,
        content: result1.entities[0].content,
        updated_at: '2025-01-04T00:00:00Z',
      });
      const merge2Theirs = createIssue({
        uuid: 'uuid-test',
        title: result1.entities[0].title,
        tags: [...result1.entities[0].tags!, 'tag4'],
        content: result1.entities[0].content,
        updated_at: '2025-01-05T00:00:00Z',
      });

      const result2 = mergeThreeWay([merge2Base], [merge2Ours], [merge2Theirs]);
      expect(result2.entities).toHaveLength(1);
      expect(result2.entities[0].tags).toHaveLength(4);
      expect(result2.entities[0].title).toBe('Updated Title');
    });
  });
});
