/**
 * Unit tests for Transaction operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../db.js';
import { transaction, batchTransaction, SavepointTransaction } from './transactions.js';
import { createIssue, getIssue } from './issues.js';
import type Database from 'better-sqlite3';

describe('Transaction Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ':memory:' });
  });

  describe('transaction', () => {
    it('should commit on success', () => {
      transaction(db, () => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Test Issue',
          created_by: 'user1',
        });
        createIssue(db, {
          id: 'issue-002',
          title: 'Another Issue',
          created_by: 'user1',
        });
      });

      expect(getIssue(db, 'issue-001')).not.toBeNull();
      expect(getIssue(db, 'issue-002')).not.toBeNull();
    });

    it('should rollback on error', () => {
      try {
        transaction(db, () => {
          createIssue(db, {
            id: 'issue-001',
            title: 'Test Issue',
            created_by: 'user1',
          });

          // This should fail (duplicate ID)
          createIssue(db, {
            id: 'issue-001',
            title: 'Duplicate',
            created_by: 'user1',
          });
        });
      } catch (error) {
        // Expected error
      }

      // First issue should have been rolled back
      expect(getIssue(db, 'issue-001')).toBeNull();
    });

    it('should handle nested transactions', () => {
      transaction(db, () => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Outer',
          created_by: 'user1',
        });

        transaction(db, () => {
          createIssue(db, {
            id: 'issue-002',
            title: 'Inner',
            created_by: 'user1',
          });
        });
      });

      expect(getIssue(db, 'issue-001')).not.toBeNull();
      expect(getIssue(db, 'issue-002')).not.toBeNull();
    });
  });

  describe('batchTransaction', () => {
    it('should execute multiple operations in a transaction', () => {
      const results = batchTransaction(db, [
        () => createIssue(db, {
          id: 'issue-001',
          title: 'Issue 1',
          created_by: 'user1',
        }),
        () => createIssue(db, {
          id: 'issue-002',
          title: 'Issue 2',
          created_by: 'user1',
        }),
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('issue-001');
      expect(results[1].id).toBe('issue-002');
    });

    it('should rollback all operations on error', () => {
      try {
        batchTransaction(db, [
          () => createIssue(db, {
            id: 'issue-001',
            title: 'Issue 1',
            created_by: 'user1',
          }),
          () => {
            throw new Error('Test error');
          },
        ]);
      } catch (error) {
        // Expected error
      }

      expect(getIssue(db, 'issue-001')).toBeNull();
    });
  });

  describe('SavepointTransaction', () => {
    it('should commit savepoint on success', () => {
      SavepointTransaction.execute(db, (sp) => {
        createIssue(db, {
          id: 'issue-001',
          title: 'Test Issue',
          created_by: 'user1',
        });
      });

      expect(getIssue(db, 'issue-001')).not.toBeNull();
    });

    it('should rollback savepoint on error', () => {
      try {
        SavepointTransaction.execute(db, (sp) => {
          createIssue(db, {
            id: 'issue-001',
            title: 'Test Issue',
            created_by: 'user1',
          });

          throw new Error('Test error');
        });
      } catch (error) {
        // Expected error
      }

      expect(getIssue(db, 'issue-001')).toBeNull();
    });

    it('should allow manual commit', () => {
      const sp = new SavepointTransaction(db);
      createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
        created_by: 'user1',
      });
      sp.commit();

      expect(getIssue(db, 'issue-001')).not.toBeNull();
    });

    it('should allow manual rollback', () => {
      const sp = new SavepointTransaction(db);
      createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
        created_by: 'user1',
      });
      sp.rollback();

      expect(getIssue(db, 'issue-001')).toBeNull();
    });
  });
});
