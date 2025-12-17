/**
 * Execution Test Utilities
 *
 * Shared helper functions for setting up ExecutionService tests,
 * including database setup, service instantiation, and mock helpers.
 */

import Database from 'better-sqlite3';
import { ExecutionService } from '../../../../src/services/execution-service.js';
import { ExecutionLifecycleService } from '../../../../src/services/execution-lifecycle.js';
import { ExecutionLogsStore } from '../../../../src/services/execution-logs-store.js';
import { TransportManager } from '../../../../src/execution/transport/transport-manager.js';
import * as fs from 'fs/promises';
import { vi } from 'vitest';
import {
  DB_CONFIG,
  ISSUES_TABLE,
  SPECS_TABLE,
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
  RELATIONSHIPS_TABLE,
  TAGS_TABLE,
} from '@sudocode-ai/types/schema';
import { runMigrations } from '@sudocode-ai/types/migrations';

/**
 * Create an in-memory SQLite database with full schema including tags
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');

  // Apply configuration
  db.exec(DB_CONFIG);

  // Create tables in order (respecting foreign keys)
  db.exec(SPECS_TABLE);
  db.exec(ISSUES_TABLE);
  db.exec(RELATIONSHIPS_TABLE);
  db.exec(TAGS_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);
  db.exec(WORKFLOWS_TABLE);
  db.exec(WORKFLOW_EVENTS_TABLE);

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Mock worktree manager for testing
 */
export function createMockWorktreeManager(): any {
  return {
    createWorktree: vi.fn().mockResolvedValue({
      path: '/tmp/test-worktree',
      branch: 'test-branch',
    }),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue([]),
    listBranches: vi.fn().mockResolvedValue(['main', 'test-branch']),
    isValidRepo: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    branchExists: vi.fn().mockResolvedValue(true),
    createBranch: vi.fn().mockResolvedValue(undefined),
    getCommitHash: vi.fn().mockResolvedValue('abc123'),
    getWorktreePath: vi.fn().mockReturnValue('/tmp/test-worktree'),
    getRepoRoot: vi.fn().mockResolvedValue('/test/repo'),
    getConfig: vi.fn().mockReturnValue({
      worktreeStoragePath: '/tmp/test-worktrees',
      autoCreateBranches: true,
      autoDeleteBranches: false,
      branchPrefix: 'sudocode',
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create ExecutionService with all dependencies for testing
 */
export interface ExecutionServiceSetup {
  db: Database.Database;
  service: ExecutionService;
  lifecycleService: ExecutionLifecycleService;
  logsStore: ExecutionLogsStore;
  transportManager: TransportManager;
  mockWorktreeManager: any;
}

export function createExecutionServiceSetup(
  projectId = 'test-project',
  repoPath = '/tmp/test-repo'
): ExecutionServiceSetup {
  const db = createTestDatabase();
  const mockWorktreeManager = createMockWorktreeManager();
  const lifecycleService = new ExecutionLifecycleService(
    db,
    repoPath,
    mockWorktreeManager
  );
  const logsStore = new ExecutionLogsStore(db);
  const transportManager = new TransportManager();

  const service = new ExecutionService(
    db,
    projectId,
    repoPath,
    lifecycleService,
    transportManager,
    logsStore
  );

  return {
    db,
    service,
    lifecycleService,
    logsStore,
    transportManager,
    mockWorktreeManager,
  };
}

/**
 * Helper to mock sudocode-mcp package detection (via which/where command)
 */
export async function mockSudocodeMcpDetection(isInstalled: boolean) {
  const { execFileNoThrow } = await import(
    '../../../../src/utils/execFileNoThrow.js'
  );

  if (isInstalled) {
    vi.mocked(execFileNoThrow).mockResolvedValue({
      stdout: '/usr/local/bin/sudocode-mcp\n',
      stderr: '',
      status: 0,
    });
  } else {
    vi.mocked(execFileNoThrow).mockResolvedValue({
      stdout: '',
      stderr: 'not found',
      status: 1,
    });
  }
}

/**
 * Helper to mock agent MCP configuration detection (settings.json for claude-code)
 */
export function mockAgentMcpDetection(isConfigured: boolean) {
  const mockSettings = isConfigured
    ? {
        $schema: 'https://json.schemastore.org/claude-code-settings.json',
        enabledPlugins: {
          'sudocode@sudocode-marketplace': true,
        },
      }
    : {
        $schema: 'https://json.schemastore.org/claude-code-settings.json',
        enabledPlugins: {},
      };

  vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSettings));
}

/**
 * Helper to get the captured config from the mock executor factory
 */
export async function getCapturedExecutorConfig(): Promise<any> {
  const factory = await import(
    '../../../../src/execution/executors/executor-factory.js'
  );
  return factory.__getCapturedConfig();
}
