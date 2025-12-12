/**
 * Spec Writer for Spec-Kit Integration
 *
 * Updates spec.md and plan.md content while preserving document structure.
 * Handles title updates in headers and status line updates.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { dirname, basename } from "path";
import { mkdirSync } from "fs";

/**
 * Updates to apply to a spec file
 */
export interface SpecUpdates {
  /** New title (will update # header) */
  title?: string;
  /** New status (will update **Status**: line) */
  status?: string;
  /** New content (will replace everything after frontmatter/header) */
  content?: string;
}

/**
 * Result of a spec update operation
 */
export interface SpecUpdateResult {
  success: boolean;
  error?: string;
  changes: {
    title?: { from: string; to: string };
    status?: { from: string; to: string };
    content?: boolean;
  };
}

/**
 * Parsed structure of a spec-kit markdown file
 */
interface ParsedSpecFile {
  /** Original raw content */
  raw: string;
  /** Lines array */
  lines: string[];
  /** Index of the title line (# header) */
  titleLineIndex: number | null;
  /** Current title (without #) */
  currentTitle: string | null;
  /** Index of the status line */
  statusLineIndex: number | null;
  /** Current status value */
  currentStatus: string | null;
  /** Index where content starts (after header/metadata) */
  contentStartIndex: number;
}

/**
 * Regex patterns for spec-kit markdown structure
 */
const TITLE_REGEX = /^#\s+(.+)$/;
const STATUS_REGEX = /^\*\*Status\*\*:\s*(.*)$/i;
const METADATA_LINE_REGEX = /^\*\*[^*]+\*\*:/;

/**
 * Update spec content while preserving document structure
 *
 * @param specFilePath - Absolute path to the spec.md or plan.md file
 * @param updates - Updates to apply (title, status, content)
 * @returns Result of the update operation
 *
 * @example
 * // Update just the status
 * updateSpecContent("/project/.specify/specs/001-auth/spec.md", {
 *   status: "In Progress"
 * });
 *
 * // Update title and status
 * updateSpecContent("/project/.specify/specs/001-auth/spec.md", {
 *   title: "Authentication System",
 *   status: "Complete"
 * });
 */
