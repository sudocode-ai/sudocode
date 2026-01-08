/**
 * CLI handlers for sync commands
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";
import { exportToJSONL } from "../export.js";
import { importFromJSONL } from "../import.js";
import { startWatcher, setupGracefulShutdown } from "../watcher.js";
import { syncMarkdownToJSONL, syncJSONLToMarkdown } from "../sync.js";
import { listSpecs } from "../operations/specs.js";
import { listIssues } from "../operations/issues.js";
import {
  generateUniqueFilename,
  findExistingEntityFile,
} from "../filename-generator.js";
import { isInitialized, performInitialization } from "./init-commands.js";

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface SyncOptions {
  watch?: boolean;
  fromMarkdown?: boolean;
  toMarkdown?: boolean;
}

export async function handleSync(
  ctx: CommandContext,
  options: SyncOptions
): Promise<void> {
  // Check if sudocode is initialized, auto-initialize if not
  if (!isInitialized(ctx.outputDir)) {
    console.log(chalk.blue("Initializing sudocode..."));
    console.log();

    try {
      await performInitialization({
        dir: ctx.outputDir,
        jsonOutput: ctx.jsonOutput,
      });
    } catch (error) {
      console.error(chalk.red("✗ Auto-initialization failed"));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    console.log();
  }

  if (options.watch) {
    // Start file watcher
    console.log(chalk.blue("Starting file watcher..."));
    console.log(chalk.gray(`  Watching: ${ctx.outputDir}`));
    console.log(chalk.gray("  Press Ctrl+C to stop"));

    const control = startWatcher({
      db: ctx.db,
      baseDir: ctx.outputDir,
      syncJSONLToMarkdown: true,
      onLog: (message) => {
        if (!ctx.jsonOutput) {
          console.log(chalk.gray(message));
        }
      },
      onError: (error) => {
        console.error(chalk.red(`[watch] Error: ${error.message}`));
      },
    });

    // Setup graceful shutdown
    setupGracefulShutdown(control);

    // Keep process alive
    await new Promise(() => {
      // This promise never resolves - the process will exit via SIGINT/SIGTERM
    });
  } else if (options.fromMarkdown) {
    // Manual sync from markdown to database
    await handleSyncFromMarkdown(ctx);
  } else if (options.toMarkdown) {
    // Manual sync from database to markdown
    await handleSyncToMarkdown(ctx);
  } else {
    // Auto-detect sync direction based on file modification times
    // TODO: Independently handle sync direction from specs and issues.
    const { direction, reason } = determineSyncDirection(ctx);

    console.log(chalk.blue("Detecting sync direction..."));
    console.log(chalk.gray(`  ${reason}`));
    console.log();

    if (direction === "no-sync") {
      console.log(chalk.green("✓ Everything is in sync"));
      console.log(
        chalk.gray(
          "  Use --from-markdown or --to-markdown to force a specific direction"
        )
      );
    } else if (direction === "from-markdown") {
      console.log(
        chalk.blue("→ Syncing FROM markdown TO database (markdown is newer)")
      );
      console.log();
      await handleSyncFromMarkdown(ctx);
    } else if (direction === "to-markdown") {
      console.log(
        chalk.blue("→ Syncing FROM database TO markdown (database is newer)")
      );
      console.log();
      await handleSyncToMarkdown(ctx);
    }
  }
}

export interface ExportOptions {
  output: string;
}

export async function handleExport(
  ctx: CommandContext,
  options: ExportOptions
): Promise<void> {
  try {
    await exportToJSONL(ctx.db, { outputDir: options.output });

    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({ success: true, outputDir: options.output }, null, 2)
      );
    } else {
      console.log(chalk.green("✓ Exported to JSONL"));
      console.log(chalk.gray(`  Output: ${options.output}`));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to export"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface ImportOptions {
  input: string;
}

export async function handleImport(
  ctx: CommandContext,
  options: ImportOptions
): Promise<void> {
  try {
    await importFromJSONL(ctx.db, { inputDir: options.input });

    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify({ success: true, inputDir: options.input }, null, 2)
      );
    } else {
      console.log(chalk.green("✓ Imported from JSONL"));
      console.log(chalk.gray(`  Input: ${options.input}`));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to import"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Sync from markdown files to database
 */
