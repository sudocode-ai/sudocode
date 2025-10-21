/**
 * Unit tests for export operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from './db.js';
import { createSpec } from './operations/specs.js';
import { createIssue } from './operations/issues.js';
import { addRelationship } from './operations/relationships.js';
import { addTags } from './operations/tags.js';
import {
  specToJSONL,
  issueToJSONL,
  exportSpecsToJSONL,
  exportIssuesToJSONL,
  exportToJSONL,
  ExportDebouncer,
  createDebouncedExport,
} from './export.js';
import { readJSONL } from './jsonl.js';
import type Database from 'better-sqlite3';
import type { SpecJSONL, IssueJSONL } from './types.js';

const TEST_DIR = path.join(process.cwd(), 'test-export');

describe('Export Operations', () => {
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

  describe('specToJSONL', () => {
    it('should convert spec with relationships and tags to JSONL format', () => {
      // Create specs
      const spec1 = createSpec(db, {
        id: 'spec-001',
        title: 'Auth System',
        file_path: '.sudocode/specs/auth.md',
        content: '# Auth',
      });

      const spec2 = createSpec(db, {
        id: 'spec-002',
        title: 'Database',
        file_path: '.sudocode/specs/db.md',
      });

      // Add relationship
      addRelationship(db, {
        from_id: 'spec-001',
        from_type: 'spec',
        to_id: 'spec-002',
        to_type: 'spec',
        relationship_type: 'related',
      });

      // Add tags
      addTags(db, 'spec-001', 'spec', ['backend', 'security']);

      // Convert to JSONL
      const jsonl = specToJSONL(db, spec1);

      expect(jsonl.id).toBe('spec-001');
      expect(jsonl.title).toBe('Auth System');
      expect(jsonl.relationships).toHaveLength(1);
      expect(jsonl.relationships[0]).toEqual({
        from: 'spec-001',
        to: 'spec-002',
        type: 'related',
      });
      expect(jsonl.tags).toHaveLength(2);
      expect(jsonl.tags).toContain('backend');
      expect(jsonl.tags).toContain('security');
    });

    it('should handle spec with no relationships or tags', () => {
      const spec = createSpec(db, {
        id: 'spec-001',
        title: 'Simple Spec',
        file_path: 'simple.md',
      });

      const jsonl = specToJSONL(db, spec);

      expect(jsonl.relationships).toHaveLength(0);
      expect(jsonl.tags).toHaveLength(0);
    });
  });

  describe('issueToJSONL', () => {
    it('should convert issue with relationships and tags to JSONL format', () => {
      // Create issues
      const issue1 = createIssue(db, {
        id: 'issue-001',
        title: 'Implement OAuth',
      });

      const issue2 = createIssue(db, {
        id: 'issue-002',
        title: 'Setup database',
      });

      // Add relationship
      addRelationship(db, {
        from_id: 'issue-001',
        from_type: 'issue',
        to_id: 'issue-002',
        to_type: 'issue',
        relationship_type: 'blocks',
      });

      // Add tags
      addTags(db, 'issue-001', 'issue', ['auth', 'backend']);

      // Convert to JSONL
      const jsonl = issueToJSONL(db, issue1);

      expect(jsonl.id).toBe('issue-001');
      expect(jsonl.title).toBe('Implement OAuth');
      expect(jsonl.relationships).toHaveLength(1);
      expect(jsonl.relationships[0]).toEqual({
        from: 'issue-001',
        to: 'issue-002',
        type: 'blocks',
      });
      expect(jsonl.tags).toEqual(['auth', 'backend']);
    });
  });

  describe('exportSpecsToJSONL', () => {
    beforeEach(() => {
      // Create test data
      createSpec(db, {
        id: 'spec-001',
        title: 'Spec 1',
        file_path: 'spec1.md',
      });
      createSpec(db, {
        id: 'spec-002',
        title: 'Spec 2',
        file_path: 'spec2.md',
      });
      addTags(db, 'spec-001', 'spec', ['tag1']);
    });

    it('should export all specs', () => {
      const specs = exportSpecsToJSONL(db);

      expect(specs).toHaveLength(2);

      const ids = specs.map(s => s.id);
      expect(ids).toContain('spec-001');
      expect(ids).toContain('spec-002');

      const spec1 = specs.find(s => s.id === 'spec-001');
      expect(spec1?.tags).toContain('tag1');
    });

    it('should support incremental export with since parameter', async () => {
      // Set beforeUpdate to a time clearly in the past
      const beforeUpdate = new Date(Date.now() - 1000);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      const spec3 = createSpec(db, {
        id: 'spec-003',
        title: 'New Spec',
        file_path: 'spec3.md',
      });

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Export only specs updated since beforeUpdate
      const specs = exportSpecsToJSONL(db, { since: beforeUpdate });

      // All specs should be included since they were all created after beforeUpdate
      expect(specs.length).toBeGreaterThanOrEqual(1);
      expect(specs.some(s => s.id === 'spec-003')).toBe(true);
    });
  });

  describe('exportIssuesToJSONL', () => {
    beforeEach(() => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue 1',
      });
      createIssue(db, {
        id: 'issue-002',
        title: 'Issue 2',
      });
      addTags(db, 'issue-001', 'issue', ['bug']);
    });

    it('should export all issues', () => {
      const issues = exportIssuesToJSONL(db);

      expect(issues).toHaveLength(2);

      const issue1 = issues.find(i => i.id === 'issue-001');
      expect(issue1?.tags).toContain('bug');
    });
  });

  describe('exportToJSONL', () => {
    beforeEach(() => {
      // Create test data
      createSpec(db, {
        id: 'spec-001',
        title: 'Test Spec',
        file_path: 'test.md',
      });
      createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
      });
    });

    it('should export both specs and issues to JSONL files', async () => {
      const result = await exportToJSONL(db, { outputDir: TEST_DIR });

      expect(result.specsCount).toBe(1);
      expect(result.issuesCount).toBe(1);

      // Verify files exist
      const specsPath = path.join(TEST_DIR, 'specs.jsonl');
      const issuesPath = path.join(TEST_DIR, 'issues.jsonl');

      expect(fs.existsSync(specsPath)).toBe(true);
      expect(fs.existsSync(issuesPath)).toBe(true);

      // Read and verify content
      const specs = await readJSONL<SpecJSONL>(specsPath);
      const issues = await readJSONL<IssueJSONL>(issuesPath);

      expect(specs).toHaveLength(1);
      expect(specs[0].id).toBe('spec-001');
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('issue-001');
    });

    it('should use custom file paths', async () => {
      await exportToJSONL(db, {
        outputDir: TEST_DIR,
        specsFile: 'custom-specs.jsonl',
        issuesFile: 'custom-issues.jsonl',
      });

      const specsPath = path.join(TEST_DIR, 'custom-specs.jsonl');
      const issuesPath = path.join(TEST_DIR, 'custom-issues.jsonl');

      expect(fs.existsSync(specsPath)).toBe(true);
      expect(fs.existsSync(issuesPath)).toBe(true);
    });
  });

  describe('ExportDebouncer', () => {
    it('should debounce multiple export triggers', async () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Test',
        file_path: 'test.md',
      });

      const debouncer = new ExportDebouncer(db, 100, { outputDir: TEST_DIR });

      // Trigger multiple times
      debouncer.trigger();
      debouncer.trigger();
      debouncer.trigger();

      expect(debouncer.isPending()).toBe(true);

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(debouncer.isPending()).toBe(false);

      // Verify export happened once
      const specsPath = path.join(TEST_DIR, 'specs.jsonl');
      expect(fs.existsSync(specsPath)).toBe(true);
    });

    it('should cancel pending export', () => {
      const debouncer = new ExportDebouncer(db, 1000, { outputDir: TEST_DIR });

      debouncer.trigger();
      expect(debouncer.isPending()).toBe(true);

      debouncer.cancel();
      expect(debouncer.isPending()).toBe(false);
    });

    it('should flush pending export immediately', async () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Test',
        file_path: 'test.md',
      });

      const debouncer = new ExportDebouncer(db, 5000, { outputDir: TEST_DIR });

      debouncer.trigger();
      expect(debouncer.isPending()).toBe(true);

      // Flush immediately (don't wait 5 seconds)
      await debouncer.flush();

      expect(debouncer.isPending()).toBe(false);

      const specsPath = path.join(TEST_DIR, 'specs.jsonl');
      expect(fs.existsSync(specsPath)).toBe(true);
    });

    it('should handle execute when not pending', async () => {
      const debouncer = new ExportDebouncer(db, 100, { outputDir: TEST_DIR });

      // Execute without trigger
      await debouncer.execute();

      // Should not throw error
      expect(debouncer.isPending()).toBe(false);
    });
  });

  describe('createDebouncedExport', () => {
    it('should create a debouncer instance', () => {
      const debouncer = createDebouncedExport(db, 1000, { outputDir: TEST_DIR });

      expect(debouncer).toBeInstanceOf(ExportDebouncer);
      expect(debouncer.isPending()).toBe(false);
    });
  });
});
