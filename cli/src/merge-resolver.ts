/**
 * JSONL merge conflict resolution
 *
 * Resolves git merge conflicts in issues.jsonl and specs.jsonl using:
 * - UUID-based deduplication
 * - Timestamp-based prioritization
 * - Metadata merging (relationships, tags)
 */

import * as fs from "fs";
import type { IssueJSONL, SpecJSONL } from "./types.js";
import { toYaml, fromYaml } from "./yaml-converter.js";
import { mergeYamlContent } from "./git-merge.js";

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
 *
 * USE FOR: Two-way merge scenarios (manual conflict resolution)
 * Merges both array fields (union) and scalar fields (latest-wins)
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
 * Merge ONLY array fields from multiple versions (union semantics)
 *
 * USE FOR: Three-way merge scenarios (git merge driver)
 * Only merges array fields (relationships, tags, feedback)
 * Scalar fields (status, priority, title, etc.) are NOT merged
 *
 * This allows git merge-file to see actual differences in scalar fields
 * for proper three-way merge semantics.
 */
export function mergeArrayFields<T extends JSONLEntity>(entities: T[]): Partial<T> {
  const result: Partial<T> = {};

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
    (result as any).relationships = Array.from(relationshipSet).map((r) =>
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
    (result as any).tags = Array.from(tagSet);
  }

  // Merge feedback if present (union of unique by id)
  const hasFeedback = entities.some((e) => (e as any).feedback);
  if (hasFeedback) {
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
      (result as any).feedback = Array.from(feedbackMap.values());
    }
  }

  return result;
}

/**
 * Resolve git conflict markers in YAML content using latest-wins per block
 *
 * When git merge-file produces conflicts in YAML, this function resolves
 * each conflict block individually while preserving cleanly merged sections.
 *
 * @param yamlWithConflicts - YAML content containing git conflict markers
 * @param useOurs - If true, use "ours" side for conflicts; if false, use "theirs"
 * @returns Resolved YAML content without conflict markers
 *
 * @example
 * ```typescript
 * const yaml = `title: test
 * <<<<<<< ours
 * content: ours text
 * =======
 * content: theirs text
 * >>>>>>> theirs
 * priority: 3`;
 *
 * const resolved = resolveYamlConflicts(yaml, true);
 * // Returns: "title: test\ncontent: ours text\npriority: 3"
 * ```
 */
export function resolveYamlConflicts(yamlWithConflicts: string, useOurs: boolean): string {
  const sections = parseMergeConflictFile(yamlWithConflicts);
  const resolved: string[] = [];

  for (const section of sections) {
    if (section.type === 'clean') {
      // Keep cleanly merged content
      resolved.push(...section.lines);
    } else {
      // Conflict block - apply latest-wins
      const chosen = useOurs ? section.ours! : section.theirs!;
      resolved.push(...chosen);
    }
  }

  return resolved.join('\n');
}

/**
 * Resolve all entities using UUID-based deduplication
 * Handles different UUIDs, same UUID conflicts, and metadata merging
 *
 * USE CASE: TWO-WAY MERGE
 * - Manual conflict resolution (sudocode resolve-conflicts)
 * - Conflicts already isolated by git conflict markers
 * - No base version available (git index cleared after conflict)
 * - Simple UUID deduplication is sufficient and faster
 * - No benefit from YAML expansion overhead
 *
 * DO NOT USE FOR: Three-way merge with base/ours/theirs
 * For that case, use mergeThreeWay() instead.
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
 * Helper function to merge entities using YAML + git merge-file for line-level merging
 */
