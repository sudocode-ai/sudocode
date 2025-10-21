/**
 * CLI handlers for spec commands
 */

import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import type Database from "better-sqlite3";
import { generateSpecId } from "../id-generator.js";
import {
  createSpec,
  getSpec,
  listSpecs,
  type ListSpecsOptions,
} from "../operations/specs.js";
import {
  getOutgoingRelationships,
  getIncomingRelationships,
} from "../operations/relationships.js";
import { getTags, setTags } from "../operations/tags.js";
import { listFeedback } from "../operations/feedback.js";
import { exportToJSONL } from "../export.js";
import { writeMarkdownFile } from "../markdown.js";
import { generateUniqueFilename } from "../filename-generator.js";

export interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

export interface SpecCreateOptions {
  priority: string;
  description?: string;
  design?: string;
  filePath?: string;
  parent?: string;
  tags?: string;
}

export async function handleSpecCreate(
  ctx: CommandContext,
  title: string,
  options: SpecCreateOptions
): Promise<void> {
  try {
    // Generate spec ID
    const specId = generateSpecId(ctx.outputDir);

    // Ensure specs directory exists
    const specsDir = path.join(ctx.outputDir, "specs");
    fs.mkdirSync(specsDir, { recursive: true });

    // Generate title-based filename
    const fileName = options.filePath
      ? path.basename(options.filePath)
      : generateUniqueFilename(title, specId, specsDir);
    const filePath = `specs/${fileName}`;

    // Create spec in database
    const content = options.description || "";
    const spec = createSpec(ctx.db, {
      id: specId,
      title,
      file_path: filePath,
      content,
      priority: parseInt(options.priority),
      created_by: process.env.USER || "system",
      parent_id: options.parent || null,
    });

    // Add tags if provided
    if (options.tags) {
      const tags = options.tags.split(",").map((t) => t.trim());
      setTags(ctx.db, specId, "spec", tags);
    }

    // Create markdown file
    const frontmatter = {
      id: specId,
      title,
      priority: parseInt(options.priority),
      created_at: spec.created_at,
      ...(options.parent && { parent_id: options.parent }),
      ...(options.tags && {
        tags: options.tags.split(",").map((t) => t.trim()),
      }),
    };

    const markdownContent = options.design || "";
    writeMarkdownFile(
      path.join(ctx.outputDir, filePath),
      frontmatter,
      markdownContent
    );

    // Export to JSONL
    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    // Output result
    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify(
          { id: specId, title, file_path: filePath },
          null,
          2
        )
      );
    } else {
      console.log(chalk.green("✓ Created spec"), chalk.cyan(specId));
      console.log(chalk.gray(`  Title: ${title}`));
      console.log(chalk.gray(`  File: ${filePath}`));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to create spec"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface SpecListOptions {
  priority?: string;
  limit: string;
}

