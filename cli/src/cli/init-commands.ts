/**
 * CLI handlers for init command
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { initDatabase } from "../db.js";
import type Database from "better-sqlite3";
import { PROJECT_CONFIG_FILE, LOCAL_CONFIG_FILE } from "../config.js";
import { VERSION } from "../version.js";

export interface InitOptions {
  dir?: string;
  jsonOutput?: boolean;
}

/**
 * Check if sudocode is initialized in a directory
 */
export function isInitialized(dir: string): boolean {
  // Check for either project config OR local config (for backwards compatibility)
  const projectConfigPath = path.join(dir, PROJECT_CONFIG_FILE);
  const localConfigPath = path.join(dir, LOCAL_CONFIG_FILE);
  const dbPath = path.join(dir, "cache.db");
  const specsDir = path.join(dir, "specs");
  const issuesDir = path.join(dir, "issues");

  return (
    (fs.existsSync(projectConfigPath) || fs.existsSync(localConfigPath)) &&
    fs.existsSync(dbPath) &&
    fs.existsSync(specsDir) &&
    fs.existsSync(issuesDir)
  );
}

/**
 * Perform sudocode initialization
 */
export async function performInitialization(
  options: InitOptions = {}
): Promise<void> {
  const dir = options.dir || path.join(process.cwd(), ".sudocode");
  const jsonOutput = options.jsonOutput || false;

  // Create directory structure
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "issues"), { recursive: true });

  // Track what was preserved
  const preserved: string[] = [];

  // Initialize database only if it doesn't exist
  const dbPath = path.join(dir, "cache.db");
  const dbExists = fs.existsSync(dbPath);
  let database: Database.Database;

  if (dbExists) {
    preserved.push("cache.db");
    // Open existing database
    database = initDatabase({ path: dbPath });
  } else {
    // Ensure the database directory exists before creating the database
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    database = initDatabase({ path: dbPath });
  }

  // Create config.json (project config, git-tracked)
  // Only create if it doesn't exist to preserve existing settings
  const projectConfigPath = path.join(dir, PROJECT_CONFIG_FILE);
  if (!fs.existsSync(projectConfigPath)) {
    const projectConfig = {
      version: VERSION,
      // sourceOfTruth defaults to "jsonl" when not specified
      worktree: {
        worktreeStoragePath: ".sudocode/worktrees",
        autoCreateBranches: true,
        autoDeleteBranches: false,
        enableSparseCheckout: false,
        branchPrefix: "sudocode",
        cleanupOrphanedWorktreesOnStartup: false,
      },
    };
    fs.writeFileSync(
      projectConfigPath,
      JSON.stringify(projectConfig, null, 2),
      "utf8"
    );
  }

  // Create config.local.json (local config, gitignored)
  // Only create if it doesn't exist to preserve existing settings
  const localConfigPath = path.join(dir, LOCAL_CONFIG_FILE);
  if (!fs.existsSync(localConfigPath)) {
    const localConfig = {
      worktree: {
        worktreeStoragePath: ".sudocode/worktrees",
        autoCreateBranches: true,
        autoDeleteBranches: false,
        enableSparseCheckout: false,
        branchPrefix: "sudocode",
        cleanupOrphanedWorktreesOnStartup: false,
      },
      editor: {
        editorType: "vs-code",
      },
    };
    fs.writeFileSync(
      localConfigPath,
      JSON.stringify(localConfig, null, 2),
      "utf8"
    );
  }

  let hasSpecsData = false;
  let hasIssuesData = false;
  // Create empty JSONL files only if they don't exist
  const specsPath = path.join(dir, "specs.jsonl");
  if (fs.existsSync(specsPath)) {
    preserved.push("specs.jsonl");
    const content = fs.readFileSync(specsPath, "utf8");
    hasSpecsData = content.trim().length > 0;
  } else {
    fs.writeFileSync(specsPath, "", "utf8");
  }

  const issuesPath = path.join(dir, "issues.jsonl");
  if (fs.existsSync(issuesPath)) {
    preserved.push("issues.jsonl");
    const content = fs.readFileSync(issuesPath, "utf8");
    hasIssuesData = content.trim().length > 0;
  } else {
    fs.writeFileSync(issuesPath, "", "utf8");
  }

  if (hasSpecsData || hasIssuesData) {
    try {
      if (!jsonOutput) {
        console.log(chalk.blue("Importing from existing JSONL files..."));
      }
      const { importFromJSONL } = await import("../import.js");
      const result = await importFromJSONL(database, {
        inputDir: dir,
        resolveCollisions: true,
      });

      // Report import results
      if (!jsonOutput) {
        if (result.specs.added > 0 || result.specs.updated > 0) {
          console.log(
            chalk.gray(
              `  Specs: ${result.specs.added} added, ${result.specs.updated} updated`
            )
          );
        }
        if (result.issues.added > 0 || result.issues.updated > 0) {
          console.log(
            chalk.gray(
              `  Issues: ${result.issues.added} added, ${result.issues.updated} updated`
            )
          );
        }
        if (result.collisions.length > 0) {
          console.log(
            chalk.yellow(`  Resolved ${result.collisions.length} ID collisions`)
          );
        }
      }
    } catch (importError) {
      // Log warning but continue with initialization
      if (!jsonOutput) {
        console.log(
          chalk.yellow(
            `  Warning: Failed to import JSONL data - ${importError instanceof Error ? importError.message : String(importError)}`
          )
        );
      }
    }
  }

  // Create .gitignore file
  const gitignoreContent = `cache.db*
issues/
specs/
worktrees/
config.json
config.local.json
merge-driver.log`;
  fs.writeFileSync(path.join(dir, ".gitignore"), gitignoreContent, "utf8");

  database.close();

  if (!jsonOutput) {
    console.log(chalk.green("✓ Initialized sudocode in"), chalk.cyan(dir));
    console.log(chalk.gray(`  Database: ${dbPath}`));

    if (preserved.length > 0) {
      console.log(
        chalk.yellow(`  Preserved existing: ${preserved.join(", ")}`)
      );
    }
  }
}

/**
 * Handle init command
 */
export async function handleInit(options: InitOptions): Promise<void> {
  try {
    await performInitialization(options);
  } catch (error) {
    console.error(chalk.red("✗ Initialization failed"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
