/**
 * Shared Markdown Utilities for OpenSpec Parsing
 *
 * Common regex patterns and helper functions for extracting
 * metadata from OpenSpec markdown files.
 */

/**
 * Regex patterns for common markdown elements in OpenSpec files
 */
export const PATTERNS = {
  /** Match H1 title: # Title */
  TITLE: /^#\s+(.+)$/,

  /** Match title with prefix: # Feature Specification: Title */
  TITLE_WITH_PREFIX: /^#\s+(?:Feature Specification|Implementation Plan):\s*(.+)$/i,

  /** Match metadata line: **Key**: Value */
  METADATA: /^\*\*([^*]+)\*\*:\s*(.*)$/,

  /** Match status metadata: **Status**: Value */
  STATUS: /^\*\*Status\*\*:\s*(.*)$/i,

  /** Match feature branch metadata: **Feature Branch**: Value */
  FEATURE_BRANCH: /^\*\*Feature Branch\*\*:\s*(.*)$/i,

  /** Match branch metadata: **Branch**: Value */
  BRANCH: /^\*\*Branch\*\*:\s*(.*)$/i,

  /** Match created date metadata: **Created**: Value */
  CREATED: /^\*\*Created\*\*:\s*(.*)$/i,

  /** Match spec link metadata: **Spec**: [[link]] or **Spec**: link */
  SPEC_LINK: /^\*\*Spec\*\*:\s*(?:\[\[)?([^\]]+)(?:\]\])?$/i,

  /** Match cross-reference: [[id]] or [[id|display]] */
  CROSS_REFERENCE: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,

  /** Match task line: - [ ] T001 [P] [US1] Description or - [x] T001: Description */
  TASK_LINE: /^(\s*)-\s*\[([ xX])\]\s*(T\d+)(.*)$/,

  /** Match parallelizable marker: [P] */
  PARALLELIZABLE: /\[P\]/i,

  /** Match user story marker: [US1], [US2], etc. */
  USER_STORY: /\[US(\d+)\]/i,

  /** Match phase header: ## Phase N: Name or ### Phase N */
  PHASE_HEADER: /^#{2,3}\s+Phase\s+(\d+)(?::\s*(.+))?$/i,

  /** Match section header: ## Section Name */
  SECTION_HEADER: /^(#{2,6})\s+(.+)$/,

  /** Match date format: YYYY-MM-DD */
  DATE: /^\d{4}-\d{2}-\d{2}$/,

  /** Match ISO date with time */
  ISO_DATE: /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/,
};

/**
 * Extract all metadata from a markdown file's lines
 *
 * @param lines - Array of file lines
 * @returns Map of metadata key-value pairs
 *
 * @example
 * const lines = [
 *   "# Title",
 *   "",
 *   "**Status**: Draft",
 *   "**Created**: 2024-01-01",
 * ];
 * extractMetadata(lines);
 * // Map { "Status" => "Draft", "Created" => "2024-01-01" }
 */
export function extractMetadata(lines: string[]): Map<string, string> {
  const metadata = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(PATTERNS.METADATA);
    if (match) {
      const [, key, value] = match;
      metadata.set(key.trim(), value.trim());
    }
  }

  return metadata;
}

/**
 * Extract the title from markdown content
 *
 * @param lines - Array of file lines
 * @returns The title text or null if not found
 */
