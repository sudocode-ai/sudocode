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
 * ## Legacy API (Deprecated)
 *
 * **`resolveEntities(entities)`** - DEPRECATED two-way merge
 *   - Only considers "ours" and "theirs" without a common base
 *   - Kept for backward compatibility with existing tests
 *   - Use `mergeThreeWay()` instead for new code
 *
 * ## Migration Path
 *
 * All usages have been migrated to `mergeThreeWay()`:
 * - ✅ `_resolveJSONLFile()` - Updated to use mergeThreeWay
 * - ✅ `_mergeJSONLFiles()` - Updated to use mergeThreeWay
 * - ✅ `resolveFile()` - Updated to use mergeThreeWay
 * - ✅ Tests - Legacy tests remain for `resolveEntities()`
 *
 * See deprecation notice on `resolveEntities()` for migration examples.
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
 * Generate deterministic conflict ID
 */
function generateConflictId(originalId: string, uuid: string): string {
  return `${originalId}-conflict-${uuid.slice(0, 8)}`;
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
 * Resolve all entities using UUID-based deduplication
 * Handles different UUIDs, same UUID conflicts, and metadata merging
 *
 * @deprecated Use `mergeThreeWay()` instead for proper three-way merge support.
 *
 * This function implements a two-way merge strategy that only considers
 * "ours" and "theirs" versions without a common base. This can lead to
 * suboptimal conflict resolution and lost changes.
 *
 * **Migration Guide:**
 *
 * Before (two-way merge):
 * ```typescript
 * const { entities, stats } = resolveEntities([...oursEntities, ...theirsEntities]);
 * ```
 *
 * After (three-way merge):
 * ```typescript
 * const { entities, stats } = mergeThreeWay(
 *   baseEntities,    // Common ancestor version (or [] for simulated 3-way)
 *   oursEntities,    // Current/local changes
 *   theirsEntities   // Incoming changes
 * );
 * ```
 *
 * **Key Benefits of mergeThreeWay:**
 * - Proper three-way merge algorithm using common base
 * - YAML-based line-level conflict resolution
 * - Automatic conflict resolver for remaining conflicts
 * - Better handling of concurrent modifications
 * - Metadata merging across all three versions
 * - Support for entity deletions (modification wins over deletion)
 *
 * **Note:** This function may be removed in a future version.
 * It is currently kept for backward compatibility with existing tests.
 */
export function resolveEntities<T extends JSONLEntity>(
  entities: T[],
  options: ResolveOptions = {}
): ResolvedResult<T> {
  const stats: ResolutionStats = {
    totalInput: entities.length,
    totalOutput: 0,
    conflicts: [],
  };

  // Group entities by UUID
  const byUuid = new Map<string, T[]>();
  for (const entity of entities) {
    if (!byUuid.has(entity.uuid)) {
      byUuid.set(entity.uuid, []);
    }
    byUuid.get(entity.uuid)!.push(entity);
  }

  const resolved: T[] = [];

  // Process each UUID group
  for (const [uuid, group] of Array.from(byUuid.entries())) {
    if (group.length === 1) {
      // No conflict - single entity with this UUID
      resolved.push(group[0]);
      continue;
    }

    // Check if all have same ID
    const ids = new Set(group.map((e) => e.id));

    if (ids.size === 1) {
      // Same UUID, same ID → Keep most recent, merge metadata
      const merged = mergeMetadata(group);
      resolved.push(merged);

      stats.conflicts.push({
        type: "same-uuid-same-id",
        uuid,
        originalIds: [group[0].id],
        resolvedIds: [merged.id],
        action: `Kept most recent version, merged ${group.length} versions`,
      });
    } else {
      // Same UUID, different IDs → Keep all, rename duplicates
      const sorted = [...group].sort((a, b) =>
        compareTimestamps(a.updated_at, b.updated_at)
      );

      // Keep most recent ID as-is
      const keeper = sorted[sorted.length - 1];
      resolved.push(keeper);

      const originalIds: string[] = [];
      const resolvedIds: string[] = [keeper.id];

      // Rename older versions
      for (let i = 0; i < sorted.length - 1; i++) {
        const entity = { ...sorted[i] } as T;
        originalIds.push(entity.id);

        // Always rename older versions
        entity.id = generateConflictId(entity.id, uuid);

        resolvedIds.push(entity.id);
        resolved.push(entity);
      }

      stats.conflicts.push({
        type: "same-uuid-different-id",
        uuid,
        originalIds,
        resolvedIds,
        action: `Renamed ${sorted.length - 1} conflicting IDs`,
      });
    }
  }

  // Handle ID collisions across different UUIDs (hash collisions)
  const idCounts = new Map<string, number>();
  const finalResolved: T[] = [];

  for (const entity of resolved) {
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
        type: "different-uuids",
        uuid: entity.uuid,
        originalIds: [currentId],
        resolvedIds: [newId],
        action: `Renamed ID to resolve hash collision (different UUIDs)`,
      });
    }
  }

  // Sort by created_at (git-friendly)
  finalResolved.sort((a, b) => {
    const aDate = a.created_at || "";
    const bDate = b.created_at || "";
    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;
    return (a.id || "").localeCompare(b.id || "");
  });

  stats.totalOutput = finalResolved.length;

  return { entities: finalResolved, stats };
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

    if (!baseEntity && oursEntity && theirsEntity) {
      // Added in both (simulated 3-way or concurrent additions)
      // Step 2: Merge metadata FIRST
      const merged = mergeMetadata([oursEntity, theirsEntity]);
      mergedEntities.push(merged);

      stats.conflicts.push({
        type: 'same-uuid-same-id',
        uuid,
        originalIds: [oursEntity.id, theirsEntity.id],
        resolvedIds: [merged.id],
        action: 'Concurrent addition: merged metadata and kept most recent version',
      });
      continue;
    }

    if (baseEntity && !oursEntity && !theirsEntity) {
      // Deleted in both: skip
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

    // baseEntity && oursEntity && theirsEntity
    // All three versions exist: perform YAML-based three-way merge

    // Step 2-3: Merge metadata FIRST, apply to all three versions
    // TypeScript: We know all three exist at this point from the conditionals above
    const allVersions = [baseEntity!, oursEntity!, theirsEntity!];
    const metadataMerged = mergeMetadata(allVersions);

    // Apply merged metadata to all three versions
    const baseWithMetadata = { ...baseEntity!, ...extractMetadata(metadataMerged) };
    const oursWithMetadata = { ...oursEntity!, ...extractMetadata(metadataMerged) };
    const theirsWithMetadata = { ...theirsEntity!, ...extractMetadata(metadataMerged) };

    // Step 4: Convert to YAML
    const baseYaml = toYaml(baseWithMetadata);
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
      const resolveResult = resolveConflicts(finalYaml);
      finalYaml = resolveResult.content;

      if (resolveResult.conflictsResolved > 0) {
        stats.conflicts.push({
          type: 'same-uuid-same-id',
          uuid,
          originalIds: [baseEntity!.id],
          resolvedIds: [oursEntity!.id, theirsEntity!.id],
          action: `Three-way merge with ${resolveResult.conflictsResolved} YAML conflicts resolved`,
        });
      }
    }

    // Step 7: Convert merged YAML back to JSON
    try {
      const mergedEntity = fromYaml(finalYaml) as T;
      mergedEntities.push(mergedEntity);
    } catch (error) {
      // Fallback to metadata merge if YAML conversion fails
      const fallback = mergeMetadata([oursEntity!, theirsEntity!]);
      mergedEntities.push(fallback);

      stats.conflicts.push({
        type: 'same-uuid-same-id',
        uuid,
        originalIds: [baseEntity!.id],
        resolvedIds: [fallback.id],
        action: `YAML merge failed, fell back to metadata merge: ${(error as Error).message}`,
      });
    }
  }

  // Step 9: Sort by created_at (git-friendly)
  mergedEntities.sort((a, b) => {
    const aDate = a.created_at || '';
    const bDate = b.created_at || '';
    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;
    return (a.id || '').localeCompare(b.id || '');
  });

  stats.totalOutput = mergedEntities.length;

  return { entities: mergedEntities, stats };
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