export function updateSpecContent(
  specFilePath: string,
  updates: SpecUpdates
): SpecUpdateResult {
  const result: SpecUpdateResult = {
    success: false,
    changes: {},
  };

  // Validate inputs
  if (!specFilePath) {
    result.error = "Spec file path is required";
    return result;
  }

  if (!updates.title && !updates.status && updates.content === undefined) {
    result.error = "At least one update (title, status, or content) is required";
    return result;
  }

  // Check if file exists
  if (!existsSync(specFilePath)) {
    result.error = `Spec file not found: ${specFilePath}`;
    return result;
  }

  try {
    // Parse the file
    const parsed = parseSpecFile(specFilePath);
    const lines = [...parsed.lines];

    // Apply title update
    if (updates.title !== undefined && updates.title !== parsed.currentTitle) {
      if (parsed.titleLineIndex !== null) {
        lines[parsed.titleLineIndex] = `# ${updates.title}`;
        result.changes.title = {
          from: parsed.currentTitle || "",
          to: updates.title,
        };
      } else {
        // No title found, prepend one
        lines.unshift(`# ${updates.title}`, "");
        result.changes.title = {
          from: "",
          to: updates.title,
        };
      }
    }

    // Apply status update
    if (updates.status !== undefined && updates.status !== parsed.currentStatus) {
      if (parsed.statusLineIndex !== null) {
        lines[parsed.statusLineIndex] = `**Status**: ${updates.status}`;
        result.changes.status = {
          from: parsed.currentStatus || "",
          to: updates.status,
        };
      } else {
        // No status found, insert after title or at start
        const insertIndex =
          parsed.titleLineIndex !== null ? parsed.titleLineIndex + 1 : 0;

        // Make sure there's a blank line before status if inserting after title
        if (parsed.titleLineIndex !== null && lines[insertIndex]?.trim() !== "") {
          lines.splice(insertIndex, 0, "");
        }
        lines.splice(insertIndex + 1, 0, `**Status**: ${updates.status}`);
        result.changes.status = {
          from: "",
          to: updates.status,
        };
      }
    }

    // Apply content update
    if (updates.content !== undefined) {
      // Recalculate content start after possible line shifts
      const recalculated = recalculateContentStart(lines);

      // Remove everything from content start
      lines.splice(recalculated.contentStartIndex);

      // Add new content with proper spacing
      if (recalculated.contentStartIndex > 0 && !lines[lines.length - 1]?.trim()) {
        // Already has blank line
      } else {
        lines.push("");
      }

      // Add the new content
      lines.push(updates.content);

      result.changes.content = true;
    }

    // Write the updated content atomically
    const updatedContent = lines.join("\n");
    writeFileAtomic(specFilePath, updatedContent);

    result.success = true;
    return result;
  } catch (error) {
    result.error = `Failed to update spec: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

/**
 * Get the current title from a spec file
 *
 * @param specFilePath - Absolute path to the spec file
 * @returns The title or null if not found
 */
export function getSpecTitle(specFilePath: string): string | null {
  if (!existsSync(specFilePath)) {
    return null;
  }

  try {
    const parsed = parseSpecFile(specFilePath);
    return parsed.currentTitle;
  } catch {
    return null;
  }
}

/**
 * Get the current status from a spec file
 *
 * @param specFilePath - Absolute path to the spec file
 * @returns The status or null if not found
 */
export function getSpecStatus(specFilePath: string): string | null {
  if (!existsSync(specFilePath)) {
    return null;
  }

  try {
    const parsed = parseSpecFile(specFilePath);
    return parsed.currentStatus;
  } catch {
    return null;
  }
}

/**
 * Parse a spec-kit markdown file to extract structure
 */
function parseSpecFile(filePath: string): ParsedSpecFile {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");

  let titleLineIndex: number | null = null;
  let currentTitle: string | null = null;
  let statusLineIndex: number | null = null;
  let currentStatus: string | null = null;
  let contentStartIndex = 0;
  let foundFirstContent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for title (# header)
    if (titleLineIndex === null) {
      const titleMatch = line.match(TITLE_REGEX);
      if (titleMatch) {
        titleLineIndex = i;
        currentTitle = titleMatch[1].trim();
        continue;
      }
    }

    // Look for status line
    if (statusLineIndex === null) {
      const statusMatch = line.match(STATUS_REGEX);
      if (statusMatch) {
        statusLineIndex = i;
        currentStatus = statusMatch[1].trim();
        continue;
      }
    }

    // Track metadata section (lines starting with **Key**:)
    if (METADATA_LINE_REGEX.test(line)) {
      continue;
    }

    // Track where content starts (first non-empty, non-metadata line after title)
    if (!foundFirstContent && titleLineIndex !== null && line.trim() !== "") {
      // Skip if this is still in metadata section
      if (!METADATA_LINE_REGEX.test(line)) {
        contentStartIndex = i;
        foundFirstContent = true;
      }
    }
  }

  // If no content found, start after metadata
  if (!foundFirstContent) {
    contentStartIndex = lines.length;
  }

  return {
    raw,
    lines,
    titleLineIndex,
    currentTitle,
    statusLineIndex,
    currentStatus,
    contentStartIndex,
  };
}

/**
 * Recalculate content start index after modifications
 */
function recalculateContentStart(lines: string[]): { contentStartIndex: number } {
  let titleLineIndex: number | null = null;
  let lastMetadataIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find title
    if (titleLineIndex === null && TITLE_REGEX.test(line)) {
      titleLineIndex = i;
    }

    // Track metadata lines
    if (METADATA_LINE_REGEX.test(line)) {
      lastMetadataIndex = i;
    }
  }

  // Content starts after the last metadata line (or after title if no metadata)
  // Skip any blank lines too
  let contentStartIndex = Math.max(
    titleLineIndex !== null ? titleLineIndex + 1 : 0,
    lastMetadataIndex + 1
  );

  // Skip blank lines after metadata
  while (contentStartIndex < lines.length && lines[contentStartIndex]?.trim() === "") {
    contentStartIndex++;
  }

  return { contentStartIndex };
}

/**
 * Write file atomically using temp file + rename pattern
 */
function writeFileAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tempPath, content, "utf-8");

  // Rename is atomic on most file systems
  renameSync(tempPath, filePath);
}
