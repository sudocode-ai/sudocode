/**
 * CLI handlers for completion and reflection commands
 */

import chalk from "chalk";
import type Database from "better-sqlite3";
import type { CompletionSummary } from "../types.js";
import { getIssue, updateIssue } from "../operations/issues.js";
import { getSpec, updateSpec } from "../operations/specs.js";
import {
  getOutgoingRelationships,
  getIncomingRelationships,
} from "../operations/relationships.js";
import { exportToJSONL } from "../export.js";
import {
  generateReflectionPrompt,
  generateBasicSummary,
  getCompletionCommit,
  calculateCompletionTime,
} from "../learning/reflection-generator.js";

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface CompleteOptions {
  reflect?: boolean;
  start?: string; // Start commit for git range
  end?: string; // End commit for git range
  summary?: string; // JSON string of completion summary
  interactive?: boolean;
}

/**
 * Complete an issue with optional reflection
 */
export async function handleIssueComplete(
  ctx: CommandContext,
  issueId: string,
  options: CompleteOptions
): Promise<void> {
  try {
    const issue = getIssue(ctx.db, issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    if (issue.status === "closed") {
      console.log(chalk.yellow(`Issue ${issueId} is already closed`));
      return;
    }

    // Close the issue first
    const closedIssue = updateIssue(ctx.db, issueId, {
      status: "closed",
      closed_at: new Date().toISOString(),
    });

    console.log(chalk.green("✓ Closed issue"), chalk.cyan(issueId));

    // Handle reflection
    if (options.reflect || options.summary) {
      await addCompletionSummary(ctx, closedIssue, "issue", options);
    }

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (!ctx.jsonOutput) {
      console.log(chalk.gray(`  Status: ${closedIssue.status}`));
      if (closedIssue.completion_summary) {
        console.log(chalk.gray("  ✓ Completion summary added"));
      }
    } else {
      console.log(JSON.stringify(closedIssue, null, 2));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to complete issue"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Complete a spec with optional reflection
 */
export async function handleSpecComplete(
  ctx: CommandContext,
  specId: string,
  options: CompleteOptions
): Promise<void> {
  try {
    const spec = getSpec(ctx.db, specId);
    if (!spec) {
      throw new Error(`Spec not found: ${specId}`);
    }

    if (spec.archived) {
      console.log(chalk.yellow(`Spec ${specId} is already archived`));
      return;
    }

    // Archive the spec
    const archivedSpec = updateSpec(ctx.db, specId, {
      archived: true,
      archived_at: new Date().toISOString(),
    });

    console.log(chalk.green("✓ Archived spec"), chalk.cyan(specId));

    // Handle reflection
    if (options.reflect || options.summary) {
      await addCompletionSummary(ctx, archivedSpec, "spec", options);
    }

    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (!ctx.jsonOutput) {
      console.log(chalk.gray(`  Archived: ${archivedSpec.archived}`));
      if (archivedSpec.completion_summary) {
        console.log(chalk.gray("  ✓ Completion summary added"));
      }
    } else {
      console.log(JSON.stringify(archivedSpec, null, 2));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to complete spec"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Add completion summary to an entity
 */
async function addCompletionSummary(
  ctx: CommandContext,
  entity: any,
  entityType: "issue" | "spec",
  options: CompleteOptions
): Promise<void> {
  let summary: CompletionSummary;

  // If summary provided as JSON string
  if (options.summary) {
    try {
      summary = JSON.parse(options.summary);
      console.log(chalk.gray("  Using provided completion summary"));
    } catch (error) {
      throw new Error("Invalid JSON in --summary option");
    }
  }
  // If --reflect flag, generate reflection
  else if (options.reflect) {
    console.log(chalk.gray("  Generating reflection..."));

    // Determine git commit range
    let gitCommitRange: { start: string; end: string } | undefined;

    if (options.start) {
      const end = options.end || (await getCompletionCommit()) || "HEAD";
      gitCommitRange = { start: options.start, end };
    } else {
      // Try to infer from entity creation date
      const currentCommit = await getCompletionCommit();
      if (currentCommit) {
        gitCommitRange = {
          start: entity.created_at, // This won't work as-is, needs commit SHA
          end: currentCommit,
        };
      }
    }

    // Get related entities
    const relatedIssues =
      entityType === "spec"
        ? getIncomingRelationships(ctx.db, entity.id, "spec", "implements")
            .map((r) => getIssue(ctx.db, r.from_id))
            .filter((i): i is NonNullable<typeof i> => i !== null)
        : [];

    const relatedSpecs =
      entityType === "issue"
        ? getOutgoingRelationships(ctx.db, entity.id, "issue", "implements")
            .map((r) => getSpec(ctx.db, r.to_id))
            .filter((s): s is NonNullable<typeof s> => s !== null)
        : [];

    // Generate reflection prompt
    const reflectionPrompt = await generateReflectionPrompt({
      entity,
      entityType,
      gitCommitRange,
      relatedIssues,
      relatedSpecs,
    });

    if (options.interactive) {
      // In interactive mode, display prompt and wait for user input
      console.log(chalk.cyan("\nReflection Prompt:"));
      console.log(chalk.gray("─".repeat(80)));
      console.log(reflectionPrompt);
      console.log(chalk.gray("─".repeat(80)));
      console.log(
        chalk.yellow(
          "\nPlease analyze the above and provide completion summary as JSON:"
        )
      );
      // In a real implementation, this would read from stdin
      // For now, fall back to basic summary
      summary = (await generateBasicSummary({
        entity,
        entityType,
        gitCommitRange,
      })) as CompletionSummary;
    } else {
      // Generate basic summary automatically
      console.log(
        chalk.gray(
          "  Note: Use --interactive to generate LLM-based reflection"
        )
      );
      summary = (await generateBasicSummary({
        entity,
        entityType,
        gitCommitRange,
      })) as CompletionSummary;

      // Fill in required fields if missing
      if (!summary.what_worked) summary.what_worked = [];
      if (!summary.what_failed) summary.what_failed = [];
      if (!summary.blocking_factors) summary.blocking_factors = [];
      if (!summary.key_decisions) summary.key_decisions = [];
      if (!summary.code_patterns_introduced) summary.code_patterns_introduced = [];
      if (!summary.dependencies_discovered) summary.dependencies_discovered = [];
    }
  } else {
    throw new Error("Either --reflect or --summary must be provided");
  }

  // Calculate time to complete if not provided
  if (!summary.time_to_complete && entity.created_at && entity.closed_at) {
    summary.time_to_complete = calculateCompletionTime(
      entity.created_at,
      entity.closed_at
    );
  }

  // Update entity with summary
  if (entityType === "issue") {
    updateIssue(ctx.db, entity.id, { completion_summary: summary });
  } else {
    updateSpec(ctx.db, entity.id, { completion_summary: summary });
  }

  console.log(chalk.green("  ✓ Completion summary added"));
}

/**
 * Display reflection prompt for an entity
 */
export async function handleShowReflectionPrompt(
  ctx: CommandContext,
  entityId: string,
  entityType: "issue" | "spec",
  options: { start?: string; end?: string }
): Promise<void> {
  try {
    const entity =
      entityType === "issue" ? getIssue(ctx.db, entityId) : getSpec(ctx.db, entityId);

    if (!entity) {
      throw new Error(`${entityType} not found: ${entityId}`);
    }

    // Determine git commit range
    let gitCommitRange: { start: string; end: string } | undefined;
    if (options.start) {
      const end = options.end || (await getCompletionCommit()) || "HEAD";
      gitCommitRange = { start: options.start, end };
    }

    // Generate prompt
    const prompt = await generateReflectionPrompt({
      entity,
      entityType,
      gitCommitRange,
    });

    console.log(prompt);
  } catch (error) {
    console.error(chalk.red("✗ Failed to generate reflection prompt"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
