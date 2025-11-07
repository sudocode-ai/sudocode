/**
 * CLI handlers for context generation and retrieval commands
 */

import chalk from "chalk";
import type Database from "better-sqlite3";
import { aggregateContext, getCompletionStats } from "../learning/context-aggregator.js";
import { generateDocumentation, generateSummaryReport } from "../learning/documentation-generator.js";
import {
  getRelevantContextForIssue,
  getRelevantContextForSpec,
  formatContextForAgent,
} from "../learning/context-retrieval.js";
import { getIssue } from "../operations/issues.js";
import { getSpec } from "../operations/specs.js";

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface ContextGenerateOptions {
  since?: string; // ISO date
  limit?: number;
  minOccurrences?: number;
  overwrite?: boolean;
}

export interface ContextQueryOptions {
  maxSimilar?: number;
  maxPatterns?: number;
  maxGotchas?: number;
  maxDecisions?: number;
}

/**
 * Generate context documentation from completion summaries
 */
export async function handleContextGenerate(
  ctx: CommandContext,
  options: ContextGenerateOptions
): Promise<void> {
  try {
    console.log(chalk.cyan("Generating context documentation...\n"));

    // Get completion stats
    const stats = getCompletionStats(ctx.db);

    if (stats.total_with_summaries === 0) {
      console.log(chalk.yellow("⚠ No completion summaries found."));
      console.log(chalk.gray("  Run 'sudocode issue complete --reflect' to add summaries.\n"));
      return;
    }

    console.log(chalk.gray(`Found ${stats.total_with_summaries} completions with summaries`));
    console.log(chalk.gray(`  • ${stats.total_issues_with_summaries} issues`));
    console.log(chalk.gray(`  • ${stats.total_specs_with_summaries} specs`));
    console.log(chalk.gray(`  • Coverage: ${stats.coverage_percentage}%\n`));

    // Aggregate context
    console.log(chalk.gray("Aggregating learnings..."));
    const context = aggregateContext(ctx.db, {
      since: options.since,
      limit: options.limit,
    });

    // Generate documentation
    console.log(chalk.gray("Generating documentation files..."));
    const files = generateDocumentation(context, {
      outputDir: ctx.outputDir,
      overwrite: options.overwrite !== false,
      minOccurrences: options.minOccurrences || 1,
    });

    // Output summary
    if (ctx.jsonOutput) {
      console.log(JSON.stringify({
        stats: context.metrics,
        files_generated: files,
        patterns_count: {
          successful: context.successful_patterns.length,
          anti: context.anti_patterns.length,
          code: context.code_patterns.length,
        },
        blockers_count: context.common_blockers.length,
        decisions_count: context.decisions.length,
      }, null, 2));
    } else {
      console.log(generateSummaryReport(context, files));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to generate context"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Query relevant context for an issue or spec
 */
export async function handleContextQuery(
  ctx: CommandContext,
  entityId: string,
  options: ContextQueryOptions
): Promise<void> {
  try {
    // Try to find as issue first, then spec
    let issue = getIssue(ctx.db, entityId);
    let spec: any = null;

    if (!issue) {
      spec = getSpec(ctx.db, entityId);
    }

    if (!issue && !spec) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    console.log(chalk.cyan(`Retrieving relevant context for ${entityId}...\n`));

    // Get relevant context
    const context = issue
      ? getRelevantContextForIssue(ctx.db, issue, {
          maxSimilarItems: options.maxSimilar,
          maxPatterns: options.maxPatterns,
          maxGotchas: options.maxGotchas,
          maxDecisions: options.maxDecisions,
        })
      : getRelevantContextForSpec(ctx.db, spec, {
          maxSimilarItems: options.maxSimilar,
          maxPatterns: options.maxPatterns,
          maxGotchas: options.maxGotchas,
          maxDecisions: options.maxDecisions,
        });

    // Output
    if (ctx.jsonOutput) {
      console.log(JSON.stringify(context, null, 2));
    } else {
      const formatted = formatContextForAgent(context);
      console.log(formatted);

      // Summary
      const total = context.similar_issues.length + context.similar_specs.length;
      console.log(chalk.gray("─".repeat(80)));
      console.log(chalk.green(`✓ Found ${total} similar items, ${context.applicable_patterns.length} patterns, ${context.known_gotchas.length} gotchas`));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to query context"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Show context generation statistics
 */
export async function handleContextStats(
  ctx: CommandContext
): Promise<void> {
  try {
    const stats = getCompletionStats(ctx.db);

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.cyan("Context Coverage Statistics\n"));
      console.log(chalk.gray("─".repeat(80)));
      console.log(`Total completions with summaries: ${chalk.green(stats.total_with_summaries)}`);
      console.log(`  • Issues: ${stats.total_issues_with_summaries}`);
      console.log(`  • Specs: ${stats.total_specs_with_summaries}`);
      console.log(`Completions without summaries: ${chalk.yellow(stats.total_without_summaries)}`);
      console.log(`Coverage: ${chalk.cyan(stats.coverage_percentage + "%")}`);
      console.log(chalk.gray("─".repeat(80)));

      if (stats.total_without_summaries > 0) {
        console.log(chalk.yellow(`\nℹ ${stats.total_without_summaries} completed items lack completion summaries.`));
        console.log(chalk.gray("  Consider adding them with: sudocode issue complete <id> --reflect\n"));
      }
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to get context stats"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
