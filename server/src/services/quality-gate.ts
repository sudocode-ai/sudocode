import type Database from "better-sqlite3";
import { spawn } from "child_process";
import {
  type QualityGateConfig,
  type QualityGateCheckResult,
  type QualityGateResult,
} from "@sudocode-ai/types";
import { v4 as uuidv4 } from "uuid";

/**
 * Service for running quality gate checks on executions
 */
export class QualityGateService {
  constructor(private db: Database.Database, private repoRoot: string) {}

  /**
   * Run all quality gate checks for an execution
   */
  async runChecks(
    executionId: string,
    config: QualityGateConfig,
    workingDirectory: string
  ): Promise<QualityGateResult> {
    const results: QualityGateCheckResult[] = [];

    // Run tests
    if (config.runTests && config.testCommand) {
      const testResult = await this.runCommand(
        "Tests",
        config.testCommand,
        workingDirectory,
        config.testTimeout
      );
      results.push(testResult);
    }

    // Run build
    if (config.runBuild && config.buildCommand) {
      const buildResult = await this.runCommand(
        "Build",
        config.buildCommand,
        workingDirectory
      );
      results.push(buildResult);
    }

    // Run lint
    if (config.runLint && config.lintCommand) {
      const lintResult = await this.runCommand(
        "Lint",
        config.lintCommand,
        workingDirectory
      );
      results.push(lintResult);
    }

    // Run custom checks
    if (config.customChecks) {
      for (const check of config.customChecks) {
        const customResult = await this.runCommand(
          check.name,
          check.command,
          workingDirectory,
          check.timeout
        );
        results.push(customResult);
      }
    }

    const passed = results.every((r) => r.passed);

    // Store results in database
    const result: QualityGateResult = {
      id: uuidv4(),
      execution_id: executionId,
      passed,
      results,
      created_at: new Date().toISOString(),
    };

    this.saveResult(result);

    return result;
  }

  /**
   * Run a single command and return the result
   */
  private async runCommand(
    name: string,
    command: string,
    cwd: string,
    timeout?: number
  ): Promise<QualityGateCheckResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // Parse command into shell and args
      const proc = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env },
      });

      // Set timeout if specified
      let timeoutHandle: NodeJS.Timeout | null = null;
      if (timeout) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");

          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill("SIGKILL");
            }
          }, 5000);
        }, timeout);
      }

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        const duration = Date.now() - startTime;

        if (timedOut) {
          resolve({
            name,
            passed: false,
            error: `Command timed out after ${timeout}ms`,
            output: stdout,
            duration,
          });
        } else if (code === 0) {
          resolve({
            name,
            passed: true,
            output: stdout,
            duration,
          });
        } else {
          resolve({
            name,
            passed: false,
            error: stderr || `Command exited with code ${code}`,
            output: stdout,
            duration,
          });
        }
      });

      proc.on("error", (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        const duration = Date.now() - startTime;
        resolve({
          name,
          passed: false,
          error: error.message,
          duration,
        });
      });
    });
  }

  /**
   * Save quality gate result to database
   */
  private saveResult(result: QualityGateResult): void {
    this.db
      .prepare(
        `INSERT INTO quality_gate_results (id, execution_id, passed, results, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        result.id,
        result.execution_id,
        result.passed ? 1 : 0,
        JSON.stringify(result.results),
        result.created_at
      );
  }

  /**
   * Get quality gate results for an execution
   */
  getResults(executionId: string): QualityGateResult | null {
    const row = this.db
      .prepare(
        `SELECT * FROM quality_gate_results
         WHERE execution_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(executionId) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      execution_id: row.execution_id,
      passed: Boolean(row.passed),
      results: JSON.parse(row.results),
      created_at: row.created_at,
    };
  }

  /**
   * Delete quality gate results for an execution
   */
  deleteResults(executionId: string): void {
    this.db
      .prepare(`DELETE FROM quality_gate_results WHERE execution_id = ?`)
      .run(executionId);
  }
}
