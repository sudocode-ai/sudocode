/**
 * CLI handlers for relationship commands
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { addRelationship } from '../operations/relationships.js';
import { exportToJSONL } from '../export.js';
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
    // Parse entity IDs to determine types
    const fromType = from.startsWith('spec-') ? 'spec' : 'issue';
    const toType = to.startsWith('spec-') ? 'spec' : 'issue';

    addRelationship(ctx.db, {
      from_id: from,
      from_type: fromType,
      to_id: to,
      to_type: toType,
      relationship_type: options.type as RelationshipType,
    });

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

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
