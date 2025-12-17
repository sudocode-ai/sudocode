/**
 * OpenSpec Change Parser
 *
 * Parses OpenSpec change directories from `openspec/changes/[name]/`.
 *
 * OpenSpec change directory structure:
 * ```
 * changes/add-scaffold-command/
 * ├── proposal.md          # ## Why, ## What Changes, ## Impact
 * ├── tasks.md             # Checkbox tasks
 * └── specs/               # Delta directories for affected specs
 *     └── cli-scaffold/
 * ```
 *
 * Archive directory pattern:
 * ```
 * changes/archive/YYYY-MM-DD-[name]/
 * ```
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import * as path from "path";
import { extractSection } from "./markdown-utils.js";
import {
  parseTasks as parseTasksFile,
  calculateCompletionPercentage,
  type ParsedTask,
} from "./tasks-parser.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A fully parsed OpenSpec change
 */
export interface ParsedOpenSpecChange {
  /** Directory name (e.g., "add-scaffold-command") */
  name: string;
  /** From "## What Changes" first line or dir name */
  title: string;
  /** From ## Why section */
  why?: string;
  /** From ## What Changes section */
  whatChanges?: string;
  /** From ## Impact section */
  impact?: string;
  /** From tasks.md */
  tasks: ParsedTask[];
  /** 0-100 percentage */
  taskCompletion: number;
  /** From specs/[cap]/ delta directories */
  affectedSpecs: string[];
  /** Whether the change is in the archive directory */
  isArchived: boolean;
  /** From archive/YYYY-MM-DD-name/ pattern */
  archivedAt?: Date;
  /** Absolute path to the change directory */
  filePath: string;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * OpenSpec change-specific patterns
 */
export const CHANGE_PATTERNS = {
  /** Match archive directory pattern: YYYY-MM-DD-name */
  ARCHIVE_DATE: /^(\d{4}-\d{2}-\d{2})-(.+)$/,
};

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse an OpenSpec change directory
 *
 * @param dirPath - Absolute path to the change directory
 * @returns Parsed change object
 * @throws Error if directory does not exist
 *
 * @example
 * const change = parseChangeDirectory("/path/to/openspec/changes/add-feature");
 * console.log(change.title);         // "Add scaffold command"
 * console.log(change.taskCompletion); // 75
 * console.log(change.affectedSpecs); // ["cli-scaffold"]
 */
export function parseChangeDirectory(dirPath: string): ParsedOpenSpecChange {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    throw new Error(`Change directory not found: ${dirPath}`);
  }

  // Extract name from directory path
  const name = extractChangeName(dirPath);

  // Check if archived
  const { isArchived, archivedAt } = detectArchiveStatus(dirPath);

  // Parse proposal.md
  const proposalPath = path.join(dirPath, "proposal.md");
  const { why, whatChanges, impact, title } = parseProposal(proposalPath, name);

  // Parse tasks.md
  const tasksPath = path.join(dirPath, "tasks.md");
  const { tasks, taskCompletion } = parseChangeTasks(tasksPath);

  // Scan specs/ subdirectory for affected specs
  const affectedSpecs = scanAffectedSpecs(dirPath);

  return {
    name,
    title,
    why,
    whatChanges,
    impact,
    tasks,
    taskCompletion,
    affectedSpecs,
    isArchived,
    archivedAt,
    filePath: dirPath,
  };
}

/**
 * Extract the change name from the directory path
 *
 * Handles both active changes and archived changes:
 * - changes/add-feature/ → "add-feature"
 * - changes/archive/2024-01-15-add-feature/ → "add-feature"
 *
 * @param dirPath - Path to the change directory
 * @returns Change name
 */
export function extractChangeName(dirPath: string): string {
  const dirName = path.basename(dirPath);

  // Check if this is an archived change with date prefix
  const archiveMatch = dirName.match(CHANGE_PATTERNS.ARCHIVE_DATE);
  if (archiveMatch) {
    return archiveMatch[2]; // Return name without date prefix
  }

  return dirName;
}

/**
 * Detect if a change is archived and extract archive date
 *
 * @param dirPath - Path to the change directory
 * @returns Archive status and date
 */
export function detectArchiveStatus(dirPath: string): {
  isArchived: boolean;
  archivedAt?: Date;
} {
  // Check if the path contains /archive/
  const normalizedPath = dirPath.replace(/\\/g, "/");
  const isArchived = normalizedPath.includes("/archive/");

  if (!isArchived) {
    return { isArchived: false };
  }

  // Try to extract date from directory name
  const dirName = path.basename(dirPath);
  const archiveMatch = dirName.match(CHANGE_PATTERNS.ARCHIVE_DATE);

  if (archiveMatch) {
    const dateStr = archiveMatch[1];
    const archivedAt = new Date(dateStr + "T00:00:00");
    if (!isNaN(archivedAt.getTime())) {
      return { isArchived: true, archivedAt };
    }
  }

  return { isArchived: true };
}

/**
 * Parse the proposal.md file for a change
 *
 * @param filePath - Path to proposal.md
 * @param fallbackName - Name to use as title fallback
 * @returns Extracted sections
 */
