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
import { handleReady, handleBlocked } from "./cli/query-commands.js";
import { handleSync, handleExport, handleImport } from "./cli/sync-commands.js";
import { handleStatus, handleStats } from "./cli/status-commands.js";
import {
  handleFeedbackAdd,
  handleFeedbackList,
  handleFeedbackShow,
  handleFeedbackAcknowledge,
  handleFeedbackResolve,
  handleFeedbackWontFix,
  handleFeedbackStale,
  handleFeedbackRelocate,
} from "./cli/feedback-commands.js";

// CLI version
const VERSION = "0.1.0";

// Global state
let db: Database.Database | null = null;
let dbPath: string = "";
let outputDir: string = ".sudocode";
let jsonOutput: boolean = false;

/**
 * Find database path
 * Searches for .sudocode/sudocode.db in current directory and parent directories
 */
function findDatabasePath(): string | null {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const potentialPath = path.join(currentDir, ".sudocode", "sudocode.db");
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
      dbPath = path.join(outputDir, "sudocode.db");
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
  .hook("preAction", (thisCommand) => {
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
  .option("--prefix <prefix>", "ID prefix for specs/issues", "sudocode")
  .action((options) => {
    const prefix = options.prefix || "sudocode";
    const dir = path.join(process.cwd(), ".sudocode");

    try {
      // Create directory structure
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
      fs.mkdirSync(path.join(dir, "issues"), { recursive: true });

      // Initialize database
      const dbPath = path.join(dir, "sudocode.db");
      // Ensure the database directory exists before creating the database
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const database = initDatabase({ path: dbPath });

      // Create meta.json with correct structure matching Metadata interface
      const meta = {
        version: "1.0.0",
        next_spec_id: 1,
        next_issue_id: 1,
        id_prefix: {
          spec: prefix,
          issue: prefix,
        },
        last_sync: new Date().toISOString(),
        collision_log: [],
      };
      fs.writeFileSync(
        path.join(dir, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf8"
      );

      // Create empty JSONL files
      fs.writeFileSync(path.join(dir, "specs.jsonl"), "", "utf8");
      fs.writeFileSync(path.join(dir, "issues.jsonl"), "", "utf8");

      database.close();

      console.log(chalk.green("✓ Initialized sudocode in"), chalk.cyan(dir));
      console.log(chalk.gray(`  Prefix: ${prefix}`));
      console.log(chalk.gray(`  Database: ${dbPath}`));
    } catch (error) {
      console.error(chalk.red("✗ Initialization failed"));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================================================
// SPEC COMMANDS
// ============================================================================

const spec = program.command("spec").description("Manage specifications");

spec
  .command("create <title>")
  .description("Create a new spec")
  .option("-p, --priority <priority>", "Priority (0-4)", "2")
  .option("-d, --description <desc>", "Description")
  .option("--design <design>", "Design notes")
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
  .command("delete <id...>")
  .description("Delete one or more specs")
  .action(async (ids, options) => {
    await handleSpecDelete(getContext(), ids, options);
  });

// ============================================================================
// ISSUE COMMANDS
// ============================================================================

const issue = program.command("issue").description("Manage issues");

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
    "Feedback type (ambiguity, missing_requirement, technical_constraint, etc.)",
    "ambiguity"
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
  .command("acknowledge <id>")
  .description("Acknowledge feedback")
  .action(async (id) => {
    await handleFeedbackAcknowledge(getContext(), id);
  });

feedback
  .command("resolve <id>")
  .description("Mark feedback as resolved")
  .option("-c, --comment <text>", "Resolution comment")
  .action(async (id, options) => {
    await handleFeedbackResolve(getContext(), id, options);
  });

feedback
  .command("wont-fix <id>")
  .description("Mark feedback as won't fix")
  .option("-r, --reason <text>", "Reason for not fixing")
  .action(async (id, options) => {
    await handleFeedbackWontFix(getContext(), id, options);
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

// Parse arguments
program.parse();
