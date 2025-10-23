/**
 * CLI handlers for relationship commands
 */

import chalk from 'chalk';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { addRelationship } from '../operations/relationships.js';
import { exportToJSONL } from '../export.js';
import { syncJSONLToMarkdown } from '../sync.js';
import { getSpec } from '../operations/specs.js';
import { getIssue } from '../operations/issues.js';
import type { RelationshipType } from '../types.js';

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface LinkOptions {
  type: string;
}

export async function handleLink(
  ctx: CommandContext,
  from: string,
  to: string,
  options: LinkOptions
): Promise<void> {
  try {
    // Determine entity types by checking existence
    let fromType: 'spec' | 'issue';
    let toType: 'spec' | 'issue';

    // Determine 'from' entity type
    if (getSpec(ctx.db, from)) {
      fromType = 'spec';
    } else if (getIssue(ctx.db, from)) {
      fromType = 'issue';
    } else {
      console.error(chalk.red(`✗ Entity not found: ${from}`));
      process.exit(1);
    }

    // Determine 'to' entity type
    if (getSpec(ctx.db, to)) {
      toType = 'spec';
    } else if (getIssue(ctx.db, to)) {
      toType = 'issue';
    } else {
      console.error(chalk.red(`✗ Entity not found: ${to}`));
      process.exit(1);
    }

    addRelationship(ctx.db, {
      from_id: from,
      from_type: fromType,
      to_id: to,
      to_type: toType,
      relationship_type: options.type as RelationshipType,
    });

    // Export to JSONL to persist the relationship
    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    // Sync the "from" entity back to markdown so the relationship appears in frontmatter
    if (fromType === 'spec') {
      const spec = getSpec(ctx.db, from);
      if (spec) {
        const specPath = path.join(ctx.outputDir, spec.file_path);
        await syncJSONLToMarkdown(ctx.db, from, 'spec', specPath);
      }
    } else {
      const issue = getIssue(ctx.db, from);
      if (issue) {
        const issuePath = path.join(ctx.outputDir, 'issues', `${from}.md`);
        await syncJSONLToMarkdown(ctx.db, from, 'issue', issuePath);
      }
    }

    if (ctx.jsonOutput) {
      console.log(JSON.stringify({ from, to, type: options.type, success: true }, null, 2));
    } else {
      console.log(chalk.green('✓ Created relationship'));
      console.log(chalk.cyan(from), chalk.yellow(options.type), '→', chalk.cyan(to));
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to create relationship'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