function mergeYamlWithGit<T extends JSONLEntity>(versions: {
  base?: T;
  ours?: T;
  theirs?: T;
}): { success: boolean; entity: T; hadConflicts: boolean } {
  const { base, ours, theirs } = versions;

  // Convert to YAML
  const baseYaml = base ? toYaml(base) : "";
  const oursYaml = ours ? toYaml(ours!) : "";
  const theirsYaml = theirs ? toYaml(theirs!) : "";

  // Run git merge-file for line-level merging
  const mergeResult = mergeYamlContent({
    base: baseYaml,
    ours: oursYaml,
    theirs: theirsYaml,
  });

  if (mergeResult.success && !mergeResult.hasConflicts) {
    // Clean merge - parse YAML back to JSON
    const mergedEntity = fromYaml(mergeResult.content) as T;
    return { success: true, entity: mergedEntity, hadConflicts: false };
  } else if (mergeResult.hasConflicts) {
    // YAML has conflicts - resolve each conflict block individually
    // Determine which side is newer for latest-wins decision
    const oursNewer = compareTimestamps(ours?.updated_at, theirs?.updated_at) > 0;

    // Resolve conflict blocks, preserving cleanly merged sections
    const resolvedYaml = resolveYamlConflicts(mergeResult.content, oursNewer);
    const mergedEntity = fromYaml(resolvedYaml) as T;

    return { success: true, entity: mergedEntity, hadConflicts: true };
  } else {
    // Fatal error during merge
    return { success: false, entity: ours!, hadConflicts: false };
  }
}

