/**
 * Import JSONL data to SQLite with collision resolution
 */

import type Database from 'better-sqlite3';
import type { Spec, Issue, SpecJSONL, IssueJSONL, Metadata, CollisionLogEntry } from './types.js';
import { readJSONL } from './jsonl.js';
import { listSpecs, createSpec, updateSpec, deleteSpec, getSpec } from './operations/specs.js';
import { listIssues, createIssue, updateIssue, deleteIssue, getIssue } from './operations/issues.js';
import { addRelationship, removeAllRelationships } from './operations/relationships.js';
import { setTags } from './operations/tags.js';
import { createFeedback, listFeedback, deleteFeedback } from './operations/feedback.js';
import { transaction } from './operations/transactions.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ImportOptions {
  /**
   * Input directory for JSONL files
   */
  inputDir?: string;
  /**
   * Custom file names
   */
  specsFile?: string;
  issuesFile?: string;
  /**
   * Dry run - detect changes but don't apply
   */
  dryRun?: boolean;
  /**
   * Automatically resolve collisions
   */
  resolveCollisions?: boolean;
  /**
   * Path to meta.json for collision logging
   */
  metaPath?: string;
}

export interface ImportResult {
  specs: {
    added: number;
    updated: number;
    deleted: number;
  };
  issues: {
    added: number;
    updated: number;
    deleted: number;
  };
  collisions: CollisionInfo[];
}

export interface CollisionInfo {
  id: string;
  type: 'spec' | 'issue';
  reason: string;
  localContent: string;
  incomingContent: string;
  resolution?: 'keep-local' | 'use-incoming' | 'renumber';
  newId?: string;
}

export interface ChangeDetection {
  added: string[];
  updated: string[];
  deleted: string[];
  unchanged: string[];
}

/**
 * Detect changes between existing and incoming entities
 */
export function detectChanges<T extends { id: string; updated_at: string }>(
  existing: T[],
  incoming: T[]
): ChangeDetection {
  const existingIds = new Set(existing.map((e) => e.id));
  const incomingIds = new Set(incoming.map((e) => e.id));

  const added = incoming
    .filter((e) => !existingIds.has(e.id))
    .map((e) => e.id);

  const deleted = existing
    .filter((e) => !incomingIds.has(e.id))
    .map((e) => e.id);

  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const inc of incoming) {
    if (existingIds.has(inc.id)) {
      const ex = existing.find((e) => e.id === inc.id);
      if (ex && hasChanged(ex, inc)) {
        updated.push(inc.id);
      } else {
        unchanged.push(inc.id);
      }
    }
  }

  return { added, updated, deleted, unchanged };
}

/**
 * Check if an entity has changed
 */
function hasChanged<T extends { updated_at: string }>(
  existing: T,
  incoming: T
): boolean {
  // Simple comparison based on updated_at timestamp
  return existing.updated_at !== incoming.updated_at;
}

/**
 * Detect ID collisions (same ID, different content hash)
 */
export function detectCollisions<T extends { id: string; title: string }>(
  existing: T[],
  incoming: T[]
): CollisionInfo[] {
  const collisions: CollisionInfo[] = [];
  const existingMap = new Map(existing.map((e) => [e.id, e]));

  for (const inc of incoming) {
    const ex = existingMap.get(inc.id);
    if (ex && ex.title !== inc.title) {
      // Different content with same ID = collision
      collisions.push({
        id: inc.id,
        type: 'spec', // Will be set correctly by caller
        reason: 'Different content with same ID',
        localContent: ex.title,
        incomingContent: inc.title,
      });
    }
  }

  return collisions;
}

/**
 * Count references to an entity ID in content fields
 */
export function countReferences(
  db: Database.Database,
  entityId: string,
  entityType: 'spec' | 'issue'
): number {
  let count = 0;

  // Count in specs
  const specs = listSpecs(db);
  for (const spec of specs) {
    const regex = new RegExp(`\\b${entityId}\\b`, 'g');
    const matches = spec.content.match(regex);
    if (matches) {
      count += matches.length;
    }
  }

  // Count in issues
  const issues = listIssues(db);
  for (const issue of issues) {
    const regex = new RegExp(`\\b${entityId}\\b`, 'g');
    const contentMatches = issue.content.match(regex);
    const descMatches = issue.description.match(regex);
    if (contentMatches) count += contentMatches.length;
    if (descMatches) count += descMatches.length;
  }

  return count;
}

/**
 * Resolve collisions using reference counting
 * Entity with fewer references gets renumbered
 */
export function resolveCollisions(
  db: Database.Database,
  collisions: CollisionInfo[]
): CollisionInfo[] {
  const resolved: CollisionInfo[] = [];

  for (const collision of collisions) {
    // For now, use simple strategy: keep local, rename incoming
    // In future, implement reference counting
    const newId = generateNewId(db, collision.id, collision.type);

    resolved.push({
      ...collision,
      resolution: 'renumber',
      newId,
    });
  }

  return resolved;
}

