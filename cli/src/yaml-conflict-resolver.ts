/**
 * YAML Conflict Resolver
 *
 * Resolves remaining YAML conflicts after git merge using latest-wins strategy
 * based on updated_at timestamps.
 */

import type { Issue, Spec } from '@sudocode-ai/types';

/**
 * Represents a single conflict section in YAML with git conflict markers
 */
interface ConflictSection {
  fullMatch: string;    // The entire conflict block including markers
  oursContent: string;  // Content between <<<<<<< and =======
  theirsContent: string; // Content between ======= and >>>>>>>
  startIndex: number;   // Start position in original string
  endIndex: number;     // End position in original string
}

/**
 * Extract all conflict sections from YAML string
 *
 * @param yaml - YAML string potentially containing git conflict markers
 * @returns Array of conflict sections with their positions
 */
function extractConflicts(yaml: string): ConflictSection[] {
  const conflicts: ConflictSection[] = [];

  // Regex to match git conflict markers (multiline mode)
  // Pattern: <<<<<<< ... \n content \n ======= \n content \n >>>>>>> ...\n
  // Note: We capture the full conflict block including all markers and trailing newline
  const conflictRegex = /^<{7}\s+.*?$\n([\s\S]*?)^={7}\s*?$\n([\s\S]*?)^>{7}\s+.*?$\n?/gm;

  let match: RegExpExecArray | null;
  while ((match = conflictRegex.exec(yaml)) !== null) {
    conflicts.push({
      fullMatch: match[0],
      oursContent: match[1],
      theirsContent: match[2],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return conflicts;
}

/**
 * Parse timestamp string to milliseconds since epoch
 *
 * Handles multiple ISO 8601 formats:
 * - 2025-01-01T10:00:00Z
 * - 2025-01-01 10:00:00
 *
 * @param timestamp - ISO 8601 timestamp string or undefined
 * @returns Milliseconds since epoch, or 0 for missing/invalid timestamps
 */
function parseTimestamp(timestamp: string | undefined): number {
  if (!timestamp) {
    return 0; // Missing timestamp treated as oldest
  }

  try {
    // Normalize space-separated format to T-separated ISO 8601
    const normalized = timestamp.includes('T')
      ? timestamp
      : timestamp.replace(' ', 'T');

    const parsed = new Date(normalized).getTime();

    // Check if parsing succeeded (NaN becomes false)
    if (isNaN(parsed)) {
      console.warn(`[yaml-conflict-resolver] Invalid timestamp: ${timestamp}`);
      return 0; // Invalid timestamp treated as oldest
    }

    return parsed;
  } catch (error) {
    console.warn(`[yaml-conflict-resolver] Error parsing timestamp: ${timestamp}`, error);
    return 0; // Error treated as oldest
  }
}

/**
 * Resolve YAML conflicts using latest-wins strategy
 *
 * Compares updated_at timestamps from original entities and keeps content
 * from the entity with the newer timestamp. All conflicts are resolved
 * using the same winning side (no per-conflict comparison).
 *
 * @param yaml - YAML string with git conflict markers
 * @param oursEntity - Our entity (for timestamp comparison)
 * @param theirsEntity - Their entity (for timestamp comparison)
 * @returns YAML string with all conflicts resolved
 *
 * @example
 * ```typescript
 * const yaml = `
 * title: Example
 * <<<<<<< HEAD
 * description: Our version
 * =======
 * description: Their version
 * >>>>>>> branch
 * `;
 *
 * const ours = { updated_at: '2025-01-01T10:00:00Z', ... };
 * const theirs = { updated_at: '2025-01-01T09:00:00Z', ... };
 *
 * const resolved = resolveYamlConflicts(yaml, ours, theirs);
 * // Result: "title: Example\ndescription: Our version\n"
 * ```
 */
export function resolveYamlConflicts(
  yaml: string,
  oursEntity: Issue | Spec,
  theirsEntity: Issue | Spec
): string {
  // Quick exit if no conflicts
  if (!yaml.includes('<<<<<<<')) {
    return yaml;
  }

  // Extract all conflicts
  const conflicts = extractConflicts(yaml);

  if (conflicts.length === 0) {
    return yaml; // No valid conflict markers found
  }

  // Compare timestamps to determine winner
  const oursTime = parseTimestamp(oursEntity.updated_at);
  const theirsTime = parseTimestamp(theirsEntity.updated_at);

  // Latest-wins strategy (>= means ours wins on ties)
  const useOurs = oursTime >= theirsTime;

  // Replace conflicts in reverse order to preserve string indices
  let resolved = yaml;
  for (const conflict of conflicts.reverse()) {
    const winner = useOurs ? conflict.oursContent : conflict.theirsContent;

    // Replace the entire conflict block (including markers) with winner content
    resolved =
      resolved.substring(0, conflict.startIndex) +
      winner +
      resolved.substring(conflict.endIndex);
  }

  return resolved;
}
