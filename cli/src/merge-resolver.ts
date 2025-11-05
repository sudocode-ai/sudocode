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
 * Merges base, ours, and theirs versions
 */
export function mergeThreeWay<T extends JSONLEntity>(
  base: T[],
  ours: T[],
  theirs: T[]
): ResolvedResult<T> {
  // Collect all entities from all three versions
  const allEntities = [...base, ...ours, ...theirs];

  // Use standard resolution logic
  return resolveEntities(allEntities);
}
