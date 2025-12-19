/**
 * JSONL merge conflict resolution
 *
 * Resolves git merge conflicts in issues.jsonl and specs.jsonl using
 * a universal three-way merge algorithm:
 *
 * - **Three-way merge**: Uses base (common ancestor), ours, theirs
 * - **YAML expansion**: Converts JSON entities to YAML for line-level merging
 * - **Line-level resolution**: Uses git merge-file for text-based merging
 * - **Automatic conflict resolver**: Applies latest-wins strategy for remaining conflicts
 * - **Metadata merging**: Unions tags, relationships, feedback across all versions
 * - **Deletion handling**: Modification wins over deletion
 * - **Simulated 3-way**: Supports empty base (treats all as additions)
 *
 * ## Primary API
 *
 * **`mergeThreeWay(base, ours, theirs)`** - Universal three-way merge
 *   - Use for all JSONL merge operations
 *   - Supports true 3-way (with base) and simulated 3-way (base = [])
 *   - Returns merged entities with conflict statistics
 *
 * ## Helper Functions
 *
 * **`mergeMetadata(entities)`** - Merge metadata from multiple entity versions
 *   - Unions tags, relationships, and feedback
 *   - Keeps most recent version as base
 *   - Used internally by mergeThreeWay
 *
 * **`parseMergeConflictFile(content)`** - Parse git conflict markers
 *   - Extracts clean sections and conflict sections
 *   - Returns structured representation
 *
 * **`hasGitConflictMarkers(filePath)`** - Check for conflict markers
 *   - Fast check for `<<<<<<<`, `=======`, `>>>>>>>`
 */

import * as fs from "fs";
import type { IssueJSONL, SpecJSONL } from "./types.js";
import { toYaml, fromYaml } from "./yaml-converter.js";
import { mergeYamlContentSync } from "./git-merge.js";
import { resolveConflicts } from "./yaml-conflict-resolver.js";

export type JSONLEntity = IssueJSONL | SpecJSONL | Record<string, any>;

/**
 * Conflict section from parsing git conflict markers
 */
export interface ConflictSection {
  type: "clean" | "conflict";
  lines: string[];
  ours?: string[];
  theirs?: string[];
  marker?: ConflictMarker;
}

/**
 * Conflict marker metadata
 */
export interface ConflictMarker {
  start: number;
  middle: number;
  end: number;
  oursLabel: string;
  theirsLabel: string;
}

/**
 * Resolution options
 */
export interface ResolveOptions {
  verbose?: boolean;
}

/**
 * Resolution result with statistics
 */
export interface ResolvedResult<T> {
  entities: T[];
  stats: ResolutionStats;
}

/**
 * Resolution statistics
 */
export interface ResolutionStats {
  totalInput: number;
  totalOutput: number;
  conflicts: ConflictResolution[];
}

/**
 * Individual conflict resolution record
 */
export interface ConflictResolution {
  type: "different-uuids" | "same-uuid-different-id" | "same-uuid-same-id";
  uuid: string;
  originalIds: string[];
  resolvedIds: string[];
  action: string;
}

/**
 * Check if file contains git conflict markers
 */
export function hasGitConflictMarkers(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  return (
    content.includes("<<<<<<<") &&
    content.includes("=======") &&
    content.includes(">>>>>>>")
  );
}

/**
 * Parse JSONL file containing git conflict markers
 * Returns structured representation of clean sections and conflicts
 */
