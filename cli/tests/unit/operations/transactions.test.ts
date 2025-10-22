/**
 * Unit tests for Transaction operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../../src/db.js';
import { transaction, batchTransaction, SavepointTransaction } from '../../../src/operations/transactions.js';
import { createIssue, getIssue } from '../../../src/operations/issues.js';
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
        });
        createIssue(db, {
          id: 'issue-002',
          title: 'Another Issue',
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
          });

          // This should fail (duplicate ID)
          createIssue(db, {
            id: 'issue-001',
            title: 'Duplicate',
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
        });

        transaction(db, () => {
          createIssue(db, {
            id: 'issue-002',
            title: 'Inner',
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
        }),
        () => createIssue(db, {
          id: 'issue-002',
          title: 'Issue 2',
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
      });
      sp.commit();

      expect(getIssue(db, 'issue-001')).not.toBeNull();
    });

    it('should allow manual rollback', () => {
      const sp = new SavepointTransaction(db);
      createIssue(db, {
        id: 'issue-001',
        title: 'Test Issue',
      });
      sp.rollback();

      expect(getIssue(db, 'issue-001')).toBeNull();
    });
  });
});
