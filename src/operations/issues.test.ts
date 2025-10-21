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
        created_by: 'user1',
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
        created_by: 'user1',
      });

      expect(issue.status).toBe('open');
      expect(issue.priority).toBe(2);
      expect(issue.assignee).toBeNull();
    });

    it('should throw error on duplicate ID', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'First',
        created_by: 'user1',
      });

      expect(() => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Duplicate',
          created_by: 'user1',
        });
      }).toThrow('Constraint violation');
    });
  });

  describe('updateIssue', () => {
    it('should update issue fields', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'Original',
        created_by: 'user1',
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
        created_by: 'user1',
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
        created_by: 'user1',
      });

      // Close it first
      updateIssue(db, 'issue-001', { status: 'closed' });

      // Reopen
      const reopened = updateIssue(db, 'issue-001', { status: 'open' });
      expect(reopened.status).toBe('open');
      expect(reopened.closed_at).toBeNull();
    });
  });

  describe('closeIssue and reopenIssue', () => {
    it('should close an issue', () => {
      createIssue(db, {
        id: 'issue-001',
        title: 'To Close',
        created_by: 'user1',
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
        created_by: 'user1',
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
        created_by: 'user1',
      });
      createIssue(db, {
        id: 'issue-002',
        title: 'Issue 2',
        status: 'closed',
        priority: 2,
        assignee: 'agent1',
        created_by: 'user1',
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
        created_by: 'user1',
      });
      createIssue(db, {
        id: 'issue-002',
        title: 'Add database migration',
        content: 'PostgreSQL schema update',
        created_by: 'user1',
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
  });
});
