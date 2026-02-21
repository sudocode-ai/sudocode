/**
 * Import JSONL data to SQLite with collision resolution
 */

import type Database from "better-sqlite3";
import type { SpecJSONL, IssueJSONL } from "@sudocode-ai/types";
import { readJSONL } from "./jsonl.js";
import {
  listSpecs,
  createSpec,
  updateSpec,
  deleteSpec,
  getSpec,
} from "./operations/specs.js";
import {
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  getIssue,
} from "./operations/issues.js";
import {
  addRelationship,
  removeAllRelationships,
  removeOutgoingRelationships,
} from "./operations/relationships.js";
import { setTags } from "./operations/tags.js";
import {
  createFeedback,
  listFeedback,
  deleteFeedback,
} from "./operations/feedback.js";
import { transaction } from "./operations/transactions.js";
import * as path from "path";
import * as fs from "fs";
import { getConfig, isMarkdownFirst } from "./config.js";

/**
 * Warnings collected during import for non-fatal issues
 */
export interface ImportWarning {
  type: "missing_entity" | "invalid_relationship";
  message: string;
  entityId?: string;
  relationshipFrom?: string;
  relationshipTo?: string;
}

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
  /**
   * Force update these entity IDs even if timestamp hasn't changed
   * Useful when file watcher detects content hash changes
   */
  forceUpdateIds?: string[];
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
  warnings?: ImportWarning[];
}

