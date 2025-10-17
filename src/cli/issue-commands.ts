/**
 * CLI handlers for issue commands
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { generateIssueId } from '../id-generator.js';
import { createIssue, getIssue, listIssues, updateIssue, closeIssue } from '../operations/issues.js';
import { getOutgoingRelationships, getIncomingRelationships } from '../operations/relationships.js';
import { getTags, setTags } from '../operations/tags.js';
import { exportToJSONL } from '../export.js';

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface IssueCreateOptions {
  type: string;
  priority: string;
  description?: string;
  assignee?: string;
  parent?: string;
  tags?: string;
  estimate?: string;
}

export async function handleIssueCreate(
  ctx: CommandContext,
  title: string,
  options: IssueCreateOptions
): Promise<void> {
  try {
    const issueId = generateIssueId(ctx.outputDir);

    const issue = createIssue(ctx.db, {
      id: issueId,
      title,
      description: options.description || '',
      content: '',
      issue_type: options.type as any,
      status: 'open',
      priority: parseInt(options.priority),
      created_by: process.env.USER || 'system',
      assignee: options.assignee || null,
      estimated_minutes: options.estimate ? parseInt(options.estimate) : null,
      parent_id: options.parent || null,
    });

    if (options.tags) {
      const tags = options.tags.split(',').map((t) => t.trim());
      setTags(ctx.db, issueId, 'issue', tags);
    }

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify({ id: issueId, title, status: 'open' }, null, 2));
    } else {
      console.log(chalk.green('✓ Created issue'), chalk.cyan(issueId));
      console.log(chalk.gray(`  Title: ${title}`));
      console.log(chalk.gray(`  Type: ${options.type}`));
      if (options.assignee) {
        console.log(chalk.gray(`  Assignee: ${options.assignee}`));
      }
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to create issue'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface IssueListOptions {
  status?: string;
  type?: string;
  assignee?: string;
  priority?: string;
  limit: string;
}

export async function handleIssueList(
  ctx: CommandContext,
  options: IssueListOptions
): Promise<void> {
  try {
    const issues = listIssues(ctx.db, {
      status: options.status as any,
      issue_type: options.type as any,
      assignee: options.assignee,
      priority: options.priority ? parseInt(options.priority) : undefined,
      limit: parseInt(options.limit),
    });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      if (issues.length === 0) {
        console.log(chalk.gray('No issues found'));
        return;
      }

      console.log(chalk.bold(`\nFound ${issues.length} issue(s):\n`));

      for (const issue of issues) {
        const statusColor =
          issue.status === 'closed'
            ? chalk.green
            : issue.status === 'in_progress'
            ? chalk.yellow
            : issue.status === 'blocked'
            ? chalk.red
            : chalk.gray;

        const assigneeStr = issue.assignee ? chalk.gray(`@${issue.assignee}`) : '';
        console.log(
          chalk.cyan(issue.id),
          statusColor(`[${issue.status}]`),
          issue.title,
          assigneeStr
        );
        console.log(
          chalk.gray(`  Type: ${issue.issue_type} | Priority: ${issue.priority}`)
        );
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to list issues'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function handleIssueShow(
  ctx: CommandContext,
  id: string
): Promise<void> {
  try {
    const issue = getIssue(ctx.db, id);
    if (!issue) {
      console.error(chalk.red(`✗ Issue not found: ${id}`));
      process.exit(1);
    }

    const outgoing = getOutgoingRelationships(ctx.db, id, 'issue');
    const incoming = getIncomingRelationships(ctx.db, id, 'issue');
    const tags = getTags(ctx.db, id, 'issue');

    if (ctx.jsonOutput) {
      console.log(JSON.stringify({ ...issue, relationships: { outgoing, incoming }, tags }, null, 2));
    } else {
      console.log();
      console.log(chalk.bold.cyan(issue.id), chalk.bold(issue.title));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray('Type:'), issue.issue_type);
      console.log(chalk.gray('Status:'), issue.status);
      console.log(chalk.gray('Priority:'), issue.priority);
      if (issue.assignee) {
        console.log(chalk.gray('Assignee:'), issue.assignee);
      }
      if (issue.estimated_minutes) {
        console.log(chalk.gray('Estimate:'), `${issue.estimated_minutes} minutes`);
      }
      if (issue.parent_id) {
        console.log(chalk.gray('Parent:'), issue.parent_id);
      }
      console.log(chalk.gray('Created:'), issue.created_at, 'by', issue.created_by);
      console.log(chalk.gray('Updated:'), issue.updated_at);
      if (issue.closed_at) {
        console.log(chalk.gray('Closed:'), issue.closed_at);
      }

      if (tags.length > 0) {
        console.log(chalk.gray('Tags:'), tags.join(', '));
      }

      if (issue.description) {
        console.log();
        console.log(chalk.bold('Description:'));
        console.log(issue.description);
      }

      if (issue.content) {
        console.log();
        console.log(chalk.bold('Content:'));
        console.log(issue.content);
      }

      if (outgoing.length > 0) {
        console.log();
        console.log(chalk.bold('Outgoing Relationships:'));
        for (const rel of outgoing) {
          console.log(
            `  ${chalk.yellow(rel.relationship_type)} → ${chalk.cyan(rel.to_id)} (${rel.to_type})`
          );
        }
      }

      if (incoming.length > 0) {
        console.log();
        console.log(chalk.bold('Incoming Relationships:'));
        for (const rel of incoming) {
          console.log(
            `  ${chalk.cyan(rel.from_id)} (${rel.from_type}) → ${chalk.yellow(rel.relationship_type)}`
          );
        }
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to show issue'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface IssueUpdateOptions {
  status?: string;
  priority?: string;
  assignee?: string;
  type?: string;
  title?: string;
  description?: string;
}

export async function handleIssueUpdate(
  ctx: CommandContext,
  id: string,
  options: IssueUpdateOptions
): Promise<void> {
  try {
    const updates: any = {};
    if (options.status) updates.status = options.status;
    if (options.priority) updates.priority = parseInt(options.priority);
    if (options.assignee) updates.assignee = options.assignee;
    if (options.type) updates.issue_type = options.type;
    if (options.title) updates.title = options.title;
    if (options.description) updates.description = options.description;

    const issue = updateIssue(ctx.db, id, updates);

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(issue, null, 2));
    } else {
      console.log(chalk.green('✓ Updated issue'), chalk.cyan(id));
      Object.keys(updates).forEach((key) => {
        console.log(chalk.gray(`  ${key}: ${updates[key]}`));
      });
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to update issue'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface IssueCloseOptions {
  reason?: string;
}

export async function handleIssueClose(
  ctx: CommandContext,
  ids: string[],
  options: IssueCloseOptions
): Promise<void> {
  try {
    const results = [];
    for (const id of ids) {
      try {
        closeIssue(ctx.db, id);
        results.push({ id, success: true });
        if (!ctx.jsonOutput) {
          console.log(chalk.green('✓ Closed issue'), chalk.cyan(id));
        }
      } catch (error) {
        results.push({ id, success: false, error: error instanceof Error ? error.message : String(error) });
        if (!ctx.jsonOutput) {
          console.error(chalk.red('✗ Failed to close'), chalk.cyan(id), ':', error instanceof Error ? error.message : String(error));
        }
      }
    }

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to close issues'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface IssueDeleteOptions {
  hard?: boolean;
}

export async function handleIssueDelete(
  ctx: CommandContext,
  ids: string[],
  options: IssueDeleteOptions
): Promise<void> {
  try {
    const results = [];

    for (const id of ids) {
      try {
        const issue = getIssue(ctx.db, id);
        if (!issue) {
          results.push({ id, success: false, error: 'Issue not found' });
          if (!ctx.jsonOutput) {
            console.error(chalk.red('✗ Issue not found:'), chalk.cyan(id));
          }
          continue;
        }

        if (options.hard) {
          // Hard delete - permanently remove from database
          const { deleteIssue } = await import('../operations/issues.js');
          const deleted = deleteIssue(ctx.db, id);
          if (deleted) {
            results.push({ id, success: true, action: 'hard_delete' });
            if (!ctx.jsonOutput) {
              console.log(chalk.green('✓ Permanently deleted issue'), chalk.cyan(id));
            }
          } else {
            results.push({ id, success: false, error: 'Delete failed' });
            if (!ctx.jsonOutput) {
              console.error(chalk.red('✗ Failed to delete issue'), chalk.cyan(id));
            }
          }
        } else {
          // Soft delete - close the issue
          closeIssue(ctx.db, id);
          results.push({ id, success: true, action: 'soft_delete', status: 'closed' });
          if (!ctx.jsonOutput) {
            console.log(chalk.green('✓ Closed issue'), chalk.cyan(id));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id, success: false, error: message });
        if (!ctx.jsonOutput) {
          console.error(chalk.red('✗ Failed to process'), chalk.cyan(id), ':', message);
        }
      }
    }

    // Export to JSONL after all deletions
    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to delete issues'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
