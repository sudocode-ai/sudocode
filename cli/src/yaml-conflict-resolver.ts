/**
 * YAML conflict resolver with latest-wins strategy
 * Resolves remaining YAML conflicts after git three-way merge based on timestamps
 */

import type { Issue, Spec } from "@sudocode-ai/types";

type Entity = Issue | Spec;

/**
 * Parse and normalize timestamp to milliseconds since epoch
 * Handles ISO 8601 formats and missing/invalid timestamps
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Milliseconds since epoch, or 0 for missing/invalid timestamps
 */
function parseTimestamp(timestamp: string | undefined): number {
  if (!timestamp) {
    return 0; // Treat missing timestamps as oldest
  }

  try {
    // Handle both formats: "2025-01-01T10:00:00Z" and "2025-01-01 10:00:00"
    // Replace space with 'T' and ensure 'Z' suffix for consistency
    const normalized = timestamp.includes('T')
      ? timestamp
      : timestamp.replace(' ', 'T') + (timestamp.endsWith('Z') ? '' : 'Z');

    const date = new Date(normalized);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn(`Invalid timestamp: ${timestamp}, treating as oldest`);
      return 0;
    }

    return date.getTime();
  } catch (error) {
    console.warn(`Failed to parse timestamp: ${timestamp}, treating as oldest`);
    return 0;
  }
}

/**
 * Extract conflict sections from YAML with conflict markers
 * Returns array of conflict objects with their positions
 */
interface ConflictSection {
  fullMatch: string;
  oursContent: string;
  theirsContent: string;
  startIndex: number;
  endIndex: number;
}

function extractConflicts(yaml: string): ConflictSection[] {
  const conflicts: ConflictSection[] = [];

  // Regex to match git conflict markers
  // <<<<<<< ours
  // content from ours
  // =======
  // content from theirs
  // >>>>>>> theirs
  const conflictRegex = /^<{7}\s+.*?\n([\s\S]*?)^={7}\s*?\n([\s\S]*?)^>{7}\s+.*?$/gm;

  let match;
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
 * Resolve YAML conflicts using latest-wins strategy based on updated_at timestamps
 *
 * @param yaml - YAML string potentially containing git conflict markers
 * @param oursEntity - Our version of the entity (for timestamp comparison)
 * @param theirsEntity - Their version of the entity (for timestamp comparison)
 * @returns YAML string with all conflicts resolved
 */
export function resolveYamlConflicts(
  yaml: string,
  oursEntity: Entity,
  theirsEntity: Entity
): string {
  // Check if there are any conflicts
  if (!yaml.includes('<<<<<<<')) {
    return yaml; // No conflicts to resolve
  }

  // Extract conflicts
  const conflicts = extractConflicts(yaml);

  if (conflicts.length === 0) {
    return yaml; // No valid conflicts found
  }

  // Compare timestamps to determine which entity wins
  const oursTimestamp = parseTimestamp(oursEntity.updated_at);
  const theirsTimestamp = parseTimestamp(theirsEntity.updated_at);

  const oursWins = oursTimestamp >= theirsTimestamp;

  // Log the decision
  if (oursTimestamp === theirsTimestamp && oursTimestamp === 0) {
    console.warn('Both entities have missing/invalid timestamps, defaulting to ours');
  } else {
    const winner = oursWins ? 'ours' : 'theirs';
    const oursDate = oursTimestamp > 0 ? new Date(oursTimestamp).toISOString() : 'missing';
    const theirsDate = theirsTimestamp > 0 ? new Date(theirsTimestamp).toISOString() : 'missing';
    console.log(`Resolving ${conflicts.length} conflict(s) - ${winner} wins (ours: ${oursDate}, theirs: ${theirsDate})`);
  }

  // Resolve conflicts by replacing them with the winning version
  // Process conflicts in reverse order to maintain correct indices
  let resolvedYaml = yaml;

  for (let i = conflicts.length - 1; i >= 0; i--) {
    const conflict = conflicts[i];
    const winningContent = oursWins ? conflict.oursContent : conflict.theirsContent;

    // Replace the entire conflict block with the winning content
    resolvedYaml =
      resolvedYaml.substring(0, conflict.startIndex) +
      winningContent +
      resolvedYaml.substring(conflict.endIndex);
  }

  return resolvedYaml;
}

/**
 * Check if YAML string contains unresolved conflicts
 *
 * @param yaml - YAML string to check
 * @returns True if conflicts exist, false otherwise
 */
export function hasConflicts(yaml: string): boolean {
  return yaml.includes('<<<<<<<') && yaml.includes('>>>>>>>');
}
