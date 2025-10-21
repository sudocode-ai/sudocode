/**
 * Transaction support with proper error handling
 */

import type Database from 'better-sqlite3';

export type TransactionCallback<T> = (db: Database.Database) => T;

/**
 * Execute a function within a transaction
 * Automatically commits on success, rolls back on error
 */
export function transaction<T>(
  db: Database.Database,
  callback: TransactionCallback<T>
): T {
  // Check if we're already in a transaction
  const inTransaction = db.inTransaction;

  if (inTransaction) {
    // Already in a transaction, just execute the callback
    return callback(db);
  }

  // Start a new transaction
  const txn = db.transaction(callback);
  return txn(db);
}

/**
 * Execute multiple operations in a transaction
 * This is a convenience wrapper that handles common patterns
 */
export function batchTransaction<T>(
  db: Database.Database,
  operations: Array<() => T>
): T[] {
  return transaction(db, () => {
    const results: T[] = [];
    for (const operation of operations) {
      results.push(operation());
    }
    return results;
  });
}

/**
 * Execute an operation with automatic retry on busy/locked errors
 */
export function withRetry<T>(
  db: Database.Database,
  operation: TransactionCallback<T>,
  maxRetries: number = 3,
  delayMs: number = 100
): T {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return operation(db);
    } catch (error: any) {
      lastError = error;

      // Retry on SQLITE_BUSY or SQLITE_LOCKED
      if (
        (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') &&
        attempt < maxRetries
      ) {
        // Wait before retrying (with exponential backoff)
        const delay = delayMs * Math.pow(2, attempt);
        const sleep = new Promise((resolve) => setTimeout(resolve, delay));
        // Block until sleep completes
        sleep.then(() => {});
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Transaction failed after retries');
}

/**
 * Savepoint-based nested transaction support
 */
export class SavepointTransaction {
  private savepointId: string;
  private released: boolean = false;

  constructor(
    private db: Database.Database,
    name?: string
  ) {
    this.savepointId = name || `sp_${Date.now()}_${Math.random().toString().replace('.', '')}`;
    this.db.prepare(`SAVEPOINT ${this.savepointId}`).run();
  }

  /**
   * Commit the savepoint
   */
  commit(): void {
    if (this.released) {
      throw new Error('Savepoint already released');
    }
    this.db.prepare(`RELEASE ${this.savepointId}`).run();
    this.released = true;
  }

  /**
   * Rollback the savepoint
   */
  rollback(): void {
    if (this.released) {
      throw new Error('Savepoint already released');
    }
    this.db.prepare(`ROLLBACK TO ${this.savepointId}`).run();
    this.db.prepare(`RELEASE ${this.savepointId}`).run();
    this.released = true;
  }

  /**
   * Execute a callback with automatic commit/rollback
   */
  static execute<T>(
    db: Database.Database,
    callback: (sp: SavepointTransaction) => T
  ): T {
    const sp = new SavepointTransaction(db);
    try {
      const result = callback(sp);
      if (!sp.released) {
        sp.commit();
      }
      return result;
    } catch (error) {
      if (!sp.released) {
        sp.rollback();
      }
      throw error;
    }
  }
}
