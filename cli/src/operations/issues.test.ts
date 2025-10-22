/**
 * Unit tests for Issue operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../db.js';
import {
  createIssue,
  getIssue,
  updateIssue,
  deleteIssue,
  closeIssue,
  reopenIssue,
  listIssues,
  getReadyIssues,
  searchIssues,
} from './issues.js';
import type Database from 'better-sqlite3';

describe('Issue Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ':memory:' });
  });

  describe('createIssue', () => {
    it('should create an issue with all fields', () => {
      const issue = createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
        description: 'Test description',
        content: '# Details',
        status: 'open',
        priority: 1,
        assignee: 'agent1',
      });

      expect(issue.id).toBe('issue-001');
      expect(issue.title).toBe('Test Issue');
      expect(issue.priority).toBe(1);
      expect(issue.assignee).toBe('agent1');
    });

    it('should create an issue with defaults', () => {
      const issue = createIssue(db, {
        id: 'issue-002',
        title: 'Minimal Issue',
      });

      expect(issue.status).toBe('open');
      expect(issue.priority).toBe(2);
      expect(issue.assignee).toBeNull();
    });

    it('should throw error on duplicate ID', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'First',
      });

      expect(() => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Duplicate',
        });
      }).toThrow('Constraint violation');
    });

    it('should throw error when parent_id does not exist', () => {
      expect(() => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Child Issue',
          parent_id: 'issue-999',
        });
      }).toThrow('Parent issue not found: issue-999');
    });

    it('should create issue with valid parent_id', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Parent Issue',
      });

      const child = createIssue(db, {
        id: 'issue-002',
        title: 'Child Issue',
        parent_id: 'issue-001',
      });

      expect(child.parent_id).toBe('issue-001');
    });
  });

  describe('updateIssue', () => {
    it('should update issue fields', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Original',
      });

      const updated = updateIssue(db, 'issue-001', {
        title: 'Updated',
        status: 'in_progress',
        assignee: 'agent1',
      });

      expect(updated.title).toBe('Updated');
      expect(updated.status).toBe('in_progress');
      expect(updated.assignee).toBe('agent1');
    });

    it('should set closed_at when closing', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'To Close',
      });

      const closed = updateIssue(db, 'issue-001', { status: 'closed' });
      expect(closed.status).toBe('closed');
      expect(closed.closed_at).not.toBeNull();
    });

    it('should clear closed_at when reopening', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        status: 'closed',
      });

      // Close it first
      updateIssue(db, 'issue-001', { status: 'closed' });

      // Reopen
      const reopened = updateIssue(db, 'issue-001', { status: 'open' });
      expect(reopened.status).toBe('open');
      expect(reopened.closed_at).toBeNull();
    });

    it('should throw error when updating with non-existent parent_id', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
      });

      expect(() => {
        updateIssue(db, 'issue-001', {
          parent_id: 'issue-999',
        });
      }).toThrow('Parent issue not found: issue-999');
    });

    it('should update issue with valid parent_id', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Parent Issue',
      });

      createIssue(db, {
        id: 'issue-002',
        title: 'Child Issue',
      });

      const updated = updateIssue(db, 'issue-002', {
        parent_id: 'issue-001',
      });

      expect(updated.parent_id).toBe('issue-001');
    });
  });

  describe('closeIssue and reopenIssue', () => {
    it('should close an issue', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'To Close',
      });

      const closed = closeIssue(db, 'issue-001');
      expect(closed.status).toBe('closed');
      expect(closed.closed_at).not.toBeNull();
    });

    it('should reopen an issue', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue',
        status: 'closed',
      });

      closeIssue(db, 'issue-001');
      const reopened = reopenIssue(db, 'issue-001');

      expect(reopened.status).toBe('open');
      expect(reopened.closed_at).toBeNull();
    });
  });

  describe('listIssues', () => {
    beforeEach(() => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Issue 1',
        status: 'open',
        priority: 1,
      });
      createIssue(db, {
        id: 'issue-002',
        title: 'Issue 2',
        status: 'closed',
        priority: 2,
        assignee: 'agent1',
      });
    });

    it('should list all issues', () => {
      const issues = listIssues(db);
      expect(issues).toHaveLength(2);
    });

    it('should filter by status', () => {
      const issues = listIssues(db, { status: 'open' });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('issue-001');
    });

    it('should filter by priority', () => {
      const issues = listIssues(db, { priority: 1 });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('issue-001');
    });

    it('should filter by assignee', () => {
      const issues = listIssues(db, { assignee: 'agent1' });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('issue-002');
    });
  });

  describe('searchIssues', () => {
    beforeEach(() => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Fix authentication bug',
        description: 'OAuth is broken',
        status: 'open',
        priority: 1,
        assignee: 'agent1',
      });
      createIssue(db, {
        id: 'issue-002',
        title: 'Add database migration',
        content: 'PostgreSQL schema update',
        status: 'in_progress',
        priority: 2,
      });
      createIssue(db, {
        id: 'issue-003',
        title: 'Fix database connection',
        description: 'Connection pooling issue',
        status: 'closed',
        priority: 1,
      });
    });

    it('should search by title', () => {
      const results = searchIssues(db, 'authentication');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-001');
    });

    it('should search by description', () => {
      const results = searchIssues(db, 'OAuth');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-001');
    });

    it('should search by content', () => {
      const results = searchIssues(db, 'PostgreSQL');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-002');
    });

    it('should search and filter by status', () => {
      const results = searchIssues(db, 'database', { status: 'in_progress' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-002');
    });

    it('should search and filter by priority', () => {
      const results = searchIssues(db, 'Fix', { priority: 1 });
      expect(results).toHaveLength(2);
      expect(results.map(r => r.id).sort()).toEqual(['issue-001', 'issue-003']);
    });

    it('should search and filter by assignee', () => {
      const results = searchIssues(db, 'authentication', { assignee: 'agent1' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-001');
    });

    it('should search and filter by multiple criteria', () => {
      const results = searchIssues(db, 'Fix', {
        status: 'open',
        priority: 1,
        assignee: 'agent1',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('issue-001');
    });

    it('should return empty array when search matches but filters do not', () => {
      const results = searchIssues(db, 'authentication', { status: 'closed' });
      expect(results).toHaveLength(0);
    });
  });
});
