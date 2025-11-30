/**
 * Integration tests for execution code changes feature
 * Tests the full stack: API endpoint + service + git operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import Database from 'better-sqlite3'
import { DB_CONFIG, EXECUTIONS_TABLE, ISSUES_TABLE, EXECUTION_LOGS_TABLE, SPECS_TABLE, RELATIONSHIPS_TABLE, ISSUE_FEEDBACK_TABLE } from '@sudocode-ai/types/schema'
import { runMigrations } from '@sudocode-ai/types/migrations'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { createExecutionsRouter } from '../../src/routes/executions.js'
import { ProjectRegistry } from '../../src/services/project-registry.js'
import { ProjectManager } from '../../src/services/project-manager.js'
import { requireProject } from '../../src/middleware/project-context.js'
import { createTestDatabase } from './execution/helpers/test-setup.js'
import { createExecution } from './execution/helpers/test-setup.js'

// Helper to create a real git repository for testing
function createTestRepo(dir: string): void {
  execSync('git init', { cwd: dir })
  execSync('git config user.name "Test User"', { cwd: dir })
  execSync('git config user.email "test@example.com"', { cwd: dir })

  // Create .sudocode directory structure for valid project
  const sudocodeDir = path.join(dir, '.sudocode')
  fs.mkdirSync(sudocodeDir, { recursive: true })
  fs.mkdirSync(path.join(sudocodeDir, 'issues'), { recursive: true })
  fs.mkdirSync(path.join(sudocodeDir, 'specs'), { recursive: true })

  // Create cache.db database with schema
  const cacheDbPath = path.join(sudocodeDir, 'cache.db')
  const cacheDb = new Database(cacheDbPath)
  cacheDb.exec(DB_CONFIG)
  cacheDb.exec(ISSUES_TABLE)
  cacheDb.exec(SPECS_TABLE)
  cacheDb.exec(RELATIONSHIPS_TABLE)
  cacheDb.exec(ISSUE_FEEDBACK_TABLE)
  cacheDb.exec(EXECUTIONS_TABLE)
  cacheDb.exec(EXECUTION_LOGS_TABLE)
  runMigrations(cacheDb)
  cacheDb.close()

  // Create .gitignore to exclude SQLite temporary files
  fs.writeFileSync(path.join(dir, '.gitignore'), '.sudocode/cache.db-shm\n.sudocode/cache.db-wal\n')

  // Create initial commit
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Repo\n')
  execSync('git add .', { cwd: dir })
  execSync('git commit -m "Initial commit"', { cwd: dir })
}

// Helper to commit a file
function commitFile(dir: string, filename: string, content: string, message: string): string {
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  execSync(`git add ${filename}`, { cwd: dir })
  execSync(`git commit -m "${message}"`, { cwd: dir })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
}

// Helper to get current commit SHA
function getCurrentCommit(dir: string): string {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim()
}

describe('Execution Changes Integration Tests', () => {
  let app: express.Application
  let testDir: string
  let testRepoPath: string
  let projectManager: ProjectManager
  let projectRegistry: ProjectRegistry
  let projectId: string
  let db: Database.Database

  beforeAll(async () => {
    // Create temporary directory for test repo
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-changes-'))
    testRepoPath = path.join(testDir, 'test-repo')
    fs.mkdirSync(testRepoPath, { recursive: true })

    // Initialize git repo
    createTestRepo(testRepoPath)

    // Create database
    db = createTestDatabase()

    // Create project registry and manager
    projectRegistry = new ProjectRegistry()
    projectManager = new ProjectManager(projectRegistry)

    // Open project
    const projectResult = await projectManager.openProject(testRepoPath)
    if (!projectResult.ok) {
      throw new Error(`Failed to open project: ${JSON.stringify(projectResult.error)}`)
    }
    const project = projectResult.value
    projectId = project.id

    // Create Express app with routes
    app = express()
    app.use(express.json())

    // Add project context middleware
    app.use((req, res, next) => {
      req.project = {
        id: projectId,
        path: testRepoPath,
        db: project.db,
      }
      next()
    })

    // Mount routes
    app.use('/api', createExecutionsRouter())
  })

  afterAll(() => {
    // Cleanup
    if (projectManager) {
      try {
        projectManager.closeProject(projectId)
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    if (db) {
      try {
        db.close()
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    // Remove test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    // Clean up executions table before each test to prevent UNIQUE constraint failures
    const projectDb = projectManager.getProject(projectId)?.db
    if (projectDb) {
      try {
        projectDb.prepare('DELETE FROM executions').run()
      } catch (e) {
        // Ignore errors if table doesn't exist yet
      }
    }
  })

  describe('Committed Changes (Scenario A)', () => {
    it('should return file changes for completed execution with commits', async () => {
      // Setup: Create before and after commits
      const beforeCommit = getCurrentCommit(testRepoPath)

      // Make some changes
      commitFile(testRepoPath, 'file1.ts', 'console.log("Hello");\n', 'Add file1')
      commitFile(testRepoPath, 'file2.ts', 'const x = 1;\n', 'Add file2')

      const afterCommit = getCurrentCommit(testRepoPath)

      // Create execution record in project database
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-committed-1'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, beforeCommit, afterCommit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify response structure
      expect(response.body).toHaveProperty('success', true)
      expect(response.body.data).toMatchObject({
        available: true,
        uncommitted: false,
        changes: {
          files: expect.arrayContaining([
            expect.objectContaining({
              path: 'file1.ts',
              status: 'A',
              additions: expect.any(Number),
              deletions: expect.any(Number),
            }),
            expect.objectContaining({
              path: 'file2.ts',
              status: 'A',
              additions: expect.any(Number),
              deletions: expect.any(Number),
            }),
          ]),
          summary: {
            totalFiles: 2,
            totalAdditions: expect.any(Number),
            totalDeletions: expect.any(Number),
          },
        },
        commitRange: {
          before: beforeCommit,
          after: afterCommit,
        },
      })
    })

    it('should handle modified and deleted files', async () => {
      // Setup: Create initial state
      commitFile(testRepoPath, 'existing.ts', 'const old = 1;\n', 'Add existing file')
      commitFile(testRepoPath, 'to-delete.ts', 'const x = 1;\n', 'Add file to delete')
      const beforeCommit = getCurrentCommit(testRepoPath)

      // Modify file
      commitFile(testRepoPath, 'existing.ts', 'const old = 2;\nconst new = 3;\n', 'Modify file')

      // Delete file
      fs.unlinkSync(path.join(testRepoPath, 'to-delete.ts'))
      execSync('git add to-delete.ts', { cwd: testRepoPath })
      execSync('git commit -m "Delete file"', { cwd: testRepoPath })

      const afterCommit = getCurrentCommit(testRepoPath)

      // Create execution record
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-committed-2'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, beforeCommit, afterCommit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify modified and deleted files
      expect(response.body.data.available).toBe(true)
      expect(response.body.data.changes.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'existing.ts',
            status: 'M',
          }),
          expect.objectContaining({
            path: 'to-delete.ts',
            status: 'D',
          }),
        ])
      )
    })
  })

  describe('Uncommitted Changes (Scenario B)', () => {
    it('should return uncommitted changes when after_commit equals before_commit', async () => {
      // Setup: Current state is the before and after commit
      const commit = getCurrentCommit(testRepoPath)

      // Make uncommitted changes
      fs.writeFileSync(path.join(testRepoPath, 'uncommitted.ts'), 'const x = 1;\n')
      execSync('git add uncommitted.ts', { cwd: testRepoPath })

      // Create execution record
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-uncommitted-1'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, commit, commit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify uncommitted changes
      expect(response.body.data).toMatchObject({
        available: true,
        uncommitted: true,
        changes: {
          files: expect.arrayContaining([
            expect.objectContaining({
              path: 'uncommitted.ts',
              status: 'A',
            }),
          ]),
        },
      })

      // Cleanup: reset working tree
      execSync('git reset HEAD uncommitted.ts', { cwd: testRepoPath })
      fs.unlinkSync(path.join(testRepoPath, 'uncommitted.ts'))
    })
  })

  describe('Error Cases', () => {
    it('should return unavailable for missing before_commit', async () => {
      // Create execution without before_commit
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-missing-before'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', NULL, NULL, 'main', 'main')
      `).run(executionId)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify unavailable
      expect(response.body.data).toMatchObject({
        available: false,
        reason: 'missing_commits',
      })
    })

    it('should return unavailable for incomplete execution', async () => {
      // Create execution with pending status
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-pending'
      const commit = getCurrentCommit(testRepoPath)

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'pending', ?, ?, 'main', 'main')
      `).run(executionId, commit, commit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify unavailable
      expect(response.body.data).toMatchObject({
        available: false,
        reason: 'incomplete_execution',
      })
    })

    it('should return unavailable for non-existent commits', async () => {
      // Create execution with fake commit SHAs
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-fake-commits'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, '0'.repeat(40), '1'.repeat(40))

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify unavailable
      expect(response.body.data).toMatchObject({
        available: false,
        reason: 'commits_not_found',
      })
    })

    it('should return unavailable for non-existent execution', async () => {
      const response = await request(app)
        .get('/api/executions/non-existent/changes')
        .expect(200)

      // Verify unavailable
      expect(response.body.data).toMatchObject({
        available: false,
        reason: 'incomplete_execution',
      })
    })
  })

  describe('No Changes', () => {
    it('should return empty changes when no files modified', async () => {
      // Setup: Same commit for before and after, no uncommitted changes
      const commit = getCurrentCommit(testRepoPath)

      // Create execution record
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-no-changes'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, commit, commit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify empty changes
      expect(response.body.data).toMatchObject({
        available: true,
        uncommitted: true,
        changes: {
          files: [],
          summary: {
            totalFiles: 0,
            totalAdditions: 0,
            totalDeletions: 0,
          },
        },
      })
    })
  })

  describe('Binary Files', () => {
    it('should handle binary files in changes', async () => {
      // Setup: Create before commit
      const beforeCommit = getCurrentCommit(testRepoPath)

      // Add binary file (create a simple PNG-like file)
      const binaryPath = path.join(testRepoPath, 'image.png')
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      fs.writeFileSync(binaryPath, buffer)
      execSync('git add image.png', { cwd: testRepoPath })
      execSync('git commit -m "Add binary file"', { cwd: testRepoPath })

      const afterCommit = getCurrentCommit(testRepoPath)

      // Create execution record
      const projectDb = projectManager.getProject(projectId)!.db
      const executionId = 'exec-binary'

      projectDb.prepare(`
        INSERT INTO executions (id, issue_id, agent_type, mode, prompt, status, before_commit, after_commit, target_branch, branch_name)
        VALUES (?, NULL, 'claude-code', 'local', 'Test prompt', 'completed', ?, ?, 'main', 'main')
      `).run(executionId, beforeCommit, afterCommit)

      // Test: Request changes
      const response = await request(app)
        .get(`/api/executions/${executionId}/changes`)
        .expect(200)

      // Verify binary file is included
      expect(response.body.data.available).toBe(true)
      expect(response.body.data.changes.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'image.png',
            status: 'A',
            // Binary files show as 0 or vary depending on git config
            additions: expect.any(Number),
            deletions: expect.any(Number),
          }),
        ])
      )
    })
  })
})
