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
    describe('True 3-way merge (with base)', () => {
      it('should handle clean three-way merge with YAML conversion', () => {
        const base: JSONLEntity[] = [
          {
            id: 'i-abc',
            uuid: 'uuid-1',
            title: 'Base Title',
            description: 'Base description',
            status: 'open',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const ours: JSONLEntity[] = [
          {
            id: 'i-abc',
            uuid: 'uuid-1',
            title: 'Our Title',
            description: 'Base description',
            status: 'open',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'i-abc',
            uuid: 'uuid-1',
            title: 'Base Title',
            description: 'Their description',
            status: 'in_progress',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        // Git three-way merge creates a conflict when both sides modify adjacent fields
        // The YAML conflict resolver uses latest timestamp (theirs: 2025-01-03)
        // So we get theirs' version
        expect(merged[0].title).toBe('Base Title');
        expect(merged[0].description).toBe('Their description');
        expect(merged[0].status).toBe('in_progress');
        expect(merged[0].updated_at).toBe('2025-01-03T00:00:00Z');
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

      it('should handle entity deletions (modification wins)', () => {
        const base: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Base',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          {
            id: 'B',
            uuid: 'uuid-2',
            title: 'Base B',
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const ours: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Modified in Ours',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
          // B deleted
        ];

        const theirs: JSONLEntity[] = [
          // A deleted
          {
            id: 'B',
            uuid: 'uuid-2',
            title: 'Modified in Theirs',
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        // Both modifications should win over deletions
        expect(merged).toHaveLength(2);
        expect(merged.find((e) => e.uuid === 'uuid-1')?.title).toBe('Modified in Ours');
        expect(merged.find((e) => e.uuid === 'uuid-2')?.title).toBe('Modified in Theirs');

        // Should have conflict records for modification-wins-deletion
        expect(stats.conflicts.some((c) => c.action.includes('Modified in ours, deleted in theirs'))).toBe(true);
        expect(stats.conflicts.some((c) => c.action.includes('Deleted in ours, modified in theirs'))).toBe(true);
      });

      it('should merge metadata before YAML conversion', () => {
        const base: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Base',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            tags: ['base-tag'],
            relationships: [],
          },
        ];

        const ours: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Ours',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
            tags: ['ours-tag'],
            relationships: [
              { from: 'A', from_type: 'issue', to: 'B', to_type: 'spec', type: 'blocks' },
            ],
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Theirs',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
            tags: ['theirs-tag'],
            relationships: [
              { from: 'A', from_type: 'issue', to: 'C', to_type: 'issue', type: 'related' },
            ],
          },
        ];

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        // All tags should be merged
        expect(merged[0].tags).toContain('base-tag');
        expect(merged[0].tags).toContain('ours-tag');
        expect(merged[0].tags).toContain('theirs-tag');
        // All relationships should be merged
        expect(merged[0].relationships).toHaveLength(2);
      });

      it('should handle YAML conflict resolution', () => {
        const base: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Base Title',
            status: 'open',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const ours: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Our Title',
            status: 'in_progress',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Their Title',
            status: 'blocked',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        // Latest timestamp wins for conflicting fields
        expect(merged[0].updated_at).toBe('2025-01-03T00:00:00Z');
      });

      it('should handle deletion in both branches', () => {
        const base: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const ours: JSONLEntity[] = [];
        const theirs: JSONLEntity[] = [];

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        // Entity deleted in both: should not appear in result
        expect(merged).toHaveLength(0);
      });
    });

    describe('Simulated 3-way merge (empty base)', () => {
      it('should handle concurrent additions with empty base', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
          {
            id: 'i-abc',
            uuid: 'uuid-1',
            title: 'Our New Issue',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
            tags: ['ours'],
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'i-abc',
            uuid: 'uuid-1',
            title: 'Their New Issue',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
            tags: ['theirs'],
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        // Should merge metadata
        expect(merged[0].tags).toContain('ours');
        expect(merged[0].tags).toContain('theirs');
        // Most recent wins
        expect(merged[0].title).toBe('Their New Issue');

        expect(stats.conflicts.some((c) => c.action.includes('Concurrent addition'))).toBe(true);
      });

      it('should handle different entities added on both sides', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
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

        const theirs: JSONLEntity[] = [
          {
            id: 'C',
            uuid: 'uuid-3',
            created_at: '2025-01-03T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
          {
            id: 'D',
            uuid: 'uuid-4',
            created_at: '2025-01-04T00:00:00Z',
            updated_at: '2025-01-04T00:00:00Z',
          },
        ];

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        // All additions from both sides
        expect(merged).toHaveLength(4);
        expect(merged.map((e) => e.id).sort()).toEqual(['A', 'B', 'C', 'D']);
      });

      it('should handle addition in ours only with empty base', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [];

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        expect(merged[0].id).toBe('A');
      });

      it('should handle addition in theirs only with empty base', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [];

        const theirs: JSONLEntity[] = [
          {
            id: 'B',
            uuid: 'uuid-2',
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        expect(merged).toHaveLength(1);
        expect(merged[0].id).toBe('B');
      });
    });

    describe('Sorting and output', () => {
      it('should sort result by created_at timestamp', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
          {
            id: 'C',
            uuid: 'uuid-3',
            created_at: '2025-03-01T00:00:00Z',
            updated_at: '2025-03-01T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [
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

        const { entities: merged } = mergeThreeWay(base, ours, theirs);

        expect(merged.map((e) => e.id)).toEqual(['A', 'B', 'C']);
      });

      it('should include accurate statistics', () => {
        const base: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const ours: JSONLEntity[] = [
          {
            id: 'A',
            uuid: 'uuid-1',
            title: 'Modified',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        expect(stats.totalInput).toBe(2); // base + ours
        expect(stats.totalOutput).toBe(1); // merged result
      });

      it('should handle hash collision (same ID, different UUID)', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
          {
            id: 'i-x7k9',
            uuid: 'uuid-1',
            title: 'Entity from branch A',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'i-x7k9', // Same ID!
            uuid: 'uuid-2', // Different UUID!
            title: 'Entity from branch B',
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        // Both entities should be kept
        expect(merged).toHaveLength(2);

        // First entity keeps original ID
        expect(merged[0].id).toBe('i-x7k9');
        expect(merged[0].uuid).toBe('uuid-1');

        // Second entity gets renamed with .1 suffix
        expect(merged[1].id).toBe('i-x7k9.1');
        expect(merged[1].uuid).toBe('uuid-2');

        // Should have conflict record for hash collision
        expect(stats.conflicts.some((c) => c.type === 'different-uuids')).toBe(true);
        expect(stats.conflicts.some((c) => c.action.includes('hash collision'))).toBe(true);
      });

      it('should handle multiple hash collisions', () => {
        const base: JSONLEntity[] = [];

        const ours: JSONLEntity[] = [
          {
            id: 'i-x7k9',
            uuid: 'uuid-1',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          {
            id: 'i-x7k9', // Same ID!
            uuid: 'uuid-2', // Different UUID!
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        const theirs: JSONLEntity[] = [
          {
            id: 'i-x7k9', // Same ID!
            uuid: 'uuid-3', // Different UUID!
            created_at: '2025-01-03T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
        ];

        const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

        // All three entities should be kept
        expect(merged).toHaveLength(3);

        // First keeps original, subsequent get .1, .2, etc.
        expect(merged[0].id).toBe('i-x7k9');
        expect(merged[1].id).toBe('i-x7k9.1');
        expect(merged[2].id).toBe('i-x7k9.2');

        // Two hash collision conflicts (second and third entities)
        const hashCollisions = stats.conflicts.filter((c) => c.type === 'different-uuids');
        expect(hashCollisions).toHaveLength(2);
      });
    });
  });
});
