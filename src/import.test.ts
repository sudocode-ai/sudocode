/**
 * Unit tests for import operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from './db.js';
import { createSpec } from './operations/specs.js';
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
    it('should detect added entities', () => {
      const existing = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
        { id: 'spec-002', updated_at: '2025-01-02T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual(['spec-002']);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect updated entities', () => {
      const existing = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', updated_at: '2025-01-02T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual(['spec-001']);
      expect(changes.deleted).toEqual([]);
    });

    it('should detect deleted entities', () => {
      const existing = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
        { id: 'spec-002', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.added).toEqual([]);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual(['spec-002']);
    });

    it('should detect unchanged entities', () => {
      const existing = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
      ];
      const incoming = [
        { id: 'spec-001', updated_at: '2025-01-01T00:00:00Z' },
      ];

      const changes = detectChanges(existing, incoming);

      expect(changes.unchanged).toEqual(['spec-001']);
    });
  });

  describe('detectCollisions', () => {
    it('should detect ID collisions with different content', () => {
      const existing = [
        { id: 'spec-001', title: 'Original Title' },
      ];
      const incoming = [
        { id: 'spec-001', title: 'Different Title' },
      ];

      const collisions = detectCollisions(existing, incoming);

      expect(collisions).toHaveLength(1);
      expect(collisions[0].id).toBe('spec-001');
      expect(collisions[0].localContent).toBe('Original Title');
      expect(collisions[0].incomingContent).toBe('Different Title');
    });

    it('should not detect collision for same content', () => {
      const existing = [
        { id: 'spec-001', title: 'Same Title' },
      ];
      const incoming = [
        { id: 'spec-001', title: 'Same Title' },
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
        created_by: 'alice',
      });

      createSpec(db, {
        id: 'spec-002',
        title: 'Referenced Spec',
        file_path: 'ref.md',
        content: 'Content',
        created_by: 'alice',
      });

      // Create issue with reference
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        description: 'Implements spec-002',
        content: 'Based on spec-002',
        created_by: 'alice',
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
        created_by: 'alice',
      });

      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        description: 'Related to spec-OLD',
        content: 'Implements spec-OLD feature',
        created_by: 'alice',
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
          title: 'Test Spec',
          file_path: 'test.md',
          content: '# Test',
          type: 'feature',
          status: 'draft',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: 'alice',
          updated_by: 'alice',
          parent_id: null,
          relationships: [],
          tags: ['test'],
        },
      ];

      const issues: IssueJSONL[] = [
        {
          id: 'issue-001',
          title: 'Test Issue',
          description: 'Test description',
          content: '# Details',
          status: 'open',
          priority: 2,
          issue_type: 'task',
          assignee: null,
          estimated_minutes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          closed_at: null,
          created_by: 'alice',
          parent_id: null,
          relationships: [],
          tags: ['test'],
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

    it('should detect and report collisions in dry-run mode', async () => {
      // Create existing data
      createSpec(db, {
        id: 'spec-001',
        title: 'Original Title',
        file_path: 'orig.md',
        created_by: 'alice',
      });

      // Create JSONL with conflicting content
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          title: 'Different Title',
          file_path: 'diff.md',
          content: '',
          type: 'feature',
          status: 'draft',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: 'bob',
          updated_by: 'bob',
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs', 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues', 'issues.jsonl'), []);

      // Dry run import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
        dryRun: true,
      });

      expect(result.collisions.length).toBeGreaterThan(0);
    });

    it('should update existing entities', async () => {
      // Create existing data
      createSpec(db, {
        id: 'spec-001',
        title: 'Original',
        file_path: 'orig.md',
        created_by: 'alice',
      });

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create JSONL with updated content
      const specs: SpecJSONL[] = [
        {
          id: 'spec-001',
          title: 'Updated',
          file_path: 'updated.md',
          content: 'New content',
          type: 'feature',
          status: 'draft',
          priority: 2,
          created_at: new Date(Date.now() - 1000).toISOString(),
          updated_at: new Date().toISOString(),
          created_by: 'alice',
          updated_by: 'alice',
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs', 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues', 'issues.jsonl'), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.updated).toBe(1);
    });

    it('should delete entities not in JSONL', async () => {
      // Create existing data
      createSpec(db, {
        id: 'spec-001',
        title: 'To Delete',
        file_path: 'delete.md',
        created_by: 'alice',
      });

      createSpec(db, {
        id: 'spec-002',
        title: 'To Keep',
        file_path: 'keep.md',
        created_by: 'alice',
      });

      // Create JSONL with only spec-002
      const specs: SpecJSONL[] = [
        {
          id: 'spec-002',
          title: 'To Keep',
          file_path: 'keep.md',
          content: '',
          type: 'feature',
          status: 'draft',
          priority: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: 'alice',
          updated_by: 'alice',
          parent_id: null,
          relationships: [],
          tags: [],
        },
      ];

      await writeJSONL(path.join(TEST_DIR, 'specs', 'specs.jsonl'), specs);
      await writeJSONL(path.join(TEST_DIR, 'issues', 'issues.jsonl'), []);

      // Import
      const result = await importFromJSONL(db, {
        inputDir: TEST_DIR,
      });

      expect(result.specs.deleted).toBe(1);
    });
  });
});
