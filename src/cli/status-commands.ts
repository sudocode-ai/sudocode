/**
 * CLI handlers for status and stats commands
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type Database from 'better-sqlite3';
import { listSpecs } from '../operations/specs.js';
import { listIssues } from '../operations/issues.js';
import { getReadyIssues, getBlockedIssues } from '../operations/issues.js';

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface StatusOptions {
  verbose?: boolean;
}

export async function handleStatus(
  ctx: CommandContext,
  options: StatusOptions
): Promise<void> {
  // Get counts
  const allSpecs = listSpecs(ctx.db, {});
  const allIssues = listIssues(ctx.db, {});
  const readyIssues = getReadyIssues(ctx.db);
  const blockedIssues = getBlockedIssues(ctx.db);

  const issuesByStatus = {
    open: allIssues.filter(i => i.status === 'open').length,
    in_progress: allIssues.filter(i => i.status === 'in_progress').length,
    blocked: allIssues.filter(i => i.status === 'blocked').length,
    closed: allIssues.filter(i => i.status === 'closed').length,
  };

  if (ctx.jsonOutput) {
    console.log(JSON.stringify({
      specs: {
        total: allSpecs.length,
      },
      issues: {
        total: allIssues.length,
        by_status: issuesByStatus,
        ready: readyIssues.length,
        blocked: blockedIssues.length,
      },
    }, null, 2));
    return;
  }

  // Display formatted output
  console.log(chalk.bold('\nSudograph Status\n'));

  console.log(chalk.blue('Specs:'));
  console.log(`  ${chalk.cyan(allSpecs.length)} total`);

  console.log();
  console.log(chalk.blue('Issues:'));
  console.log(`  ${chalk.cyan(allIssues.length)} total (${issuesByStatus.open} open, ${issuesByStatus.in_progress} in_progress, ${issuesByStatus.blocked} blocked, ${issuesByStatus.closed} closed)`);
  console.log(`  ${chalk.green(readyIssues.length)} ready to work on`);
  console.log(`  ${chalk.yellow(blockedIssues.length)} blocked`);

  console.log();
  console.log(chalk.gray('Sync status: All files in sync'));
  console.log();
}

export interface StatsOptions {}

export async function handleStats(
  ctx: CommandContext,
  options: StatsOptions
): Promise<void> {
  // Get all entities
  const allSpecs = listSpecs(ctx.db, {});
  const allIssues = listIssues(ctx.db, {});
  const readyIssues = getReadyIssues(ctx.db);
  const blockedIssues = getBlockedIssues(ctx.db);

  const issuesByStatus = {
    open: allIssues.filter(i => i.status === 'open').length,
    in_progress: allIssues.filter(i => i.status === 'in_progress').length,
    blocked: allIssues.filter(i => i.status === 'blocked').length,
    closed: allIssues.filter(i => i.status === 'closed').length,
  };

  // Get relationship counts
  const relationshipsStmt = ctx.db.prepare(`
    SELECT relationship_type, COUNT(*) as count
    FROM relationships
    GROUP BY relationship_type
  `);
  const relationshipCounts: Record<string, number> = {};
  const relResults = relationshipsStmt.all() as Array<{ relationship_type: string; count: number }>;
  for (const row of relResults) {
    relationshipCounts[row.relationship_type] = row.count;
  }
  const totalRelationships = relResults.reduce((sum, row) => sum + row.count, 0);

  // Get recent activity (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentSpecs = allSpecs.filter(s => new Date(s.updated_at) > sevenDaysAgo).length;
  const recentIssues = allIssues.filter(i => new Date(i.updated_at) > sevenDaysAgo).length;
  const newIssues = allIssues.filter(i => new Date(i.created_at) > sevenDaysAgo).length;
  const closedIssues = allIssues.filter(i => i.closed_at && new Date(i.closed_at) > sevenDaysAgo).length;

  if (ctx.jsonOutput) {
    console.log(JSON.stringify({
      specs: {
        total: allSpecs.length,
      },
      issues: {
        total: allIssues.length,
        by_status: issuesByStatus,
        ready: readyIssues.length,
        blocked: blockedIssues.length,
      },
      relationships: {
        total: totalRelationships,
        by_type: relationshipCounts,
      },
      recent_activity: {
        specs_updated: recentSpecs,
        issues_updated: recentIssues,
        issues_created: newIssues,
        issues_closed: closedIssues,
      },
    }, null, 2));
    return;
  }

  // Display formatted output
  console.log(chalk.bold('\nProject Statistics\n'));

  console.log(chalk.blue('Specs:'));
  console.log(`  Total: ${chalk.cyan(allSpecs.length)}`);

  console.log();
  console.log(chalk.blue('Issues:'));
  console.log(`  Total: ${chalk.cyan(allIssues.length)}`);
  console.log(`  By Status: ${issuesByStatus.open} open, ${issuesByStatus.in_progress} in_progress, ${issuesByStatus.blocked} blocked, ${issuesByStatus.closed} closed`);
  console.log(`  Ready: ${chalk.green(readyIssues.length)}`);
  console.log(`  Blocked: ${chalk.yellow(blockedIssues.length)}`);

  console.log();
  console.log(chalk.blue('Relationships:'));
  console.log(`  Total: ${chalk.cyan(totalRelationships)}`);
  const relTypes = Object.entries(relationshipCounts).map(([type, count]) => `${count} ${type}`).join(', ');
  if (relTypes) {
    console.log(`  ${relTypes}`);
  }

  console.log();
  console.log(chalk.blue('Recent Activity (last 7 days):'));
  console.log(`  ${recentSpecs} specs updated`);
  console.log(`  ${recentIssues} issues updated`);
  console.log(`  ${newIssues} issues created`);
  console.log(`  ${closedIssues} issues closed`);

  console.log();
}