export function parseMergeConflictFile(content: string): ConflictSection[] {
  const lines = content.split("\n");
  const sections: ConflictSection[] = [];
  let currentSection: ConflictSection | null = null;
  let inConflict = false;
  let conflictStart = -1;
  let conflictMiddle = -1;
  let oursLabel = "";
  let theirsLabel = "";
  let oursLines: string[] = [];
  let theirsLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Start of conflict
    if (line.startsWith("<<<<<<<")) {
      // Save any clean section
      if (currentSection) {
        sections.push(currentSection);
      }

      inConflict = true;
      conflictStart = i;
      oursLabel = line.substring(7).trim();
      oursLines = [];
      currentSection = null;
      continue;
    }

    // Middle of conflict
    if (line.startsWith("=======") && inConflict) {
      conflictMiddle = i;
      theirsLines = [];
      continue;
    }

    // End of conflict
    if (line.startsWith(">>>>>>>") && inConflict) {
      theirsLabel = line.substring(7).trim();

      sections.push({
        type: "conflict",
        lines: [],
        ours: oursLines,
        theirs: theirsLines,
        marker: {
          start: conflictStart,
          middle: conflictMiddle,
          end: i,
          oursLabel,
          theirsLabel,
        },
      });

      inConflict = false;
      conflictStart = -1;
      conflictMiddle = -1;
      oursLabel = "";
      theirsLabel = "";
      oursLines = [];
      theirsLines = [];
      continue;
    }

    // Accumulate lines
    if (inConflict) {
      if (conflictMiddle === -1) {
        oursLines.push(line);
      } else {
        theirsLines.push(line);
      }
    } else {
      // Clean line
      if (!currentSection || currentSection.type !== "clean") {
        currentSection = {
          type: "clean",
          lines: [],
        };
      }
      currentSection.lines.push(line);
    }
  }

  // Save final clean section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Compare timestamps with normalization
 */
function compareTimestamps(
  a: string | undefined,
  b: string | undefined
): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  // Normalize timestamps to ISO format
  const normalizeTs = (ts: string) => {
    const hasZone =
      ts.endsWith("Z") ||
      ts.includes("+") ||
      /[+-]\d{2}:\d{2}$/.test(ts);
    return hasZone ? ts : ts.replace(" ", "T") + "Z";
  };

  const dateA = new Date(normalizeTs(a));
  const dateB = new Date(normalizeTs(b));

  return dateA.getTime() - dateB.getTime();
}

/**
 * Merge metadata from multiple versions of same entity
 */
export function mergeMetadata<T extends JSONLEntity>(entities: T[]): T {
  // Sort by updated_at, keep most recent as base
  const sorted = [...entities].sort((a, b) =>
    compareTimestamps(b.updated_at, a.updated_at)
  );

  const base = { ...sorted[0] };

  // Merge relationships (union of unique)
  const relationshipSet = new Set<string>();
  for (const entity of entities) {
    if ((entity as any).relationships) {
      for (const rel of (entity as any).relationships) {
        relationshipSet.add(JSON.stringify(rel));
      }
    }
  }
  if (relationshipSet.size > 0) {
    (base as any).relationships = Array.from(relationshipSet).map((r) =>
      JSON.parse(r)
    );
  }

  // Merge tags (union of unique)
  const tagSet = new Set<string>();
  for (const entity of entities) {
    if ((entity as any).tags) {
      for (const tag of (entity as any).tags) {
        tagSet.add(tag);
      }
    }
  }
  if (tagSet.size > 0) {
    (base as any).tags = Array.from(tagSet);
  }

  // Merge feedback if present (union of unique by id)
  if ((entities[0] as any).feedback) {
    const feedbackMap = new Map<string, any>();
    for (const entity of entities) {
      if ((entity as any).feedback) {
        for (const fb of (entity as any).feedback) {
          if (!feedbackMap.has(fb.id)) {
            feedbackMap.set(fb.id, fb);
          }
        }
      }
    }
    if (feedbackMap.size > 0) {
      (base as any).feedback = Array.from(feedbackMap.values());
    }
  }

  return base;
}

/**
 * Three-way merge for git merge driver using YAML expansion
 * Merges base, ours, and theirs versions with line-level conflict resolution
 *
 * This function supports both:
 * - True 3-way merge: base from merge-base commit (normal git merge)
 * - Simulated 3-way merge: base = [] (empty array, treats all as additions)
 *
 * Algorithm:
 * 1. Group entities by UUID across all three versions
 * 2. Merge metadata FIRST (tags, relationships, feedback) across all versions
 * 3. Apply merged metadata to all three versions before YAML conversion
 * 4. Convert entities to YAML using yaml-converter
 * 5. Use git merge-file for line-level text merging
 * 6. Apply conflict resolver for remaining conflicts
 * 7. Convert merged YAML back to JSON
 * 8. Handle entity deletions (modification wins over deletion)
 * 9. Sort by created_at (git-friendly)
 *
 * @param base - Base version (can be empty array for simulated 3-way)
 * @param ours - Our version (current/local changes)
 * @param theirs - Their version (incoming changes)
 * @returns ResolvedResult with merged entities and statistics
 */
