/**
 * Sudograph CLI client wrapper
 *
 * This module provides a client class that spawns `sg` CLI commands
 * and parses their JSON output for use in MCP tools.
 */

import { spawn } from "child_process";
import { SudographClientConfig, SudographError } from "./types.js";

export class SudographClient {
  private workingDir: string;
  private cliPath: string;
  private dbPath?: string;
  private versionChecked = false;

  constructor(config?: SudographClientConfig) {
    this.workingDir =
      config?.workingDir || process.env.SUDOCODE_WORKING_DIR || process.cwd();
    this.cliPath = config?.cliPath || process.env.SUDOCODE_PATH || "sg";
    this.dbPath = config?.dbPath || process.env.SUDOCODE_DB;
  }

  /**
   * Execute a CLI command and return parsed JSON output
   */
  async exec(args: string[], options?: { timeout?: number }): Promise<any> {
    // Check CLI version on first call
    if (!this.versionChecked) {
      await this.checkVersion();
      this.versionChecked = true;
    }

    // Build command arguments
    const cmdArgs = [...args];

    // Add --json flag if not already present
    if (!cmdArgs.includes("--json")) {
      cmdArgs.push("--json");
    }

    // Add --db flag if dbPath is configured
    if (this.dbPath && !cmdArgs.includes("--db")) {
      cmdArgs.push("--db", this.dbPath);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliPath, cmdArgs, {
        cwd: this.workingDir,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Set timeout if specified
      const timeout = options?.timeout || 30000; // Default 30s
      const timer = setTimeout(() => {
        proc.kill();
        reject(
          new SudographError(
            `Command timed out after ${timeout}ms`,
            -1,
            "Timeout"
          )
        );
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          reject(
            new SudographError(
              `CLI command failed with exit code ${code}`,
              code || -1,
              stderr
            )
          );
          return;
        }

        // Parse JSON output
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(
            new SudographError(
              `Failed to parse JSON output: ${
                error instanceof Error ? error.message : String(error)
              }`,
              -1,
              stdout
            )
          );
        }
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(
          new SudographError(
            `Failed to spawn CLI: ${error.message}`,
            -1,
            error.message
          )
        );
      });
    });
  }

  /**
   * Check that the CLI is installed and get its version
   */
  async checkVersion(): Promise<{ version: string }> {
    try {
      const proc = spawn(this.cliPath, ["--version"], {
        cwd: this.workingDir,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      return new Promise((resolve, reject) => {
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(
              new SudographError(
                `CLI not found or failed to execute. Make sure 'sg' is installed and in your PATH.`,
                code || -1,
                stderr
              )
            );
            return;
          }

          // Version output format: "sg version X.Y.Z" or just "X.Y.Z"
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          const version = versionMatch ? versionMatch[1] : stdout.trim();

          resolve({ version });
        });

        proc.on("error", () => {
          reject(
            new SudographError(
              `CLI not found at path: ${this.cliPath}. Make sure 'sg' is installed.`,
              -1,
              "CLI not found"
            )
          );
        });
      });
    } catch (error) {
      throw new SudographError(
        `Failed to check CLI version: ${
          error instanceof Error ? error.message : String(error)
        }`,
        -1,
        ""
      );
    }
  }
}
