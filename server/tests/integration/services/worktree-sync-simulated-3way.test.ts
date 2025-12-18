/**
 * Integration tests for worktree sync with simulated 3-way merges
 *
 * Tests end-to-end worktree sync scenarios where local and worktree
 * both add the same entity (base = empty), requiring simulated 3-way merge.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { WorktreeSyncService } from '../../../src/services/worktree-sync-service.js';
import { GitSyncCli } from '../../../src/execution/worktree/git-sync-cli.js';
import {
  createTestRepo,
  cleanupTestRepo,
} from '../execution/helpers/git-test-utils.js';
import {
  createTestDatabase,
  createExecution,
  updateExecution,
} from '../execution/helpers/test-setup.js';

/**
 * Setup test environment with repo, worktree, execution, and database
 */
function setupTestEnvironment() {
  const repo = createTestRepo();

  // Ensure main branch
  try {
    execSync('git branch -M main', { cwd: repo, stdio: 'pipe' });
  } catch {
    // Branch already named main
  }

  // Create .sudocode directory in main
  const sudocodeDir = path.join(repo, '.sudocode');
  fs.mkdirSync(sudocodeDir, { recursive: true });

  const db = createTestDatabase();

  // Create issue for execution
  db.prepare(`
    INSERT INTO issues (uuid, id, title, content, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run('uuid-i-test', 'i-test', 'Test issue', '', 'open', 1);

  // Create execution record
  const execution = createExecution(db, {
    id: 'exec-simulated-3way',
    issue_id: 'i-test',
    target_branch: 'main',
    branch_name: 'worktree-simulated',
    status: 'completed',
  });

  // Create worktree
  const worktreePath = path.join(repo, '..', 'worktree-simulated');
  execSync(`git worktree add ${worktreePath} -b worktree-simulated`, {
    cwd: repo,
    stdio: 'pipe',
  });

  // Ensure .sudocode exists in worktree too
  const worktreeSudocodeDir = path.join(worktreePath, '.sudocode');
  fs.mkdirSync(worktreeSudocodeDir, { recursive: true });

  // Update execution with worktree path
  updateExecution(db, execution.id, { worktree_path: worktreePath });

  const gitSync = new GitSyncCli(repo);

  return {
    repo,
    worktree: worktreePath,
    execution: { ...execution, worktree_path: worktreePath },
    db,
    gitSync,
  };
}

/**
 * Helper to write JSONL entity
 */
function writeJSONLEntity(filePath: string, entity: any) {
  const line = JSON.stringify(entity) + '\n';
  fs.appendFileSync(filePath, line);
}

/**
 * Helper to read JSONL entities
 */
function readJSONLEntities(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

describe('Worktree sync with simulated 3-way merge', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;
  let service: WorktreeSyncService;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
    service = new WorktreeSyncService(testEnv.db, testEnv.repo);
  });

  afterEach(() => {
    if (testEnv.db) {
      testEnv.db.close();
    }
    if (testEnv.repo) {
      cleanupTestRepo(testEnv.repo);
    }
  });

  it('should merge concurrent additions of same issue from local and worktree', async () => {
    const issuesJsonlMain = path.join(testEnv.repo, '.sudocode', 'issues.jsonl');
    const issuesJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'issues.jsonl');

    // Main branch: Add new issue
    const localIssue = {
      id: 'i-new-feature',
      uuid: 'uuid-concurrent',
      title: 'New Feature (local)',
      description: 'Added in local branch',
      status: 'open',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
      tags: ['local', 'feature'],
      relationships: [],
    };
    writeJSONLEntity(issuesJsonlMain, localIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add new issue on main"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add same issue (by UUID) with different data
    const worktreeIssue = {
      id: 'i-new-feature',
      uuid: 'uuid-concurrent',
      title: 'New Feature (worktree)',
      description: 'Added in worktree',
      status: 'in_progress',
      priority: 2,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
      tags: ['worktree', 'feature'],
      relationships: [],
    };
    fs.writeFileSync(issuesJsonlWorktree, ''); // Clear first
    writeJSONLEntity(issuesJsonlWorktree, worktreeIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add new issue on worktree"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Preview sync
    const preview = await service.previewSync(testEnv.execution.id);
    expect(preview.canSync).toBe(true);
    expect(preview.conflicts.hasConflicts).toBe(true);
    expect(preview.conflicts.jsonlConflicts.length).toBeGreaterThan(0);
    expect(preview.conflicts.jsonlConflicts[0].canAutoResolve).toBe(true);

    // Perform squash sync
    const result = await service.squashSync(testEnv.execution.id);
    if (!result.success) {
      console.error('Squash sync failed:', result.error);
    }
    expect(result.success).toBe(true);

    // Verify merged result
    const mergedEntities = readJSONLEntities(issuesJsonlMain);
    expect(mergedEntities).toHaveLength(1);

    const merged = mergedEntities[0];

    // Worktree should win (newer timestamp: 2025-01-03)
    expect(merged.title).toBe('New Feature (worktree)');
    expect(merged.status).toBe('in_progress');
    expect(merged.priority).toBe(2);
    expect(merged.updated_at).toBe('2025-01-03T00:00:00Z');

    // Metadata should be unioned
    expect(merged.tags).toContain('local');
    expect(merged.tags).toContain('worktree');
    expect(merged.tags).toContain('feature');
  });

  it('should handle multiple concurrent additions', async () => {
    const issuesJsonlMain = path.join(testEnv.repo, '.sudocode', 'issues.jsonl');
    const issuesJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'issues.jsonl');

    // Main branch: Add two issues
    const localIssue1 = {
      id: 'i-1',
      uuid: 'uuid-1',
      title: 'Issue 1 (local)',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    };
    const localIssue2 = {
      id: 'i-2',
      uuid: 'uuid-2',
      title: 'Issue 2 (local)',
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    };
    writeJSONLEntity(issuesJsonlMain, localIssue1);
    writeJSONLEntity(issuesJsonlMain, localIssue2);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add issues on main"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add uuid-1 (conflict) and uuid-3 (new)
    const worktreeIssue1 = {
      id: 'i-1',
      uuid: 'uuid-1',
      title: 'Issue 1 (worktree)',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    };
    const worktreeIssue3 = {
      id: 'i-3',
      uuid: 'uuid-3',
      title: 'Issue 3 (worktree)',
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    };
    fs.writeFileSync(issuesJsonlWorktree, '');
    writeJSONLEntity(issuesJsonlWorktree, worktreeIssue1);
    writeJSONLEntity(issuesJsonlWorktree, worktreeIssue3);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add issues on worktree"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify: Should have 3 issues (uuid-1 merged, uuid-2 from local, uuid-3 from worktree)
    const mergedEntities = readJSONLEntities(issuesJsonlMain);
    expect(mergedEntities).toHaveLength(3);

    const ids = mergedEntities.map((e) => e.id).sort();
    expect(ids).toEqual(['i-1', 'i-2', 'i-3']);

    // uuid-1 should be merged with worktree winning
    const merged1 = mergedEntities.find((e) => e.uuid === 'uuid-1');
    expect(merged1?.title).toBe('Issue 1 (worktree)');
  });

  it('should union tags and relationships in simulated 3-way', async () => {
    const issuesJsonlMain = path.join(testEnv.repo, '.sudocode', 'issues.jsonl');
    const issuesJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'issues.jsonl');

    // Main: Add issue with local tags and relationships
    const localIssue = {
      id: 'i-metadata',
      uuid: 'uuid-metadata',
      title: 'Feature',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
      tags: ['backend', 'local-tag'],
      relationships: [
        {
          from: 'i-metadata',
          from_type: 'issue',
          to: 's-local-spec',
          to_type: 'spec',
          type: 'implements',
        },
      ],
    };
    writeJSONLEntity(issuesJsonlMain, localIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add issue with metadata on main"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add same issue with different tags and relationships
    const worktreeIssue = {
      id: 'i-metadata',
      uuid: 'uuid-metadata',
      title: 'Feature',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
      tags: ['backend', 'worktree-tag'],
      relationships: [
        {
          from: 'i-metadata',
          from_type: 'issue',
          to: 'i-worktree-dep',
          to_type: 'issue',
          type: 'blocks',
        },
      ],
    };
    fs.writeFileSync(issuesJsonlWorktree, '');
    writeJSONLEntity(issuesJsonlWorktree, worktreeIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add issue with metadata on worktree"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify metadata union
    const mergedEntities = readJSONLEntities(issuesJsonlMain);
    expect(mergedEntities).toHaveLength(1);

    const merged = mergedEntities[0];

    // All tags should be present
    expect(merged.tags).toHaveLength(3);
    expect(merged.tags).toContain('backend');
    expect(merged.tags).toContain('local-tag');
    expect(merged.tags).toContain('worktree-tag');

    // All relationships should be present
    expect(merged.relationships).toHaveLength(2);
    expect(merged.relationships.some((r: any) => r.to === 's-local-spec')).toBe(true);
    expect(merged.relationships.some((r: any) => r.to === 'i-worktree-dep')).toBe(true);
  });

  it('should merge multi-line descriptions with YAML line-level merging', async () => {
    const specsJsonlMain = path.join(testEnv.repo, '.sudocode', 'specs.jsonl');
    const specsJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'specs.jsonl');

    // Main: Add spec with multi-line description
    const localSpec = {
      id: 's-docs',
      uuid: 'uuid-docs',
      title: 'Documentation',
      content: `# API Documentation

## Authentication
Use JWT tokens for authentication.

## Endpoints
Coming soon...`,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    };
    writeJSONLEntity(specsJsonlMain, localSpec);
    execSync('git add .sudocode/specs.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add spec on main"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add same spec with different multi-line content
    const worktreeSpec = {
      id: 's-docs',
      uuid: 'uuid-docs',
      title: 'API Documentation',
      content: `# API Documentation

## Authentication
Coming soon...

## Endpoints
### GET /api/users
Returns list of users.`,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    };
    fs.writeFileSync(specsJsonlWorktree, '');
    writeJSONLEntity(specsJsonlWorktree, worktreeSpec);
    execSync('git add .sudocode/specs.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add spec on worktree"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify merged content
    const mergedEntities = readJSONLEntities(specsJsonlMain);
    expect(mergedEntities).toHaveLength(1);

    const merged = mergedEntities[0];

    // Title from worktree (newer)
    expect(merged.title).toBe('API Documentation');

    // Content should merge both changes (YAML line-level merge)
    expect(merged.content).toContain('JWT tokens');
    expect(merged.content).toContain('GET /api/users');
  });

  it('should handle one-sided additions correctly', async () => {
    const issuesJsonlMain = path.join(testEnv.repo, '.sudocode', 'issues.jsonl');
    const issuesJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'issues.jsonl');

    // Main: Add issue
    const localIssue = {
      id: 'i-local-only',
      uuid: 'uuid-local',
      title: 'Local only issue',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    writeJSONLEntity(issuesJsonlMain, localIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add local issue"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add different issue
    const worktreeIssue = {
      id: 'i-worktree-only',
      uuid: 'uuid-worktree',
      title: 'Worktree only issue',
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    };
    fs.writeFileSync(issuesJsonlWorktree, '');
    writeJSONLEntity(issuesJsonlWorktree, worktreeIssue);
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add worktree issue"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Both should be present
    const mergedEntities = readJSONLEntities(issuesJsonlMain);
    expect(mergedEntities).toHaveLength(2);

    expect(mergedEntities.find((e) => e.uuid === 'uuid-local')?.title).toBe('Local only issue');
    expect(mergedEntities.find((e) => e.uuid === 'uuid-worktree')?.title).toBe('Worktree only issue');
  });

  it('should preserve sorting by created_at after merge', async () => {
    const issuesJsonlMain = path.join(testEnv.repo, '.sudocode', 'issues.jsonl');
    const issuesJsonlWorktree = path.join(testEnv.worktree, '.sudocode', 'issues.jsonl');

    // Main: Add issues in random order
    writeJSONLEntity(issuesJsonlMain, {
      id: 'i-3',
      uuid: 'uuid-3',
      title: 'Third',
      created_at: '2025-01-03T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    });
    writeJSONLEntity(issuesJsonlMain, {
      id: 'i-1',
      uuid: 'uuid-1',
      title: 'First',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    });
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.repo, stdio: 'pipe' });
    execSync('git commit -m "Add issues on main"', { cwd: testEnv.repo, stdio: 'pipe' });

    // Worktree: Add more issues
    fs.writeFileSync(issuesJsonlWorktree, '');
    writeJSONLEntity(issuesJsonlWorktree, {
      id: 'i-4',
      uuid: 'uuid-4',
      title: 'Fourth',
      created_at: '2025-01-04T00:00:00Z',
      updated_at: '2025-01-04T00:00:00Z',
    });
    writeJSONLEntity(issuesJsonlWorktree, {
      id: 'i-2',
      uuid: 'uuid-2',
      title: 'Second',
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    });
    execSync('git add .sudocode/issues.jsonl', { cwd: testEnv.worktree, stdio: 'pipe' });
    execSync('git commit -m "Add issues on worktree"', { cwd: testEnv.worktree, stdio: 'pipe' });

    // Sync
    const result = await service.squashSync(testEnv.execution.id);
    expect(result.success).toBe(true);

    // Verify sorted by created_at
    const mergedEntities = readJSONLEntities(issuesJsonlMain);
    expect(mergedEntities).toHaveLength(4);

    const ids = mergedEntities.map((e) => e.id);
    expect(ids).toEqual(['i-1', 'i-2', 'i-3', 'i-4']);
  });
});