async function handleSyncFromMarkdown(ctx: CommandContext): Promise<void> {
  console.log(chalk.blue("Syncing from markdown to database..."));

  const specsDir = path.join(ctx.outputDir, "specs");
  const issuesDir = path.join(ctx.outputDir, "issues");

  let syncedCount = 0;
  let errorCount = 0;

  const syncOptions = {
    outputDir: ctx.outputDir,
    autoExport: false,
    autoInitialize: true,
    writeBackFrontmatter: true,
  };

  // Sync specs
  if (fs.existsSync(specsDir)) {
    const specFiles = findMarkdownFiles(specsDir);
    console.log(chalk.gray(`  Found ${specFiles.length} spec files`));

    for (const file of specFiles) {
      const result = await syncMarkdownToJSONL(ctx.db, file, syncOptions);

      if (result.success) {
        syncedCount++;
        console.log(
          chalk.gray(
            `  ✓ ${result.action} ${result.entityType} ${result.entityId}`
          )
        );
      } else {
        errorCount++;
        console.log(
          chalk.red(
            `  ✗ Failed to sync ${path.basename(file)}: ${result.error}`
          )
        );
      }
    }
  }

  // Sync issues
  if (fs.existsSync(issuesDir)) {
    const issueFiles = findMarkdownFiles(issuesDir);
    console.log(chalk.gray(`  Found ${issueFiles.length} issue files`));

    for (const file of issueFiles) {
      const result = await syncMarkdownToJSONL(ctx.db, file, syncOptions);

      if (result.success) {
        syncedCount++;
        console.log(
          chalk.gray(
            `  ✓ ${result.action} ${result.entityType} ${result.entityId}`
          )
        );
      } else {
        errorCount++;
        console.log(
          chalk.red(
            `  ✗ Failed to sync ${path.basename(file)}: ${result.error}`
          )
        );
      }
    }
  }

  // Export to JSONL
  if (syncedCount > 0) {
    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });
  }

  console.log();
  console.log(chalk.green(`✓ Synced ${syncedCount} files to database`));
  if (errorCount > 0) {
    console.log(chalk.yellow(`  ${errorCount} errors`));
  }
}

/**
 * Sync from database to markdown files
 */
async function handleSyncToMarkdown(ctx: CommandContext): Promise<void> {
  console.log(chalk.blue("Syncing from database to markdown..."));

  const specsDir = path.join(ctx.outputDir, "specs");
  const issuesDir = path.join(ctx.outputDir, "issues");

  // Ensure directories exist
  fs.mkdirSync(specsDir, { recursive: true });
  fs.mkdirSync(issuesDir, { recursive: true });

  let syncedCount = 0;
  let errorCount = 0;

  // Sync all specs
  const specs = listSpecs(ctx.db, {});
  console.log(chalk.gray(`  Found ${specs.length} specs in database`));

  for (const spec of specs) {
    let filePath = path.join(ctx.outputDir, spec.file_path);
    if (!fs.existsSync(filePath)) {
      const foundFile = findExistingEntityFile(spec.id, specsDir, spec.title);

      if (foundFile) {
        filePath = foundFile;
      } else {
        const fileName = generateUniqueFilename(spec.title, spec.id);
        filePath = path.join(specsDir, fileName);
      }
    }

    const result = await syncJSONLToMarkdown(ctx.db, spec.id, "spec", filePath);

    if (result.success) {
      syncedCount++;
      console.log(
        chalk.gray(
          `  ✓ ${result.action} spec ${spec.id} → ${path.basename(filePath)}`
        )
      );
    } else {
      errorCount++;
      console.log(
        chalk.red(`  ✗ Failed to sync spec ${spec.id}: ${result.error}`)
      );
    }
  }

  // Sync all issues
  const issues = listIssues(ctx.db, {});
  console.log(chalk.gray(`  Found ${issues.length} issues in database`));

  for (const issue of issues) {
    // Find existing file or generate new filename using unified scheme
    let filePath = findExistingEntityFile(issue.id, issuesDir, issue.title);

    if (!filePath) {
      // File doesn't exist, generate new filename with unified format
      const fileName = generateUniqueFilename(issue.title, issue.id);
      filePath = path.join(issuesDir, fileName);
    }

    const result = await syncJSONLToMarkdown(
      ctx.db,
      issue.id,
      "issue",
      filePath
    );

    if (result.success) {
      syncedCount++;
      console.log(
        chalk.gray(
          `  ✓ ${result.action} issue ${issue.id} → ${path.basename(filePath)}`
        )
      );
    } else {
      errorCount++;
      console.log(
        chalk.red(`  ✗ Failed to sync issue ${issue.id}: ${result.error}`)
      );
    }
  }

  console.log();
  console.log(chalk.green(`✓ Synced ${syncedCount} entities to markdown`));
  if (errorCount > 0) {
    console.log(chalk.yellow(`  ${errorCount} errors`));
  }
}