export interface CollisionInfo {
  id: string;
  uuid: string; // UUID of the colliding entity
  type: "spec" | "issue";
  reason: string;
  localContent: string;
  incomingContent: string;
  localCreatedAt?: string; // Created timestamp of local entity
  incomingCreatedAt: string; // Created timestamp of incoming entity
  resolution?: "keep-local" | "use-incoming" | "renumber";
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
 * Uses UUID as the source of truth for entity identity
 */
export function detectChanges<
  T extends { id: string; uuid: string; updated_at: string },
>(existing: T[], incoming: T[], forceUpdateIds: string[] = []): ChangeDetection {
  // Map by UUID (the true identity)
  const existingByUUID = new Map(existing.map((e) => [e.uuid, e]));
  const incomingUUIDs = new Set(incoming.map((e) => e.uuid));
  const forceUpdateSet = new Set(forceUpdateIds);

  const added = incoming
    .filter((e) => !existingByUUID.has(e.uuid))
    .map((e) => e.id);

  const deleted = existing
    .filter((e) => !incomingUUIDs.has(e.uuid))
    .map((e) => e.id);

  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const inc of incoming) {
    const ex = existingByUUID.get(inc.uuid);
    if (ex) {
      // Same entity (same UUID), check if content changed or force update requested
      if (forceUpdateSet.has(inc.id) || hasChanged(ex, inc)) {
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
 * Detect ID collisions (same ID, different UUID)
 * UUIDs are the source of truth for entity identity
 */
export function detectCollisions<
  T extends { id: string; uuid: string; title: string; created_at: string },
>(existing: T[], incoming: T[]): CollisionInfo[] {
  const collisions: CollisionInfo[] = [];
  const existingMap = new Map(existing.map((e) => [e.id, e]));

  // First, detect collisions between existing and incoming
  for (const inc of incoming) {
    const ex = existingMap.get(inc.id);
    // Collision only if same ID but different UUID (different entities)
    if (ex && ex.uuid !== inc.uuid) {
      collisions.push({
        id: inc.id,
        uuid: inc.uuid, // UUID of the incoming entity
        type: "spec", // Will be set correctly by caller
        reason: "Same ID but different UUID (different entities)",
        localContent: ex.title,
        incomingContent: inc.title,
        localCreatedAt: ex.created_at,
        incomingCreatedAt: inc.created_at,
      });
    }
  }

  // Second, detect collisions within incoming data itself (duplicates)
  const incomingByID = new Map<string, T[]>();
  for (const inc of incoming) {
    const existing = incomingByID.get(inc.id) || [];
    existing.push(inc);
    incomingByID.set(inc.id, existing);
  }

  for (const [id, entities] of incomingByID.entries()) {
    if (entities.length > 1) {
      // Multiple entities with same ID in incoming data
      // Check if they have different UUIDs (real collision) vs same UUID (duplicate entry)
      const uniqueUUIDs = new Set(entities.map((e) => e.uuid));
      if (uniqueUUIDs.size > 1) {
        // Different UUIDs = real collision within incoming data
        // We'll keep the first one and mark the rest as collisions
        for (let i = 1; i < entities.length; i++) {
          collisions.push({
            id: entities[i].id,
            uuid: entities[i].uuid, // UUID of the colliding entity
            type: "spec", // Will be set correctly by caller
            reason: "Duplicate ID in incoming data with different UUID",
            localContent: entities[0].title,
            incomingContent: entities[i].title,
            localCreatedAt: entities[0].created_at,
            incomingCreatedAt: entities[i].created_at,
          });
        }
      }
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
  entityType: "spec" | "issue"
): number {
  let count = 0;

  // Count in specs
  const specs = listSpecs(db);
  for (const spec of specs) {
    const regex = new RegExp(`\\b${entityId}\\b`, "g");
    const matches = spec.content.match(regex);
    if (matches) {
      count += matches.length;
    }
  }

  // Count in issues
  const issues = listIssues(db);
  for (const issue of issues) {
    const regex = new RegExp(`\\b${entityId}\\b`, "g");
    const contentMatches = issue.content.match(regex);
    if (contentMatches) count += contentMatches.length;
  }

  return count;
}

/**
 * Resolve collisions using timestamp-based deterministic strategy
 *
 * The entity with the NEWER (more recent) created_at timestamp logically
 * should be renumbered, while the OLDER entity keeps the original ID.
 *
 * For practical reasons (entities already in DB can't be easily renamed),
 * incoming entities are always the ones that get new IDs. However, we
 * deterministically decide which UUID gets which new ID based on timestamps.
 */
export function resolveCollisions(
  db: Database.Database,
  collisions: CollisionInfo[]
): CollisionInfo[] {
  const resolved: CollisionInfo[] = [];
  const uuidToNewId = new Map<string, string>();

  for (const collision of collisions) {
    // Determine which entity is newer based on created_at timestamps
    let incomingIsNewer = true;

    if (collision.localCreatedAt) {
      const localTime = new Date(collision.localCreatedAt).getTime();
      const incomingTime = new Date(collision.incomingCreatedAt).getTime();

      // Check which is newer
      if (incomingTime > localTime) {
        incomingIsNewer = true; // Incoming is newer
      } else if (localTime > incomingTime) {
        incomingIsNewer = false; // Local is newer
      } else {
        // Same timestamp - use UUID comparison for determinism
        incomingIsNewer = collision.uuid > collision.localContent;
      }
    }

    // Generate deterministic new ID
    // Always renumber the incoming entity (practical constraint)
    // But ensure same UUID always gets same new ID across runs
    let newId = uuidToNewId.get(collision.uuid);
    if (!newId) {
      newId = generateNewId(db, collision.id, collision.type);
      uuidToNewId.set(collision.uuid, newId);
    }

    resolved.push({
      ...collision,
      resolution: "renumber", // Incoming always gets renumbered
      newId,
      // Track which one was logically newer (for logging/debugging)
      ...(incomingIsNewer && {
        note: "incoming is newer - correctly renumbered",
      }),
      ...(!incomingIsNewer && {
        note: "local is newer - incoming (older) being renumbered",
      }),
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
  type: "spec" | "issue"
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
      type === "spec"
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
    const regex = new RegExp(`\\b${oldId}\\b`, "g");
    if (regex.test(spec.content)) {
      const newContent = spec.content.replace(regex, newId);
      updateSpec(db, spec.id, {
        content: newContent,
      });
      updatedCount++;
    }
  }

  // Update issues
  const issues = listIssues(db);
  for (const issue of issues) {
    const regex = new RegExp(`\\b${oldId}\\b`, "g");
    let updated = false;
    let newContent = issue.content;

    if (regex.test(issue.content)) {
      newContent = issue.content.replace(regex, newId);
      updated = true;
    }

    if (updated) {
      updateIssue(db, issue.id, {
        content: newContent,
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
  dryRun: boolean = false,
  skipRelationships: boolean = false
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

  // Add new specs (first pass: without parent_id to handle out-of-order parents)
  const specsWithParents: SpecJSONL[] = [];
  for (const id of changes.added) {
    const spec = specs.find((s) => s.id === id);
    if (spec) {
      createSpec(db, {
        id: spec.id,
        uuid: spec.uuid,
        title: spec.title,
        file_path: spec.file_path,
        content: spec.content,
        priority: spec.priority,
        // Skip parent_id in first pass - will be set in second pass
        archived: spec.archived,
        archived_at: spec.archived_at,
        created_at: spec.created_at,
        updated_at: spec.updated_at,
        // Pass null when JSONL doesn't have external_links, so SQLite gets cleared
        // (undefined would skip the update, causing oscillation with export)
        external_links: spec.external_links && spec.external_links.length > 0
          ? JSON.stringify(spec.external_links)
          : null,
      });

      // Add tags
      setTags(db, spec.id, "spec", spec.tags || []);
      added++;

      // Track specs with parent_id for second pass
      if (spec.parent_id) {
        specsWithParents.push(spec);
      }
    }
  }

  // Second pass: set parent_id for newly added specs (now all parents exist)
  // Preserve updated_at to avoid clobbering timestamps set in pass 1
  for (const spec of specsWithParents) {
    updateSpec(db, spec.id, {
      parent_id: spec.parent_id,
      updated_at: spec.updated_at,
    });
  }

  // Add relationships
  if (!skipRelationships) {
    for (const id of changes.added) {
      const spec = specs.find((s) => s.id === id);
      if (spec) {
        if (spec.relationships && spec.relationships.length > 0) {
          for (const rel of spec.relationships) {
            addRelationship(db, {
              from_id: rel.from,
              from_type: rel.from_type,
              to_id: rel.to,
              to_type: rel.to_type,
              relationship_type: rel.type,
            });
          }
        }
      }
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
        parent_id: spec.parent_id,
        archived: spec.archived,
        archived_at: spec.archived_at,
        updated_at: spec.updated_at,
        // Pass null when JSONL doesn't have external_links, so SQLite gets cleared
        // (undefined would skip the update, causing oscillation with export)
        external_links: spec.external_links && spec.external_links.length > 0
          ? JSON.stringify(spec.external_links)
          : null,
      });
      setTags(db, spec.id, "spec", spec.tags || []);
      updated++;
    }
  }

  // Update relationships (only remove outgoing to preserve incoming relationships)
  if (!skipRelationships) {
    for (const id of changes.updated) {
      const spec = specs.find((s) => s.id === id);
      if (spec) {
        removeOutgoingRelationships(db, spec.id, "spec");
        for (const rel of spec.relationships || []) {
          addRelationship(db, {
            from_id: rel.from,
            from_type: rel.from_type,
            to_id: rel.to,
            to_type: rel.to_type,
            relationship_type: rel.type,
          });
        }
      }
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
  feedbackJSONL: IssueJSONL["feedback"]
): void {
  // Delete all existing feedback for this issue
  const existingFeedback = listFeedback(db, { from_id: issueId });
  for (const fb of existingFeedback) {
    deleteFeedback(db, fb.id);
  }

  // Create new feedback from JSONL
  if (feedbackJSONL && feedbackJSONL.length > 0) {
    for (const fb of feedbackJSONL) {
      // Support legacy JSONL format (issue_id/spec_id) for backward compatibility
      const fromId = (fb as any).from_id || (fb as any).issue_id;
      const toId = (fb as any).to_id || (fb as any).spec_id;

      // to_id is required, but from_id is optional (external feedback)
      if (!toId) {
        console.warn(
          `Skipping feedback ${fb.id}: missing to_id or spec_id`
        );
        continue;
      }

      createFeedback(db, {
        id: fb.id,
        from_id: fromId, // Can be undefined for anonymous feedback
        to_id: toId,
        feedback_type: fb.feedback_type,
        content: fb.content,
        agent: fb.agent,
        anchor: fb.anchor,
        dismissed: fb.dismissed,
        created_at: fb.created_at,
        updated_at: fb.updated_at,
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
  dryRun: boolean = false,
  skipRelationships: boolean = false
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

  // Add new issues (first pass: without parent_id to handle out-of-order parents)
  const issuesWithParents: IssueJSONL[] = [];
  for (const id of changes.added) {
    const issue = issues.find((i) => i.id === id);
    if (issue) {
      createIssue(db, {
        id: issue.id,
        uuid: issue.uuid,
        title: issue.title,
        content: issue.content,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        // Skip parent_id in first pass - will be set in second pass
        archived: issue.archived,
        archived_at: issue.archived_at,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        // Pass null when JSONL doesn't have external_links, so SQLite gets cleared
        // (undefined would skip the update, causing oscillation with export)
        external_links: issue.external_links && issue.external_links.length > 0
          ? JSON.stringify(issue.external_links)
          : null,
      });
      setTags(db, issue.id, "issue", issue.tags || []);
      added++;

      // Track issues with parent_id for second pass
      if (issue.parent_id) {
        issuesWithParents.push(issue);
      }
    }
  }

  // Second pass: set parent_id for newly added issues (now all parents exist)
  // Preserve updated_at to avoid clobbering timestamps set in pass 1
  for (const issue of issuesWithParents) {
    updateIssue(db, issue.id, {
      parent_id: issue.parent_id,
      updated_at: issue.updated_at,
    });
  }

  // Add relationships
  if (!skipRelationships) {
    for (const id of changes.added) {
      const issue = issues.find((i) => i.id === id);
      if (issue) {
        for (const rel of issue.relationships || []) {
          addRelationship(db, {
            from_id: rel.from,
            from_type: rel.from_type,
            to_id: rel.to,
            to_type: rel.to_type,
            relationship_type: rel.type,
          });
        }
      }
    }
  }

  // Update existing issues
  for (const id of changes.updated) {
    const issue = issues.find((i) => i.id === id);
    if (issue) {
      updateIssue(db, issue.id, {
        title: issue.title,
        content: issue.content,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        parent_id: issue.parent_id,
        archived: issue.archived,
        archived_at: issue.archived_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        // Pass null when JSONL doesn't have external_links, so SQLite gets cleared
        // (undefined would skip the update, causing oscillation with export)
        external_links: issue.external_links && issue.external_links.length > 0
          ? JSON.stringify(issue.external_links)
          : null,
      });
      setTags(db, issue.id, "issue", issue.tags || []);
      updated++;
    }
  }

  // Update relationships (only remove outgoing to preserve incoming relationships)
  if (!skipRelationships) {
    for (const id of changes.updated) {
      const issue = issues.find((i) => i.id === id);
      if (issue) {
        removeOutgoingRelationships(db, issue.id, "issue");
        for (const rel of issue.relationships || []) {
          addRelationship(db, {
            from_id: rel.from,
            from_type: rel.from_type,
            to_id: rel.to,
            to_type: rel.to_type,
            relationship_type: rel.type,
          });
        }
      }
    }
  }

  // Delete removed issues
  for (const id of changes.deleted) {
    deleteIssue(db, id);
    deleted++;
  }

  // Sync feedback after all issues/specs are created/updated
  // This ensures that feedback references to other issues are valid
  for (const id of [...changes.added, ...changes.updated]) {
    const issue = issues.find((i) => i.id === id);
    if (issue) {
      syncIssueFeedback(db, issue.id, issue.feedback);
    }
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
    inputDir = ".sudocode",
    specsFile = "specs.jsonl",
    issuesFile = "issues.jsonl",
    dryRun = false,
    resolveCollisions: shouldResolve = true,
    forceUpdateIds = [],
  } = options;

  // Check if markdown is source of truth
  const config = getConfig(inputDir);
  if (isMarkdownFirst(config)) {
    // In markdown-first mode, JSONL is derived, not authoritative
    // Warn but still allow import (useful for initial setup or recovery)
    console.warn(
      "[import] Warning: Markdown is configured as source of truth (sourceOfTruth = 'markdown')."
    );
    console.warn(
      "[import] JSONL import may override changes. Consider using 'sudocode sync --from-markdown' instead."
    );
  }

  const specsPath = path.join(inputDir, specsFile);
  const issuesPath = path.join(inputDir, issuesFile);

  // Read JSONL files
  const incomingSpecs = await readJSONL<SpecJSONL>(specsPath, {
    skipErrors: true,
  });
  const incomingIssues = await readJSONL<IssueJSONL>(issuesPath, {
    skipErrors: true,
  });

  // Get existing data
  const existingSpecs = listSpecs(db);
  const existingIssues = listIssues(db);

  // Detect collisions
  const specCollisions = detectCollisions(existingSpecs, incomingSpecs);
  const issueCollisions = detectCollisions(existingIssues, incomingIssues);

  const allCollisions = [
    ...specCollisions.map((c) => ({ ...c, type: "spec" as const })),
    ...issueCollisions.map((c) => ({ ...c, type: "issue" as const })),
  ];

  // Resolve collisions if requested
  let resolvedCollisions: CollisionInfo[] = [];
  if (shouldResolve && allCollisions.length > 0) {
    resolvedCollisions = resolveCollisions(db, allCollisions);

    // Modify incoming data to use new IDs for colliding entities
    // Use UUID to identify the correct entity to rename (in case of duplicate IDs)
    for (const collision of resolvedCollisions) {
      if (collision.resolution === "renumber" && collision.newId) {
        const oldId = collision.id;
        const newId = collision.newId;

        if (collision.type === "spec") {
          const spec = incomingSpecs.find(
            (s) => s.id === oldId && s.uuid === collision.uuid
          );
          if (spec) {
            spec.id = newId;
          }

          // Update feedback references to this spec (to_id)
          for (const issue of incomingIssues) {
            if (issue.feedback) {
              for (const fb of issue.feedback) {
                const feedbackToId = (fb as any).to_id || (fb as any).spec_id;
                if (feedbackToId === oldId) {
                  // Update both old and new field names for safety
                  if ((fb as any).to_id) (fb as any).to_id = newId;
                  if ((fb as any).spec_id) (fb as any).spec_id = newId;
                }
              }
            }
          }
        } else if (collision.type === "issue") {
          const issue = incomingIssues.find(
            (i) => i.id === oldId && i.uuid === collision.uuid
          );
          if (issue) {
            issue.id = newId;

            // Update feedback within this issue (from_id)
            if (issue.feedback) {
              for (const fb of issue.feedback) {
                // Update both old and new field names for safety
                if ((fb as any).from_id) (fb as any).from_id = newId;
                if ((fb as any).issue_id) (fb as any).issue_id = newId;
              }
            }
          }

          // Update feedback references FROM this issue in other issues' feedback
          for (const otherIssue of incomingIssues) {
            if (otherIssue.feedback) {
              for (const fb of otherIssue.feedback) {
                const feedbackFromId =
                  (fb as any).from_id || (fb as any).issue_id;
                if (feedbackFromId === oldId) {
                  // Update both old and new field names for safety
                  if ((fb as any).from_id) (fb as any).from_id = newId;
                  if ((fb as any).issue_id) (fb as any).issue_id = newId;
                }
              }
            }
          }
        }
      }
    }
  }

  // Detect changes (after collision resolution has modified incoming data)
  const specChanges = detectChanges(existingSpecs, incomingSpecs, forceUpdateIds);
  const issueChanges = detectChanges(existingIssues, incomingIssues, forceUpdateIds);

  // Collect markdown file paths for entities to be deleted (before deletion)
  // We need to do this before the transaction because the entities will be gone after
  const markdownFilesToDelete: string[] = [];
  if (!dryRun) {
    // Collect spec file paths
    for (const id of specChanges.deleted) {
      const spec = getSpec(db, id);
      if (spec && spec.file_path) {
        markdownFilesToDelete.push(path.join(inputDir, spec.file_path));
      }
    }
    // Collect issue file paths (issues use standard path format)
    for (const id of issueChanges.deleted) {
      markdownFilesToDelete.push(path.join(inputDir, "issues", `${id}.md`));
    }
  }

  // Apply changes in transaction
  const result: ImportResult = {
    specs: { added: 0, updated: 0, deleted: 0 },
    issues: { added: 0, updated: 0, deleted: 0 },
    collisions:
      resolvedCollisions.length > 0 ? resolvedCollisions : allCollisions,
    warnings: [],
  };

  // Helper to try adding a relationship, collecting warnings for missing entities
  const tryAddRelationship = (
    rel: { from: string; from_type: "spec" | "issue"; to: string; to_type: "spec" | "issue"; type: string },
    sourceEntityId: string
  ): void => {
    try {
      addRelationship(db, {
        from_id: rel.from,
        from_type: rel.from_type,
        to_id: rel.to,
        to_type: rel.to_type,
        relationship_type: rel.type as any,
      });
    } catch (error: any) {
      // Check if this is a "not found" error for missing entities
      const message = error?.message || String(error);
      if (message.includes("not found:")) {
        result.warnings!.push({
          type: "missing_entity",
          message: `Skipping relationship: ${message}`,
          entityId: sourceEntityId,
          relationshipFrom: rel.from,
          relationshipTo: rel.to,
        });
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  };

  if (!dryRun) {
    transaction(db, () => {
      // First pass: Import all entities without relationships
      result.specs = importSpecs(db, incomingSpecs, specChanges, dryRun, true);
      result.issues = importIssues(
        db,
        incomingIssues,
        issueChanges,
        dryRun,
        true
      );

      // Second pass: Import all relationships after all entities exist
      // Import spec relationships for added specs
      for (const id of specChanges.added) {
        const spec = incomingSpecs.find((s) => s.id === id);
        if (spec && spec.relationships && spec.relationships.length > 0) {
          for (const rel of spec.relationships) {
            tryAddRelationship(rel, id);
          }
        }
      }

      // Import spec relationships for updated specs (only remove outgoing to preserve incoming)
      for (const id of specChanges.updated) {
        const spec = incomingSpecs.find((s) => s.id === id);
        if (spec) {
          removeOutgoingRelationships(db, spec.id, "spec");
          for (const rel of spec.relationships || []) {
            tryAddRelationship(rel, id);
          }
        }
      }

      // Import issue relationships for added issues
      for (const id of issueChanges.added) {
        const issue = incomingIssues.find((i) => i.id === id);
        if (issue && issue.relationships && issue.relationships.length > 0) {
          for (const rel of issue.relationships) {
            tryAddRelationship(rel, id);
          }
        }
      }

      // Import issue relationships for updated issues (only remove outgoing to preserve incoming)
      for (const id of issueChanges.updated) {
        const issue = incomingIssues.find((i) => i.id === id);
        if (issue) {
          removeOutgoingRelationships(db, issue.id, "issue");
          for (const rel of issue.relationships || []) {
            tryAddRelationship(rel, id);
          }
        }
      }

      // Note: Text reference updating is intentionally not done here
      // The renumbered entity is imported with its new ID
      // References within the imported data should already be using the correct IDs
      // Updating all references globally would incorrectly change references to the local entity
    });

    // Clean up markdown files for deleted entities (after successful DB transaction)
    for (const filePath of markdownFilesToDelete) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          // Log but don't fail - file cleanup is best-effort
          console.warn(`Failed to delete markdown file: ${filePath}`, err);
        }
      }
    }
  } else {
    result.specs = importSpecs(db, incomingSpecs, specChanges, dryRun);
    result.issues = importIssues(db, incomingIssues, issueChanges, dryRun);
  }

  // Log warnings for skipped relationships (non-fatal issues)
  if (result.warnings && result.warnings.length > 0) {
    console.warn(
      `[Import] ${result.warnings.length} relationship(s) skipped due to missing entities:`
    );
    for (const warning of result.warnings) {
      console.warn(`  - ${warning.message}`);
    }
  }

  return result;
}
