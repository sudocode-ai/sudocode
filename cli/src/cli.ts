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
  handlePluginList,
  handlePluginInstall,
  handlePluginStatus,
  handlePluginUninstall,
  handlePluginConfigure,
  handlePluginTest,
  handlePluginInfo,
} from "./cli/plugin-commands.js";
import {
  handleResolveConflicts,
  handleMergeDriver,
  handleInitMergeDriver,
  handleRemoveMergeDriver,
} from "./cli/merge-commands.js";
import { handleAuthClearCommand, handleAuthStatusCommand, handleAuthClaudeCommand } from "./cli/auth-commands.js";
import {
  handleDeploy,
  handleDeployConfig,
  handleDeployList,
  handleDeployStatus,
  handleDeployStop,
} from "./cli/deploy-commands.js";
import {
  handleRemoteSpawn,
  handleRemoteConfig,
  handleRemoteList,
  handleRemoteStatus,
  handleRemoteStop,
} from "./cli/remote-commands.js";
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
  .action(async () => {
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
  .option("--parent <id>", "New parent issue ID")
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
  .description("Manage feedback from issues");

feedback
  .command("add <target-id> [issue-id]")
  .description("Add feedback to a target (optionally from an issue)")
  .option("-l, --line <number>", "Line number in target to anchor feedback")
  .option("-t, --text <text>", "Text to search for anchor")
  .option(
    "--type <type>",
    "Feedback type (comment, suggestion, request)",
    "comment"
  )
  .option("-c, --content <text>", "Feedback content (required)")
  .option("-a, --agent <name>", "Agent name")
  .action(async (targetId, issueId, options) => {
    await handleFeedbackAdd(getContext(), issueId, targetId, options);
  });

feedback
  .command("list")
  .description("List all feedback")
  .option("-i, --issue <id>", "Filter by issue ID")
  .option("-t, --target <id>", "Filter by target ID")
  .option("--type <type>", "Filter by feedback type")
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
  .action(async (id) => {
    await handleFeedbackDismiss(getContext(), id);
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
  .option("-p, --port <port>", "Port to run server on")
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
  .requiredOption(
    "--theirs <path>",
    "Their version file path (incoming branch)"
  )
  .option(
    "--marker-size <size>",
    "Conflict marker size (provided by git)",
    parseInt
  )
  .action(async (options) => {
    // Don't call initDB - this runs during git merge, might not have db access
    await handleMergeDriver(options);
  });

program
  .command("init-merge-driver")
  .description(
    "Configure git to use sudocode for automatic JSONL merge resolution"
  )
  .option(
    "--global",
    "Install globally (all repos) instead of just current repo"
  )
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

// ============================================================================
// PLUGIN COMMANDS
// ============================================================================

const plugin = program
  .command("plugin")
  .alias("plugins")
  .description("Manage integration plugins");

plugin
  .command("list")
  .description("List available integration plugins")
  .option("-a, --all", "Show all plugins including not installed")
  .action(async (options) => {
    await handlePluginList(getContext(), options);
  });

plugin
  .command("install <name>")
  .description("Install an integration plugin")
  .option("-g, --global", "Install globally")
  .action(async (name, options) => {
    await handlePluginInstall(getContext(), name, options);
  });

plugin
  .command("uninstall <name>")
  .description("Uninstall an integration plugin")
  .option("-g, --global", "Uninstall globally")
  .action(async (name, options) => {
    await handlePluginUninstall(getContext(), name, options);
  });

plugin
  .command("status")
  .description("Show status of installed plugins")
  .action(async () => {
    await handlePluginStatus(getContext());
  });

plugin
  .command("configure <name>")
  .description("Configure an integration plugin")
  .option("--set <key=value...>", "Set configuration option(s)")
  .option("--options <json>", "Set options as JSON object")
  .option("--enable", "Enable the integration")
  .option("--disable", "Disable the integration")
  .option("--auto-sync", "Enable automatic syncing")
  .option("--no-auto-sync", "Disable automatic syncing")
  .option("--auto-import", "Enable automatic import of new entities")
  .option("--no-auto-import", "Disable automatic import")
  .option(
    "--delete-behavior <behavior>",
    "What to do when external entity is deleted (close|delete|ignore)"
  )
  .option("--test", "Run connection test after configuration")
  .action(async (name, options) => {
    await handlePluginConfigure(getContext(), name, {
      set: options.set,
      options: options.options,
      enable: options.enable,
      disable: options.disable,
      autoSync: options.autoSync,
      autoImport: options.autoImport,
      deleteBehavior: options.deleteBehavior,
      test: options.test,
    });
  });

plugin
  .command("test <name>")
  .description("Test a plugin's connection/setup")
  .action(async (name) => {
    await handlePluginTest(getContext(), name);
  });

plugin
  .command("info <name>")
  .description("Show detailed information about a plugin")
  .action(async (name) => {
    await handlePluginInfo(getContext(), name);
  });

// ============================================================================
// AUTH COMMANDS
// ============================================================================

const auth = program
  .command("auth")
  .description("Manage authentication for AI services");

auth
  .command("claude")
  .description("Configure Claude Code authentication via OAuth")
  .option("-f, --force", "Overwrite existing token without confirmation")
  .action(async (options) => {
    // Auth commands don't need database context, but we need to provide it for consistency
    await handleAuthClaudeCommand(getContext(), options);
  });

auth
  .command("status")
  .description("Check authentication status for all services")
  .action(async (options) => {
    // Auth commands don't need database context, but we need to provide it for consistency
    await handleAuthStatusCommand(getContext(), options);
  });

auth
  .command("clear")
  .description("Clear all stored authentication credentials")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (options) => {
    // Auth commands don't need database context, but we need to provide it for consistency
    await handleAuthClearCommand(getContext(), options);
  });

// ============================================================================
// DEPLOY COMMANDS
// ============================================================================

const deploy = program
  .command("deploy")
  .description("Deploy sudocode to remote environments");

// deploy config - View or update configuration
deploy
  .command("config")
  .description("View or update deployment configuration")
  .option("--reset", "Reset to default configuration")
  .option("--provider <provider>", "Set deployment provider")
  .option("--default-branch <branch>", "Set default branch")
  .option("--port <port>", "Set server port (1-65535)")
  .option("--idle-timeout <minutes>", "Set idle timeout in minutes")
  .option("--keep-alive-hours <hours>", "Set keep-alive duration in hours")
  .option("--machine <type>", "Set machine type")
  .option("--retention-period <days>", "Set retention period in days")
  .action(async (options) => {
    await handleDeployConfig(getContext(), options);
  });

// deploy list - List all deployments
deploy
  .command("list")
  .description("List all active deployments")
  .action(async () => {
    await handleDeployList(getContext());
  });

// deploy status <id> - Get deployment status
deploy
  .command("status <id>")
  .description("Get detailed status of a deployment")
  .action(async (id) => {
    await handleDeployStatus(getContext(), id);
  });

// deploy stop <id> - Stop a deployment
deploy
  .command("stop <id>")
  .description("Stop and delete a deployment")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (id, options) => {
    await handleDeployStop(getContext(), id, options);
  });

// Default action (sudocode deploy with no subcommand)
// Options must be defined BEFORE .action() in Commander.js
deploy
  .option("--branch <name>", "Branch to deploy")
  .option("--repo <owner/repo>", "Repository to deploy")
  .option("--port <number>", "Server port", parseInt)
  .option("--machine <type>", "Machine type")
  .option("--idle-timeout <minutes>", "Idle timeout in minutes", parseInt)
  .option("--keep-alive-hours <hours>", "Keep-alive hours", parseInt)
  .option("--retention-period <days>", "Retention period in days", parseInt)
  .option("--dev", "Deploy in development mode")
  .option("--no-open", "Don't open browser automatically after deployment")
  .action(async (options) => {
    // If a subcommand was provided, don't run the default action
    const subcommands = ['config', 'list', 'status', 'stop'];
    const args = process.argv.slice(2);
    const hasSubcommand = args.some(arg => subcommands.includes(arg));
    
    if (!hasSubcommand) {
      await handleDeploy(getContext(), options);
    }
  });

// ============================================================================
// REMOTE COMMANDS
// ============================================================================

const remote = program
  .command('remote')
  .description('Manage remote sudocode deployments');

// Codespaces provider
const codespaces = remote
  .command('codespaces')
  .description('Manage GitHub Codespaces deployments');

codespaces
  .command('spawn')
  .description('Spawn sudocode to GitHub Codespaces')
  .option('--branch <name>', 'Branch to spawn')
  .option('--repo <owner/repo>', 'Repository to spawn')
  .option('--port <number>', 'Server port', parseInt)
  .option('--machine <type>', 'Machine type')
  .option('--idle-timeout <minutes>', 'Idle timeout in minutes', parseInt)
  .option('--keep-alive <hours>', 'Keep-alive hours', parseInt)
  .option('--retention <days>', 'Retention period in days', parseInt)
  .option('--dev', 'Spawn in development mode (uses local sudocode packages)')
  .action(async (options) => {
    await handleRemoteSpawn(getContext(), 'codespaces', options);
  });

codespaces
  .command('config')
  .description('Configure codespaces settings')
  .option('--idle-timeout <minutes>', 'Idle timeout in minutes', parseInt)
  .option('--keep-alive <hours>', 'Keep-alive duration in hours', parseInt)
  .option('--retention <days>', 'Retention period in days', parseInt)
  .option('--machine <type>', 'Machine type')
  .option('--port <number>', 'Server port', parseInt)
  .option('--reset', 'Reset to defaults')
  .action(async (options) => {
    await handleRemoteConfig(getContext(), 'codespaces', options);
  });

codespaces
  .command('list')
  .description('List all codespaces deployments')
  .action(async () => {
    await handleRemoteList(getContext(), 'codespaces');
  });

codespaces
  .command('status <id>')
  .description('Get codespaces deployment status')
  .action(async (id) => {
    await handleRemoteStatus(getContext(), 'codespaces', id);
  });

codespaces
  .command('stop <id>')
  .description('Stop a codespaces deployment')
  .option('-f, --force', 'Skip confirmation')
  .action(async (id, options) => {
    await handleRemoteStop(getContext(), 'codespaces', id, options);
  });

// Coder provider (not yet supported)
const coder = remote
  .command('coder')
  .description('Manage Coder deployments (not yet supported)');

coder
  .command('spawn')
  .description('Spawn sudocode to Coder (not yet supported)')
  .action(async () => {
    console.error(chalk.red("✗ Provider 'coder' is not yet supported"));
    console.error(chalk.gray("  Currently supported: codespaces"));
    process.exit(1);
  });

coder
  .command('config')
  .description('Configure coder settings (not yet supported)')
  .action(async () => {
    console.error(chalk.red("✗ Provider 'coder' is not yet supported"));
    console.error(chalk.gray("  Currently supported: codespaces"));
    process.exit(1);
  });

coder
  .command('list')
  .description('List all coder deployments (not yet supported)')
  .action(async () => {
    console.error(chalk.red("✗ Provider 'coder' is not yet supported"));
    console.error(chalk.gray("  Currently supported: codespaces"));
    process.exit(1);
  });

coder
  .command('status <id>')
  .description('Get coder deployment status (not yet supported)')
  .action(async () => {
    console.error(chalk.red("✗ Provider 'coder' is not yet supported"));
    console.error(chalk.gray("  Currently supported: codespaces"));
    process.exit(1);
  });

coder
  .command('stop <id>')
  .description('Stop a coder deployment (not yet supported)')
  .action(async () => {
    console.error(chalk.red("✗ Provider 'coder' is not yet supported"));
    console.error(chalk.gray("  Currently supported: codespaces"));
    process.exit(1);
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
