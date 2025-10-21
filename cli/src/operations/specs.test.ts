/**
 * Unit tests for Spec operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../db.js';
import { createSpec, getSpec, getSpecByFilePath, updateSpec, deleteSpec, listSpecs, searchSpecs } from './specs.js';
import type Database from 'better-sqlite3';

describe('Spec Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ':memory:' });
  });

  describe('createSpec', () => {
    it('should create a spec with all fields', () => {
      const spec = createSpec(db, {
        id: 'spec-001',
        title: 'Test Spec',
        file_path: '.sudocode/specs/test.md',
        content: '# Test Content',
        priority: 1,
      });

      expect(spec.id).toBe('spec-001');
      expect(spec.title).toBe('Test Spec');
      expect(spec.priority).toBe(1);
    });

    it('should create a spec with default values', () => {
      const spec = createSpec(db, {
        id: 'spec-002',
        title: 'Minimal Spec',
        file_path: '.sudocode/specs/minimal.md',
      });

      expect(spec.content).toBe('');
      expect(spec.priority).toBe(2);
    });

    it('should throw error on duplicate ID', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'First',
        file_path: 'first.md',
      });

      expect(() => {
        createSpec(db, {
          id: 'spec-001',
          title: 'Duplicate',
          file_path: 'duplicate.md',
        });
      }).toThrow('Constraint violation');
    });
  });

  describe('getSpec', () => {
    it('should retrieve an existing spec', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Test Spec',
        file_path: 'test.md',
      });

      const spec = getSpec(db, 'spec-001');
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe('Test Spec');
    });

    it('should return null for non-existent spec', () => {
      const spec = getSpec(db, 'non-existent');
      expect(spec).toBeNull();
    });
  });

  describe('getSpecByFilePath', () => {
    it('should retrieve a spec by its file path', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Test Spec',
        file_path: 'specs/test-spec.md',
      });

      const spec = getSpecByFilePath(db, 'specs/test-spec.md');
      expect(spec).not.toBeNull();
      expect(spec?.id).toBe('spec-001');
      expect(spec?.title).toBe('Test Spec');
      expect(spec?.file_path).toBe('specs/test-spec.md');
    });

    it('should return null for non-existent file path', () => {
      const spec = getSpecByFilePath(db, 'specs/non-existent.md');
      expect(spec).toBeNull();
    });

    it('should distinguish between different specs with similar paths', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'First Spec',
        file_path: 'specs/test.md',
      });

      createSpec(db, {
        id: 'spec-002',
        title: 'Second Spec',
        file_path: 'specs/test2.md',
      });

      const spec1 = getSpecByFilePath(db, 'specs/test.md');
      const spec2 = getSpecByFilePath(db, 'specs/test2.md');

      expect(spec1?.id).toBe('spec-001');
      expect(spec2?.id).toBe('spec-002');
    });
  });

  describe('updateSpec', () => {
    it('should update spec fields', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Original Title',
        file_path: 'test.md',
      });

      const updated = updateSpec(db, 'spec-001', {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
    });

    it('should throw error for non-existent spec', () => {
      expect(() => {
        updateSpec(db, 'non-existent', {
          title: 'New Title',
        });
      }).toThrow('Spec not found');
    });
  });

  describe('deleteSpec', () => {
    it('should delete an existing spec', () => {
      createSpec(db, {
        id: 'spec-001',
        title: 'To Delete',
        file_path: 'delete.md',
      });

      const deleted = deleteSpec(db, 'spec-001');
      expect(deleted).toBe(true);

      const spec = getSpec(db, 'spec-001');
      expect(spec).toBeNull();
    });

    it('should return false for non-existent spec', () => {
      const deleted = deleteSpec(db, 'non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listSpecs', () => {
    beforeEach(() => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Spec 1',
        file_path: 'spec1.md',
        priority: 1,
      });
      createSpec(db, {
        id: 'spec-002',
        title: 'Spec 2',
        file_path: 'spec2.md',
        priority: 2,
      });
    });

    it('should list all specs', () => {
      const specs = listSpecs(db);
      expect(specs).toHaveLength(2);
    });

    it('should filter by priority', () => {
      const specs = listSpecs(db, { priority: 1 });
      expect(specs).toHaveLength(1);
      expect(specs[0].id).toBe('spec-001');
    });

    it('should respect limit', () => {
      const specs = listSpecs(db, { limit: 1 });
      expect(specs).toHaveLength(1);
    });
  });

  describe('searchSpecs', () => {
    beforeEach(() => {
      createSpec(db, {
        id: 'spec-001',
        title: 'Authentication System',
        file_path: 'auth.md',
        content: 'Implements OAuth 2.0',
      });
      createSpec(db, {
        id: 'spec-002',
        title: 'Database Design',
        file_path: 'db.md',
        content: 'PostgreSQL schema',
      });
    });

    it('should search by title', () => {
      const results = searchSpecs(db, 'Authentication');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('spec-001');
    });

    it('should search by content', () => {
      const results = searchSpecs(db, 'OAuth');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('spec-001');
    });

    it('should return empty for no matches', () => {
      const results = searchSpecs(db, 'NonExistent');
      expect(results).toHaveLength(0);
    });
  });
});
