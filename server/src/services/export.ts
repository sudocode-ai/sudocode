/**
 * Export service - handles syncing database to JSONL and Markdown files
 */

import type Database from "better-sqlite3";
import { exportToJSONL } from "@sudocode-ai/cli/dist/export.js";
import { syncJSONLToMarkdown } from "@sudocode-ai/cli/dist/sync.js";
import { getSudocodeDir } from "../utils/sudocode-dir.js";
import * as path from "path";

// Global debouncer state (keyed by database instance)
const exportDebouncers = new WeakMap<
  Database.Database,
  {
    timeoutId: NodeJS.Timeout | null;
    pending: boolean;
    outputDir?: string;
  }
>();

/**
 * Initialize or get the export debouncer for a specific database
 */
function getExportDebouncer(db: Database.Database) {
  let debouncer = exportDebouncers.get(db);
  if (!debouncer) {
    debouncer = {
      timeoutId: null,
      pending: false,
    };
    exportDebouncers.set(db, debouncer);
  }
  return debouncer;
}

/**
 * Execute the full export (JSONL only)
 * Note: Markdown files are not updated here to avoid triggering mass file changes.
 * Markdown updates should happen through the watcher's reverse sync if enabled,
 * or through explicit sync commands.
 */
async function executeFullExport(db: Database.Database, outputDir?: string): Promise<void> {
  const dir = outputDir || getSudocodeDir();

  // Export to JSONL only
  await exportToJSONL(db, { outputDir: dir });

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
  entityType: "spec" | "issue",
  outputDir?: string
): Promise<void> {
  const dir = outputDir || getSudocodeDir();

  if (entityType === "issue") {
    const { getIssueById } = await import("./issues.js");
    const issue = getIssueById(db, entityId);
    if (issue) {
      const mdPath = path.join(dir, "issues", `${issue.id}.md`);
      await syncJSONLToMarkdown(db, issue.id, "issue", mdPath);
    }
  } else {
    const { getSpecById } = await import("./specs.js");
    const spec = getSpecById(db, entityId);
    if (spec) {
      const mdPath = spec.file_path
        ? path.join(dir, spec.file_path)
        : path.join(dir, "specs", `${spec.id}.md`);
      await syncJSONLToMarkdown(db, spec.id, "spec", mdPath);
    }
  }
}

/**
 * Trigger an export to JSONL and Markdown files (debounced)
 * This should be called after any database modifications
 *
 * @param db - Database instance
 * @param outputDir - Optional output directory (defaults to getSudocodeDir())
 */
export function triggerExport(db: Database.Database, outputDir?: string): void {
  const debouncer = getExportDebouncer(db);
  debouncer.pending = true;
  if (outputDir) {
    debouncer.outputDir = outputDir;
  }

  if (debouncer.timeoutId) {
    clearTimeout(debouncer.timeoutId);
  }

  debouncer.timeoutId = setTimeout(async () => {
    try {
      await executeFullExport(db, debouncer.outputDir);
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      // Reset debouncer state after export completes
      debouncer.pending = false;
      debouncer.timeoutId = null;
    }
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
 *
 * Note: With WeakMap-based debouncers, this is now a no-op since
 * debouncers are automatically garbage collected when the database is closed
 */
export function cleanupExport(): void {
  // No-op: debouncers are now per-database and will be GC'd automatically
  // Kept for backward compatibility
}
