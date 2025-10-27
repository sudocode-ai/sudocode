/**
 * Utility functions for spawning Claude Code processes
 */

import { spawn, type ChildProcess } from "child_process";

/**
 * Options for spawning Claude Code
 */
export interface SpawnClaudeCodeOptions {
  workDir: string;
  prompt: string;
  verbose?: boolean;
}

/**
 * Spawn a Claude Code process with the correct arguments
 *
 * @param options - Spawn options
 * @returns ChildProcess instance
 *
 * @example
 * ```typescript
 * const proc = spawnClaudeCode({
 *   workDir: '/path/to/repo',
 *   prompt: 'Fix the bug in auth.ts'
 * });
 *
 * proc.stdout?.on('data', (data) => {
 *   console.log(data.toString());
 * });
 * ```
 */
export function spawnClaudeCode(
  options: SpawnClaudeCodeOptions
): ChildProcess {
  const { workDir, prompt, verbose = false } = options;

  if (verbose) {
    console.log(`[spawn-claude-code] Spawning Claude Code in ${workDir}`);
    console.log(`[spawn-claude-code] Prompt length: ${prompt.length} chars`);
  }

  // Build command arguments
  const args = [
    "-y", // Auto-install if needed
    "@anthropic-ai/claude-code@latest",
    "-p", // Read prompt from stdin
    "--output-format=stream-json",
    "--include-partial-messages",
  ];

  if (verbose) {
    args.push("--verbose");
  }

  if (verbose) {
    console.log(`[spawn-claude-code] Command: npx ${args.join(" ")}`);
  }

  // Spawn the process
  const proc = spawn("npx", args, {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr all piped
    env: {
      ...process.env,
      // Ensure consistent environment
      NODE_ENV: process.env.NODE_ENV || "production",
    },
  });

  // Handle spawn errors
  proc.on("error", (error) => {
    console.error(`[spawn-claude-code] Failed to spawn process: ${error.message}`);
  });

  // Log when process starts
  proc.on("spawn", () => {
    if (verbose) {
      console.log(`[spawn-claude-code] Process spawned with PID: ${proc.pid}`);
    }
  });

  // Write prompt to stdin and close
  if (proc.stdin) {
    try {
      if (verbose) {
        console.log(`[spawn-claude-code] Writing prompt to stdin...`);
      }

      proc.stdin.write(prompt);
      proc.stdin.end();

      if (verbose) {
        console.log(`[spawn-claude-code] Prompt sent, stdin closed`);
      }
    } catch (error) {
      console.error(
        `[spawn-claude-code] Failed to write prompt to stdin:`,
        error
      );
    }
  } else {
    console.error(`[spawn-claude-code] stdin is not available`);
  }

  return proc;
}

/**
 * Test if Claude Code is available
 *
 * This spawns a simple test command to check if Claude Code can be invoked
 *
 * @returns Promise that resolves to true if available, false otherwise
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["-y", "@anthropic-ai/claude-code@latest", "--version"], {
      stdio: "pipe",
    });

    let output = "";

    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      // If it exits with 0 or produces output, it's available
      resolve(code === 0 || output.length > 0);
    });

    proc.on("error", () => {
      resolve(false);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 10000);
  });
}
