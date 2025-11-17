#!/usr/bin/env node

/**
 * sudocode CLI - Git-native spec and issue management
 */

import { Command } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import { initDatabase } from "./db.js";
import type Database from "better-sqlite3";

// Import command handlers
import {
  handleSpecCreate,
  handleSpecList,
  handleSpecShow,
  handleSpecUpdate,
  handleSpecDelete,
} from "./cli/spec-commands.js";
import {
  handleIssueCreate,
  handleIssueList,
  handleIssueShow,
  handleIssueUpdate,
  handleIssueClose,
  handleIssueDelete,
} from "./cli/issue-commands.js";
import { handleLink } from "./cli/relationship-commands.js";
import { handleAddReference } from "./cli/reference-commands.js";
import { handleReady, handleBlocked } from "./cli/query-commands.js";
import { handleSync, handleExport, handleImport } from "./cli/sync-commands.js";
import { handleStatus, handleStats } from "./cli/status-commands.js";
import {
  handleFeedbackAdd,
  handleFeedbackList,
  handleFeedbackShow,
  handleFeedbackDismiss,
  handleFeedbackStale,
  handleFeedbackRelocate,
} from "./cli/feedback-commands.js";
import { handleServerStart } from "./cli/server-commands.js";
import { handleInit } from "./cli/init-commands.js";
import { handleUpdate, handleUpdateCheck } from "./cli/update-commands.js";
import {
  handleResolveConflicts,
  handleMergeDriver,
  handleInitMergeDriver,
  handleRemoveMergeDriver,
} from "./cli/merge-commands.js";
import { getUpdateNotification } from "./update-checker.js";
import { VERSION } from "./version.js";

// Global state
let db: Database.Database | null = null;
let dbPath: string = "";
let outputDir: string = ".sudocode";
let jsonOutput: boolean = false;

/**
 * Find database path
 * Searches for .sudocode/cache.db in current directory and parent directories
 */
