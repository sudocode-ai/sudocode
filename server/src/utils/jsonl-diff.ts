/**
 * JSONL Diffing Utilities
 *
 * Provides functions for:
 * - Reading JSONL files from git commits
 * - Detecting semantic changes between entity versions
 * - Computing diffs for checkpoint snapshots
 *
 * @module utils/jsonl-diff
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
  IssueJSONL,
  SpecJSONL,
  RelationshipJSONL,
  FeedbackJSONL,
} from '@sudocode-ai/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of semantic change detection
 */
export interface SemanticChangeResult {
  hasChanges: boolean;
  changedFields: string[];
}

/**
 * Change type for snapshot entries
 */
export type ChangeType = 'created' | 'modified' | 'deleted';

/**
 * A single entity change in a snapshot
 */
export interface EntityChange<T> {
  id: string;
  changeType: ChangeType;
  entity: T;
  changedFields?: string[];
}

/**
 * Complete diff between baseline and current state
 */
export interface SnapshotDiff {
  issues: EntityChange<IssueJSONL>[];
  specs: EntityChange<SpecJSONL>[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Field Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields to compare for issue semantic changes.
 * Excludes: created_at, updated_at, uuid, file_path (auto-generated/timestamps)
 */
const ISSUE_SEMANTIC_FIELDS = [
  'title',
  'status',
  'content',
  'priority',
  'assignee',
  'archived',
  'parent_id',
  'external_links',
] as const;

/**
 * Fields to compare for spec semantic changes.
 * Excludes: created_at, updated_at, uuid, file_path (auto-generated/timestamps)
 */
const SPEC_SEMANTIC_FIELDS = [
  'title',
  'content',
  'priority',
  'archived',
  'parent_id',
  'external_links',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Git-based JSONL Reading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read JSONL file from a specific git commit.
 * Returns empty array if file doesn't exist at that commit.
 *
 * @param repoPath - Path to git repository
 * @param commitSha - Git commit SHA to read from
 * @param relativePath - Relative path to JSONL file (e.g., '.sudocode/issues/issues.jsonl')
 * @returns Array of parsed entities, empty if file doesn't exist
 */
export function readJSONLAtCommit<T extends IssueJSONL | SpecJSONL>(
  repoPath: string,
  commitSha: string,
  relativePath: string
): T[] {
  try {
    const content = execSync(`git show ${commitSha}:${relativePath}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return parseJSONLContent<T>(content);
  } catch {
    // File doesn't exist at this commit - treat as empty
    return [];
  }
}

/**
 * Read current JSONL file from filesystem path.
 * Returns empty array if file doesn't exist.
 *
 * @param basePath - Base path (worktree or repo path)
 * @param relativePath - Relative path to JSONL file
 * @returns Array of parsed entities
 */
export function readJSONLFromPath<T extends IssueJSONL | SpecJSONL>(
  basePath: string,
  relativePath: string
): T[] {
  const fullPath = path.join(basePath, relativePath);

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return parseJSONLContent<T>(content);
  } catch {
    return [];
  }
}

/**
 * Parse JSONL content string into array of entities
 */
function parseJSONLContent<T>(content: string): T[] {
  const entities: T[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      entities.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines
      console.warn(`[jsonl-diff] Skipping malformed JSONL line: ${trimmed.substring(0, 50)}...`);
    }
  }

  return entities;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Change Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect semantic changes between two entity versions.
 *
 * @param baseline - Entity at baseline (null if created)
 * @param current - Entity at current state (null if deleted)
 * @param entityType - Type of entity ('issue' or 'spec')
 * @returns Change result with changed fields list
 */
export function hasSemanticChanges<T extends IssueJSONL | SpecJSONL>(
  baseline: T | null,
  current: T | null,
  entityType: 'issue' | 'spec'
): SemanticChangeResult {
  // Handle creation/deletion
  if (!baseline && current) {
    return { hasChanges: true, changedFields: ['*created*'] };
  }
  if (baseline && !current) {
    return { hasChanges: true, changedFields: ['*deleted*'] };
  }
  if (!baseline && !current) {
    return { hasChanges: false, changedFields: [] };
  }

  // Both exist - compare semantic fields
  const fields = entityType === 'issue' ? ISSUE_SEMANTIC_FIELDS : SPEC_SEMANTIC_FIELDS;
  const changedFields: string[] = [];

  for (const field of fields) {
    const baselineValue = (baseline as unknown as Record<string, unknown>)[field];
    const currentValue = (current as unknown as Record<string, unknown>)[field];

    if (!deepEqual(baselineValue, currentValue)) {
      changedFields.push(field);
    }
  }

  // Compare relationships (array of RelationshipJSONL)
  if (!relationshipsEqual(baseline!.relationships, current!.relationships)) {
    changedFields.push('relationships');
  }

  // Compare tags (array of strings)
  if (!arraysEqual(baseline!.tags, current!.tags)) {
    changedFields.push('tags');
  }

  // Compare feedback for issues
  if (entityType === 'issue') {
    const baseIssue = baseline as IssueJSONL;
    const currIssue = current as IssueJSONL;
    if (!feedbackEqual(baseIssue.feedback, currIssue.feedback)) {
      changedFields.push('feedback');
    }
  }

  return {
    hasChanges: changedFields.length > 0,
    changedFields,
  };
}

/**
 * Deep equality check for arbitrary values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;

  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();

    if (!arraysEqual(aKeys, bKeys)) return false;

    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Compare arrays for equality (order-sensitive)
 */
function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((val, idx) => deepEqual(val, b[idx]));
}

/**
 * Compare relationship arrays (order-insensitive, by composite key)
 */
function relationshipsEqual(
  a: RelationshipJSONL[] | undefined,
  b: RelationshipJSONL[] | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  // Create composite keys for comparison
  const keyOf = (r: RelationshipJSONL) =>
    `${r.from}:${r.from_type}:${r.to}:${r.to_type}:${r.type}`;

  const aKeys = new Set(a.map(keyOf));
  const bKeys = new Set(b.map(keyOf));

  if (aKeys.size !== bKeys.size) return false;

  for (const key of aKeys) {
    if (!bKeys.has(key)) return false;
  }

  return true;
}

/**
 * Compare feedback arrays (order-insensitive, by id)
 */
function feedbackEqual(
  a: FeedbackJSONL[] | undefined,
  b: FeedbackJSONL[] | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  // Build maps by id for comparison
  const aMap = new Map(a.map((f) => [f.id, f]));
  const bMap = new Map(b.map((f) => [f.id, f]));

  if (aMap.size !== bMap.size) return false;

  for (const [id, aFeedback] of aMap) {
    const bFeedback = bMap.get(id);
    if (!bFeedback) return false;

    // Compare relevant fields (excluding timestamps)
    if (
      aFeedback.from_id !== bFeedback.from_id ||
      aFeedback.to_id !== bFeedback.to_id ||
      aFeedback.feedback_type !== bFeedback.feedback_type ||
      aFeedback.content !== bFeedback.content ||
      aFeedback.agent !== bFeedback.agent ||
      aFeedback.dismissed !== bFeedback.dismissed ||
      !deepEqual(aFeedback.anchor, bFeedback.anchor)
    ) {
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Diff Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute diff between baseline and current JSONL state.
 *
 * @param baselineIssues - Issues at baseline commit (empty if new)
 * @param currentIssues - Issues in current worktree
 * @param baselineSpecs - Specs at baseline commit
 * @param currentSpecs - Specs in current worktree
 * @returns Categorized changes for snapshot
 */
export function computeSnapshotDiff(
  baselineIssues: IssueJSONL[],
  currentIssues: IssueJSONL[],
  baselineSpecs: SpecJSONL[],
  currentSpecs: SpecJSONL[]
): SnapshotDiff {
  return {
    issues: computeEntityDiff(baselineIssues, currentIssues, 'issue'),
    specs: computeEntityDiff(baselineSpecs, currentSpecs, 'spec'),
  };
}

/**
 * Compute diff for a single entity type
 */
function computeEntityDiff<T extends IssueJSONL | SpecJSONL>(
  baseline: T[],
  current: T[],
  entityType: 'issue' | 'spec'
): EntityChange<T>[] {
  const changes: EntityChange<T>[] = [];

  // Build maps for O(1) lookup
  const baselineMap = new Map(baseline.map((e) => [e.id, e]));
  const currentMap = new Map(current.map((e) => [e.id, e]));

  // Find created and modified entities
  for (const [id, entity] of currentMap) {
    const baselineEntity = baselineMap.get(id);

    if (!baselineEntity) {
      // Created - entity exists in current but not baseline
      changes.push({
        id,
        changeType: 'created',
        entity,
      });
    } else {
      // Check for modifications
      const result = hasSemanticChanges(baselineEntity, entity, entityType);
      if (result.hasChanges) {
        changes.push({
          id,
          changeType: 'modified',
          entity,
          changedFields: result.changedFields,
        });
      }
    }
  }

  // Find deleted entities
  for (const [id, entity] of baselineMap) {
    if (!currentMap.has(id)) {
      changes.push({
        id,
        changeType: 'deleted',
        entity,
      });
    }
  }

  return changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard paths for JSONL files
 */
export const JSONL_PATHS = {
  issues: '.sudocode/issues/issues.jsonl',
  specs: '.sudocode/specs/specs.jsonl',
} as const;

/**
 * Compute snapshot diff from git commits.
 *
 * @param repoPath - Path to git repository
 * @param baselineCommit - Baseline commit SHA (null for empty baseline)
 * @param currentCommit - Current commit SHA (null to read from working directory)
 * @param worktreePath - Path to worktree (used when currentCommit is null)
 * @returns Snapshot diff
 */
export function computeSnapshotDiffFromCommits(
  repoPath: string,
  baselineCommit: string | null,
  currentCommit: string | null,
  worktreePath?: string
): SnapshotDiff {
  // Read baseline
  const baselineIssues = baselineCommit
    ? readJSONLAtCommit<IssueJSONL>(repoPath, baselineCommit, JSONL_PATHS.issues)
    : [];
  const baselineSpecs = baselineCommit
    ? readJSONLAtCommit<SpecJSONL>(repoPath, baselineCommit, JSONL_PATHS.specs)
    : [];

  // Read current
  let currentIssues: IssueJSONL[];
  let currentSpecs: SpecJSONL[];

  if (currentCommit) {
    currentIssues = readJSONLAtCommit<IssueJSONL>(repoPath, currentCommit, JSONL_PATHS.issues);
    currentSpecs = readJSONLAtCommit<SpecJSONL>(repoPath, currentCommit, JSONL_PATHS.specs);
  } else {
    // Read from worktree or repo working directory
    const readPath = worktreePath || repoPath;
    currentIssues = readJSONLFromPath<IssueJSONL>(readPath, JSONL_PATHS.issues);
    currentSpecs = readJSONLFromPath<SpecJSONL>(readPath, JSONL_PATHS.specs);
  }

  return computeSnapshotDiff(baselineIssues, currentIssues, baselineSpecs, currentSpecs);
}

/**
 * Check if a snapshot diff has any changes
 */
export function hasAnyChanges(diff: SnapshotDiff): boolean {
  return diff.issues.length > 0 || diff.specs.length > 0;
}

/**
 * Serialize snapshot diff to JSON string for storage
 */
export function serializeSnapshot(changes: EntityChange<IssueJSONL | SpecJSONL>[]): string {
  return JSON.stringify(changes);
}

/**
 * Parse serialized snapshot from database
 */
export function parseSnapshot<T extends IssueJSONL | SpecJSONL>(
  json: string | null
): EntityChange<T>[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as EntityChange<T>[];
  } catch {
    return [];
  }
}
