/**
 * CLI handlers for query commands (ready, blocked)
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { getReadyIssues, getBlockedIssues } from '../operations/issues.js';

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface ReadyOptions {
  issues?: boolean;
}

export async function handleReady(
  ctx: CommandContext,
  options: ReadyOptions
): Promise<void> {
  try {
    const results: any = {};

    results.issues = getReadyIssues(ctx.db);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.issues.length === 0) {
        console.log(chalk.gray('\nNo ready issues'));
      } else {
        console.log(chalk.bold(`\nReady Issues (${results.issues.length}):\n`));
        for (const issue of results.issues) {
          const assigneeStr = issue.assignee ? chalk.gray(`@${issue.assignee}`) : '';
          console.log(chalk.cyan(issue.id), issue.title, assigneeStr);
          console.log(chalk.gray(`  Priority: ${issue.priority}`));
        }
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to get ready items'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface BlockedOptions {
  issues?: boolean;
}

export async function handleBlocked(
  ctx: CommandContext,
  options: BlockedOptions
): Promise<void> {
  try {
    const results: any = {};

    results.issues = getBlockedIssues(ctx.db);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.issues.length === 0) {
        console.log(chalk.gray('\nNo blocked issues'));
      } else {
        console.log(chalk.bold(`\nBlocked Issues (${results.issues.length}):\n`));
        for (const issue of results.issues) {
          console.log(chalk.cyan(issue.id), issue.title);
          console.log(chalk.gray(`  Reason: ${issue.status}`));
        }
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to get blocked items'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