function findDatabasePath(): string | null {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const potentialPath = path.join(currentDir, ".sudocode", "cache.db");
    if (fs.existsSync(potentialPath)) {
      return potentialPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Initialize database connection
 */
function initDB() {
  if (!dbPath) {
    const found = findDatabasePath();
    if (found) {
      dbPath = found;
      outputDir = path.dirname(found);
    } else {
      // Default location
      outputDir = path.join(process.cwd(), ".sudocode");
      dbPath = path.join(outputDir, "cache.db");
    }
  }

  try {
    // Ensure the database directory exists before opening/creating the database
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = initDatabase({ path: dbPath });
  } catch (error) {
    console.error(chalk.red("Error: Failed to open database"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Get command context
 */
function getContext() {
  if (!db) {
    console.error(chalk.red("Error: Database not initialized"));
    process.exit(1);
  }
  return { db, outputDir, jsonOutput };
}

// Create main program
const program = new Command();

program
  .name("sudocode")
  .description("sudocode - git-native agentic context management")
  .version(VERSION)
  .option("--db <path>", "Database path (default: auto-discover)")
  .option("--json", "Output in JSON format")
  .hook("preAction", (thisCommand: Command) => {
    // Get global options
    const opts = thisCommand.optsWithGlobals();
    if (opts.db) dbPath = opts.db;
    if (opts.json) jsonOutput = true;

    // Skip DB init for init command
    if (thisCommand.name() !== "init") {
      initDB();
    }
  })
  .hook("postAction", () => {
    // Close database after command completes
    if (db) {
      db.close();
      db = null;
    }
  });

// ============================================================================
// INIT COMMAND
// ============================================================================

program
  .command("init")
  .description("Initialize .sudocode directory structure")
  .action(async (options) => {
    await handleInit({});
  });

// ============================================================================
// SPEC COMMANDS
// ============================================================================

const spec = program
  .command("spec")
  .alias("specs")
  .description("Manage specifications");

spec
  .command("create <title>")
  .description("Create a new spec")
  .option("-p, --priority <priority>", "Priority (0-4)", "2")
  .option("-d, --description <desc>", "Description")
  .option("--file-path <path>", "File path for markdown")
  .option("--parent <id>", "Parent spec ID")
  .option("--tags <tags>", "Comma-separated tags")
  .action(async (title, options) => {
    await handleSpecCreate(getContext(), title, options);
  });

spec
  .command("list")
  .description("List all specs")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("-g, --grep <query>", "Search by title or content")
  .option("--archived <bool>", "Filter by archive status (true/false)")
  .option("--limit <num>", "Limit results", "50")
  .action(async (options) => {
    await handleSpecList(getContext(), options);
  });

spec
  .command("show <id>")
  .description("Show spec details")
  .action(async (id) => {
    await handleSpecShow(getContext(), id);
  });

spec
  .command("update <id>")
  .description("Update a spec")
  .option("-p, --priority <priority>", "New priority")
  .option("--title <title>", "New title")
  .option("-d, --description <desc>", "New description")
  .option("--parent <id>", "New parent spec ID")
  .option("--tags <tags>", "New comma-separated tags")
  .option("--archived <bool>", "Archive status (true/false)")
  .action(async (id, options) => {
    await handleSpecUpdate(getContext(), id, options);
  });

spec
  .command("delete <id...>")
  .description("Delete one or more specs")
  .action(async (ids, options) => {
    await handleSpecDelete(getContext(), ids, options);
  });

spec
  .command("add-ref <entity-id> <reference-id>")
  .description("Add a reference to a spec")
  .option("-l, --line <number>", "Line number to insert reference")
  .option("-t, --text <text>", "Text to search for insertion point")
  .option("--display <text>", "Display text for reference")
  .option("--type <type>", "Relationship type (blocks, implements, etc.)")
  .option("--format <format>", "Format: inline or newline", "inline")
  .action(async (entityId, referenceId, options) => {
    await handleAddReference(getContext(), entityId, referenceId, options);
  });

// ============================================================================
// ISSUE COMMANDS
// ============================================================================

const issue = program
  .command("issue")
  .alias("issues")
  .description("Manage issues");

issue
  .command("create <title>")
  .description("Create a new issue")
  .option("-p, --priority <priority>", "Priority (0-4)", "2")
  .option("-d, --description <desc>", "Description")
  .option("-a, --assignee <assignee>", "Assignee")
  .option("--parent <id>", "Parent issue ID")
  .option("--tags <tags>", "Comma-separated tags")
  .action(async (title, options) => {
    await handleIssueCreate(getContext(), title, options);
  });

issue
  .command("list")
  .description("List all issues")
  .option("-s, --status <status>", "Filter by status")
  .option("-a, --assignee <assignee>", "Filter by assignee")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("-g, --grep <query>", "Search by title or content")
  .option("--archived <bool>", "Filter by archive status (true/false)")
  .option("--limit <num>", "Limit results", "50")
  .action(async (options) => {
    await handleIssueList(getContext(), options);
  });

issue
  .command("show <id>")
  .description("Show issue details")
  .action(async (id) => {
    await handleIssueShow(getContext(), id);
  });

issue
  .command("update <id>")
  .description("Update an issue")
  .option("-s, --status <status>", "New status")
  .option("-p, --priority <priority>", "New priority")
  .option("-a, --assignee <assignee>", "New assignee")
  .option("--title <title>", "New title")
  .option("--description <desc>", "New description")
  .option("--archived <bool>", "Archive status (true/false)")
  .action(async (id, options) => {
    await handleIssueUpdate(getContext(), id, options);
  });

issue
  .command("close <id...>")
  .description("Close one or more issues")
  .option("-r, --reason <reason>", "Reason for closing")
  .action(async (ids, options) => {
    await handleIssueClose(getContext(), ids, options);
  });

issue
  .command("delete <id...>")
  .description("Delete one or more issues")
  .option(
    "--hard",
    "Permanently delete from database (default: close the issue)"
  )
  .action(async (ids, options) => {
    await handleIssueDelete(getContext(), ids, options);
  });

issue
  .command("add-ref <entity-id> <reference-id>")
  .description("Add a reference to an issue")
  .option("-l, --line <number>", "Line number to insert reference")
  .option("-t, --text <text>", "Text to search for insertion point")
  .option("--display <text>", "Display text for reference")
  .option("--type <type>", "Relationship type (blocks, implements, etc.)")
  .option("--format <format>", "Format: inline or newline", "inline")
  .option("--position <position>", "Position: before or after", "after")
  .action(async (entityId, referenceId, options) => {
    await handleAddReference(getContext(), entityId, referenceId, options);
  });

// ============================================================================
// RELATIONSHIP COMMANDS
// ============================================================================

program
  .command("link <from> <to>")
  .description("Create a relationship between entities")
  .option("-t, --type <type>", "Relationship type", "references")
  .action(async (from, to, options) => {
    await handleLink(getContext(), from, to, options);
  });

// ============================================================================
// READY & BLOCKED COMMANDS
// ============================================================================

program
  .command("ready")
  .description("Show ready issues (no blockers)")
  .action(async (options) => {
    await handleReady(getContext(), options);
  });

program
  .command("blocked")
  .description("Show blocked issues")
  .action(async (options) => {
    await handleBlocked(getContext(), options);
  });

// ============================================================================
// STATUS & STATS COMMANDS
// ============================================================================

program
  .command("status")
  .description("Show project status summary")
  .option("-v, --verbose", "Show detailed status")
  .action(async (options) => {
    await handleStatus(getContext(), options);
  });

program
  .command("stats")
  .description("Show detailed project statistics")
  .action(async (options) => {
    await handleStats(getContext(), options);
  });

// ============================================================================
// FEEDBACK COMMANDS
// ============================================================================

const feedback = program
  .command("feedback")
  .description("Manage spec feedback from issues");

feedback
  .command("add <issue-id> <spec-id>")
  .description("Add feedback to a spec from an issue")
  .option("-l, --line <number>", "Line number in spec")
  .option("-t, --text <text>", "Text to search for anchor")
  .option(
    "--type <type>",
    "Feedback type (comment, suggestion, request)",
    "comment"
  )
  .option("-c, --content <text>", "Feedback content (required)")
  .option("-a, --agent <name>", "Agent name")
  .action(async (issueId, specId, options) => {
    await handleFeedbackAdd(getContext(), issueId, specId, options);
  });

feedback
  .command("list")
  .description("List all feedback")
  .option("-i, --issue <id>", "Filter by issue ID")
  .option("-s, --spec <id>", "Filter by spec ID")
  .option("-t, --type <type>", "Filter by feedback type")
  .option(
    "--status <status>",
    "Filter by status (open, acknowledged, resolved, wont_fix)"
  )
  .option("--limit <num>", "Limit results", "50")
  .action(async (options) => {
    await handleFeedbackList(getContext(), options);
  });

feedback
  .command("show <id>")
  .description("Show detailed feedback information")
  .action(async (id) => {
    await handleFeedbackShow(getContext(), id);
  });

feedback
  .command("dismiss <id>")
  .description("Dismiss feedback")
  .option("-c, --comment <text>", "Optional comment")
  .action(async (id, options) => {
    await handleFeedbackDismiss(getContext(), id, options);
  });

feedback
  .command("stale")
  .description("List all stale feedback anchors")
  .action(async () => {
    await handleFeedbackStale(getContext());
  });

feedback
  .command("relocate <id>")
  .description("Manually relocate a stale anchor")
  .option("-l, --line <number>", "New line number (required)")
  .action(async (id, options) => {
    await handleFeedbackRelocate(getContext(), id, options);
  });

// ============================================================================
// SYNC COMMANDS
// ============================================================================

program
  .command("sync")
  .description("Sync between markdown, JSONL, and database")
  .option("--watch", "Watch for changes and auto-sync")
  .option("--from-markdown", "Sync from markdown to database")
  .option("--to-markdown", "Sync from database to markdown")
  .action(async (options) => {
    await handleSync(getContext(), options);
  });

program
  .command("export")
  .description("Export database to JSONL")
  .option("-o, --output <dir>", "Output directory", ".sudocode")
  .action(async (options) => {
    await handleExport(getContext(), options);
  });

program
  .command("import")
  .description("Import from JSONL to database")
  .option("-i, --input <dir>", "Input directory", ".sudocode")
  .action(async (options) => {
    await handleImport(getContext(), options);
  });

// ============================================================================
// SERVER COMMANDS
// ============================================================================

program
  .command("server")
  .description("Start the sudocode local server")
  .option("-p, --port <port>", "Port to run server on", "3000")
  .option("-d, --detach", "Run server in background")
  .action(async (options) => {
    await handleServerStart(getContext(), options);
  });

// ============================================================================
// UPDATE COMMANDS
// ============================================================================

program
  .command("update")
  .description("Update sudocode to the latest version")
  .option("--check", "Check for updates without installing")
  .option("--dismiss", "Dismiss update notifications for 30 days")
  .action(async (options) => {
    if (options.check) {
      await handleUpdateCheck();
    } else if (options.dismiss) {
      const { handleUpdateDismiss } = await import("./cli/update-commands.js");
      await handleUpdateDismiss();
    } else {
      await handleUpdate();
    }
  });

// ============================================================================
// MERGE CONFLICT RESOLUTION COMMANDS
// ============================================================================

program
  .command("resolve-conflicts")
  .description("Automatically resolve merge conflicts in JSONL files")
  .option("--dry-run", "Show what would be done without making changes")
  .option("--verbose", "Show detailed resolution information")
  .action(async (options) => {
    initDB();
    await handleResolveConflicts(getContext(), options);
  });

program
  .command("merge-driver")
  .description("Git merge driver for JSONL files (called automatically by git)")
  .requiredOption("--base <path>", "Base/ancestor version file path")
  .requiredOption("--ours <path>", "Our version file path (HEAD)")
  .requiredOption("--theirs <path>", "Their version file path (incoming branch)")
  .option("--marker-size <size>", "Conflict marker size (provided by git)", parseInt)
  .action(async (options) => {
    // Don't call initDB - this runs during git merge, might not have db access
    await handleMergeDriver(options);
  });

program
  .command("init-merge-driver")
  .description("Configure git to use sudocode for automatic JSONL merge resolution")
  .option("--global", "Install globally (all repos) instead of just current repo")
  .action(async (options) => {
    await handleInitMergeDriver(options);
  });

program
  .command("remove-merge-driver")
  .description("Remove sudocode merge driver configuration from git")
  .option("--global", "Remove from global config instead of just current repo")
  .action(async (options) => {
    await handleRemoveMergeDriver(options);
  });

// Parse arguments
program.parse(process.argv);

// Check for updates (non-blocking)
// Skip for update and server commands (server handles it explicitly)
// Also skip when --json flag is present (to avoid interfering with JSON output)
// Skip if SUDOCODE_DISABLE_UPDATE_CHECK environment variable is set
const isUpdateCommand = process.argv.includes("update");
const isServerCommand = process.argv.includes("server");
const isJsonOutput = process.argv.includes("--json");
const isUpdateCheckDisabled =
  process.env.SUDOCODE_DISABLE_UPDATE_CHECK === "true";
if (
  !isUpdateCommand &&
  !isServerCommand &&
  !isJsonOutput &&
  !isUpdateCheckDisabled
) {
  getUpdateNotification()
    .then((notification) => {
      if (notification) {
        // Display in gray/dim to be less intrusive
        console.error(chalk.gray(notification));
      }
    })
    .catch(() => {
      // Silently ignore update check failures
    });
}