/**
 * Generate a new unique ID
 */
function generateNewId(
  db: Database.Database,
  oldId: string,
  type: 'spec' | 'issue'
): string {
  // Extract prefix and number
  const match = oldId.match(/^([a-z]+-)?(\d+)$/i);
  if (!match) {
    // Use timestamp-based ID
    return `${type}-${Date.now()}`;
  }

  const prefix = match[1] || `${type}-`;
  let num = parseInt(match[2], 10);

  // Find next available ID
  let newId = `${prefix}${num + 1000}`;
  let attempts = 0;

  while (attempts < 1000) {
    const exists =
      type === 'spec'
        ? getSpec(db, newId) !== null
        : getIssue(db, newId) !== null;

    if (!exists) {
      return newId;
    }

    num++;
    newId = `${prefix}${num + 1000}`;
    attempts++;
  }

  // Fallback to timestamp
  return `${prefix}${Date.now()}`;
}

/**
 * Update text references when an ID is renumbered
 */
export function updateTextReferences(
  db: Database.Database,
  oldId: string,
  newId: string
): number {
  let updatedCount = 0;

  // Update specs
  const specs = listSpecs(db);
  for (const spec of specs) {
    const regex = new RegExp(`\\b${oldId}\\b`, 'g');
    if (regex.test(spec.content)) {
      const newContent = spec.content.replace(regex, newId);
      updateSpec(db, spec.id, {
        content: newContent,
        updated_by: 'system',
      });
      updatedCount++;
    }
  }

  // Update issues
  const issues = listIssues(db);
  for (const issue of issues) {
    const regex = new RegExp(`\\b${oldId}\\b`, 'g');
    let updated = false;
    let newContent = issue.content;
    let newDescription = issue.description;

    if (regex.test(issue.content)) {
      newContent = issue.content.replace(regex, newId);
      updated = true;
    }

    const descRegex = new RegExp(`\\b${oldId}\\b`, 'g');
    if (descRegex.test(issue.description)) {
      newDescription = issue.description.replace(descRegex, newId);
      updated = true;
    }

    if (updated) {
      updateIssue(db, issue.id, {
        content: newContent,
        description: newDescription,
      });
      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Import specs from JSONL
 */
export function importSpecs(
  db: Database.Database,
  specs: SpecJSONL[],
  changes: ChangeDetection,
  dryRun: boolean = false
): { added: number; updated: number; deleted: number } {
  if (dryRun) {
    return {
      added: changes.added.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
    };
  }

  let added = 0;
  let updated = 0;
  let deleted = 0;

  // Add new specs
  for (const id of changes.added) {
    const spec = specs.find((s) => s.id === id);
    if (spec) {
      createSpec(db, {
        id: spec.id,
        title: spec.title,
        file_path: spec.file_path,
        content: spec.content,
        priority: spec.priority,
        created_by: spec.created_by,
        parent_id: spec.parent_id,
      });

      // Add relationships
      removeAllRelationships(db, spec.id, 'spec');
      for (const rel of spec.relationships || []) {
        addRelationship(db, {
          from_id: rel.from,
          from_type: 'spec',
          to_id: rel.to,
          to_type: 'spec',
          relationship_type: rel.type,
          created_by: spec.updated_by,
        });
      }

      // Add tags
      setTags(db, spec.id, 'spec', spec.tags || []);

      added++;
    }
  }

  // Update existing specs
  for (const id of changes.updated) {
    const spec = specs.find((s) => s.id === id);
    if (spec) {
      updateSpec(db, spec.id, {
        title: spec.title,
        file_path: spec.file_path,
        content: spec.content,
        priority: spec.priority,
        updated_by: spec.updated_by,
        parent_id: spec.parent_id,
      });

      // Update relationships
      removeAllRelationships(db, spec.id, 'spec');
      for (const rel of spec.relationships || []) {
        addRelationship(db, {
          from_id: rel.from,
          from_type: 'spec',
          to_id: rel.to,
          to_type: 'spec',
          relationship_type: rel.type,
          created_by: spec.updated_by,
        });
      }

      // Update tags
      setTags(db, spec.id, 'spec', spec.tags || []);

      updated++;
    }
  }

  // Delete removed specs
  for (const id of changes.deleted) {
    deleteSpec(db, id);
    deleted++;
  }

  return { added, updated, deleted };
}

/**
 * Sync feedback for an issue from JSONL data
 */
function syncIssueFeedback(
  db: Database.Database,
  issueId: string,
  feedbackJSONL: IssueJSONL['feedback']
): void {
  // Delete all existing feedback for this issue
  const existingFeedback = listFeedback(db, { issue_id: issueId });
  for (const fb of existingFeedback) {
    deleteFeedback(db, fb.id);
  }

  // Create new feedback from JSONL
  if (feedbackJSONL && feedbackJSONL.length > 0) {
    for (const fb of feedbackJSONL) {
      createFeedback(db, {
        id: fb.id,
        issue_id: issueId,
        spec_id: fb.spec_id,
        feedback_type: fb.type,
        content: fb.content,
        agent: 'import',
        anchor: fb.anchor,
        status: fb.status,
      });
    }
  }
}

/**
 * Import issues from JSONL
 */
export function importIssues(
  db: Database.Database,
  issues: IssueJSONL[],
  changes: ChangeDetection,
  dryRun: boolean = false
): { added: number; updated: number; deleted: number } {
  if (dryRun) {
    return {
      added: changes.added.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
    };
  }

  let added = 0;
  let updated = 0;
  let deleted = 0;

  // Add new issues
  for (const id of changes.added) {
    const issue = issues.find((i) => i.id === id);
    if (issue) {
      createIssue(db, {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        content: issue.content,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        created_by: issue.created_by,
        parent_id: issue.parent_id,
      });

      // Add relationships
      removeAllRelationships(db, issue.id, 'issue');
      for (const rel of issue.relationships || []) {
        addRelationship(db, {
          from_id: rel.from,
          from_type: 'issue',
          to_id: rel.to,
          to_type: 'issue',
          relationship_type: rel.type,
          created_by: issue.created_by,
        });
      }

      // Add tags
      setTags(db, issue.id, 'issue', issue.tags || []);

      // Sync feedback
      syncIssueFeedback(db, issue.id, issue.feedback);

      added++;
    }
  }

  // Update existing issues
  for (const id of changes.updated) {
    const issue = issues.find((i) => i.id === id);
    if (issue) {
      updateIssue(db, issue.id, {
        title: issue.title,
        description: issue.description,
        content: issue.content,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        parent_id: issue.parent_id,
      });

      // Update relationships
      removeAllRelationships(db, issue.id, 'issue');
      for (const rel of issue.relationships || []) {
        addRelationship(db, {
          from_id: rel.from,
          from_type: 'issue',
          to_id: rel.to,
          to_type: 'issue',
          relationship_type: rel.type,
          created_by: issue.created_by,
        });
      }

      // Update tags
      setTags(db, issue.id, 'issue', issue.tags || []);

      // Sync feedback
      syncIssueFeedback(db, issue.id, issue.feedback);

      updated++;
    }
  }

  // Delete removed issues
  for (const id of changes.deleted) {
    deleteIssue(db, id);
    deleted++;
  }

  return { added, updated, deleted };
}

/**
 * Import both specs and issues from JSONL files
 */
export async function importFromJSONL(
  db: Database.Database,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const {
    inputDir = '.sudocode',
    specsFile = 'specs.jsonl',
    issuesFile = 'issues.jsonl',
    dryRun = false,
    resolveCollisions: shouldResolve = true,
  } = options;

  const specsPath = path.join(inputDir, specsFile);
  const issuesPath = path.join(inputDir, issuesFile);

  // Read JSONL files
  const incomingSpecs = await readJSONL<SpecJSONL>(specsPath, { skipErrors: true });
  const incomingIssues = await readJSONL<IssueJSONL>(issuesPath, { skipErrors: true });

  // Get existing data
  const existingSpecs = listSpecs(db);
  const existingIssues = listIssues(db);

  // Detect changes
  const specChanges = detectChanges(existingSpecs, incomingSpecs);
  const issueChanges = detectChanges(existingIssues, incomingIssues);

  // Detect collisions
  const specCollisions = detectCollisions(existingSpecs, incomingSpecs);
  const issueCollisions = detectCollisions(existingIssues, incomingIssues);

  const allCollisions = [
    ...specCollisions.map((c) => ({ ...c, type: 'spec' as const })),
    ...issueCollisions.map((c) => ({ ...c, type: 'issue' as const })),
  ];

  // Resolve collisions if requested
  let resolvedCollisions: CollisionInfo[] = [];
  if (shouldResolve && allCollisions.length > 0) {
    resolvedCollisions = resolveCollisions(db, allCollisions);
  }

  // Apply changes in transaction
  const result: ImportResult = {
    specs: { added: 0, updated: 0, deleted: 0 },
    issues: { added: 0, updated: 0, deleted: 0 },
    collisions: resolvedCollisions.length > 0 ? resolvedCollisions : allCollisions,
  };

  if (!dryRun) {
    transaction(db, () => {
      result.specs = importSpecs(db, incomingSpecs, specChanges, dryRun);
      result.issues = importIssues(db, incomingIssues, issueChanges, dryRun);

      // Apply collision resolutions
      for (const collision of resolvedCollisions) {
        if (collision.resolution === 'renumber' && collision.newId) {
          updateTextReferences(db, collision.id, collision.newId);
        }
      }
    });
  } else {
    result.specs = importSpecs(db, incomingSpecs, specChanges, dryRun);
    result.issues = importIssues(db, incomingIssues, issueChanges, dryRun);
  }

  return result;
}