export async function handleSpecList(
  ctx: CommandContext,
  options: SpecListOptions
): Promise<void> {
  try {
    const specs = listSpecs(ctx.db, {
      priority: options.priority ? parseInt(options.priority) : undefined,
      limit: parseInt(options.limit),
    });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(specs, null, 2));
    } else {
      if (specs.length === 0) {
        console.log(chalk.gray("No specs found"));
        return;
      }

      console.log(chalk.bold(`\nFound ${specs.length} spec(s):\n`));

      for (const spec of specs) {
        console.log(chalk.cyan(spec.id), spec.title);
        console.log(
          chalk.gray(`  Priority: ${spec.priority} | ${spec.file_path}`)
        );
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to list specs"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function handleSpecShow(
  ctx: CommandContext,
  id: string
): Promise<void> {
  try {
    const spec = getSpec(ctx.db, id);
    if (!spec) {
      console.error(chalk.red(`✗ Spec not found: ${id}`));
      process.exit(1);
    }

    const outgoing = getOutgoingRelationships(ctx.db, id, "spec");
    const incoming = getIncomingRelationships(ctx.db, id, "spec");
    const tags = getTags(ctx.db, id, "spec");
    const feedback = listFeedback(ctx.db, { spec_id: id });

    if (ctx.jsonOutput) {
      console.log(
        JSON.stringify(
          { ...spec, relationships: { outgoing, incoming }, tags, feedback },
          null,
          2
        )
      );
    } else {
      console.log();
      console.log(chalk.bold.cyan(spec.id), chalk.bold(spec.title));
      console.log(chalk.gray("─".repeat(60)));
      console.log(chalk.gray("Priority:"), spec.priority);
      console.log(chalk.gray("File:"), spec.file_path);
      if (spec.parent_id) {
        console.log(chalk.gray("Parent:"), spec.parent_id);
      }
      console.log(
        chalk.gray("Created:"),
        spec.created_at,
        "by",
        spec.created_by
      );
      console.log(
        chalk.gray("Updated:"),
        spec.updated_at,
        "by",
        spec.updated_by
      );

      if (tags.length > 0) {
        console.log(chalk.gray("Tags:"), tags.join(", "));
      }

      if (spec.content) {
        console.log();
        console.log(chalk.bold("Content:"));
        console.log(spec.content);
      }

      if (outgoing.length > 0) {
        console.log();
        console.log(chalk.bold("Outgoing Relationships:"));
        for (const rel of outgoing) {
          console.log(
            `  ${chalk.yellow(rel.relationship_type)} → ${chalk.cyan(
              rel.to_id
            )} (${rel.to_type})`
          );
        }
      }

      if (incoming.length > 0) {
        console.log();
        console.log(chalk.bold("Incoming Relationships:"));
        for (const rel of incoming) {
          console.log(
            `  ${chalk.cyan(rel.from_id)} (${rel.from_type}) → ${chalk.yellow(
              rel.relationship_type
            )}`
          );
        }
      }

      if (feedback.length > 0) {
        console.log();
        console.log(chalk.bold("Feedback Received:"));
        for (const fb of feedback) {
          const anchor =
            typeof fb.anchor === "string" ? JSON.parse(fb.anchor) : fb.anchor;
          const statusColor =
            fb.status === "resolved"
              ? chalk.green
              : fb.status === "acknowledged"
              ? chalk.yellow
              : fb.status === "wont_fix"
              ? chalk.gray
              : chalk.white;
          const anchorStatusColor =
            anchor.anchor_status === "valid"
              ? chalk.green
              : anchor.anchor_status === "relocated"
              ? chalk.yellow
              : chalk.red;

          console.log(
            `  ${chalk.cyan(fb.id)} ← ${chalk.cyan(fb.issue_id)}`,
            statusColor(`[${fb.status}]`),
            anchorStatusColor(`[${anchor.anchor_status}]`)
          );
          console.log(
            chalk.gray(
              `    Type: ${fb.feedback_type} | ${
                anchor.section_heading || "No section"
              } (line ${anchor.line_number})`
            )
          );
          const contentPreview =
            fb.content.substring(0, 60) + (fb.content.length > 60 ? "..." : "");
          console.log(chalk.gray(`    ${contentPreview}`));
        }
      }

      console.log();
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to show spec"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export interface SpecDeleteOptions {}

export async function handleSpecDelete(
  ctx: CommandContext,
  ids: string[],
  options: SpecDeleteOptions
): Promise<void> {
  try {
    const results = [];

    for (const id of ids) {
      try {
        const spec = getSpec(ctx.db, id);
        if (!spec) {
          results.push({ id, success: false, error: "Spec not found" });
          if (!ctx.jsonOutput) {
            console.error(chalk.red("✗ Spec not found:"), chalk.cyan(id));
          }
          continue;
        }

        // Get the markdown file path before deletion
        const markdownPath = path.join(ctx.outputDir, spec.file_path);

        // Delete spec from database
        const { deleteSpec } = await import("../operations/specs.js");
        const deleted = deleteSpec(ctx.db, id);
        if (deleted) {
          // Remove markdown file
          if (fs.existsSync(markdownPath)) {
            fs.unlinkSync(markdownPath);
          }
          results.push({ id, success: true });
          if (!ctx.jsonOutput) {
            console.log(chalk.green("✓ Deleted spec"), chalk.cyan(id));
          }
        } else {
          results.push({ id, success: false, error: "Delete failed" });
          if (!ctx.jsonOutput) {
            console.error(chalk.red("✗ Failed to delete spec"), chalk.cyan(id));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id, success: false, error: message });
        if (!ctx.jsonOutput) {
          console.error(
            chalk.red("✗ Failed to process"),
            chalk.cyan(id),
            ":",
            message
          );
        }
      }
    }

    // Export to JSONL after all deletions
    await exportToJSONL(ctx.db, { outputDir: ctx.outputDir });

    if (ctx.jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.error(chalk.red("✗ Failed to delete specs"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
