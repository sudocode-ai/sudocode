/**
 * Unit tests for Tag operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../db.js';
import {
  addTag,
  addTags,
  removeTag,
  getTags,
  getEntitiesByTag,
  removeAllTags,
  hasTag,
  getAllTags,
  setTags,
} from './tags.js';
import { createIssue } from './issues.js';
import type Database from 'better-sqlite3';

describe('Tag Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ':memory:' });

    // Create test issues
    createIssue(db, {
      id: 'issue-001',
      title: 'Issue 1',
    });
    createIssue(db, {
      id: 'issue-002',
      title: 'Issue 2',
    });
  });

  describe('addTag', () => {
    it('should add a tag to an entity', () => {
      const tag = addTag(db, 'issue-001', 'issue', 'backend');
      expect(tag.entity_id).toBe('issue-001');
      expect(tag.tag).toBe('backend');
    });

    it('should handle duplicate tags gracefully', () => {
      addTag(db, 'issue-001', 'issue', 'backend');
      const tag = addTag(db, 'issue-001', 'issue', 'backend');
      expect(tag.tag).toBe('backend');
    });
  });

  describe('addTags', () => {
    it('should add multiple tags at once', () => {
      const tags = addTags(db, 'issue-001', 'issue', ['backend', 'api', 'auth']);
      expect(tags).toHaveLength(3);
    });
  });

  describe('getTags', () => {
    beforeEach(() => {
      addTags(db, 'issue-001', 'issue', ['backend', 'api', 'auth']);
    });

    it('should get all tags for an entity', () => {
      const tags = getTags(db, 'issue-001', 'issue');
      expect(tags).toHaveLength(3);
      expect(tags).toContain('backend');
      expect(tags).toContain('api');
      expect(tags).toContain('auth');
    });

    it('should return empty array for entity with no tags', () => {
      const tags = getTags(db, 'issue-002', 'issue');
      expect(tags).toHaveLength(0);
    });
  });

  describe('removeTag', () => {
    beforeEach(() => {
      addTag(db, 'issue-001', 'issue', 'backend');
    });

    it('should remove a tag', () => {
      const removed = removeTag(db, 'issue-001', 'issue', 'backend');
      expect(removed).toBe(true);

      const tags = getTags(db, 'issue-001', 'issue');
      expect(tags).toHaveLength(0);
    });

    it('should return false for non-existent tag', () => {
      const removed = removeTag(db, 'issue-001', 'issue', 'nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('hasTag', () => {
    beforeEach(() => {
      addTag(db, 'issue-001', 'issue', 'backend');
    });

    it('should return true for existing tag', () => {
      expect(hasTag(db, 'issue-001', 'issue', 'backend')).toBe(true);
    });

    it('should return false for non-existent tag', () => {
      expect(hasTag(db, 'issue-001', 'issue', 'frontend')).toBe(false);
    });
  });

  describe('getEntitiesByTag', () => {
    beforeEach(() => {
      addTag(db, 'issue-001', 'issue', 'backend');
      addTag(db, 'issue-002', 'issue', 'backend');
      addTag(db, 'issue-001', 'issue', 'auth');
    });

    it('should get all entities with a tag', () => {
      const entities = getEntitiesByTag(db, 'backend');
      expect(entities).toHaveLength(2);
    });

    it('should filter by entity type', () => {
      const entities = getEntitiesByTag(db, 'backend', 'issue');
      expect(entities).toHaveLength(2);
    });
  });

  describe('getAllTags', () => {
    beforeEach(() => {
      addTags(db, 'issue-001', 'issue', ['backend', 'api']);
      addTags(db, 'issue-002', 'issue', ['frontend', 'ui']);
    });

    it('should get all unique tags', () => {
      const tags = getAllTags(db);
      expect(tags).toHaveLength(4);
      expect(tags).toContain('backend');
      expect(tags).toContain('frontend');
    });

    it('should filter by entity type', () => {
      const tags = getAllTags(db, 'issue');
      expect(tags).toHaveLength(4);
    });
  });

  describe('removeAllTags', () => {
    beforeEach(() => {
      addTags(db, 'issue-001', 'issue', ['backend', 'api', 'auth']);
    });

    it('should remove all tags from an entity', () => {
      const count = removeAllTags(db, 'issue-001', 'issue');
      expect(count).toBe(3);

      const tags = getTags(db, 'issue-001', 'issue');
      expect(tags).toHaveLength(0);
    });
  });

  describe('setTags', () => {
    beforeEach(() => {
      addTags(db, 'issue-001', 'issue', ['old1', 'old2']);
    });

    it('should replace all tags', () => {
      const tags = setTags(db, 'issue-001', 'issue', ['new1', 'new2', 'new3']);
      expect(tags).toHaveLength(3);

      const actualTags = getTags(db, 'issue-001', 'issue');
      expect(actualTags).toHaveLength(3);
      expect(actualTags).toContain('new1');
      expect(actualTags).not.toContain('old1');
    });
  });
});
