/**
 * Unit tests for JSONL diffing utilities
 *
 * @module tests/unit/utils/jsonl-diff
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { IssueJSONL, SpecJSONL, RelationshipJSONL, FeedbackJSONL } from '@sudocode-ai/types';
import {
  hasSemanticChanges,
  readJSONLAtCommit,
  readJSONLFromPath,
  computeSnapshotDiff,
  computeSnapshotDiffFromCommits,
  serializeSnapshot,
  parseSnapshot,
  hasAnyChanges,
  JSONL_PATHS,
  type SemanticChangeResult,
  type EntityChange,
  type SnapshotDiff,
} from '../../../src/utils/jsonl-diff.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function createIssue(overrides: Partial<IssueJSONL> = {}): IssueJSONL {
  return {
    id: 'i-test',
    uuid: '00000000-0000-0000-0000-000000000001',
    title: 'Test Issue',
    status: 'open',
    content: 'Test content',
    priority: 1,
    archived: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    file_path: '.sudocode/issues/i-test.md',
    tags: [],
    relationships: [],
    feedback: [],
    ...overrides,
  };
}

function createSpec(overrides: Partial<SpecJSONL> = {}): SpecJSONL {
  return {
    id: 's-test',
    uuid: '00000000-0000-0000-0000-000000000002',
    title: 'Test Spec',
    content: 'Test spec content',
    priority: 1,
    archived: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    file_path: '.sudocode/specs/s-test.md',
    tags: [],
    relationships: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// hasSemanticChanges Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('hasSemanticChanges', () => {
  describe('issue changes', () => {
    it('detects title change', () => {
      const baseline = createIssue({ title: 'Original' });
      const current = createIssue({ title: 'Modified' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('title');
    });

    it('detects status change', () => {
      const baseline = createIssue({ status: 'open' });
      const current = createIssue({ status: 'in_progress' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('status');
    });

    it('detects content change', () => {
      const baseline = createIssue({ content: 'Original content' });
      const current = createIssue({ content: 'Modified content' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('content');
    });

    it('detects priority change', () => {
      const baseline = createIssue({ priority: 1 });
      const current = createIssue({ priority: 2 });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('priority');
    });

    it('detects archived change', () => {
      const baseline = createIssue({ archived: false });
      const current = createIssue({ archived: true });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('archived');
    });

    it('ignores updated_at change only', () => {
      const baseline = createIssue({ updated_at: '2024-01-01T00:00:00Z' });
      const current = createIssue({ updated_at: '2024-01-02T00:00:00Z' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });

    it('ignores created_at change only', () => {
      const baseline = createIssue({ created_at: '2024-01-01T00:00:00Z' });
      const current = createIssue({ created_at: '2024-01-02T00:00:00Z' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });

    it('ignores uuid change only', () => {
      const baseline = createIssue({ uuid: '00000000-0000-0000-0000-000000000001' });
      const current = createIssue({ uuid: '00000000-0000-0000-0000-000000000002' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(false);
    });

    it('ignores file_path change only', () => {
      const baseline = createIssue({ file_path: '.sudocode/issues/old.md' });
      const current = createIssue({ file_path: '.sudocode/issues/new.md' });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(false);
    });

    it('detects relationship changes', () => {
      const relationship: RelationshipJSONL = {
        from: 'i-test',
        from_type: 'issue',
        to: 's-spec1',
        to_type: 'spec',
        type: 'implements',
        created_at: '2024-01-01T00:00:00Z',
      };

      const baseline = createIssue({ relationships: [] });
      const current = createIssue({ relationships: [relationship] });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('relationships');
    });

    it('detects tag changes', () => {
      const baseline = createIssue({ tags: ['bug'] });
      const current = createIssue({ tags: ['bug', 'urgent'] });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('tags');
    });

    it('detects feedback changes', () => {
      const feedback: FeedbackJSONL = {
        id: 'fb-1',
        from_id: 'i-test',
        to_id: 's-spec1',
        feedback_type: 'comment',
        content: 'Test feedback',
        agent: 'user',
        dismissed: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const baseline = createIssue({ feedback: [] });
      const current = createIssue({ feedback: [feedback] });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('feedback');
    });
  });

  describe('spec changes', () => {
    it('detects title change', () => {
      const baseline = createSpec({ title: 'Original' });
      const current = createSpec({ title: 'Modified' });

      const result = hasSemanticChanges(baseline, current, 'spec');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('title');
    });

    it('detects content change', () => {
      const baseline = createSpec({ content: 'Original' });
      const current = createSpec({ content: 'Modified' });

      const result = hasSemanticChanges(baseline, current, 'spec');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('content');
    });

    it('ignores updated_at change only', () => {
      const baseline = createSpec({ updated_at: '2024-01-01T00:00:00Z' });
      const current = createSpec({ updated_at: '2024-01-02T00:00:00Z' });

      const result = hasSemanticChanges(baseline, current, 'spec');

      expect(result.hasChanges).toBe(false);
    });
  });

  describe('creation and deletion', () => {
    it('handles null baseline (created entity)', () => {
      const current = createIssue();

      const result = hasSemanticChanges(null, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('*created*');
    });

    it('handles null current (deleted entity)', () => {
      const baseline = createIssue();

      const result = hasSemanticChanges(baseline, null, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('*deleted*');
    });

    it('handles both null (no entity)', () => {
      const result = hasSemanticChanges(null, null, 'issue');

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });
  });

  describe('no changes', () => {
    it('returns no changes for identical issues', () => {
      const issue = createIssue();

      const result = hasSemanticChanges(issue, { ...issue }, 'issue');

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });

    it('returns no changes for identical specs', () => {
      const spec = createSpec();

      const result = hasSemanticChanges(spec, { ...spec }, 'spec');

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toHaveLength(0);
    });
  });

  describe('multiple changes', () => {
    it('detects multiple field changes', () => {
      const baseline = createIssue({
        title: 'Original',
        status: 'open',
        content: 'Original content',
      });
      const current = createIssue({
        title: 'Modified',
        status: 'in_progress',
        content: 'Modified content',
      });

      const result = hasSemanticChanges(baseline, current, 'issue');

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toContain('title');
      expect(result.changedFields).toContain('status');
      expect(result.changedFields).toContain('content');
      expect(result.changedFields.length).toBeGreaterThanOrEqual(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readJSONLFromPath Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('readJSONLFromPath', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-diff-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads valid JSONL file', () => {
    const issue = createIssue();
    const filePath = '.sudocode/issues/issues.jsonl';
    const fullDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, filePath), JSON.stringify(issue) + '\n');

    const result = readJSONLFromPath<IssueJSONL>(tempDir, filePath);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i-test');
  });

  it('reads multiple entities from JSONL', () => {
    const issue1 = createIssue({ id: 'i-1' });
    const issue2 = createIssue({ id: 'i-2' });
    const filePath = '.sudocode/issues/multi.jsonl';
    const fullDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, filePath),
      JSON.stringify(issue1) + '\n' + JSON.stringify(issue2) + '\n'
    );

    const result = readJSONLFromPath<IssueJSONL>(tempDir, filePath);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('i-1');
    expect(result[1].id).toBe('i-2');
  });

  it('returns empty array for missing file', () => {
    const result = readJSONLFromPath<IssueJSONL>(tempDir, 'nonexistent.jsonl');

    expect(result).toHaveLength(0);
  });

  it('handles empty file', () => {
    const filePath = '.sudocode/issues/empty.jsonl';
    const fullDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, filePath), '');

    const result = readJSONLFromPath<IssueJSONL>(tempDir, filePath);

    expect(result).toHaveLength(0);
  });

  it('skips malformed JSON lines', () => {
    const issue = createIssue({ id: 'i-valid' });
    const filePath = '.sudocode/issues/malformed.jsonl';
    const fullDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, filePath),
      'not valid json\n' + JSON.stringify(issue) + '\n{incomplete\n'
    );

    const result = readJSONLFromPath<IssueJSONL>(tempDir, filePath);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i-valid');
  });

  it('handles blank lines', () => {
    const issue = createIssue();
    const filePath = '.sudocode/issues/blanks.jsonl';
    const fullDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, filePath), '\n' + JSON.stringify(issue) + '\n\n');

    const result = readJSONLFromPath<IssueJSONL>(tempDir, filePath);

    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readJSONLAtCommit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('readJSONLAtCommit', () => {
  let tempDir: string;
  let commitSha: string;

  beforeAll(() => {
    // Create temp git repo
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-git-test-'));

    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    // Create JSONL file and commit
    const jsonlDir = path.join(tempDir, '.sudocode/issues');
    fs.mkdirSync(jsonlDir, { recursive: true });

    const issue = createIssue({ id: 'i-committed' });
    fs.writeFileSync(path.join(jsonlDir, 'issues.jsonl'), JSON.stringify(issue) + '\n');

    execSync('git add .', { cwd: tempDir });
    execSync('git commit -m "Initial commit"', { cwd: tempDir });

    commitSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads valid JSONL file from commit', () => {
    const result = readJSONLAtCommit<IssueJSONL>(
      tempDir,
      commitSha,
      '.sudocode/issues/issues.jsonl'
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('i-committed');
  });

  it('returns empty array for file not in commit', () => {
    const result = readJSONLAtCommit<IssueJSONL>(tempDir, commitSha, 'nonexistent.jsonl');

    expect(result).toHaveLength(0);
  });

  it('returns empty array for invalid commit', () => {
    const result = readJSONLAtCommit<IssueJSONL>(tempDir, 'invalidcommit', 'issues.jsonl');

    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSnapshotDiff Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSnapshotDiff', () => {
  it('identifies created entities', () => {
    const baseline: IssueJSONL[] = [];
    const current: IssueJSONL[] = [createIssue({ id: 'i-new' })];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(1);
    expect(diff.issues[0].changeType).toBe('created');
    expect(diff.issues[0].id).toBe('i-new');
  });

  it('identifies deleted entities', () => {
    const baseline: IssueJSONL[] = [createIssue({ id: 'i-deleted' })];
    const current: IssueJSONL[] = [];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(1);
    expect(diff.issues[0].changeType).toBe('deleted');
    expect(diff.issues[0].id).toBe('i-deleted');
  });

  it('identifies modified entities', () => {
    const baseline: IssueJSONL[] = [createIssue({ id: 'i-mod', title: 'Original' })];
    const current: IssueJSONL[] = [createIssue({ id: 'i-mod', title: 'Modified' })];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(1);
    expect(diff.issues[0].changeType).toBe('modified');
    expect(diff.issues[0].id).toBe('i-mod');
    expect(diff.issues[0].changedFields).toContain('title');
  });

  it('returns empty diff for no changes', () => {
    const issue = createIssue();
    const baseline: IssueJSONL[] = [issue];
    const current: IssueJSONL[] = [{ ...issue }];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(0);
    expect(diff.specs).toHaveLength(0);
  });

  it('empty baseline = all created', () => {
    const baseline: IssueJSONL[] = [];
    const current: IssueJSONL[] = [
      createIssue({ id: 'i-1' }),
      createIssue({ id: 'i-2' }),
      createIssue({ id: 'i-3' }),
    ];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(3);
    diff.issues.forEach((change) => {
      expect(change.changeType).toBe('created');
    });
  });

  it('empty current = all deleted', () => {
    const baseline: IssueJSONL[] = [
      createIssue({ id: 'i-1' }),
      createIssue({ id: 'i-2' }),
    ];
    const current: IssueJSONL[] = [];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(2);
    diff.issues.forEach((change) => {
      expect(change.changeType).toBe('deleted');
    });
  });

  it('handles mixed changes (create + modify + delete)', () => {
    const baseline: IssueJSONL[] = [
      createIssue({ id: 'i-deleted' }),
      createIssue({ id: 'i-modified', title: 'Original' }),
      createIssue({ id: 'i-unchanged' }),
    ];
    const current: IssueJSONL[] = [
      createIssue({ id: 'i-created' }),
      createIssue({ id: 'i-modified', title: 'Changed' }),
      createIssue({ id: 'i-unchanged' }),
    ];

    const diff = computeSnapshotDiff(baseline, current, [], []);

    expect(diff.issues).toHaveLength(3);

    const created = diff.issues.find((c) => c.id === 'i-created');
    const deleted = diff.issues.find((c) => c.id === 'i-deleted');
    const modified = diff.issues.find((c) => c.id === 'i-modified');

    expect(created?.changeType).toBe('created');
    expect(deleted?.changeType).toBe('deleted');
    expect(modified?.changeType).toBe('modified');
  });

  it('handles spec changes', () => {
    const baselineSpecs: SpecJSONL[] = [createSpec({ id: 's-1', title: 'Original' })];
    const currentSpecs: SpecJSONL[] = [createSpec({ id: 's-1', title: 'Modified' })];

    const diff = computeSnapshotDiff([], [], baselineSpecs, currentSpecs);

    expect(diff.specs).toHaveLength(1);
    expect(diff.specs[0].changeType).toBe('modified');
    expect(diff.specs[0].changedFields).toContain('title');
  });

  it('handles simultaneous issue and spec changes', () => {
    const baselineIssues: IssueJSONL[] = [];
    const currentIssues: IssueJSONL[] = [createIssue()];
    const baselineSpecs: SpecJSONL[] = [];
    const currentSpecs: SpecJSONL[] = [createSpec()];

    const diff = computeSnapshotDiff(baselineIssues, currentIssues, baselineSpecs, currentSpecs);

    expect(diff.issues).toHaveLength(1);
    expect(diff.specs).toHaveLength(1);
    expect(diff.issues[0].changeType).toBe('created');
    expect(diff.specs[0].changeType).toBe('created');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('serializeSnapshot and parseSnapshot', () => {
  it('serializes and parses snapshot correctly', () => {
    const changes: EntityChange<IssueJSONL>[] = [
      { id: 'i-1', changeType: 'created', entity: createIssue({ id: 'i-1' }) },
      { id: 'i-2', changeType: 'deleted', entity: createIssue({ id: 'i-2' }) },
    ];

    const serialized = serializeSnapshot(changes);
    const parsed = parseSnapshot<IssueJSONL>(serialized);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('i-1');
    expect(parsed[0].changeType).toBe('created');
    expect(parsed[1].id).toBe('i-2');
    expect(parsed[1].changeType).toBe('deleted');
  });

  it('parseSnapshot handles null', () => {
    const result = parseSnapshot<IssueJSONL>(null);
    expect(result).toHaveLength(0);
  });

  it('parseSnapshot handles invalid JSON', () => {
    const result = parseSnapshot<IssueJSONL>('not valid json');
    expect(result).toHaveLength(0);
  });

  it('parseSnapshot handles empty string', () => {
    const result = parseSnapshot<IssueJSONL>('');
    expect(result).toHaveLength(0);
  });
});

describe('hasAnyChanges', () => {
  it('returns true when issues have changes', () => {
    const diff: SnapshotDiff = {
      issues: [{ id: 'i-1', changeType: 'created', entity: createIssue() }],
      specs: [],
    };

    expect(hasAnyChanges(diff)).toBe(true);
  });

  it('returns true when specs have changes', () => {
    const diff: SnapshotDiff = {
      issues: [],
      specs: [{ id: 's-1', changeType: 'created', entity: createSpec() }],
    };

    expect(hasAnyChanges(diff)).toBe(true);
  });

  it('returns false when no changes', () => {
    const diff: SnapshotDiff = {
      issues: [],
      specs: [],
    };

    expect(hasAnyChanges(diff)).toBe(false);
  });
});

describe('JSONL_PATHS', () => {
  it('has correct paths', () => {
    expect(JSONL_PATHS.issues).toBe('.sudocode/issues/issues.jsonl');
    expect(JSONL_PATHS.specs).toBe('.sudocode/specs/specs.jsonl');
  });
});
