#!/usr/bin/env node

/**
 * Sudograph CLI - Git-native spec and issue management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase } from './db.js';
import type Database from 'better-sqlite3';

// Import command handlers
import {
  handleSpecCreate,
  handleSpecList,
  handleSpecShow,
  handleSpecDelete
} from './cli/spec-commands.js';
import {
  handleIssueCreate,
  handleIssueList,
  handleIssueShow,
  handleIssueUpdate,
  handleIssueClose,
  handleIssueDelete,
} from './cli/issue-commands.js';
import { handleLink } from './cli/relationship-commands.js';
import { handleReady, handleBlocked } from './cli/query-commands.js';
import { handleSync, handleExport, handleImport } from './cli/sync-commands.js';
import { handleStatus, handleStats } from './cli/status-commands.js';

// CLI version
const VERSION = '0.1.0';

// Global state
let db: Database.Database | null = null;
let dbPath: string = '';
let outputDir: string = '.sudocode';
let jsonOutput: boolean = false;

/**
 * Find database path
 * Searches for .sudocode/sudograph.db in current directory and parent directories
 */
function findDatabasePath(): string | null {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const potentialPath = path.join(currentDir, '.sudocode', 'sudograph.db');
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
      outputDir = path.join(process.cwd(), '.sudocode');
      dbPath = path.join(outputDir, 'sudograph.db');
    }
  }

  try {
    db = initDatabase({ path: dbPath });
  } catch (error) {
    console.error(chalk.red('Error: Failed to open database'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Get command context
 */
function getContext() {
  if (!db) {
    console.error(chalk.red('Error: Database not initialized'));
    process.exit(1);
  }
  return { db, outputDir, jsonOutput };
}

// Create main program
const program = new Command();

program
  .name('sg')
  .description('Sudograph - Git-native spec and issue management')
  .version(VERSION)
  .option('--db <path>', 'Database path (default: auto-discover)')
  .option('--json', 'Output in JSON format')
  .hook('preAction', (thisCommand) => {
    // Get global options
    const opts = thisCommand.optsWithGlobals();
    if (opts.db) dbPath = opts.db;
    if (opts.json) jsonOutput = true;

    // Skip DB init for init command
    if (thisCommand.name() !== 'init') {
      initDB();
    }
  })
  .hook('postAction', () => {
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
  .command('init')
  .description('Initialize .sudocode directory structure')
  .option('--prefix <prefix>', 'ID prefix for specs/issues', 'sg')
  .action((options) => {
    const prefix = options.prefix || 'sg';
    const dir = path.join(process.cwd(), '.sudocode');

    try {
      // Create directory structure
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });

      // Initialize database
      const dbPath = path.join(dir, 'sudograph.db');
      const database = initDatabase({ path: dbPath });

      // Create meta.json with correct structure matching Metadata interface
      const meta = {
        version: '1.0.0',
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
        path.join(dir, 'meta.json'),
        JSON.stringify(meta, null, 2),
        'utf8'
      );

      // Create empty JSONL files
      fs.writeFileSync(path.join(dir, 'specs', 'specs.jsonl'), '', 'utf8');
      fs.writeFileSync(path.join(dir, 'issues', 'issues.jsonl'), '', 'utf8');

      database.close();

      console.log(chalk.green('✓ Initialized sudograph in'), chalk.cyan(dir));
      console.log(chalk.gray(`  Prefix: ${prefix}`));
      console.log(chalk.gray(`  Database: ${dbPath}`));
    } catch (error) {
      console.error(chalk.red('✗ Initialization failed'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================================================
// SPEC COMMANDS
// ============================================================================

const spec = program.command('spec').description('Manage specifications');

spec
  .command('create <title>')
  .description('Create a new spec')
  .option('-t, --type <type>', 'Spec type', 'feature')
  .option('-p, --priority <priority>', 'Priority (0-4)', '2')
  .option('-d, --description <desc>', 'Description')
  .option('--design <design>', 'Design notes')
  .option('--file-path <path>', 'File path for markdown')
  .option('--parent <id>', 'Parent spec ID')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (title, options) => {
    await handleSpecCreate(getContext(), title, options);
  });

spec
  .command('list')
  .description('List all specs')
  .option('-s, --status <status>', 'Filter by status')
  .option('-t, --type <type>', 'Filter by type')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('--limit <num>', 'Limit results', '50')
  .action(async (options) => {
    await handleSpecList(getContext(), options);
  });

spec
  .command('show <id>')
  .description('Show spec details')
  .action(async (id) => {
    await handleSpecShow(getContext(), id);
  });

spec
  .command('delete <id...>')
  .description('Delete one or more specs')
  .option('--hard', 'Permanently delete from database (default: mark as deprecated)')
  .action(async (ids, options) => {
    await handleSpecDelete(getContext(), ids, options);
  });

// ============================================================================
// ISSUE COMMANDS
// ============================================================================

const issue = program.command('issue').description('Manage issues');

issue
  .command('create <title>')
  .description('Create a new issue')
  .option('-t, --type <type>', 'Issue type', 'task')
  .option('-p, --priority <priority>', 'Priority (0-4)', '2')
  .option('-d, --description <desc>', 'Description')
  .option('-a, --assignee <assignee>', 'Assignee')
  .option('--parent <id>', 'Parent issue ID')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--estimate <minutes>', 'Estimated minutes')
  .action(async (title, options) => {
    await handleIssueCreate(getContext(), title, options);
  });

issue
  .command('list')
  .description('List all issues')
  .option('-s, --status <status>', 'Filter by status')
  .option('-t, --type <type>', 'Filter by type')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('--limit <num>', 'Limit results', '50')
  .action(async (options) => {
    await handleIssueList(getContext(), options);
  });

issue
  .command('show <id>')
  .description('Show issue details')
  .action(async (id) => {
    await handleIssueShow(getContext(), id);
  });

issue
  .command('update <id>')
  .description('Update an issue')
  .option('-s, --status <status>', 'New status')
  .option('-p, --priority <priority>', 'New priority')
  .option('-a, --assignee <assignee>', 'New assignee')
  .option('-t, --type <type>', 'New type')
  .option('--title <title>', 'New title')
  .option('--description <desc>', 'New description')
  .action(async (id, options) => {
    await handleIssueUpdate(getContext(), id, options);
  });

issue
  .command('close <id...>')
  .description('Close one or more issues')
  .option('-r, --reason <reason>', 'Reason for closing')
  .action(async (ids, options) => {
    await handleIssueClose(getContext(), ids, options);
  });

issue
  .command('delete <id...>')
  .description('Delete one or more issues')
  .option('--hard', 'Permanently delete from database (default: close the issue)')
  .action(async (ids, options) => {
    await handleIssueDelete(getContext(), ids, options);
  });

// ============================================================================
// RELATIONSHIP COMMANDS
// ============================================================================

program
  .command('link <from> <to>')
  .description('Create a relationship between entities')
  .option('-t, --type <type>', 'Relationship type', 'references')
  .action(async (from, to, options) => {
    await handleLink(getContext(), from, to, options);
  });

// ============================================================================
// READY & BLOCKED COMMANDS
// ============================================================================

program
  .command('ready')
  .description('Show ready work (no blockers)')
  .option('--specs', 'Show specs only')
  .option('--issues', 'Show issues only')
  .action(async (options) => {
    await handleReady(getContext(), options);
  });

program
  .command('blocked')
  .description('Show blocked items')
  .option('--specs', 'Show specs only')
  .option('--issues', 'Show issues only')
  .action(async (options) => {
    await handleBlocked(getContext(), options);
  });

// ============================================================================
// STATUS & STATS COMMANDS
// ============================================================================

program
  .command('status')
  .description('Show project status summary')
  .option('-v, --verbose', 'Show detailed status')
  .action(async (options) => {
    await handleStatus(getContext(), options);
  });

program
  .command('stats')
  .description('Show detailed project statistics')
  .action(async (options) => {
    await handleStats(getContext(), options);
  });

// ============================================================================
// SYNC COMMANDS
// ============================================================================

program
  .command('sync')
  .description('Sync between markdown, JSONL, and database')
  .option('--watch', 'Watch for changes and auto-sync')
  .option('--from-markdown', 'Sync from markdown to database')
  .option('--to-markdown', 'Sync from database to markdown')
  .action(async (options) => {
    await handleSync(getContext(), options);
  });

program
  .command('export')
  .description('Export database to JSONL')
  .option('-o, --output <dir>', 'Output directory', '.sudocode')
  .action(async (options) => {
    await handleExport(getContext(), options);
  });

program
  .command('import')
  .description('Import from JSONL to database')
  .option('-i, --input <dir>', 'Input directory', '.sudocode')
  .action(async (options) => {
    await handleImport(getContext(), options);
  });

// Parse arguments
program.parse();
