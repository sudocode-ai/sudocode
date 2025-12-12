/**
 * CLI utilities for Beads integration
 *
 * Provides detection and execution of the Beads CLI (`beads` or `bd` command).
 * When CLI is available, we prefer using it for write operations as it
 * ensures compatibility with Beads' own data format and validations.
 */

import { execSync, spawnSync } from "child_process";

/** Cached CLI availability result */
let cliAvailableCache: boolean | null = null;

/** Cached CLI command name */
let cliCommandCache: string | null = null;

/**
 * Check if Beads CLI is available on the system
 *
 * Checks for both `beads` and `bd` commands.
 * Result is cached for the lifetime of the process.
 *
 * @returns True if Beads CLI is available
 */
export function isBeadsCLIAvailable(): boolean {
  if (cliAvailableCache !== null) {
    return cliAvailableCache;
  }

  // Try 'beads' first, then 'bd'
  for (const cmd of ["beads", "bd"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      cliAvailableCache = true;
      cliCommandCache = cmd;
      return true;
    } catch {
      // Command not found, try next
    }
  }

  cliAvailableCache = false;
  return false;
}

/**
 * Get the Beads CLI command name
 *
 * @returns 'beads' or 'bd' depending on what's available, or null if not available
 */
export function getBeadsCLICommand(): string | null {
  if (!isBeadsCLIAvailable()) {
    return null;
  }
  return cliCommandCache;
}

/**
 * Execute a Beads CLI command
 *
 * @param args - Command arguments (without the beads/bd prefix)
 * @param cwd - Working directory for the command
 * @param beadsDir - Optional path to .beads directory (sets BEADS_DIR env var)
 * @returns Command output as string
 * @throws Error if CLI not available or command fails
 */
export function execBeadsCommand(
  args: string[],
  cwd: string,
  beadsDir?: string
): string {
  const cmd = getBeadsCLICommand();
  if (!cmd) {
    throw new Error("Beads CLI is not available");
  }

  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // Set BEADS_DIR if provided so CLI knows where to find .beads
      ...(beadsDir ? { BEADS_DIR: beadsDir } : {}),
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "Unknown error";
    throw new Error(`Beads command failed: ${stderr}`);
  }

  return result.stdout || "";
}

/**
 * Parse the output of `beads create` to extract the new issue ID
 *
 * Expected output formats (varies by version):
 * - "Created issue beads-a1b2c3d4"
 * - "beads-a1b2c3d4"
 * - "✓ Created issue: beads-xxx-yyy"  (newer versions with emoji)
 * - "✓ Created issue: myproject-abc"  (project-derived prefix)
 *
 * @param output - Command output from beads create
 * @returns The extracted issue ID
 * @throws Error if ID cannot be parsed
 */
export function parseBeadsCreateOutput(output: string): string {
  // Match "Created issue: <id>" pattern first (most reliable)
  const createdMatch = output.match(/Created issue:\s*([a-zA-Z0-9-]+)/);
  if (createdMatch) {
    return createdMatch[1];
  }

  // Try to find a beads ID pattern - matches beads-xxx or beads-xxx-yyy format
  const beadsMatch = output.match(/\b(beads-[a-zA-Z0-9]+-[a-zA-Z0-9]+)\b/);
  if (beadsMatch) {
    return beadsMatch[1];
  }

  // Simpler beads-xxx format
  const simpleBeadsMatch = output.match(/\b(beads-[a-f0-9]+)\b/i);
  if (simpleBeadsMatch) {
    return simpleBeadsMatch[1];
  }

  // Try to find any ID pattern like "bd-xxxx" or similar
  const altMatch = output.match(/\b([a-z]+-[a-f0-9]+)\b/i);
  if (altMatch) {
    return altMatch[1];
  }

  throw new Error(`Could not parse issue ID from beads output: ${output}`);
}

/**
 * Create an issue using the Beads CLI
 *
 * @param cwd - Working directory (project root)
 * @param title - Issue title
 * @param options - Additional options
 * @returns The created issue ID
 */
export function createIssueViaCLI(
  cwd: string,
  title: string,
  options?: {
    priority?: number;
    tags?: string[];
    content?: string;
    beadsDir?: string;
  }
): string {
  // Use --no-db to work with JSONL only (no SQLite required)
  const args = ["--no-db", "create", title];

  if (options?.priority !== undefined) {
    args.push("-p", String(options.priority));
  }

  if (options?.tags?.length) {
    for (const tag of options.tags) {
      args.push("-t", tag);
    }
  }

  // Note: content may need to be added via update after creation
  // depending on beads CLI capabilities

  const output = execBeadsCommand(args, cwd, options?.beadsDir);
  return parseBeadsCreateOutput(output);
}

/**
 * Close an issue using the Beads CLI
 *
 * @param cwd - Working directory (project root)
 * @param issueId - Issue ID to close
 * @param reason - Optional reason for closing
 * @param beadsDir - Optional path to .beads directory
 */
export function closeIssueViaCLI(
  cwd: string,
  issueId: string,
  reason?: string,
  beadsDir?: string
): void {
  // Use --no-db to work with JSONL only (no SQLite required)
  const args = ["--no-db", "close", issueId];

  if (reason) {
    args.push("--reason", reason);
  }

  execBeadsCommand(args, cwd, beadsDir);
}

/**
 * Clear the CLI availability cache
 *
 * Useful for testing or when the system state may have changed.
 */
export function clearCLICache(): void {
  cliAvailableCache = null;
  cliCommandCache = null;
}