export function extractTitle(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(PATTERNS.TITLE);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Extract title with optional prefix removal
 *
 * @param lines - Array of file lines
 * @param prefixes - Optional prefixes to remove (e.g., ["Feature Specification:", "Implementation Plan:"])
 * @returns The clean title text or null
 */
export function extractTitleWithPrefixRemoval(
  lines: string[],
  prefixes: string[] = []
): string | null {
  const rawTitle = extractTitle(lines);
  if (!rawTitle) return null;

  // Try to match and remove known prefixes
  for (const prefix of prefixes) {
    const prefixLower = prefix.toLowerCase();
    if (rawTitle.toLowerCase().startsWith(prefixLower)) {
      const remainder = rawTitle.slice(prefix.length).trim();
      // Remove leading colon if present
      return remainder.startsWith(":") ? remainder.slice(1).trim() : remainder;
    }
  }

  return rawTitle;
}

/**
 * Extract a specific metadata value by key (case-insensitive)
 *
 * @param lines - Array of file lines
 * @param key - The metadata key to find
 * @returns The value or null if not found
 */
export function extractMetadataValue(
  lines: string[],
  key: string
): string | null {
  const keyLower = key.toLowerCase();

  for (const line of lines) {
    const match = line.match(PATTERNS.METADATA);
    if (match && match[1].trim().toLowerCase() === keyLower) {
      return match[2].trim();
    }
  }

  return null;
}

/**
 * Extract all cross-references from markdown content
 *
 * @param content - The full markdown content as a string
 * @returns Array of cross-reference objects
 */
export function extractCrossReferences(
  content: string
): Array<{ id: string; displayText?: string }> {
  const references: Array<{ id: string; displayText?: string }> = [];
  const regex = new RegExp(PATTERNS.CROSS_REFERENCE.source, "g");

  let match;
  while ((match = regex.exec(content)) !== null) {
    references.push({
      id: match[1].trim(),
      displayText: match[2]?.trim(),
    });
  }

  return references;
}

/**
 * Find the line index where the main content starts (after metadata)
 *
 * @param lines - Array of file lines
 * @returns Index of the first content line
 */
export function findContentStartIndex(lines: string[]): number {
  let titleFound = false;
  let lastMetadataIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track title
    if (!titleFound && PATTERNS.TITLE.test(line)) {
      titleFound = true;
      continue;
    }

    // Track metadata lines
    if (PATTERNS.METADATA.test(line)) {
      lastMetadataIndex = i;
      continue;
    }

    // Skip blank lines after metadata
    if (line.trim() === "") {
      continue;
    }

    // If we're past the title and metadata, this is content start
    if (titleFound && i > lastMetadataIndex) {
      return i;
    }
  }

  // Return end of file if no content found
  return lines.length;
}

/**
 * Extract section content by header
 *
 * @param lines - Array of file lines
 * @param sectionName - Name of the section to extract
 * @param headerLevel - Header level (2-6, default 2 for ##)
 * @returns Section content as array of lines, or null if not found
 */
export function extractSection(
  lines: string[],
  sectionName: string,
  headerLevel: number = 2
): string[] | null {
  const headerPrefix = "#".repeat(headerLevel);
  const sectionRegex = new RegExp(
    `^${headerPrefix}\\s+${escapeRegex(sectionName)}\\s*$`,
    "i"
  );
  const nextHeaderRegex = new RegExp(`^#{1,${headerLevel}}\\s+`);

  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (sectionStart === -1) {
      // Looking for section start
      if (sectionRegex.test(line)) {
        sectionStart = i + 1; // Start after header
      }
    } else {
      // Looking for section end (next header at same or higher level)
      if (nextHeaderRegex.test(line)) {
        sectionEnd = i;
        break;
      }
    }
  }

  if (sectionStart === -1) {
    return null;
  }

  return lines.slice(sectionStart, sectionEnd);
}

/**
 * Parse a date string from various formats
 *
 * @param dateStr - Date string to parse
 * @returns Date object or null if invalid
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try ISO format first
  if (PATTERNS.ISO_DATE.test(dateStr)) {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try simple date format
  if (PATTERNS.DATE.test(dateStr)) {
    const date = new Date(dateStr + "T00:00:00");
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

/**
 * Escape special regex characters in a string
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in regex
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Clean task description by removing markers
 *
 * @param description - Raw task description
 * @returns Cleaned description
 */
export function cleanTaskDescription(description: string): string {
  return description
    .replace(PATTERNS.PARALLELIZABLE, "")
    .replace(PATTERNS.USER_STORY, "")
    .replace(/^\s*:\s*/, "") // Remove leading colon with surrounding whitespace
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Normalize status string to a consistent format
 *
 * @param status - Raw status string
 * @returns Normalized status
 */
export function normalizeStatus(status: string): string {
  const statusLower = status.toLowerCase().trim();

  const statusMap: Record<string, string> = {
    draft: "Draft",
    "in progress": "In Progress",
    "in-progress": "In Progress",
    inprogress: "In Progress",
    blocked: "Blocked",
    complete: "Complete",
    completed: "Complete",
    done: "Complete",
    review: "Review",
    "needs review": "Needs Review",
    "needs-review": "Needs Review",
    approved: "Approved",
  };

  return statusMap[statusLower] || status;
}
