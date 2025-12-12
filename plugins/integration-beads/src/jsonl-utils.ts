/**
 * JSONL utilities for Beads plugin
 *
 * Provides atomic read/write operations for .beads/issues.jsonl files.
 * Used as fallback when Beads CLI is not available.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

/**
 * Beads issue structure (minimal fields we need)
 * Note: Beads uses 'description' while sudocode uses 'content'
 */
export interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  created_at: string;
  updated_at: string;
  // Allow additional beads-specific fields
  [key: string]: unknown;
}

/**
 * Read all issues from a beads JSONL file
 *
 * @param filePath - Path to issues.jsonl
 * @param options - Read options
 * @returns Array of parsed issues
 */
export function readBeadsJSONL(
  filePath: string,
  options: { skipErrors?: boolean } = {}
): BeadsIssue[] {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const issues: BeadsIssue[] = [];

    for (const line of lines) {
      try {
        const issue = JSON.parse(line) as BeadsIssue;
        issues.push(issue);
      } catch (parseError) {
        if (!options.skipErrors) {
          throw parseError;
        }
        // Skip malformed lines when skipErrors is true
      }
    }

    return issues;
  } catch (error) {
    if (options.skipErrors) {
      return [];
    }
    throw error;
  }
}

/**
 * Write issues to a beads JSONL file atomically
 *
 * Features:
 * - Atomic write (temp file + rename)
 * - Sorted by created_at to minimize git merge conflicts
 * - Skips write if content unchanged (prevents watcher loops)
 *
 * @param filePath - Path to issues.jsonl
 * @param issues - Array of issues to write
 */
export function writeBeadsJSONL(filePath: string, issues: BeadsIssue[]): void {
  console.log(`[beads-jsonl] writeBeadsJSONL called with ${issues.length} issue(s)`);

  // Sort by created_at for consistent ordering (minimizes merge conflicts)
  const sortedIssues = [...issues].sort((a, b) => {
    const aDate = a.created_at || "";
    const bDate = b.created_at || "";

    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;

    // Fallback to ID comparison
    return (a.id || "").localeCompare(b.id || "");
  });

  // Build content
  const content = sortedIssues.map((issue) => JSON.stringify(issue)).join("\n");

  // Skip write if content unchanged (prevents watcher loops)
  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, "utf-8");
    if (existingContent.trim() === content.trim()) {
      console.log(`[beads-jsonl] Content unchanged, skipping write`);
      return; // No changes
    }
    console.log(`[beads-jsonl] Content changed, proceeding with write`);
  } else {
    console.log(`[beads-jsonl] File doesn't exist, creating new file`);
  }

  // Atomic write: write to temp file, then rename
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, content + "\n", "utf-8");
  renameSync(tempPath, filePath);
  console.log(`[beads-jsonl] Successfully wrote to ${filePath}`);
}

/**
 * Generate a beads-style ID
 *
 * Beads uses IDs like "beads-a1b2c3d4"
 *
 * @param prefix - ID prefix (default: "beads")
 * @returns Generated ID
 */
export function generateBeadsId(prefix: string = "beads"): string {
  const random = randomBytes(4).toString("hex");
  return `${prefix}-${random}`;
}

/**
 * Create a new issue in the JSONL file
 *
 * @param beadsDir - Path to .beads directory
 * @param issue - Issue data to create
 * @param idPrefix - Prefix for generated ID
 * @returns The created issue with generated ID
 */
export function createIssueViaJSONL(
  beadsDir: string,
  issue: Partial<BeadsIssue>,
  idPrefix: string = "beads"
): BeadsIssue {
  const issuesPath = path.join(beadsDir, "issues.jsonl");
  const issues = readBeadsJSONL(issuesPath, { skipErrors: true });

  const now = new Date().toISOString();
  const newIssue: BeadsIssue = {
    id: generateBeadsId(idPrefix),
    title: issue.title || "Untitled",
    description: issue.description || "",
    status: issue.status || "open",
    priority: issue.priority ?? 2,
    created_at: issue.created_at || now,
    updated_at: issue.updated_at || now,
    ...issue, // Allow additional fields to pass through
  };

  // Ensure ID is from our generator, not passed in
  newIssue.id = generateBeadsId(idPrefix);

  issues.push(newIssue);
  writeBeadsJSONL(issuesPath, issues);

  return newIssue;
}

/**
 * Update an existing issue in the JSONL file
 *
 * @param beadsDir - Path to .beads directory
 * @param issueId - ID of issue to update
 * @param updates - Fields to update
 * @returns The updated issue
 * @throws Error if issue not found
 */
export function updateIssueViaJSONL(
  beadsDir: string,
  issueId: string,
  updates: Partial<BeadsIssue>
): BeadsIssue {
  console.log(`[beads-jsonl] updateIssueViaJSONL called for ${issueId} with updates:`, JSON.stringify(updates));

  const issuesPath = path.join(beadsDir, "issues.jsonl");
  const issues = readBeadsJSONL(issuesPath, { skipErrors: true });

  const index = issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    console.error(`[beads-jsonl] Issue not found: ${issueId}`);
    throw new Error(`Beads issue not found: ${issueId}`);
  }

  console.log(`[beads-jsonl] Found issue at index ${index}, current status: ${issues[index].status}`);

  // Merge updates, preserving beads-specific fields
  const updatedIssue: BeadsIssue = {
    ...issues[index],
    ...updates,
    id: issueId, // Preserve original ID
    updated_at: new Date().toISOString(),
  };

  console.log(`[beads-jsonl] Merged issue, new status: ${updatedIssue.status}`);

  issues[index] = updatedIssue;
  writeBeadsJSONL(issuesPath, issues);
  console.log(`[beads-jsonl] Wrote issues back to ${issuesPath}`);

  return updatedIssue;
}

/**
 * Delete an issue from the JSONL file
 *
 * @param beadsDir - Path to .beads directory
 * @param issueId - ID of issue to delete
 * @returns True if deleted, false if not found
 */
export function deleteIssueViaJSONL(beadsDir: string, issueId: string): boolean {
  const issuesPath = path.join(beadsDir, "issues.jsonl");
  const issues = readBeadsJSONL(issuesPath, { skipErrors: true });

  const originalLength = issues.length;
  const filtered = issues.filter((i) => i.id !== issueId);

  if (filtered.length === originalLength) {
    return false; // Not found
  }

  writeBeadsJSONL(issuesPath, filtered);
  return true;
}

/**
 * Get a single issue by ID
 *
 * @param beadsDir - Path to .beads directory
 * @param issueId - ID of issue to find
 * @returns The issue or null if not found
 */
export function getIssueById(
  beadsDir: string,
  issueId: string
): BeadsIssue | null {
  const issuesPath = path.join(beadsDir, "issues.jsonl");
  const issues = readBeadsJSONL(issuesPath, { skipErrors: true });
  return issues.find((i) => i.id === issueId) || null;
}
