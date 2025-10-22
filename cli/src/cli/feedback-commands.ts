/**
 * CLI handlers for feedback commands
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import {
  createFeedback,
  getFeedback,
  listFeedback,
  updateFeedback,
  dismissFeedback,
  type ListFeedbackOptions,
} from '../operations/feedback.js';
import { getSpec } from '../operations/specs.js';
import { getIssue } from '../operations/issues.js';
import { createFeedbackAnchor, createAnchorByText } from '../operations/feedback-anchors.js';
import type { FeedbackType } from '../types.js';

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface FeedbackAddOptions {
  line?: string;
  text?: string;
  type: string;
  content: string;
  agent?: string;
}

/**
 * Add feedback to a spec from an issue
 */
export async function handleFeedbackAdd(
  ctx: CommandContext,
  issueId: string,
  specId: string,
  options: FeedbackAddOptions
): Promise<void> {
  try {
    // Validate issue and spec exist
    const issue = getIssue(ctx.db, issueId);
    if (!issue) {
      console.error(chalk.red(`✗ Issue not found: ${issueId}`));
      process.exit(1);
    }

    const spec = getSpec(ctx.db, specId);
    if (!spec) {
      console.error(chalk.red(`✗ Spec not found: ${specId}`));
      process.exit(1);
    }

    // Read spec content for anchor creation
    const specContent = spec.content;

    // Create anchor based on line number or text search
    let anchor;
    if (options.line) {
      const lineNumber = parseInt(options.line);
      if (isNaN(lineNumber) || lineNumber < 1) {
        console.error(chalk.red('✗ Invalid line number'));
        process.exit(1);
      }
      anchor = createFeedbackAnchor(specContent, lineNumber);
    } else if (options.text) {
      anchor = createAnchorByText(specContent, options.text);
      if (!anchor) {
        console.error(chalk.red(`✗ Text not found in spec: "${options.text}"`));
        process.exit(1);
      }
    } else {
      console.error(chalk.red('✗ Either --line or --text must be specified'));
      process.exit(1);
    }

    // Create feedback
    const feedback = createFeedback(ctx.db, {
      issue_id: issueId,
      spec_id: specId,
      feedback_type: options.type as FeedbackType,
      content: options.content,
      agent: options.agent || process.env.USER || 'cli',
      anchor,
      dismissed: false,
    });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(feedback, null, 2));
    } else {
      console.log(chalk.green('✓ Created feedback'), chalk.cyan(feedback.id));
      console.log(chalk.gray(`  Issue: ${issueId}`));
      console.log(chalk.gray(`  Spec: ${specId}`));
      console.log(chalk.gray(`  Type: ${options.type}`));
      console.log(chalk.gray(`  Location: ${anchor.section_heading || 'Unknown'} (line ${anchor.line_number})`));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to create feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface FeedbackListOptions {
  issue?: string;
  spec?: string;
  type?: string;
  dismissed?: string;
  limit: string;
}

/**
 * List feedback with optional filters
 */
export async function handleFeedbackList(
  ctx: CommandContext,
  options: FeedbackListOptions
): Promise<void> {
  try {
    const filters: ListFeedbackOptions = {
      issue_id: options.issue,
      spec_id: options.spec,
      feedback_type: options.type as FeedbackType | undefined,
      dismissed: options.dismissed !== undefined ? options.dismissed === 'true' : undefined,
      limit: parseInt(options.limit),
    };

    const feedbackList = listFeedback(ctx.db, filters);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(feedbackList, null, 2));
    } else {
      if (feedbackList.length === 0) {
        console.log(chalk.gray('No feedback found'));
        return;
      }

      console.log(chalk.bold(`\nFound ${feedbackList.length} feedback item(s):\n`));

      for (const feedback of feedbackList) {
        const anchor = typeof feedback.anchor === 'string' ? JSON.parse(feedback.anchor) : feedback.anchor;

        const statusColor = feedback.dismissed ? chalk.gray : chalk.white;

        const anchorStatusColor =
          anchor.anchor_status === 'valid'
            ? chalk.green
            : anchor.anchor_status === 'relocated'
            ? chalk.yellow
            : chalk.red;

        console.log(
          chalk.cyan(feedback.id),
          statusColor(`[${feedback.dismissed ? 'dismissed' : 'active'}]`),
          anchorStatusColor(`[${anchor.anchor_status}]`),
          chalk.gray(`${feedback.issue_id} → ${feedback.spec_id}`)
        );
        console.log(
          chalk.gray(`  Type: ${feedback.feedback_type} | ${anchor.section_heading || 'No section'} (line ${anchor.line_number})`)
        );
        console.log(chalk.gray(`  ${feedback.content.substring(0, 80)}${feedback.content.length > 80 ? '...' : ''}`));
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to list feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Show detailed feedback information
 */
export async function handleFeedbackShow(
  ctx: CommandContext,
  id: string
): Promise<void> {
  try {
    const feedback = getFeedback(ctx.db, id);
    if (!feedback) {
      console.error(chalk.red(`✗ Feedback not found: ${id}`));
      process.exit(1);
    }

    const anchor = typeof feedback.anchor === 'string' ? JSON.parse(feedback.anchor) : feedback.anchor;

    if (ctx.jsonOutput) {
      console.log(JSON.stringify({ ...feedback, anchor }, null, 2));
    } else {
      console.log();
      console.log(chalk.bold.cyan(feedback.id), chalk.bold(feedback.feedback_type));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.gray('Issue:'), feedback.issue_id);
      console.log(chalk.gray('Spec:'), feedback.spec_id);
      console.log(chalk.gray('Status:'), feedback.dismissed ? 'Dismissed' : 'Active');
      console.log(chalk.gray('Agent:'), feedback.agent);
      console.log(chalk.gray('Created:'), feedback.created_at);
      console.log(chalk.gray('Updated:'), feedback.updated_at);

      console.log();
      console.log(chalk.bold('Content:'));
      console.log(feedback.content);

      console.log();
      console.log(chalk.bold('Anchor Location:'));

      const anchorStatusColor =
        anchor.anchor_status === 'valid'
          ? chalk.green
          : anchor.anchor_status === 'relocated'
          ? chalk.yellow
          : chalk.red;

      console.log(chalk.gray('  Status:'), anchorStatusColor(anchor.anchor_status));
      console.log(chalk.gray('  Section:'), anchor.section_heading || 'None');
      console.log(chalk.gray('  Line:'), anchor.line_number || 'Unknown');

      if (anchor.text_snippet) {
        console.log(chalk.gray('  Snippet:'), `"${anchor.text_snippet}"`);
      }

      if (anchor.original_location && anchor.anchor_status !== 'valid') {
        console.log();
        console.log(chalk.bold('Original Location:'));
        console.log(chalk.gray('  Line:'), anchor.original_location.line_number);
        console.log(chalk.gray('  Section:'), anchor.original_location.section_heading || 'None');
      }


      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to show feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface FeedbackDismissOptions {
}

/**
 * Dismiss feedback
 */
export async function handleFeedbackDismiss(
  ctx: CommandContext,
  id: string,
  options: FeedbackDismissOptions
): Promise<void> {
  try {
    const feedback = dismissFeedback(ctx.db, id);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(feedback, null, 2));
    } else {
      console.log(chalk.green('✓ Dismissed feedback'), chalk.cyan(id));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to dismiss feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * List stale feedback anchors
 */
export async function handleFeedbackStale(
  ctx: CommandContext
): Promise<void> {
  try {
    const allFeedback = listFeedback(ctx.db, {});

    const staleFeedback = allFeedback.filter((f) => {
      const anchor = typeof f.anchor === 'string' ? JSON.parse(f.anchor) : f.anchor;
      return anchor.anchor_status === 'stale';
    });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(staleFeedback, null, 2));
    } else {
      if (staleFeedback.length === 0) {
        console.log(chalk.green('✓ No stale anchors found'));
        return;
      }

      console.log(chalk.bold.red(`\nFound ${staleFeedback.length} stale anchor(s):\n`));

      for (const feedback of staleFeedback) {
        const anchor = typeof feedback.anchor === 'string' ? JSON.parse(feedback.anchor) : feedback.anchor;

        console.log(
          chalk.cyan(feedback.id),
          chalk.red('[stale]'),
          chalk.gray(`${feedback.issue_id} → ${feedback.spec_id}`)
        );
        console.log(
          chalk.gray(`  Original: ${anchor.original_location?.section_heading || 'Unknown'} (line ${anchor.original_location?.line_number})`)
        );
        if (anchor.text_snippet) {
          console.log(chalk.gray(`  Snippet: "${anchor.text_snippet}"`));
        }
      }
      console.log();
      console.log(chalk.yellow('Tip: Use `sg feedback relocate <id> --line <number>` to manually relocate anchors'));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to list stale feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface FeedbackRelocateOptions {
  line: string;
}

/**
 * Manually relocate a stale anchor
 */
export async function handleFeedbackRelocate(
  ctx: CommandContext,
  id: string,
  options: FeedbackRelocateOptions
): Promise<void> {
  try {
    const feedback = getFeedback(ctx.db, id);
    if (!feedback) {
      console.error(chalk.red(`✗ Feedback not found: ${id}`));
      process.exit(1);
    }

    const spec = getSpec(ctx.db, feedback.spec_id);
    if (!spec) {
      console.error(chalk.red(`✗ Spec not found: ${feedback.spec_id}`));
      process.exit(1);
    }

    const lineNumber = parseInt(options.line);
    if (isNaN(lineNumber) || lineNumber < 1) {
      console.error(chalk.red('✗ Invalid line number'));
      process.exit(1);
    }

    // Create new anchor at specified line
    const newAnchor = createFeedbackAnchor(spec.content, lineNumber);

    // Preserve original location
    const oldAnchor = typeof feedback.anchor === 'string' ? JSON.parse(feedback.anchor) : feedback.anchor;
    newAnchor.original_location = oldAnchor.original_location || {
      line_number: oldAnchor.line_number || 0,
      section_heading: oldAnchor.section_heading,
    };
    newAnchor.anchor_status = 'relocated';

    // Update feedback with new anchor
    const updated = updateFeedback(ctx.db, id, { anchor: newAnchor });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log(chalk.green('✓ Relocated feedback anchor'), chalk.cyan(id));
      console.log(chalk.gray(`  New location: ${newAnchor.section_heading || 'Unknown'} (line ${lineNumber})`));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to relocate feedback'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
