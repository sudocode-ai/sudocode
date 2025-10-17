/**
 * CLI handlers for sync commands
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { exportToJSONL } from '../export.js';
import { importFromJSONL } from '../import.js';
import { startWatcher, setupGracefulShutdown } from '../watcher.js';

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
  if (options.watch) {
    // Start file watcher
    console.log(chalk.blue('Starting file watcher...'));
    console.log(chalk.gray(`  Watching: ${ctx.outputDir}`));
    console.log(chalk.gray('  Press Ctrl+C to stop'));

    const control = startWatcher({
      db: ctx.db,
      baseDir: ctx.outputDir,
      debounceDelay: 2000,
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
    console.log(chalk.yellow('Manual sync from markdown not yet implemented'));
    console.log(chalk.gray('  Use: sg sync --watch for automatic sync'));
  } else if (options.toMarkdown) {
    // Manual sync from database to markdown
    console.log(chalk.yellow('Manual sync to markdown not yet implemented'));
    console.log(chalk.gray('  Use: sg sync --watch for automatic sync'));
  } else {
    // Default: show help
    console.log(chalk.blue('Sync options:'));
    console.log(chalk.gray('  --watch          Watch for file changes and auto-sync'));
    console.log(chalk.gray('  --from-markdown  Sync from markdown to database (manual)'));
    console.log(chalk.gray('  --to-markdown    Sync from database to markdown (manual)'));
    console.log();
    console.log(chalk.gray('For automatic sync, use: sg sync --watch'));
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
      console.log(JSON.stringify({ success: true, outputDir: options.output }, null, 2));
    } else {
      console.log(chalk.green('✓ Exported to JSONL'));
      console.log(chalk.gray(`  Output: ${options.output}`));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to export'));
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
      console.log(JSON.stringify({ success: true, inputDir: options.input }, null, 2));
    } else {
      console.log(chalk.green('✓ Imported from JSONL'));
      console.log(chalk.gray(`  Input: ${options.input}`));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to import'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
