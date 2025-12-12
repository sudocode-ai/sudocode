/**
 * Conflict resolution utilities for sync operations
 *
 * Provides strategies for resolving conflicts when both sudocode
 * and an external system have modified the same entity since last sync.
 */

import type { SyncConflict, ConflictResolution } from "@sudocode-ai/types";

/**
 * Log entry for conflict resolution audit trail
 */
export interface ConflictLog {
  /** When the conflict was resolved */
  timestamp: string;
  /** The conflict details */
  conflict: SyncConflict;
  /** How the conflict was resolved */
  resolution: "sudocode" | "external" | "skip";
  /** The strategy used to resolve */
  strategy: ConflictResolution;
}

/**
 * Resolve a conflict using the specified strategy
 *
 * @param conflict - The sync conflict to resolve
 * @param strategy - The resolution strategy to use
 * @returns The resolution decision
 *
 * @example
 * ```typescript
 * const conflict = {
 *   sudocode_entity_id: 'i-abc',
 *   external_id: 'PROJ-123',
 *   provider: 'jira',
 *   sudocode_updated_at: '2025-01-01T12:00:00Z',
 *   external_updated_at: '2025-01-01T11:00:00Z',
 * };
 *
 * // Sudocode is newer, so newest-wins returns 'sudocode'
 * const resolution = resolveByStrategy(conflict, 'newest-wins');
 * console.log(resolution); // 'sudocode'
 * ```
 */
export function resolveByStrategy(
  conflict: SyncConflict,
  strategy: ConflictResolution
): "sudocode" | "external" | "skip" {
  switch (strategy) {
    case "sudocode-wins":
      return "sudocode";

    case "external-wins":
      return "external";

    case "newest-wins": {
      const sudocodeTime = new Date(conflict.sudocode_updated_at).getTime();
      const externalTime = new Date(conflict.external_updated_at).getTime();

      // If timestamps are equal, prefer sudocode (arbitrary but consistent)
      return sudocodeTime >= externalTime ? "sudocode" : "external";
    }

    case "manual":
    default:
      // Manual resolution requires external callback; skip by default
      return "skip";
  }
}

/**
 * Log a conflict resolution for audit purposes
 *
 * @param log - The conflict log entry
 *
 * @example
 * ```typescript
 * logConflict({
 *   timestamp: new Date().toISOString(),
 *   conflict: { ... },
 *   resolution: 'sudocode',
 *   strategy: 'newest-wins',
 * });
 * ```
 */
export function logConflict(log: ConflictLog): void {
  // In a production system, this could write to a log file or emit events
  // For now, just log to console in a structured format
  console.warn("[Sync Conflict]", {
    provider: log.conflict.provider,
    entity: log.conflict.sudocode_entity_id,
    external: log.conflict.external_id,
    resolution: log.resolution,
    strategy: log.strategy,
    sudocode_updated: log.conflict.sudocode_updated_at,
    external_updated: log.conflict.external_updated_at,
  });
}

/**
 * Create a conflict log entry
 *
 * @param conflict - The sync conflict
 * @param resolution - The resolution decision
 * @param strategy - The strategy used
 * @returns A complete conflict log entry
 */
export function createConflictLog(
  conflict: SyncConflict,
  resolution: "sudocode" | "external" | "skip",
  strategy: ConflictResolution
): ConflictLog {
  return {
    timestamp: new Date().toISOString(),
    conflict,
    resolution,
    strategy,
  };
}

/**
 * Determine if two timestamps represent a conflict
 * (both updated since a reference time)
 *
 * @param sudocodeUpdated - When sudocode entity was updated
 * @param externalUpdated - When external entity was updated
 * @param lastSynced - When entities were last synced
 * @returns True if both were updated since last sync
 */
export function isConflict(
  sudocodeUpdated: Date | string,
  externalUpdated: Date | string,
  lastSynced: Date | string
): boolean {
  const sudocodeTime = new Date(sudocodeUpdated).getTime();
  const externalTime = new Date(externalUpdated).getTime();
  const syncTime = new Date(lastSynced).getTime();

  return sudocodeTime > syncTime && externalTime > syncTime;
}
