/**
 * Integration tests for entity-level conflict detection
 *
 * Tests the fix for issue i-8pl5: JSONL conflict resolution should respect
 * entity-level independence. Independent entities (unique UUIDs) in conflict
 * sections should be preserved as clean additions, not treated as conflicts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleResolveConflicts, type CommandContext } from '../../src/cli/merge-commands.js';
import type Database from 'better-sqlite3';
import { initDatabase } from '../../src/db.js';
import { readJSONL } from '../../src/jsonl.js';

describe('Entity-Level Conflict Detection', () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-conflict-test-'));
    const dbPath = path.join(tmpDir, 'cache.db');
    db = initDatabase({ path: dbPath });

    ctx = {
      db,
      outputDir: tmpDir,
      jsonOutput: false,
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should preserve independent entities in conflict sections', async () => {
    // Reproduction case from issue i-8pl5:
    // Branch A: modifies test_1, adds test_2
    // Branch B: modifies test_1, adds test_3
    // Expected: test_1 merged, both test_2 and test_3 preserved

    const issuesPath = path.join(tmpDir, 'issues.jsonl');
    const conflictContent = `<<<<<<< HEAD
{"id":"test_1","uuid":"uuid-1","title":"Branch B Version","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
{"id":"test_3","uuid":"uuid-3","title":"Added in Branch B","created_at":"2025-01-03T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"test_1","uuid":"uuid-1","title":"Branch A Version","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
{"id":"test_2","uuid":"uuid-2","title":"Added in Branch A","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> branch_a
`;

    fs.writeFileSync(issuesPath, conflictContent);

    // Run resolution
    await handleResolveConflicts(ctx, { dryRun: false, verbose: false });

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Should have exactly 3 entities
    expect(resolved).toHaveLength(3);

    // Find entities by UUID
    const test1 = resolved.find(e => e.uuid === 'uuid-1');
    const test2 = resolved.find(e => e.uuid === 'uuid-2');
    const test3 = resolved.find(e => e.uuid === 'uuid-3');

    // All three should be present
    expect(test1).toBeDefined();
    expect(test2).toBeDefined();
    expect(test3).toBeDefined();

    // test_1 should be the latest version (Branch B is newer)
    expect(test1?.title).toBe('Branch B Version');
    expect(test1?.id).toBe('test_1');

    // test_2 should be preserved exactly as added in Branch A
    expect(test2?.title).toBe('Added in Branch A');
    expect(test2?.id).toBe('test_2');

    // test_3 should be preserved exactly as added in Branch B
    expect(test3?.title).toBe('Added in Branch B');
    expect(test3?.id).toBe('test_3');
  });

  it('should handle multiple conflict sections with independent entities', async () => {
    const issuesPath = path.join(tmpDir, 'issues.jsonl');
    const conflictContent = `{"id":"clean_1","uuid":"uuid-clean-1","title":"Clean Entity 1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
<<<<<<< HEAD
{"id":"conflict_1","uuid":"uuid-conflict-1","title":"HEAD Version","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
{"id":"unique_head","uuid":"uuid-unique-head","title":"Unique in HEAD","created_at":"2025-01-03T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"conflict_1","uuid":"uuid-conflict-1","title":"Feature Version","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
{"id":"unique_feature","uuid":"uuid-unique-feature","title":"Unique in Feature","created_at":"2025-01-04T00:00:00Z","updated_at":"2025-01-04T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
{"id":"clean_2","uuid":"uuid-clean-2","title":"Clean Entity 2","created_at":"2025-01-05T00:00:00Z","updated_at":"2025-01-05T00:00:00Z","relationships":[],"tags":[]}
`;

    fs.writeFileSync(issuesPath, conflictContent);

    // Run resolution
    await handleResolveConflicts(ctx, { dryRun: false, verbose: false });

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Should have exactly 5 entities:
    // - clean_1 (clean section)
    // - conflict_1 (true conflict, resolved)
    // - unique_head (clean addition from HEAD)
    // - unique_feature (clean addition from feature)
    // - clean_2 (clean section)
    expect(resolved).toHaveLength(5);

    // Verify all entities are present
    const uuids = resolved.map(e => e.uuid).sort();
    expect(uuids).toEqual([
      'uuid-clean-1',
      'uuid-clean-2',
      'uuid-conflict-1',
      'uuid-unique-feature',
      'uuid-unique-head',
    ]);

    // Verify conflict_1 was resolved (most recent wins)
    const conflict1 = resolved.find(e => e.uuid === 'uuid-conflict-1');
    expect(conflict1?.title).toBe('HEAD Version'); // Newer timestamp

    // Verify unique entities are preserved
    const uniqueHead = resolved.find(e => e.uuid === 'uuid-unique-head');
    expect(uniqueHead?.title).toBe('Unique in HEAD');

    const uniqueFeature = resolved.find(e => e.uuid === 'uuid-unique-feature');
    expect(uniqueFeature?.title).toBe('Unique in Feature');
  });

  it('should handle complex case with multiple true conflicts and unique additions', async () => {
    const issuesPath = path.join(tmpDir, 'issues.jsonl');
    const conflictContent = `<<<<<<< HEAD
{"id":"shared_1","uuid":"uuid-shared-1","title":"HEAD shared_1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
{"id":"shared_2","uuid":"uuid-shared-2","title":"HEAD shared_2","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-04T00:00:00Z","relationships":[],"tags":[]}
{"id":"only_head_1","uuid":"uuid-only-head-1","title":"Only in HEAD 1","created_at":"2025-01-05T00:00:00Z","updated_at":"2025-01-05T00:00:00Z","relationships":[],"tags":[]}
{"id":"only_head_2","uuid":"uuid-only-head-2","title":"Only in HEAD 2","created_at":"2025-01-06T00:00:00Z","updated_at":"2025-01-06T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"shared_1","uuid":"uuid-shared-1","title":"Feature shared_1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
{"id":"shared_2","uuid":"uuid-shared-2","title":"Feature shared_2","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
{"id":"only_feature_1","uuid":"uuid-only-feature-1","title":"Only in Feature 1","created_at":"2025-01-07T00:00:00Z","updated_at":"2025-01-07T00:00:00Z","relationships":[],"tags":[]}
{"id":"only_feature_2","uuid":"uuid-only-feature-2","title":"Only in Feature 2","created_at":"2025-01-08T00:00:00Z","updated_at":"2025-01-08T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
`;

    fs.writeFileSync(issuesPath, conflictContent);

    // Run resolution
    await handleResolveConflicts(ctx, { dryRun: false, verbose: false });

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Should have exactly 6 entities:
    // - shared_1 (true conflict, HEAD version is newer)
    // - shared_2 (true conflict, HEAD version is newer)
    // - only_head_1 (clean addition)
    // - only_head_2 (clean addition)
    // - only_feature_1 (clean addition)
    // - only_feature_2 (clean addition)
    expect(resolved).toHaveLength(6);

    // Verify all UUIDs are present
    const uuids = resolved.map(e => e.uuid).sort();
    expect(uuids).toEqual([
      'uuid-only-feature-1',
      'uuid-only-feature-2',
      'uuid-only-head-1',
      'uuid-only-head-2',
      'uuid-shared-1',
      'uuid-shared-2',
    ]);

    // Verify conflicts were resolved correctly (most recent wins)
    const shared1 = resolved.find(e => e.uuid === 'uuid-shared-1');
    expect(shared1?.title).toBe('HEAD shared_1'); // Newer timestamp

    const shared2 = resolved.find(e => e.uuid === 'uuid-shared-2');
    expect(shared2?.title).toBe('HEAD shared_2'); // Newer timestamp

    // Verify unique entities are preserved
    expect(resolved.find(e => e.uuid === 'uuid-only-head-1')?.title).toBe('Only in HEAD 1');
    expect(resolved.find(e => e.uuid === 'uuid-only-head-2')?.title).toBe('Only in HEAD 2');
    expect(resolved.find(e => e.uuid === 'uuid-only-feature-1')?.title).toBe('Only in Feature 1');
    expect(resolved.find(e => e.uuid === 'uuid-only-feature-2')?.title).toBe('Only in Feature 2');
  });

  it('should preserve entities in correct sorted order (by created_at)', async () => {
    const issuesPath = path.join(tmpDir, 'issues.jsonl');
    const conflictContent = `<<<<<<< HEAD
{"id":"entity_3","uuid":"uuid-3","title":"Entity 3","created_at":"2025-03-01T00:00:00Z","updated_at":"2025-03-01T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"entity_1","uuid":"uuid-1","title":"Entity 1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
{"id":"entity_2","uuid":"uuid-2","title":"Entity 2","created_at":"2025-02-01T00:00:00Z","updated_at":"2025-02-01T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
`;

    fs.writeFileSync(issuesPath, conflictContent);

    // Run resolution
    await handleResolveConflicts(ctx, { dryRun: false, verbose: false });

    // Read resolved file
    const resolved = await readJSONL(issuesPath);

    // Should be sorted by created_at
    expect(resolved).toHaveLength(3);
    expect(resolved[0].id).toBe('entity_1');
    expect(resolved[1].id).toBe('entity_2');
    expect(resolved[2].id).toBe('entity_3');
  });
});
