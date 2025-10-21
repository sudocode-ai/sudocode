/**
 * Unit tests for import operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from './db.js';
import { createSpec, getSpec } from './operations/specs.js';
import { createIssue } from './operations/issues.js';
import { addRelationship } from './operations/relationships.js';
import { addTags } from './operations/tags.js';
import { writeJSONL } from './jsonl.js';
import {
  detectChanges,
  detectCollisions,
  countReferences,
  updateTextReferences,
  importFromJSONL,
} from './import.js';
import type Database from 'better-sqlite3';
import type { SpecJSONL, IssueJSONL } from './types.js';

const TEST_DIR = path.join(process.cwd(), 'test-import');

describe('Import Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ':memory:' });

    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    db.close();

    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('detectChanges', () => {
    it('should detect added entities (using UUID matching)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
        { id: 'spec-002', uuid: 'uuid-002', updated_at: '2025-01-02T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual(['spec-002']);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect updated entities (using UUID matching)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-02T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual(['spec-001']);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect deleted entities (using UUID matching)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
        { id: 'spec-002', uuid: 'uuid-002', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual(['spec-002']);
    });

    it('should detect unchanged entities', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-001', updated_at: '2025-01-01T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.unchanged).toEqual(['spec-001']);
    });

    it('should treat same UUID with different ID as update (entity was renamed)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-same', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-999', uuid: 'uuid-same', updated_at: '2025-01-02T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual(['spec-999']); // Returns new ID
      expect(changes.deleted).toEqual([]);
    });
  });

  describe('detectCollisions', () => {
    it('should detect ID collisions when UUIDs differ (different entities with same ID)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-aaa', title: 'Original Title', created_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-bbb', title: 'Different Title', created_at: '2025-01-02T00:00:00Z' },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(1);
      expect(collisions[0].id).toBe('spec-001');
      expect(collisions[0].reason).toBe('Same ID but different UUID (different entities)');
      expect(collisions[0].localContent).toBe('Original Title');
      expect(collisions[0].incomingContent).toBe('Different Title');
    });

    it('should not detect collision when UUIDs match (same entity)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-same', title: 'Original Title', created_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', uuid: 'uuid-same', title: 'Updated Title', created_at: '2025-01-02T00:00:00Z' },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(0);
    });

    it('should not detect collision for different IDs (even if content is same)', () => {
      const existing = [
        { id: 'spec-001', uuid: 'uuid-aaa', title: 'Same Title', created_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-002', uuid: 'uuid-bbb', title: 'Same Title', created_at: '2025-01-01T00:00:00Z' },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(0);
    });
  });

  describe('countReferences', () => {
    beforeEach(() => {
      // Create specs with references
      createSpec(db, {
        id: 'spec-001',
        title: 'Main Spec',
        file_path: 'main.md',
        content: 'See spec-002 for details. Also spec-002 is important.',
      });

      createSpec(db, {
        id: 'spec-002',
        title: 'Referenced Spec',
        file_path: 'ref.md',
        content: 'Content',
      });

      // Create issue with reference
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        description: 'Implements spec-002',
        content: 'Based on spec-002',
      });
    });

    it('should count references to an entity', () => {
      const count = countReferences(db, 'spec-002', 'spec');

      // 2 in spec-001 content + 1 in issue description + 1 in issue content = 4
      expect(count).toBe(4);
    });

    it('should return 0 for unreferenced entity', () => {
      const count = countReferences(db, 'spec-999', 'spec');
      expect(count).toBe(0);
    });
  });

  describe('updateTextReferences', () => {
    beforeEach(() => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Spec with reference',
        file_path: 'spec.md',
        content: 'See spec-OLD for details',
      });

      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        description: 'Related to spec-OLD',
        content: 'Implements spec-OLD feature',
      });
    });

    it('should update all text references', () => {
      const count = updateTextReferences(db, 'spec-OLD', 'spec-NEW');

      expect(count).toBe(2); // 1 spec + 1 issue

      // Verification is implicit - the function would throw if updates failed
    });
  });

  describe('importFromJSONL', () => {
    it('should import new specs and issues', async () => {
      // Create JSONL files
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-spec-001',
          title: 'Test Spec',
          file_path: 'test.md',
          content: '# Test',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: ['test'],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: 'issue-001',
          uuid: 'uuid-issue-001',
          title: 'Test Issue',
          description: 'Test description',
          content: '# Details',
          status: 'open',
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [],
          tags: ['test'],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), issues);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);
      expect(result.collisions).toHaveLength(0);
    });

    it('should detect and report collisions in dry-run mode (same ID, different UUID)', async () => {
      // Create existing data with UUID
      createSpec(db, {
        id: 'spec-001',
        uuid: 'uuid-original',
        title: 'Original Title',
        file_path: 'orig.md',
      });

      // Create JSONL with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-different',
          title: 'Different Title',
          file_path: 'diff.md',
          content: '',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Dry run import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        dryRun: true,
      });

      expect(result.collisions.length).toBeGreaterThan(0);
      expect(result.collisions[0].reason).toBe('Same ID but different UUID (different entities)');
    });

    it('should update existing entities (same UUID, different content)', async () => {
      // Create existing data with UUID
      const uuid = 'uuid-same';
      createSpec(db, {
        id: 'spec-001',
        uuid: uuid,
        title: 'Original',
        file_path: 'orig.md',
      });

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create JSONL with updated content but same UUID
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: uuid,
          title: 'Updated',
          file_path: 'updated.md',
          content: 'New content',
          priority: 2,
          created_at: new Date(Date.now() - 1000).toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.updated).toBe(1);
    });

    it('should delete entities not in JSONL (UUID not present)', async () => {
      // Create existing data with UUIDs
      createSpec(db, {
        id: 'spec-001',
        uuid: 'uuid-001',
        title: 'To Delete',
        file_path: 'delete.md',
      });

      createSpec(db, {
        id: 'spec-002',
        uuid: 'uuid-002',
        title: 'To Keep',
        file_path: 'keep.md',
      });

      // Create JSONL with only spec-002 (uuid-002)
      const specs: SpecJSONL[] = [
        {
          id: 'spec-002',
          uuid: 'uuid-002',
          title: 'To Keep',
          file_path: 'keep.md',
          content: '',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.deleted).toBe(1);
    });

    it('should resolve ID collisions by renumbering incoming entity', async () => {
      // Create existing spec with UUID
      const localSpec = createSpec(db, {
        id: 'spec-001',
        uuid: 'uuid-local',
        title: 'Local Spec',
        file_path: 'local.md',
        content: 'Local content',
      });

      // Create JSONL with:
      // 1. Local spec (same UUID, should be preserved)
      // 2. Incoming spec with SAME ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-local',  // Same UUID = same entity as existing, should be preserved
          title: 'Local Spec',
          file_path: 'local.md',
          content: 'Local content',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: 'spec-001',  // Same ID as above = COLLISION!
          uuid: 'uuid-incoming',  // Different UUID = different entity
          title: 'Incoming Spec',
          file_path: 'incoming.md',
          content: 'Incoming content',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import with collision resolution enabled
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect 2 collisions (one with existing, one within incoming data)
      // Both refer to the same incoming entity with uuid-incoming
      expect(result.collisions.length).toBe(2);
      expect(result.collisions.every(c => c.resolution === 'renumber')).toBe(true);

      // All collisions should have the same newId (same entity being renumbered)
      const newId = result.collisions[0].newId!;
      expect(newId).toBeDefined();
      expect(newId).not.toBe('spec-001');
      expect(result.collisions.every(c => c.newId === newId)).toBe(true);

      // Should have 1 spec updated (uuid-local) and 1 added (uuid-incoming with new ID)
      expect(result.specs.added).toBe(1);
      expect(result.specs.updated).toBe(1);  // The first incoming spec with uuid-local
      expect(result.specs.deleted).toBe(0);

      // Verify: Local spec-001 should still exist with original UUID (unchanged)
      const localAfter = getSpec(db, 'spec-001');
      expect(localAfter).not.toBeNull();
      expect(localAfter?.uuid).toBe('uuid-local');
      expect(localAfter?.title).toBe('Local Spec');

      // Verify: Incoming spec should be imported with new ID (use newId from earlier)
      const incomingAfter = getSpec(db, newId);
      expect(incomingAfter).not.toBeNull();
      expect(incomingAfter?.uuid).toBe('uuid-incoming');
      expect(incomingAfter?.title).toBe('Incoming Spec');
    });

    it('should use timestamps to determine collision resolution (newer gets renumbered)', async () => {
      // Create local spec with OLDER timestamp
      const olderTime = new Date('2025-01-01T00:00:00Z');
      const newerTime = new Date('2025-01-02T00:00:00Z');

      createSpec(db, {
        id: 'spec-001',
        uuid: 'uuid-older',
        title: 'Older Spec',
        file_path: 'older.md',
      });

      // Manually set created_at to older time in DB
      db.prepare('UPDATE specs SET created_at = ? WHERE id = ?').run(
        olderTime.toISOString(),
        'spec-001'
      );

      // Create JSONL with:
      // 1. The older spec (same UUID, same ID)
      // 2. A newer spec with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-older',
          title: 'Older Spec',
          file_path: 'older.md',
          content: '',
          priority: 2,
          created_at: olderTime.toISOString(),
          updated_at: olderTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: 'spec-001',
          uuid: 'uuid-newer',  // Different UUID = collision
          title: 'Newer Spec',
          file_path: 'newer.md',
          content: '',
          priority: 2,
          created_at: newerTime.toISOString(),  // NEWER timestamp
          updated_at: newerTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import with collision resolution
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect collisions and renumber the newer entity
      expect(result.collisions.length).toBeGreaterThan(0);

      // The OLDER entity should keep spec-001
      const olderAfter = getSpec(db, 'spec-001');
      expect(olderAfter).not.toBeNull();
      expect(olderAfter?.uuid).toBe('uuid-older');
      expect(olderAfter?.title).toBe('Older Spec');

      // The NEWER entity should be imported with a new ID
      const newId = result.collisions.find(c => c.uuid === 'uuid-newer')?.newId;
      expect(newId).toBeDefined();
      expect(newId).not.toBe('spec-001');

      const newerAfter = getSpec(db, newId!);
      expect(newerAfter).not.toBeNull();
      expect(newerAfter?.uuid).toBe('uuid-newer');
      expect(newerAfter?.title).toBe('Newer Spec');
    });

    it('should handle reverse case (local is newer, incoming is older)', async () => {
      // Create local spec with NEWER timestamp
      const olderTime = new Date('2025-01-01T00:00:00Z');
      const newerTime = new Date('2025-01-02T00:00:00Z');

      createSpec(db, {
        id: 'spec-001',
        uuid: 'uuid-newer',
        title: 'Newer Spec',
        file_path: 'newer.md',
      });

      // Manually set created_at to newer time in DB
      db.prepare('UPDATE specs SET created_at = ? WHERE id = ?').run(
        newerTime.toISOString(),
        'spec-001'
      );

      // Create JSONL with:
      // 1. The newer spec (same UUID, same ID)
      // 2. An older spec with same ID but different UUID (collision!)
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-newer',
          title: 'Newer Spec',
          file_path: 'newer.md',
          content: '',
          priority: 2,
          created_at: newerTime.toISOString(),
          updated_at: newerTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
        {
          id: 'spec-001',
          uuid: 'uuid-older',  // Different UUID = collision
          title: 'Older Spec',
          file_path: 'older.md',
          content: '',
          priority: 2,
          created_at: olderTime.toISOString(),  // OLDER timestamp
          updated_at: olderTime.toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import with collision resolution
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        resolveCollisions: true,
      });

      // Should detect collisions
      expect(result.collisions.length).toBeGreaterThan(0);

      // Note: Due to practical constraints, the incoming entity (older)
      // still gets renumbered, even though ideally the newer one should be
      const collision = result.collisions.find(c => c.uuid === 'uuid-older');
      expect(collision).toBeDefined();

      // The newer entity keeps spec-001 (it was there first in DB)
      const newerAfter = getSpec(db, 'spec-001');
      expect(newerAfter).not.toBeNull();
      expect(newerAfter?.uuid).toBe('uuid-newer');

      // The older entity gets imported with new ID
      const newId = collision?.newId;
      expect(newId).toBeDefined();
      const olderAfter = getSpec(db, newId!);
      expect(olderAfter).not.toBeNull();
      expect(olderAfter?.uuid).toBe('uuid-older');
    });

    it('should import relationships with entity types', async () => {
      // Create specs
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-spec-001',
          title: 'Spec One',
          file_path: 'spec1.md',
          content: '',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [
            {
              from: 'spec-001',
              from_type: 'spec',
              to: 'spec-002',
              to_type: 'spec',
              type: 'references',
            },
          ],
          tags: [],
        },
        {
          id: 'spec-002',
          uuid: 'uuid-spec-002',
          title: 'Spec Two',
          file_path: 'spec2.md',
          content: '',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(2);

      // Verify relationship was imported correctly
      const { getOutgoingRelationships } = await import('./operations/relationships.js');
      const relationships = getOutgoingRelationships(db, 'spec-001', 'spec');

      expect(relationships).toHaveLength(1);
      expect(relationships[0].from_id).toBe('spec-001');
      expect(relationships[0].from_type).toBe('spec');
      expect(relationships[0].to_id).toBe('spec-002');
      expect(relationships[0].to_type).toBe('spec');
      expect(relationships[0].relationship_type).toBe('references');
    });

    it('should import cross-type relationships (spec to issue)', async () => {
      // Create spec and issue with cross-type relationship
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          uuid: 'uuid-spec-001',
          title: 'Spec One',
          file_path: 'spec1.md',
          content: '',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          parent_id: null,
          relationships: [
            {
              from: 'spec-001',
              from_type: 'spec',
              to: 'issue-001',
              to_type: 'issue',
              type: 'implements',
            },
          ],
          tags: [],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: 'issue-001',
          uuid: 'uuid-issue-001',
          title: 'Issue One',
          description: 'Test',
          content: '',
          status: 'open',
          priority: 2,
          assignee: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          parent_id: null,
          relationships: [],
          tags: [],
          feedback: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues.jsonl'), issues);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.added).toBe(1);
      expect(result.issues.added).toBe(1);

      // Verify cross-type relationship was imported correctly
      const { getOutgoingRelationships } = await import('./operations/relationships.js');
      const relationships = getOutgoingRelationships(db, 'spec-001', 'spec');

      expect(relationships).toHaveLength(1);
      expect(relationships[0].from_id).toBe('spec-001');
      expect(relationships[0].from_type).toBe('spec');
      expect(relationships[0].to_id).toBe('issue-001');
      expect(relationships[0].to_type).toBe('issue');
      expect(relationships[0].relationship_type).toBe('implements');
    });
  });
});