/**
 * Helper: Find all markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  function scan(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  scan(dir);
  return results;
}

/**
 * Get the most recent modification time from a list of files
 * Returns null if no files exist
 */
function getMostRecentModTime(files: string[]): Date | null {
  if (files.length === 0) return null;

  let mostRecent: Date | null = null;

  for (const file of files) {
    try {
      const stats = fs.statSync(file);
      const mtime = stats.mtime;

      if (!mostRecent || mtime > mostRecent) {
        mostRecent = mtime;
      }
    } catch (error) {
      // Ignore files that don't exist or can't be accessed
      continue;
    }
  }

  return mostRecent;
}

/**
 * Get modification time of a file
 * Returns null if file doesn't exist
 */
function getFileModTime(filePath: string): Date | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

/**
 * Determine sync direction based on database timestamps vs file modification times
 * The database is the source of truth - we compare file times against database entity timestamps
 */
function determineSyncDirection(ctx: CommandContext): {
  direction: "to-markdown" | "from-markdown" | "no-sync";
  reason: string;
} {
  const specsDir = path.join(ctx.outputDir, "specs");
  const issuesDir = path.join(ctx.outputDir, "issues");
  const specsJsonl = path.join(ctx.outputDir, "specs.jsonl");
  const issuesJsonl = path.join(ctx.outputDir, "issues.jsonl");

  // Get JSONL modification times
  const specsJsonlTime = getFileModTime(specsJsonl);
  const issuesJsonlTime = getFileModTime(issuesJsonl);

  // Get markdown file times
  let specMarkdownFiles: string[] = [];
  let issueMarkdownFiles: string[] = [];

  if (fs.existsSync(specsDir)) {
    specMarkdownFiles = findMarkdownFiles(specsDir);
  }
  if (fs.existsSync(issuesDir)) {
    issueMarkdownFiles = findMarkdownFiles(issuesDir);
  }

  const specsMarkdownTime = getMostRecentModTime(specMarkdownFiles);
  const issuesMarkdownTime = getMostRecentModTime(issueMarkdownFiles);

  // Get the most recent updated_at timestamp from database
  const specs = listSpecs(ctx.db, {});
  const issues = listIssues(ctx.db, {});

  const dbSpecsTime =
    specs.length > 0
      ? new Date(
          Math.max(...specs.map((s: any) => new Date(s.updated_at).getTime()))
        )
      : null;
  const dbIssuesTime =
    issues.length > 0
      ? new Date(
          Math.max(...issues.map((i: any) => new Date(i.updated_at).getTime()))
        )
      : null;

  // Determine sync direction
  let syncToMarkdown = false;
  let syncFromMarkdown = false;
  const reasons: string[] = [];

  // Check specs
  if (!dbSpecsTime && !specsMarkdownTime) {
    // Neither exists - no sync needed
    reasons.push("No spec files or database entries found");
  } else if (!dbSpecsTime && specsMarkdownTime) {
    // Only markdown exists - sync from markdown
    syncFromMarkdown = true;
    reasons.push("Specs database empty, markdown exists");
  } else if (dbSpecsTime && !specsMarkdownTime) {
    // Only database exists - sync to markdown
    syncToMarkdown = true;
    reasons.push("Spec markdown files missing, database has entries");
  } else if (dbSpecsTime && specsMarkdownTime) {
    // Both exist - compare markdown file time against database time (at second precision)
    const comparison = compareDatesAtSecondPrecision(specsMarkdownTime, dbSpecsTime);
    if (comparison > 0) {
      syncFromMarkdown = true;
      reasons.push(
        `Spec markdown files are newer than database (${formatTime(
          specsMarkdownTime
        )} > ${formatTime(dbSpecsTime)})`
      );
    } else if (comparison < 0) {
      syncToMarkdown = true;
      reasons.push(
        `Spec database is newer than markdown files (${formatTime(dbSpecsTime)} > ${formatTime(
          specsMarkdownTime
        )})`
      );
    } else {
      reasons.push("Specs are in sync");
    }
  }

  // Check issues
  if (!dbIssuesTime && !issuesMarkdownTime) {
    // Neither exists - no sync needed
    reasons.push("No issue files or database entries found");
  } else if (!dbIssuesTime && issuesMarkdownTime) {
    // Only markdown exists - sync from markdown
    syncFromMarkdown = true;
    reasons.push("Issues database empty, markdown exists");
  } else if (dbIssuesTime && !issuesMarkdownTime) {
    // Only database exists - sync to markdown
    syncToMarkdown = true;
    reasons.push("Issue markdown files missing, database has entries");
  } else if (dbIssuesTime && issuesMarkdownTime) {
    // Both exist - compare markdown file time against database time (at second precision)
    const comparison = compareDatesAtSecondPrecision(issuesMarkdownTime, dbIssuesTime);
    if (comparison > 0) {
      syncFromMarkdown = true;
      reasons.push(
        `Issue markdown files are newer than database (${formatTime(
          issuesMarkdownTime
        )} > ${formatTime(dbIssuesTime)})`
      );
    } else if (comparison < 0) {
      syncToMarkdown = true;
      reasons.push(
        `Issue database is newer than markdown files (${formatTime(dbIssuesTime)} > ${formatTime(
          issuesMarkdownTime
        )})`
      );
    } else {
      reasons.push("Issues are in sync");
    }
  }

  // Decide direction - prefer database (to-markdown) in conflicts since database is source of truth
  // Only sync from-markdown if markdown is clearly newer (user edited files)
  if (syncFromMarkdown && syncToMarkdown) {
    // Mixed state - prefer database as source of truth
    // This prevents stale markdown files from overwriting fresh database/JSONL data
    return {
      direction: "to-markdown",
      reason: reasons.join("; ") + " (using database as source of truth)",
    };
  } else if (syncFromMarkdown) {
    return {
      direction: "from-markdown",
      reason: reasons.join("; "),
    };
  } else if (syncToMarkdown) {
    return {
      direction: "to-markdown",
      reason: reasons.join("; "),
    };
  } else {
    return {
      direction: "no-sync",
      reason: reasons.join("; "),
    };
  }
}

/**
 * Format timestamp for display
 */
function formatTime(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

// Compare dates with second-level precision (ignore milliseconds)
// Returns: -1 if a < b, 0 if equal, 1 if a > b
function compareDatesAtSecondPrecision(a: Date, b: Date): number {
  const aSeconds = Math.floor(a.getTime() / 1000);
  const bSeconds = Math.floor(b.getTime() / 1000);
  if (aSeconds < bSeconds) return -1;
  if (aSeconds > bSeconds) return 1;
  return 0;
}