export function parseProposal(
  filePath: string,
  fallbackName: string
): {
  why?: string;
  whatChanges?: string;
  impact?: string;
  title: string;
} {
  if (!existsSync(filePath)) {
    return { title: formatTitle(fallbackName) };
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Extract ## Why section
    const whyLines = extractSection(lines, "Why", 2);
    const why = whyLines ? whyLines.join("\n").trim() : undefined;

    // Extract ## What Changes section
    const whatChangesLines = extractSection(lines, "What Changes", 2);
    const whatChanges = whatChangesLines
      ? whatChangesLines.join("\n").trim()
      : undefined;

    // Extract ## Impact section
    const impactLines = extractSection(lines, "Impact", 2);
    const impact = impactLines ? impactLines.join("\n").trim() : undefined;

    // Extract title from "What Changes" first line, or fall back to dir name
    const title = extractTitleFromWhatChanges(whatChanges) || formatTitle(fallbackName);

    return { why, whatChanges, impact, title };
  } catch (error) {
    console.error(`[change-parser] Failed to parse ${filePath}:`, error);
    return { title: formatTitle(fallbackName) };
  }
}

/**
 * Extract title from the "What Changes" section
 *
 * The title is the first non-empty line, with bullet prefix removed
 *
 * @param whatChanges - Content of the What Changes section
 * @returns Extracted title or undefined
 */
export function extractTitleFromWhatChanges(
  whatChanges?: string
): string | undefined {
  if (!whatChanges) return undefined;

  const lines = whatChanges.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Remove bullet prefix if present (- or *)
    const withoutBullet = trimmed.replace(/^[-*]\s*/, "");

    // Return first meaningful content
    if (withoutBullet.length > 0) {
      return withoutBullet;
    }
  }

  return undefined;
}

/**
 * Format a directory name as a human-readable title
 *
 * @param name - Directory name (e.g., "add-scaffold-command")
 * @returns Formatted title (e.g., "Add scaffold command")
 */
export function formatTitle(name: string): string {
  // Replace hyphens and underscores with spaces
  const spaced = name.replace(/[-_]/g, " ");

  // Capitalize first letter
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Parse tasks.md file for a change
 *
 * @param filePath - Path to tasks.md
 * @returns Tasks and completion percentage
 */
export function parseChangeTasks(filePath: string): {
  tasks: ParsedTask[];
  taskCompletion: number;
} {
  const result = parseTasksFile(filePath);

  if (!result) {
    return { tasks: [], taskCompletion: 0 };
  }

  return {
    tasks: result.tasks,
    taskCompletion: result.completionPercentage,
  };
}

/**
 * Scan the specs/ subdirectory for affected spec delta directories
 *
 * @param dirPath - Path to the change directory
 * @returns Array of affected spec names
 */
export function scanAffectedSpecs(dirPath: string): string[] {
  const specsDir = path.join(dirPath, "specs");

  if (!existsSync(specsDir) || !statSync(specsDir).isDirectory()) {
    return [];
  }

  try {
    const entries = readdirSync(specsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    console.error(`[change-parser] Failed to scan specs directory:`, error);
    return [];
  }
}

/**
 * Check if a directory appears to be a valid OpenSpec change directory
 *
 * A valid change directory contains at least one of:
 * - proposal.md
 * - tasks.md
 * - design.md
 *
 * @param dirPath - Path to check
 * @returns true if the directory looks like a change directory
 */
export function isChangeDirectory(dirPath: string): boolean {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return false;
  }

  // Check for characteristic files
  const hasProposal = existsSync(path.join(dirPath, "proposal.md"));
  const hasTasks = existsSync(path.join(dirPath, "tasks.md"));
  const hasDesign = existsSync(path.join(dirPath, "design.md"));

  return hasProposal || hasTasks || hasDesign;
}

/**
 * Scan a directory for all change directories
 *
 * @param basePath - Path to the changes/ directory
 * @param includeArchived - Whether to include archived changes
 * @returns Array of change directory paths
 */
export function scanChangeDirectories(
  basePath: string,
  includeArchived: boolean = true
): string[] {
  if (!existsSync(basePath) || !statSync(basePath).isDirectory()) {
    return [];
  }

  const changes: string[] = [];

  try {
    const entries = readdirSync(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const entryPath = path.join(basePath, entry.name);

      if (entry.name === "archive") {
        // Scan archive subdirectory
        if (includeArchived) {
          const archivedChanges = scanArchivedChanges(entryPath);
          changes.push(...archivedChanges);
        }
      } else if (isChangeDirectory(entryPath)) {
        changes.push(entryPath);
      }
    }
  } catch (error) {
    console.error(`[change-parser] Failed to scan changes directory:`, error);
  }

  return changes;
}

/**
 * Scan the archive directory for archived changes
 *
 * @param archivePath - Path to the archive/ directory
 * @returns Array of archived change directory paths
 */
function scanArchivedChanges(archivePath: string): string[] {
  if (!existsSync(archivePath) || !statSync(archivePath).isDirectory()) {
    return [];
  }

  try {
    const entries = readdirSync(archivePath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => isChangeDirectory(path.join(archivePath, entry.name)))
      .map((entry) => path.join(archivePath, entry.name));
  } catch (error) {
    console.error(`[change-parser] Failed to scan archive directory:`, error);
    return [];
  }
}

/**
 * Parse all changes in a directory
 *
 * @param basePath - Path to the changes/ directory
 * @param includeArchived - Whether to include archived changes
 * @returns Array of parsed changes
 */
export function parseAllChanges(
  basePath: string,
  includeArchived: boolean = true
): ParsedOpenSpecChange[] {
  const changePaths = scanChangeDirectories(basePath, includeArchived);

  return changePaths.map((changePath) => {
    try {
      return parseChangeDirectory(changePath);
    } catch (error) {
      console.error(
        `[change-parser] Failed to parse change at ${changePath}:`,
        error
      );
      // Return a minimal change object for failed parses
      return {
        name: path.basename(changePath),
        title: formatTitle(path.basename(changePath)),
        tasks: [],
        taskCompletion: 0,
        affectedSpecs: [],
        isArchived: changePath.includes("/archive/"),
        filePath: changePath,
      };
    }
  });
}
