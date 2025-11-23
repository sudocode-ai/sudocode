/**
 * Test setup utilities for Phase 1 integration tests
 *
 * Provides helper functions to create in-memory databases, mock services,
 * and set up test fixtures for integration testing.
 */

import Database from 'better-sqlite3';
import { vi } from 'vitest';
import type { ExecutionTask } from 'agent-execution-engine/engine';
import {
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  ISSUES_TABLE,
  DB_CONFIG
} from '@sudocode-ai/types/schema';
import { runMigrations } from '@sudocode-ai/types/migrations';
import { ExecutionLifecycleService } from '../../../../src/services/execution-lifecycle.js';
import { ExecutionLogsStore } from '../../../../src/services/execution-logs-store.js';
import { TransportManager } from '../../../../src/execution/transport/transport-manager.js';

/**
 * Create an in-memory SQLite database with the required schema
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');

  // Apply configuration
  db.exec(DB_CONFIG);

  // Create tables (issues table must be created first due to foreign key)
  db.exec(ISSUES_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);

  // Run migrations to ensure we have the latest schema
  runMigrations(db);

  return db;
}

/**
 * Create test services (lifecycle, logs, transport)
 */
export function createTestServices(db: Database.Database) {
  const lifecycleService = new ExecutionLifecycleService(db, '/tmp/test-repo');
  const logsStore = new ExecutionLogsStore(db);
  const transportManager = new TransportManager();

  return { lifecycleService, logsStore, transportManager };
}

/**
 * Create a mock ClaudeCodeExecutor for testing
 */
export function createMockExecutor() {
  return {
    executeTask: vi.fn(),
    resumeTask: vi.fn(),
    createOutputChunks: vi.fn(),
    normalizeOutput: vi.fn(),
    getCapabilities: vi.fn(() => ({
      supportsSessionResume: true,
      requiresSetup: false,
      supportsApprovals: true,
      supportsMcp: true,
      protocol: 'stream-json',
    })),
    checkAvailability: vi.fn(() => Promise.resolve(true)),
  };
}

/**
 * Create a mock child process for testing
 */
export function createMockChildProcess() {
  const EventEmitter = require('events');
  const mockChildProcess = new EventEmitter() as any;
  mockChildProcess.kill = vi.fn();
  mockChildProcess.stdout = new EventEmitter();
  mockChildProcess.stderr = new EventEmitter();
  mockChildProcess.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  return mockChildProcess;
}

/**
 * Create a mock ManagedProcess wrapper
 */
export function createMockManagedProcess() {
  const mockChildProcess = createMockChildProcess();

  // Mock peer for protocol handling (required for peer-based message handling)
  const mockPeer = {
    onMessage: vi.fn(),
  };

  return {
    process: mockChildProcess,
    peer: mockPeer,
  };
}

/**
 * Create a basic execution task for testing
 */
export function createTestTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: 'task-test-1',
    type: 'issue',
    prompt: 'Test prompt',
    workDir: '/tmp/test',
    config: {},
    priority: 0,
    dependencies: [],
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create an execution record in the database
 */
export function createExecution(
  db: Database.Database,
  data: {
    id: string;
    issue_id?: string;
    agent_type?: string;
    mode?: string;
    prompt?: string;
    status?: string;
    target_branch?: string;
    branch_name?: string;
  }
) {
  const stmt = db.prepare(`
    INSERT INTO executions (
      id, issue_id, agent_type, mode, prompt, status,
      target_branch, branch_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    data.id,
    data.issue_id || null,
    data.agent_type || 'claude-code',
    data.mode || 'worktree',
    data.prompt || 'Test prompt',
    data.status || 'pending',
    data.target_branch || 'main',
    data.branch_name || 'test-branch'
  );

  return getExecution(db, data.id);
}

/**
 * Get an execution record from the database
 */
export function getExecution(db: Database.Database, id: string) {
  const stmt = db.prepare('SELECT * FROM executions WHERE id = ?');
  return stmt.get(id) as any;
}

/**
 * Update an execution record in the database
 */
export function updateExecution(
  db: Database.Database,
  id: string,
  updates: Record<string, any>
) {
  const fields = Object.keys(updates);
  const values = Object.values(updates);

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE executions SET ${setClause} WHERE id = ?`);

  stmt.run(...values, id);

  return getExecution(db, id);
}

/**
 * Capture AG-UI events from an adapter
 */
export function captureAgUiEvents() {
  const events: any[] = [];

  const captureAdapter = {
    onEvent: (handler: (event: any) => void) => {
      // Store the handler so we can trigger it later
      (captureAdapter as any).handler = handler;
    },
    emit: (event: any) => {
      events.push(event);
      if ((captureAdapter as any).handler) {
        (captureAdapter as any).handler(event);
      }
    },
  };

  return { captureAdapter, events };
}

/**
 * Wait for a specific condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Clean up test resources
 */
export function cleanup(db: Database.Database) {
  try {
    db.close();
  } catch (error) {
    // Ignore errors during cleanup
  }
}
