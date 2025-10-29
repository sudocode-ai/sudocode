/**
 * Export service - handles syncing database to JSONL and Markdown files
 */

import type Database from "better-sqlite3";
import { exportToJSONL } from "@sudocode/cli/dist/export.js";
import { syncJSONLToMarkdown } from "@sudocode/cli/dist/sync.js";
import { getSudocodeDir } from "../utils/sudocode-dir.js";
import * as path from "path";

// Global debouncer state
let exportDebouncer: {
  db: Database.Database;
  timeoutId: NodeJS.Timeout | null;
  pending: boolean;
} | null = null;

/**
 * Initialize or get the export debouncer
 */
function getExportDebouncer(db: Database.Database) {
  if (!exportDebouncer) {
    exportDebouncer = {
      db,
      timeoutId: null,
      pending: false,
    };
  }
  return exportDebouncer;
}

/**
 * Execute the full export (JSONL only)
 * Note: Markdown files are not updated here to avoid triggering mass file changes.
 * Markdown updates should happen through the watcher's reverse sync if enabled,
 * or through explicit sync commands.
 */
async function executeFullExport(db: Database.Database): Promise<void> {
  const outputDir = getSudocodeDir();

  // Export to JSONL only
  await exportToJSONL(db, { outputDir });

  // Note: We don't sync to markdown here because:
  // 1. It would update ALL markdown files on every change (inefficient)
  // 2. The watcher can handle reverse sync if enabled (JSONL → Markdown)
  // 3. For API updates, the markdown file will be updated when the watcher
  //    detects the JSONL change and does reverse sync
}

/**
 * Sync a single entity to its markdown file
 */
export async function syncEntityToMarkdown(
  db: Database.Database,
  entityId: string,
  entityType: "spec" | "issue"
): Promise<void> {
  const outputDir = getSudocodeDir();

  if (entityType === "issue") {
    const { getIssueById } = await import("./issues.js");
    const issue = getIssueById(db, entityId);
    if (issue) {
      const mdPath = path.join(outputDir, "issues", `${issue.id}.md`);
      await syncJSONLToMarkdown(db, issue.id, "issue", mdPath);
    }
  } else {
    const { getSpecById } = await import("./specs.js");
    const spec = getSpecById(db, entityId);
    if (spec) {
      const mdPath = spec.file_path
        ? path.join(outputDir, spec.file_path)
        : path.join(outputDir, "specs", `${spec.id}.md`);
      await syncJSONLToMarkdown(db, spec.id, "spec", mdPath);
    }
  }
}

/**
 * Trigger an export to JSONL and Markdown files (debounced)
 * This should be called after any database modifications
 */
export function triggerExport(db: Database.Database): void {
  const debouncer = getExportDebouncer(db);
  debouncer.pending = true;

  if (debouncer.timeoutId) {
    clearTimeout(debouncer.timeoutId);
  }

  debouncer.timeoutId = setTimeout(() => {
    executeFullExport(db).catch((error) => {
      console.error("Export failed:", error);
    });
  }, 2000); // 2 second debounce
}

/**
 * Execute export immediately (bypass debouncing)
 * Exports to both JSONL and Markdown files
 */
export async function executeExportNow(db: Database.Database): Promise<void> {
  await executeFullExport(db);
}

/**
 * Cleanup the export debouncer (cancel pending exports and reset)
 * Should be called when closing the database or during test cleanup
 */
export function cleanupExport(): void {
  if (exportDebouncer) {
    if (exportDebouncer.timeoutId) {
      clearTimeout(exportDebouncer.timeoutId);
    }
    exportDebouncer = null;
  }
}
