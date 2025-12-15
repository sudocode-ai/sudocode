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
import type { Issue, Spec } from "@sudocode-ai/types";
import { jsonToYaml, yamlToJson } from "./yaml-converter.js";
import { mergeYaml } from "./git-merge.js";
import { resolveYamlConflicts } from "./yaml-conflict-resolver.js";

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
 * Extract metadata fields (relationships, tags, feedback) from entity
 */
function extractMetadata<T extends JSONLEntity>(entity: T): Partial<T> {
  const metadata: any = {};
  if ((entity as any).relationships !== undefined) {
    metadata.relationships = (entity as any).relationships;
  }
  if ((entity as any).tags !== undefined) {
    metadata.tags = (entity as any).tags;
  }
  if ((entity as any).feedback !== undefined) {
    metadata.feedback = (entity as any).feedback;
  }
  return metadata as Partial<T>;
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
 * Three-way merge for git merge driver
 * Merges base, ours, and theirs versions using metadata-first YAML approach
 */
export async function mergeThreeWay<T extends JSONLEntity>(
  base: T[],
  ours: T[],
  theirs: T[]
): Promise<ResolvedResult<T>> {
  // 1. Group entities by UUID for all three versions
  const baseByUuid = new Map<string, T>();
  const oursByUuid = new Map<string, T>();
  const theirsByUuid = new Map<string, T>();

  for (const entity of base) {
    baseByUuid.set(entity.uuid, entity);
  }
  for (const entity of ours) {
    oursByUuid.set(entity.uuid, entity);
  }
  for (const entity of theirs) {
    theirsByUuid.set(entity.uuid, entity);
  }

  // 2. Collect all unique UUIDs
  const allUuids = new Set([
    ...baseByUuid.keys(),
    ...oursByUuid.keys(),
    ...theirsByUuid.keys(),
  ]);

  const mergedEntities: T[] = [];
  const conflicts: ConflictResolution[] = [];

  // 3. For each UUID:
  for (const uuid of allUuids) {
    const baseEntity = baseByUuid.get(uuid);
    const oursEntity = oursByUuid.get(uuid);
    const theirsEntity = theirsByUuid.get(uuid);

    // a. If all three versions exist → YAML merge with metadata-first
    if (baseEntity && oursEntity && theirsEntity) {
      try {
        // **STEP 1: Merge metadata FIRST**
        const mergedMeta = mergeMetadata([baseEntity, oursEntity, theirsEntity]);
        const metadata = extractMetadata(mergedMeta);

        // Apply merged metadata to all three versions
        const baseWithMeta = { ...baseEntity, ...metadata };
        const oursWithMeta = { ...oursEntity, ...metadata };
        const theirsWithMeta = { ...theirsEntity, ...metadata };

        // **STEP 2: Convert to YAML**
        const baseYaml = jsonToYaml(baseWithMeta);
        const oursYaml = jsonToYaml(oursWithMeta);
        const theirsYaml = jsonToYaml(theirsWithMeta);

        // **STEP 3: Run git merge**
        const { merged: mergedYaml, hasConflicts } = await mergeYaml(
          baseYaml,
          oursYaml,
          theirsYaml
        );

        // **STEP 4: Resolve remaining conflicts**
        let resolvedYaml = mergedYaml;
        if (hasConflicts) {
          resolvedYaml = resolveYamlConflicts(mergedYaml, oursEntity as Issue | Spec, theirsEntity as Issue | Spec);
        }

        // **STEP 5: Convert back to JSON**
        const finalEntity = yamlToJson<T>(resolvedYaml);
        mergedEntities.push(finalEntity);

        if (hasConflicts) {
          conflicts.push({
            type: "same-uuid-same-id",
            uuid,
            originalIds: [baseEntity.id],
            resolvedIds: [finalEntity.id],
            action: "YAML merge with conflict resolution (latest-wins)",
          });
        }
      } catch (error) {
        // Fallback to pure metadata merge
        console.warn(
          `YAML merge failed for UUID ${uuid}, falling back to metadata merge:`,
          error
        );
        const fallback = mergeMetadata([baseEntity, oursEntity, theirsEntity]) as T;
        mergedEntities.push(fallback);

        conflicts.push({
          type: "same-uuid-same-id",
          uuid,
          originalIds: [baseEntity.id],
          resolvedIds: [fallback.id],
          action: "Metadata merge (YAML merge failed)",
        });
      }
    }
    // b. Otherwise (missing versions) → add available entities
    else {
      // Modification wins over deletion - preserve work
      if (oursEntity) {
        mergedEntities.push(oursEntity);
      }
      if (theirsEntity && !oursEntity) {
        // Only add theirs if ours doesn't exist
        mergedEntities.push(theirsEntity);
      }
      // Skip baseEntity only (deleted on both sides)
    }
  }

  // 4. Sort by created_at, then by id (for ties)
  mergedEntities.sort((a, b) => {
    const cmp = (a.created_at || "").localeCompare(b.created_at || "");
    return cmp !== 0 ? cmp : (a.id || "").localeCompare(b.id || "");
  });

  // 5. Return with stats
  return {
    entities: mergedEntities,
    stats: {
      totalInput: base.length + ours.length + theirs.length,
      totalOutput: mergedEntities.length,
      conflicts,
    },
  };
}
