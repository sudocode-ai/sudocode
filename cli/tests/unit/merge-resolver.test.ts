/**
 * Unit tests for merge conflict resolution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseMergeConflictFile,
  hasGitConflictMarkers,
  resolveEntities,
  mergeMetadata,
  mergeThreeWay,
  type JSONLEntity,
  type ConflictSection,
} from '../../src/merge-resolver.js';

describe('Merge Resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('hasGitConflictMarkers', () => {
    it('should detect conflict markers in file', () => {
      const filePath = path.join(tmpDir, 'conflict.jsonl');
      fs.writeFileSync(
        filePath,
        '<<<<<<< HEAD\n{"id":"A"}\n=======\n{"id":"B"}\n>>>>>>>\n'
      );

      expect(hasGitConflictMarkers(filePath)).toBe(true);
    });

    it('should return false for clean file', () => {
      const filePath = path.join(tmpDir, 'clean.jsonl');
      fs.writeFileSync(filePath, '{"id":"A"}\n{"id":"B"}\n');

      expect(hasGitConflictMarkers(filePath)).toBe(false);
    });

    it('should return false for non-existent file', () => {
      const filePath = path.join(tmpDir, 'nonexistent.jsonl');

      expect(hasGitConflictMarkers(filePath)).toBe(false);
    });

    it('should return false if only partial markers present', () => {
      const filePath = path.join(tmpDir, 'partial.jsonl');
      fs.writeFileSync(filePath, '<<<<<<< HEAD\n{"id":"A"}\n');

      expect(hasGitConflictMarkers(filePath)).toBe(false);
    });
  });

  describe('parseMergeConflictFile', () => {
    it('should parse file with no conflicts', () => {
      const content = '{"id":"A"}\n{"id":"B"}\n';
      const sections = parseMergeConflictFile(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].type).toBe('clean');
      const nonEmptyLines = sections[0].lines.filter((l) => l.trim());
      expect(nonEmptyLines).toHaveLength(2);
      expect(nonEmptyLines[0]).toBe('{"id":"A"}');
      expect(nonEmptyLines[1]).toBe('{"id":"B"}');
    });

    it('should parse file with single conflict', () => {
      const content = `{"id":"A"}
<<<<<<< HEAD
{"id":"B","uuid":"uuid-1"}
=======
{"id":"B","uuid":"uuid-2"}
>>>>>>> feature
{"id":"C"}`;

      const sections = parseMergeConflictFile(content);

      expect(sections).toHaveLength(3);

      // First clean section
      expect(sections[0].type).toBe('clean');
      expect(sections[0].lines).toEqual(['{"id":"A"}']);

      // Conflict section
      expect(sections[1].type).toBe('conflict');
      expect(sections[1].ours).toEqual(['{"id":"B","uuid":"uuid-1"}']);
      expect(sections[1].theirs).toEqual(['{"id":"B","uuid":"uuid-2"}']);
      expect(sections[1].marker?.oursLabel).toBe('HEAD');
      expect(sections[1].marker?.theirsLabel).toBe('feature');
      expect(sections[1].marker?.start).toBe(1);
      expect(sections[1].marker?.middle).toBe(3);
      expect(sections[1].marker?.end).toBe(5);

      // Second clean section
      expect(sections[2].type).toBe('clean');
      expect(sections[2].lines).toEqual(['{"id":"C"}']);
    });

    it('should parse file with multiple conflicts', () => {
      const content = `{"id":"A"}
<<<<<<< HEAD
{"id":"B","uuid":"uuid-1"}
=======
{"id":"B","uuid":"uuid-2"}
>>>>>>> feature
{"id":"C"}
<<<<<<< HEAD
{"id":"D","uuid":"uuid-3"}
=======
{"id":"D","uuid":"uuid-4"}
>>>>>>> feature
{"id":"E"}`;

      const sections = parseMergeConflictFile(content);

      expect(sections).toHaveLength(5);
      expect(sections[0].type).toBe('clean');
      expect(sections[1].type).toBe('conflict');
      expect(sections[2].type).toBe('clean');
      expect(sections[3].type).toBe('conflict');
      expect(sections[4].type).toBe('clean');
    });

    it('should handle empty conflict sections', () => {
      const content = `{"id":"A"}
<<<<<<< HEAD
=======
{"id":"B","uuid":"uuid-2"}
>>>>>>> feature
{"id":"C"}`;

      const sections = parseMergeConflictFile(content);

      expect(sections).toHaveLength(3);
      expect(sections[1].type).toBe('conflict');
      expect(sections[1].ours).toEqual([]);
      expect(sections[1].theirs).toEqual(['{"id":"B","uuid":"uuid-2"}']);
    });

    it('should handle multiline conflict sections', () => {
      const content = `<<<<<<< HEAD
{"id":"A"}
{"id":"B"}
=======
{"id":"C"}
{"id":"D"}
>>>>>>> feature`;

      const sections = parseMergeConflictFile(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].type).toBe('conflict');
      expect(sections[0].ours).toEqual(['{"id":"A"}', '{"id":"B"}']);
      expect(sections[0].theirs).toEqual(['{"id":"C"}', '{"id":"D"}']);
    });
  });

  describe('resolveEntities', () => {
    it('should keep single entity unchanged', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const { entities: resolved, stats } = resolveEntities(entities);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('A');
      expect(stats.conflicts).toHaveLength(0);
      expect(stats.totalInput).toBe(1);
      expect(stats.totalOutput).toBe(1);
    });

    it('should rename ID collision when different UUIDs (hash collision)', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'i-2j3e',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'i-2j3e',
          uuid: 'uuid-2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const { entities: resolved, stats } = resolveEntities(entities);

      expect(resolved).toHaveLength(2);
      // First entity keeps original ID
      expect(resolved[0].id).toBe('i-2j3e');
      expect(resolved[0].uuid).toBe('uuid-1');
      // Second entity gets .1 suffix to resolve collision
      expect(resolved[1].id).toBe('i-2j3e.1');
      expect(resolved[1].uuid).toBe('uuid-2');

      // One conflict for ID collision
      expect(stats.conflicts).toHaveLength(1);
      expect(stats.conflicts[0].type).toBe('different-uuids');
      expect(stats.conflicts[0].originalIds).toEqual(['i-2j3e']);
      expect(stats.conflicts[0].resolvedIds).toEqual(['i-2j3e.1']);
    });

    it('should handle multiple ID collisions with different UUIDs', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'i-2j3e',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'i-2j3e',
          uuid: 'uuid-2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
        {
          id: 'i-2j3e',
          uuid: 'uuid-3',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: resolved, stats } = resolveEntities(entities);

      expect(resolved).toHaveLength(3);
      // First keeps original, subsequent get .1, .2, etc.
      expect(resolved[0].id).toBe('i-2j3e');
      expect(resolved[1].id).toBe('i-2j3e.1');
      expect(resolved[2].id).toBe('i-2j3e.2');

      // Two conflicts (second and third entities)
      expect(stats.conflicts).toHaveLength(2);
    });

    it('should rename deterministically when same UUID but different IDs', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'ISSUE-042',
          uuid: 'abcdef12-3456-7890-abcd-ef1234567890',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'ISSUE-043',
          uuid: 'abcdef12-3456-7890-abcd-ef1234567890', // Same UUID!
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const { entities: resolved } = resolveEntities(entities);

      expect(resolved).toHaveLength(2);
      // Older one renamed
      expect(resolved[0].id).toBe('ISSUE-042-conflict-abcdef12');
      // Newer one keeps its ID
      expect(resolved[1].id).toBe('ISSUE-043');
    });

    it('should keep most recent when same UUID and ID', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Old',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          relationships: [],
          tags: ['old'],
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'New',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          relationships: [],
          tags: ['new'],
        },
      ];

      const { entities: resolved, stats } = resolveEntities(entities);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].title).toBe('New'); // Most recent
      expect(resolved[0].tags).toEqual(['old', 'new']); // Merged

      expect(stats.conflicts).toHaveLength(1);
      expect(stats.conflicts[0].type).toBe('same-uuid-same-id');
      expect(stats.conflicts[0].action).toContain('merged 2 versions');
    });

    it('should sort result by created_at', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'C',
          uuid: 'uuid-3',
          created_at: '2025-03-01T00:00:00Z',
          updated_at: '2025-03-01T00:00:00Z',
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'B',
          uuid: 'uuid-2',
          created_at: '2025-02-01T00:00:00Z',
          updated_at: '2025-02-01T00:00:00Z',
        },
      ];

      const { entities: resolved } = resolveEntities(entities);

      expect(resolved.map((e) => e.id)).toEqual(['A', 'B', 'C']);
    });

    it('should handle missing timestamps gracefully', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: undefined as any,
        },
        {
          id: 'B',
          uuid: 'uuid-2',
          created_at: undefined as any,
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const { entities: resolved } = resolveEntities(entities);

      expect(resolved).toHaveLength(2);
      // Should not throw, should handle gracefully
    });

    it('should handle various timestamp formats', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01 00:00:00', // Space instead of T
          updated_at: '2025-01-01 00:00:00',
        },
        {
          id: 'B',
          uuid: 'uuid-2',
          created_at: '2025-01-02T00:00:00Z', // ISO format
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const { entities: resolved } = resolveEntities(entities);

      expect(resolved).toHaveLength(2);
      expect(resolved[0].id).toBe('A'); // Older first
      expect(resolved[1].id).toBe('B');
    });
  });

  describe('mergeMetadata', () => {
    it('should merge relationships from multiple versions', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-01T00:00:00Z',
          relationships: [
            { from: 'A', from_type: 'issue', to: 'B', to_type: 'spec', type: 'blocks' },
          ],
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-02T00:00:00Z',
          relationships: [
            { from: 'A', from_type: 'issue', to: 'C', to_type: 'issue', type: 'related' },
          ],
        },
      ];

      const merged = mergeMetadata(entities);

      expect(merged.relationships).toHaveLength(2);
      expect(merged.updated_at).toBe('2025-01-02T00:00:00Z'); // Most recent
    });

    it('should merge tags correctly', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['tag1', 'tag2'],
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['tag2', 'tag3'],
        },
      ];

      const merged = mergeMetadata(entities);

      expect(merged.tags).toHaveLength(3);
      expect(merged.tags).toContain('tag1');
      expect(merged.tags).toContain('tag2');
      expect(merged.tags).toContain('tag3');
    });

    it('should merge feedback by ID', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-01T00:00:00Z',
          feedback: [
            {
              id: 'fb-1',
              issue_id: 'i-1',
              spec_id: 's-1',
              feedback_type: 'comment',
              content: 'Test',
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-02T00:00:00Z',
          feedback: [
            {
              id: 'fb-2',
              issue_id: 'i-2',
              spec_id: 's-1',
              feedback_type: 'suggestion',
              content: 'Test 2',
              created_at: '2025-01-02T00:00:00Z',
              updated_at: '2025-01-02T00:00:00Z',
            },
          ],
        },
      ];

      const merged = mergeMetadata(entities);

      expect(merged.feedback).toHaveLength(2);
    });

    it('should keep most recent entity as base', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Old Title',
          content: 'Old Content',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'New Title',
          content: 'New Content',
          updated_at: '2025-01-03T00:00:00Z',
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Middle Title',
          content: 'Middle Content',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const merged = mergeMetadata(entities);

      expect(merged.title).toBe('New Title');
      expect(merged.content).toBe('New Content');
      expect(merged.updated_at).toBe('2025-01-03T00:00:00Z');
    });

    it('should deduplicate identical relationships', () => {
      const entities: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-01T00:00:00Z',
          relationships: [
            { from: 'A', from_type: 'issue', to: 'B', to_type: 'spec', type: 'blocks' },
          ],
        },
        {
          id: 'A',
          uuid: 'uuid-1',
          updated_at: '2025-01-02T00:00:00Z',
          relationships: [
            { from: 'A', from_type: 'issue', to: 'B', to_type: 'spec', type: 'blocks' },
          ],
        },
      ];

      const merged = mergeMetadata(entities);

      expect(merged.relationships).toHaveLength(1);
    });
  });

  describe('mergeThreeWay', () => {
    it('should handle clean three-way merge', () => {
      const base: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Base',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Ours',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Theirs',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('Theirs'); // Most recent
    });

    it('should handle additions on both sides', () => {
      const base: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        ...base,
        {
          id: 'B',
          uuid: 'uuid-2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        ...base,
        {
          id: 'C',
          uuid: 'uuid-3',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(3);
      expect(merged.map((e) => e.id).sort()).toEqual(['A', 'B', 'C']);
    });

    it('should handle deletions and additions', () => {
      const base: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'B',
          uuid: 'uuid-2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        base[0], // Kept A, removed B
        {
          id: 'C',
          uuid: 'uuid-3',
          created_at: '2025-01-03T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        base[1], // Removed A, kept B
        {
          id: 'D',
          uuid: 'uuid-4',
          created_at: '2025-01-04T00:00:00Z',
          updated_at: '2025-01-04T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      // All unique UUIDs should be present
      expect(merged).toHaveLength(4);
      expect(merged.map((e) => e.id).sort()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should handle conflicting modifications', () => {
      const base: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Base',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['base'],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Ours',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['ours'],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'A',
          uuid: 'uuid-1',
          title: 'Theirs',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['theirs'],
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('Theirs'); // Most recent wins
      expect(merged[0].tags).toEqual(['base', 'ours', 'theirs']); // All tags merged
      expect(stats.conflicts).toHaveLength(1);
    });
  });
});