export function mergeThreeWay<T extends JSONLEntity>(
  base: T[],
  ours: T[],
  theirs: T[]
): ResolvedResult<T> {
  const stats: ResolutionStats = {
    totalInput: base.length + ours.length + theirs.length,
    totalOutput: 0,
    conflicts: [],
  };

  // Step 1: Group entities by UUID across all three versions
  const byUuid = new Map<string, { base?: T; ours?: T; theirs?: T }>();

  for (const entity of base) {
    if (!byUuid.has(entity.uuid)) {
      byUuid.set(entity.uuid, {});
    }
    byUuid.get(entity.uuid)!.base = entity;
  }

  for (const entity of ours) {
    if (!byUuid.has(entity.uuid)) {
      byUuid.set(entity.uuid, {});
    }
    byUuid.get(entity.uuid)!.ours = entity;
  }

  for (const entity of theirs) {
    if (!byUuid.has(entity.uuid)) {
      byUuid.set(entity.uuid, {});
    }
    byUuid.get(entity.uuid)!.theirs = entity;
  }

  const mergedEntities: T[] = [];

  // Step 2-8: Process each UUID group
  for (const [uuid, versions] of Array.from(byUuid.entries())) {
    const { base: baseEntity, ours: oursEntity, theirs: theirsEntity } = versions;

    // Handle entity deletions (modification wins over deletion)
    if (!oursEntity && !theirsEntity) {
      // Deleted in both: skip
      continue;
    }

    if (!baseEntity && !oursEntity && theirsEntity) {
      // Added in theirs only
      mergedEntities.push(theirsEntity);
      continue;
    }

    if (!baseEntity && oursEntity && !theirsEntity) {
      // Added in ours only
      mergedEntities.push(oursEntity);
      continue;
    }

    if (baseEntity && oursEntity && !theirsEntity) {
      // Modified in ours, deleted in theirs: modification wins
      mergedEntities.push(oursEntity);
      stats.conflicts.push({
        type: 'same-uuid-same-id',
        uuid,
        originalIds: [baseEntity.id],
        resolvedIds: [oursEntity.id],
        action: 'Modified in ours, deleted in theirs: kept modification',
      });
      continue;
    }

    if (baseEntity && !oursEntity && theirsEntity) {
      // Deleted in ours, modified in theirs: modification wins
      mergedEntities.push(theirsEntity);
      stats.conflicts.push({
        type: 'same-uuid-same-id',
        uuid,
        originalIds: [baseEntity.id],
        resolvedIds: [theirsEntity.id],
        action: 'Deleted in ours, modified in theirs: kept modification',
      });
      continue;
    }

    // At this point, we have either:
    // 1. baseEntity && oursEntity && theirsEntity (true 3-way merge)
    // 2. !baseEntity && oursEntity && theirsEntity (concurrent additions, simulated 3-way)
    // Both cases use the same YAML merge pipeline

    // Step 2-3: Merge metadata FIRST, apply to all versions
    const versionsForMetadata = [baseEntity, oursEntity, theirsEntity].filter(
      (v) => v !== undefined
    ) as T[];
    const metadataMerged = mergeMetadata(versionsForMetadata);

    // Apply merged metadata to all versions that exist
    const baseWithMetadata = baseEntity
      ? { ...baseEntity, ...extractMetadata(metadataMerged) }
      : undefined;
    const oursWithMetadata = { ...oursEntity!, ...extractMetadata(metadataMerged) };
    const theirsWithMetadata = { ...theirsEntity!, ...extractMetadata(metadataMerged) };

    // Step 4: Convert to YAML
    // For simulated 3-way (no base), use empty string - git merge-file handles this
    const baseYaml = baseWithMetadata ? toYaml(baseWithMetadata) : '';
    const oursYaml = toYaml(oursWithMetadata);
    const theirsYaml = toYaml(theirsWithMetadata);

    // Step 5: Use git merge-file for line-level text merging
    const gitMergeResult = mergeYamlContentSync({
      base: baseYaml,
      ours: oursYaml,
      theirs: theirsYaml,
    });

    let finalYaml = gitMergeResult.content;

    // Step 6: Apply conflict resolver if conflicts remain
    if (gitMergeResult.hasConflicts) {
      // Pass entity timestamps as fallback for conflict blocks without timestamps
      const resolveResult = resolveConflicts(
        finalYaml,
        oursEntity!.updated_at,
        theirsEntity!.updated_at
      );
      finalYaml = resolveResult.content;

      if (resolveResult.conflictsResolved > 0) {
        const action = baseEntity
          ? `Three-way merge with ${resolveResult.conflictsResolved} YAML conflicts resolved`
          : `Concurrent addition: merged with ${resolveResult.conflictsResolved} YAML conflicts resolved`;
        stats.conflicts.push({
          type: 'same-uuid-same-id',
          uuid,
          originalIds: baseEntity ? [baseEntity.id] : [oursEntity!.id, theirsEntity!.id],
          resolvedIds: [oursEntity!.id, theirsEntity!.id],
          action,
        });
      }
    }

    // Step 7: Convert merged YAML back to JSON
    try {
      const mergedEntity = fromYaml(finalYaml) as T;
      mergedEntities.push(mergedEntity);
    } catch (error) {
      // Fallback to metadata merge if YAML conversion fails
      const fallback = mergeMetadata(versionsForMetadata);
      mergedEntities.push(fallback);

      stats.conflicts.push({
        type: 'same-uuid-same-id',
        uuid,
        originalIds: baseEntity ? [baseEntity.id] : [oursEntity!.id, theirsEntity!.id],
        resolvedIds: [fallback.id],
        action: `YAML merge failed, fell back to metadata merge: ${(error as Error).message}`,
      });
    }
  }

  // Step 9: Handle ID collisions across different UUIDs (hash collisions)
  // This can happen when two different entities (different UUIDs) independently
  // generate the same hash-based ID (e.g., i-x7k9 from different UUIDs)
  const idCounts = new Map<string, number>();
  const finalResolved: T[] = [];

  for (const entity of mergedEntities) {
    const currentId = entity.id;

    if (!idCounts.has(currentId)) {
      // First entity with this ID
      idCounts.set(currentId, 1);
      finalResolved.push(entity);
    } else {
      // ID collision - rename with suffix
      const count = idCounts.get(currentId)!;
      const newEntity = { ...entity } as T;
      const newId = `${currentId}.${count}`;
      newEntity.id = newId;

      idCounts.set(currentId, count + 1);
      finalResolved.push(newEntity);

      stats.conflicts.push({
        type: 'different-uuids',
        uuid: entity.uuid,
        originalIds: [currentId],
        resolvedIds: [newId],
        action: `Renamed ID to resolve hash collision (different UUIDs)`,
      });
    }
  }

  // Step 10: Sort by created_at (git-friendly)
  finalResolved.sort((a, b) => {
    const aDate = a.created_at || '';
    const bDate = b.created_at || '';
    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;
    return (a.id || '').localeCompare(b.id || '');
  });

  stats.totalOutput = finalResolved.length;

  return { entities: finalResolved, stats };
}

/**
 * Extract metadata fields (tags, relationships, feedback) from an entity
 */
function extractMetadata<T extends JSONLEntity>(entity: T): Partial<T> {
  const metadata: any = {};

  if ((entity as any).tags) {
    metadata.tags = (entity as any).tags;
  }

  if ((entity as any).relationships) {
    metadata.relationships = (entity as any).relationships;
  }

  if ((entity as any).feedback) {
    metadata.feedback = (entity as any).feedback;
  }

  return metadata;
}
