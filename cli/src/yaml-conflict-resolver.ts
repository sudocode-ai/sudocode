/**
 * YAML Conflict Resolver
 *
 * Parses YAML conflict markers from git merge-file output and applies
 * latest-wins strategy based on `updated_at` timestamps.
 *
 * This resolver handles conflicts that git merge-file couldn't auto-resolve
 * (when both sides modified the same line). It uses timestamp comparison to
 * determine which version to keep.
 */

/**
 * Represents a conflict section in YAML
 */
export interface ConflictSection {
  /** The "ours" version (current/local changes) */
  ours: string;
  /** The "theirs" version (incoming changes) */
  theirs: string;
  /** The line number where the conflict starts */
  startLine: number;
  /** The line number where the conflict ends */
  endLine: number;
}

/**
 * Result of conflict resolution
 */
export interface ResolveResult {
  /** Whether any conflicts were found */
  hasConflicts: boolean;
  /** The resolved content (conflict markers replaced with winning values) */
  content: string;
  /** Number of conflicts resolved */
  conflictsResolved: number;
}

/**
 * Extract updated_at timestamp from a YAML section
 *
 * Looks for lines like:
 * - updated_at: 2025-01-01T10:00:00Z
 * - updated_at: "2025-01-01 10:00:00"
 * - updated_at: '2025-01-01T10:00:00.000Z'
 *
 * @param yamlSection - YAML content to search
 * @returns Date object or null if not found/invalid
 */
function extractTimestamp(yamlSection: string): Date | null {
  // Match updated_at field with various timestamp formats
  // Handles quoted and unquoted ISO 8601 timestamps
  const timestampRegex = /updated_at:\s*['"]?([^'"{\n]+?)['"]?\s*$/m;
  const match = yamlSection.match(timestampRegex);

  if (!match || !match[1]) {
    return null;
  }

  const timestampStr = match[1].trim();

  try {
    // Parse ISO 8601 timestamp
    const date = new Date(timestampStr);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Parse git conflict markers from YAML content
 *
 * Git conflict format:
 * <<<<<<< HEAD (or ours)
 * ... our version ...
 * =======
 * ... their version ...
 * >>>>>>> branch-name (or theirs)
 *
 * @param content - YAML content with conflict markers
 * @returns Array of conflict sections
 */
export function parseConflicts(content: string): ConflictSection[] {
  const conflicts: ConflictSection[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for conflict start marker
    if (line.startsWith('<<<<<<<')) {
      const startLine = i;
      const oursLines: string[] = [];
      const theirsLines: string[] = [];

      // Advance to collect "ours" section
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        oursLines.push(lines[i]);
        i++;
      }

      // Skip the separator
      if (i < lines.length && lines[i].startsWith('=======')) {
        i++;
      }

      // Collect "theirs" section
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirsLines.push(lines[i]);
        i++;
      }

      // Record end line
      const endLine = i;

      // Add conflict section
      conflicts.push({
        ours: oursLines.join('\n'),
        theirs: theirsLines.join('\n'),
        startLine,
        endLine,
      });
    }

    i++;
  }

  return conflicts;
}

/**
 * Resolve a single conflict using latest-wins strategy
 *
 * Compares updated_at timestamps from both versions and returns the newer one.
 * If timestamps are missing or invalid, treats that version as oldest.
 * If timestamps are identical, prefers "ours" for stability.
 *
 * @param conflict - The conflict section to resolve
 * @returns The winning YAML content
 */
export function resolveConflict(conflict: ConflictSection): string {
  const oursTimestamp = extractTimestamp(conflict.ours);
  const theirsTimestamp = extractTimestamp(conflict.theirs);

  // If neither has a valid timestamp, prefer ours for stability
  if (!oursTimestamp && !theirsTimestamp) {
    return conflict.ours;
  }

  // If only one has a valid timestamp, it wins
  if (!oursTimestamp && theirsTimestamp) {
    return conflict.theirs;
  }
  if (oursTimestamp && !theirsTimestamp) {
    return conflict.ours;
  }

  // Both have valid timestamps - compare them
  // TypeScript knows both are non-null here due to above checks
  if (oursTimestamp!.getTime() > theirsTimestamp!.getTime()) {
    return conflict.ours;
  } else if (theirsTimestamp!.getTime() > oursTimestamp!.getTime()) {
    return conflict.theirs;
  } else {
    // Timestamps are identical - prefer ours for stability
    return conflict.ours;
  }
}

/**
 * Resolve all conflicts in YAML content using latest-wins strategy
 *
 * Parses conflict markers, compares updated_at timestamps, and replaces
 * each conflict section with the winning version.
 *
 * @param content - YAML content with conflict markers
 * @returns ResolveResult with resolved content and stats
 *
 * @example
 * ```typescript
 * const yamlWithConflicts = `
 * id: i-abc123
 * <<<<<<< HEAD
 * title: Updated Title
 * updated_at: 2025-01-02T10:00:00Z
 * =======
 * title: Different Title
 * updated_at: 2025-01-01T10:00:00Z
 * >>>>>>> theirs
 * status: open
 * `;
 *
 * const result = resolveConflicts(yamlWithConflicts);
 * // result.content contains "title: Updated Title" (newer timestamp wins)
 * // result.conflictsResolved === 1
 * ```
 */
export function resolveConflicts(content: string): ResolveResult {
  const conflicts = parseConflicts(content);

  if (conflicts.length === 0) {
    return {
      hasConflicts: false,
      content,
      conflictsResolved: 0,
    };
  }

  // Process conflicts in reverse order to maintain line numbers
  const lines = content.split('\n');
  let resolvedCount = 0;

  for (let i = conflicts.length - 1; i >= 0; i--) {
    const conflict = conflicts[i];
    const resolvedContent = resolveConflict(conflict);

    // Replace conflict section with resolved content
    // Split resolved content into lines for splicing
    const resolvedLines = resolvedContent.split('\n');

    // Remove conflict markers and content, insert resolved version
    // +1 to include the end marker line
    lines.splice(conflict.startLine, conflict.endLine - conflict.startLine + 1, ...resolvedLines);

    resolvedCount++;
  }

  return {
    hasConflicts: true,
    content: lines.join('\n'),
    conflictsResolved: resolvedCount,
  };
}
