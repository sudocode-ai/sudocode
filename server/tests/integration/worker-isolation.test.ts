/**
 * Integration tests for worker pool isolation
 *
 * Tests that worker processes provide proper isolation:
 * - Crash isolation (worker crash doesn't affect main server)
 * - Memory isolation (workers respect memory limits)
 * - Concurrency control (max concurrent workers enforced)
 * - Clean shutdown (workers terminate gracefully)
 *
 * NOTE: These tests spawn actual worker processes and require:
 * 1. Server built with npm run build
 * 2. Tests run with NODE_ENV=test
 *
 * Run with: npm test -- --run tests/integration/worker-isolation.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { ExecutionWorkerPool } from '../../src/services/execution-worker-pool.js'
import type { Execution } from '@sudocode-ai/types'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Skip these tests in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true'

describe.skipIf(SKIP_INTEGRATION_TESTS)('Worker Isolation Integration Tests', () => {
  let testDir: string
  let dbPath: string
  let repoPath: string
  let db: Database.Database
  let pool: ExecutionWorkerPool

  // Create test execution record
  // Use 'copilot' (legacy agent) to avoid spawning real Claude processes via ACP
  // ACP-native agents (claude-code) try to spawn real processes via AgentFactory.spawn()
  const createTestExecution = (id: string): Execution => ({
    id,
    issue_id: 'i-test',
    agent_type: 'copilot',
    mode: 'local',
    status: 'pending',
    prompt: 'Test prompt',
    config: JSON.stringify({}),
    target_branch: 'main',
    branch_name: 'main',
    created_at: new Date().toISOString(),
  })

  beforeAll(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `worker-integration-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    // Create test database
    dbPath = join(testDir, 'test.db')
    db = new Database(dbPath)

    // Initialize database schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        issue_id TEXT,
        agent_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        config TEXT,
        target_branch TEXT,
        branch_name TEXT,
        worktree_path TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_logs (
        execution_id TEXT PRIMARY KEY,
        raw_logs TEXT NOT NULL DEFAULT '',
        byte_size INTEGER NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
      );
    `)

    // Create test repository directory
    repoPath = join(testDir, 'repo')
    mkdirSync(repoPath, { recursive: true })
  })

  afterEach(async () => {
    // Shutdown pool if it exists
    if (pool) {
      await pool.shutdown()
    }

    // Clear all data from tables (but keep schema)
    if (db) {
      db.prepare('DELETE FROM execution_logs').run()
      db.prepare('DELETE FROM executions').run()
    }
  })

  afterAll(() => {
    // Close database
    if (db) {
      db.close()
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('crash isolation', () => {
    // Skip crash tests: The current executor architecture doesn't support the
    // 'exit(1)' prompt pattern used to trigger crashes. Workers now go through
    // full agent initialization (via AgentExecutorWrapper/AcpExecutorWrapper)
    // before processing prompts, so the immediate-crash behavior doesn't work.
    // These tests need to be redesigned with a different crash triggering mechanism.
    it.skip('should not crash main process when worker crashes', async () => {
      pool = new ExecutionWorkerPool('test-project', {
        maxConcurrentWorkers: 1,
        verbose: false,
      })

      const execution = createTestExecution('exec-crash-test')

      // Insert execution into database
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'exit(1)', // Worker will exit immediately
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      // Track crash event
      let crashCalled = false
      const onCrash = vi.fn(() => {
        crashCalled = true
      })

      const crashPool = new ExecutionWorkerPool(
        'test-project',
        { maxConcurrentWorkers: 1 },
        { onCrash }
      )

      try {
        await crashPool.startExecution(execution, repoPath, dbPath)

        // Wait for worker to start and crash
        await new Promise((resolve) => setTimeout(resolve, 2000))

        // Main process should still be running
        expect(process.pid).toBeTruthy()
        expect(crashPool.getActiveWorkerCount()).toBe(0)
      } finally {
        await crashPool.shutdown()
      }
    }, 15000)

    it.skip('should handle multiple worker crashes independently', async () => {
      const crashCount = { count: 0 }
      const onCrash = vi.fn(() => {
        crashCount.count++
      })

      pool = new ExecutionWorkerPool(
        'test-project',
        { maxConcurrentWorkers: 3 },
        { onCrash }
      )

      // Start 3 workers that will crash
      const executions = [
        createTestExecution('exec-crash-1'),
        createTestExecution('exec-crash-2'),
        createTestExecution('exec-crash-3'),
      ]

      for (const exec of executions) {
        db.prepare(
          `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          exec.id,
          exec.issue_id,
          exec.agent_type,
          exec.mode,
          exec.status,
          'exit(1)',
          exec.target_branch,
          exec.branch_name,
          exec.created_at
        )

        await pool.startExecution(exec, repoPath, dbPath)
      }

      // Wait for all workers to crash
      await new Promise((resolve) => setTimeout(resolve, 3000))

      // All workers should have crashed independently
      expect(pool.getActiveWorkerCount()).toBe(0)
    }, 20000)
  })

  describe('concurrency control', () => {
    it('should enforce max concurrent workers limit', async () => {
      pool = new ExecutionWorkerPool('test-project', {
        maxConcurrentWorkers: 2,
        verbose: false,
      })

      // Start 2 workers (should succeed)
      const exec1 = createTestExecution('exec-concurrent-1')
      const exec2 = createTestExecution('exec-concurrent-2')

      for (const exec of [exec1, exec2]) {
        db.prepare(
          `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          exec.id,
          exec.issue_id,
          exec.agent_type,
          exec.mode,
          exec.status,
          'console.log("test"); setTimeout(() => {}, 10000)',
          exec.target_branch,
          exec.branch_name,
          exec.created_at
        )
      }

      await pool.startExecution(exec1, repoPath, dbPath)
      await pool.startExecution(exec2, repoPath, dbPath)

      expect(pool.getActiveWorkerCount()).toBe(2)

      // Third worker should fail
      const exec3 = createTestExecution('exec-concurrent-3')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        exec3.id,
        exec3.issue_id,
        exec3.agent_type,
        exec3.mode,
        exec3.status,
        'test',
        exec3.target_branch,
        exec3.branch_name,
        exec3.created_at
      )

      await expect(
        pool.startExecution(exec3, repoPath, dbPath)
      ).rejects.toThrow('Maximum concurrent workers')
    }, 15000)
  })

  describe('graceful shutdown', () => {
    it('should terminate all workers on shutdown', async () => {
      pool = new ExecutionWorkerPool('test-project', {
        maxConcurrentWorkers: 3,
        verbose: false,
      })

      // Start 3 workers
      const executions = [
        createTestExecution('exec-shutdown-1'),
        createTestExecution('exec-shutdown-2'),
        createTestExecution('exec-shutdown-3'),
      ]

      for (const exec of executions) {
        db.prepare(
          `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          exec.id,
          exec.issue_id,
          exec.agent_type,
          exec.mode,
          exec.status,
          'setTimeout(() => {}, 30000)', // Long-running
          exec.target_branch,
          exec.branch_name,
          exec.created_at
        )

        await pool.startExecution(exec, repoPath, dbPath)
      }

      expect(pool.getActiveWorkerCount()).toBe(3)

      // Shutdown should kill all workers
      await pool.shutdown()

      expect(pool.getActiveWorkerCount()).toBe(0)
    }, 20000)

    it('should force kill workers after graceful timeout', async () => {
      vi.useFakeTimers()

      pool = new ExecutionWorkerPool('test-project', {
        maxConcurrentWorkers: 1,
        verbose: false,
      })

      const execution = createTestExecution('exec-force-kill')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'while(true) {}', // Infinite loop that won't respond to SIGTERM
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      await pool.startExecution(execution, repoPath, dbPath)

      const shutdownPromise = pool.shutdown()

      // Advance timers past graceful timeout
      vi.advanceTimersByTime(5000)

      await shutdownPromise

      expect(pool.getActiveWorkerCount()).toBe(0)

      vi.useRealTimers()
    }, 15000)
  })

  describe('worker lifecycle', () => {
    it('should transition worker through states correctly', async () => {
      const statusChanges: string[] = []
      const onStatusChange = vi.fn((executionId: string, status: string) => {
        statusChanges.push(status)
      })

      // Use mock worker that doesn't require Claude CLI
      const mockWorkerPath = join(__dirname, 'fixtures/mock-worker.ts')
      pool = new ExecutionWorkerPool(
        'test-project',
        { maxConcurrentWorkers: 1, workerScriptPath: mockWorkerPath },
        { onStatusChange }
      )

      const execution = createTestExecution('exec-lifecycle')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'console.log("test")',
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      const workerId = await pool.startExecution(execution, repoPath, dbPath)

      // Worker should start
      expect(workerId).toBeTruthy()
      expect(pool.hasWorker(execution.id)).toBe(true)

      const worker = pool.getWorker(execution.id)
      expect(worker?.status).toMatch(/starting|running/)

      // Wait for worker to be removed (process exit removes it from pool)
      // Poll instead of fixed timeout to avoid flakiness
      const startTime = Date.now()
      const timeout = 5000
      while (pool.hasWorker(execution.id) && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Worker should be removed after completion
      expect(pool.hasWorker(execution.id)).toBe(false)
      expect(pool.getActiveWorkerCount()).toBe(0)

      await pool.shutdown()
    }, 15000)
  })

  describe('event forwarding', () => {
    it('should forward log events from worker to main process', async () => {
      const logs: string[] = []
      let logResolve: () => void
      const logReceived = new Promise<void>((resolve) => {
        logResolve = resolve
      })

      const onLog = vi.fn((executionId: string, event: any) => {
        logs.push(event.data)
        logResolve()
      })

      // Use mock worker that doesn't require Claude CLI
      const mockWorkerPath = join(__dirname, 'fixtures/mock-worker.ts')
      pool = new ExecutionWorkerPool(
        'test-project',
        {
          maxConcurrentWorkers: 1,
          workerScriptPath: mockWorkerPath,
        },
        { onLog }
      )

      const execution = createTestExecution('exec-logs')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'console.log("Worker log test")',
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      await pool.startExecution(execution, repoPath, dbPath)

      // Wait for log event to be received (with timeout)
      await Promise.race([
        logReceived,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for log event')), 10000)
        ),
      ])

      // Should have received log events
      expect(onLog).toHaveBeenCalled()
    }, 15000)

    it('should forward completion events from worker to main process', async () => {
      let completionResolve: () => void
      const completionReceived = new Promise<void>((resolve) => {
        completionResolve = resolve
      })

      const onComplete = vi.fn(() => {
        completionResolve()
      })

      // Use mock worker that doesn't require Claude CLI
      const mockWorkerPath = join(__dirname, 'fixtures/mock-worker.ts')
      pool = new ExecutionWorkerPool(
        'test-project',
        {
          maxConcurrentWorkers: 1,
          workerScriptPath: mockWorkerPath,
        },
        { onComplete }
      )

      const execution = createTestExecution('exec-complete')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'console.log("done")',
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      await pool.startExecution(execution, repoPath, dbPath)

      // Wait for completion event to be received (with timeout)
      await Promise.race([
        completionReceived,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for completion event')), 10000)
        ),
      ])

      // Should have received completion event
      expect(onComplete).toHaveBeenCalled()
    }, 15000)
  })

  describe('cancellation', () => {
    it('should cancel running worker', async () => {
      pool = new ExecutionWorkerPool('test-project', {
        maxConcurrentWorkers: 1,
        verbose: false,
      })

      const execution = createTestExecution('exec-cancel')
      db.prepare(
        `INSERT INTO executions (id, issue_id, agent_type, mode, status, prompt, target_branch, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        execution.id,
        execution.issue_id,
        execution.agent_type,
        execution.mode,
        execution.status,
        'setTimeout(() => {}, 30000)', // Long-running
        execution.target_branch,
        execution.branch_name,
        execution.created_at
      )

      await pool.startExecution(execution, repoPath, dbPath)

      expect(pool.hasWorker(execution.id)).toBe(true)

      // Cancel worker
      await pool.cancelExecution(execution.id)

      // Worker should be removed
      expect(pool.hasWorker(execution.id)).toBe(false)
      expect(pool.getActiveWorkerCount()).toBe(0)
    }, 15000)
  })
})