/**
 * Three-way merge for git merge driver
 * Uses hybrid approach: field-level merge for scalars + line-level merge for multi-line text
 *
 * USE CASE: THREE-WAY MERGE
 * - Git merge driver operations (automatic merge)
 * - Worktree sync with true base/ours/theirs versions
 * - Field-level merging preserves changes from either branch
 *
 * DO NOT USE FOR: Manual conflict resolution (use resolveEntities)
 *
 * This function implements true three-way merge semantics:
 * 1. Group entities by UUID across base/ours/theirs
 * 2. Handle deletion cases (modification wins over deletion)
 * 3. Merge array fields FIRST (tags, relationships, feedback) with union semantics
 * 4. Field-level three-way merge for SCALAR fields only (status, priority, etc.)
 * 5. YAML + git merge-file for multi-line text fields (content, description)
 * 6. Handle ID collisions (hash conflicts with .1, .2 suffixes)
 * 7. Sort by created_at (git-friendly)
 *
 * Field-level three-way merge logic:
 * - If base == ours == theirs: use any value (no changes)
 * - If base == ours && base != theirs: use theirs (only theirs changed)
 * - If base == theirs && base != ours: use ours (only ours changed)
 * - If base != ours && base != theirs && ours == theirs: use either (both made same change)
 * - If base != ours && base != theirs && ours != theirs: conflict -> latest wins
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
  const byUuid = new Map<
    string,
    {
      base?: T;
      ours?: T;
      theirs?: T;
    }
  >();

  // Populate from all three versions
  for (const entity of base) {
    const existing = byUuid.get(entity.uuid) || {};
    byUuid.set(entity.uuid, { ...existing, base: entity });
  }
  for (const entity of ours) {
    const existing = byUuid.get(entity.uuid) || {};
    byUuid.set(entity.uuid, { ...existing, ours: entity });
  }
  for (const entity of theirs) {
    const existing = byUuid.get(entity.uuid) || {};
    byUuid.set(entity.uuid, { ...existing, theirs: entity });
  }

  const mergedEntities: T[] = [];

  // Step 2: Process each UUID group
  for (const [uuid, versions] of Array.from(byUuid.entries())) {
    const { base: baseEntity, ours: oursEntity, theirs: theirsEntity } =
      versions;

    // Step 2a: Handle deletion cases
    // Deleted in both → skip
    if (!oursEntity && !theirsEntity) {
      continue;
    }

    // Deleted in theirs, modified in ours → modification wins
    if (baseEntity && !theirsEntity && oursEntity) {
      mergedEntities.push(oursEntity);
      stats.conflicts.push({
        type: "same-uuid-same-id",
        uuid,
        originalIds: [baseEntity.id],
        resolvedIds: [oursEntity.id],
        action: `Kept ours (deleted in theirs, modified in ours)`,
      });
      continue;
    }

    // Deleted in ours, modified in theirs → modification wins
    if (baseEntity && !oursEntity && theirsEntity) {
      mergedEntities.push(theirsEntity);
      stats.conflicts.push({
        type: "same-uuid-same-id",
        uuid,
        originalIds: [baseEntity.id],
        resolvedIds: [theirsEntity.id],
        action: `Kept theirs (deleted in ours, modified in theirs)`,
      });
      continue;
    }

    // Added in only one side (no base)
    if (!baseEntity && oursEntity && !theirsEntity) {
      mergedEntities.push(oursEntity);
      continue;
    }
    if (!baseEntity && !oursEntity && theirsEntity) {
      mergedEntities.push(theirsEntity);
      continue;
    }

    // Added in both sides (no base) → use standard resolution
    if (!baseEntity && oursEntity && theirsEntity) {
      const resolved = resolveEntities([oursEntity, theirsEntity]);
      mergedEntities.push(...resolved.entities);
      stats.conflicts.push(...resolved.stats.conflicts);
      continue;
    }

    // Check if IDs match - if not, this is an ID conflict
    // In three-way merge, keep ours and theirs (they both moved from base)
    const ids = new Set([baseEntity?.id, oursEntity?.id, theirsEntity?.id].filter(Boolean));
    if (ids.size > 1) {
      // IDs don't match - ID conflict
      // Only keep ours and theirs (not base, since both sides moved away from it)
      const versionsToResolve = [oursEntity, theirsEntity].filter(
        (e): e is T => e !== undefined
      );
      const resolved = resolveEntities(versionsToResolve);
      mergedEntities.push(...resolved.entities);
      stats.conflicts.push(...resolved.stats.conflicts);
      continue;
    }

    // Step 2b: Merge array fields FIRST (union semantics)
    const versionsForMetadata = [baseEntity, oursEntity, theirsEntity].filter(
      (e): e is T => e !== undefined
    );
    const arrayFieldsMerged = mergeArrayFields(versionsForMetadata);

    // Step 2c: Get all fields from any of the three versions (except array fields)
    const allFields = new Set<string>();
    for (const entity of [baseEntity, oursEntity, theirsEntity]) {
      if (entity) {
        for (const key of Object.keys(entity)) {
          // Skip array fields (already merged via mergeArrayFields)
          if (key === 'relationships' || key === 'tags' || key === 'feedback') continue;
          allFields.add(key);
        }
      }
    }

    // Step 2d: Perform field-level three-way merge for SCALAR fields only
    // Multi-line text fields (content, description) will be handled by git merge-file
    const fieldsMerged: Partial<T> = { ...arrayFieldsMerged };
    const scalarConflicts: string[] = [];

    // Multi-line text fields that should go through git merge-file
    const multiLineFields = new Set(['content', 'description']);

    // updated_at always differs and causes spurious conflicts - extract latest value
    const latestUpdatedAt = compareTimestamps(
      oursEntity?.updated_at,
      theirsEntity?.updated_at
    ) > 0 ? oursEntity?.updated_at : theirsEntity?.updated_at;

    for (const field of allFields) {
      // Skip multi-line text fields - they'll be handled by git merge-file
      if (multiLineFields.has(field)) {
        continue;
      }

      // Skip updated_at - we'll add it back at the end
      if (field === 'updated_at') {
        continue;
      }

      const baseValue = baseEntity?.[field as keyof T];
      const oursValue = oursEntity?.[field as keyof T];
      const theirsValue = theirsEntity?.[field as keyof T];

      // Three-way merge logic for scalar fields:
      // - If base == ours == theirs: use any value
      // - If base == ours && base != theirs: use theirs (they changed it)
      // - If base == theirs && base != ours: use ours (we changed it)
      // - If base != ours && base != theirs && ours == theirs: use either (both made same change)
      // - If base != ours && base != theirs && ours != theirs: conflict -> latest wins

      if (baseValue === oursValue && baseValue === theirsValue) {
        // No changes
        (fieldsMerged as any)[field] = baseValue;
      } else if (baseValue === oursValue && baseValue !== theirsValue) {
        // Only theirs changed
        (fieldsMerged as any)[field] = theirsValue;
      } else if (baseValue === theirsValue && baseValue !== oursValue) {
        // Only ours changed
        (fieldsMerged as any)[field] = oursValue;
      } else if (oursValue === theirsValue) {
        // Both made same change
        (fieldsMerged as any)[field] = oursValue;
      } else {
        // Conflict: both changed to different values -> latest wins
        const oursNewer = compareTimestamps(oursEntity?.updated_at, theirsEntity?.updated_at) > 0;
        (fieldsMerged as any)[field] = oursNewer ? oursValue : theirsValue;
        scalarConflicts.push(field);
      }
    }

    // Step 2e: FAST PATH - Skip expensive YAML merge if entity is unchanged
    // Check if all multi-line text fields are identical across versions
    const multiLineFieldsIdentical = Array.from(multiLineFields).every(field => {
      const baseValue = baseEntity?.[field as keyof T];
      const oursValue = oursEntity?.[field as keyof T];
      const theirsValue = theirsEntity?.[field as keyof T];
      return baseValue === oursValue && oursValue === theirsValue;
    });

    let mergedEntity: T;
    let hadYamlConflicts = false;

    // If no scalar conflicts and multi-line fields are identical, skip YAML merge
    if (scalarConflicts.length === 0 && multiLineFieldsIdentical) {
      // Fast path: Entity unchanged, use any version (prefer ours)
      mergedEntity = { ...oursEntity!, ...fieldsMerged } as T;
    } else {
      // Slow path: Need YAML merge for multi-line fields or scalar conflicts exist
      // For multi-line fields, keep original values for YAML conversion
      // Git merge-file will handle the line-level merge
      // Remove updated_at to avoid spurious conflicts in YAML
      const versionsForYaml = {
        base: baseEntity ? { ...baseEntity, ...fieldsMerged, updated_at: undefined } : undefined,
        ours: oursEntity ? { ...oursEntity, ...fieldsMerged, updated_at: undefined } : undefined,
        theirs: theirsEntity ? { ...theirsEntity, ...fieldsMerged, updated_at: undefined } : undefined,
      };

      // Step 2f: Convert to YAML and run git merge-file for line-level merging
      const yamlMergeResult = mergeYamlWithGit(versionsForYaml);
      hadYamlConflicts = yamlMergeResult.hadConflicts;

      if (yamlMergeResult.success) {
        mergedEntity = yamlMergeResult.entity;
      } else {
        // Fatal error during merge - fallback to latest-wins for entire entity
        const oursNewer = compareTimestamps(oursEntity?.updated_at, theirsEntity?.updated_at) > 0;
        mergedEntity = (oursNewer ? versionsForYaml.ours : versionsForYaml.theirs) as T;
      }
    }

    // Add back the latest updated_at timestamp
    mergedEntity.updated_at = latestUpdatedAt;

    // Record conflicts if any
    if (scalarConflicts.length > 0 || hadYamlConflicts) {
      const conflictParts = [];
      if (scalarConflicts.length > 0) {
        conflictParts.push(`${scalarConflicts.length} scalar field conflicts (${scalarConflicts.join(', ')})`);
      }
      if (hadYamlConflicts) {
        conflictParts.push('YAML conflict blocks (latest-wins per block)');
      }

      stats.conflicts.push({
        type: "same-uuid-same-id",
        uuid,
        originalIds: [baseEntity?.id || oursEntity?.id || theirsEntity?.id || "unknown"],
        resolvedIds: [mergedEntity.id || "unknown"],
        action: `Resolved ${conflictParts.join(', ')}`,
      });
    }

    mergedEntities.push(mergedEntity);
  }

  // Step 3: Handle ID collisions (hash conflicts)
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
        type: "different-uuids",
        uuid: entity.uuid,
        originalIds: [currentId],
        resolvedIds: [newId],
        action: `Renamed ID to resolve hash collision (different UUIDs)`,
      });
    }
  }

  // Step 4: Sort by created_at (git-friendly)
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
