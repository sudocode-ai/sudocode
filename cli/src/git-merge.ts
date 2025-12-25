/**
 * Git Merge-File Wrapper
 *
 * Wrapper around `git merge-file` command for three-way merging of YAML content.
 * Enables git's native three-way merge algorithm to work on YAML representations.
 *
 * Security: Uses execFile (not exec) to prevent shell injection vulnerabilities.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge completed without conflicts */
  success: boolean;
  /** The merged content (may include conflict markers if success=false) */
  content: string;
  /** Whether conflicts were detected */
  hasConflicts: boolean;
}

/**
 * Three-way merge input versions
 */
export interface MergeInput {
  /** Base version (common ancestor) */
  base: string;
  /** Our version (current/local changes) */
  ours: string;
  /** Their version (incoming changes) */
  theirs: string;
}

/**
 * Perform three-way merge using git merge-file
 *
 * This function wraps the `git merge-file` command to provide three-way merging
 * of YAML content. It creates temporary files for the merge operation and cleans
 * them up afterwards.
 *
 * Security: Uses execFileSync with array arguments to prevent shell injection.
 *
 * Git merge-file exit codes:
 * - 0: Clean merge, no conflicts
 * - 1: Conflicts detected (most common, merge produces output with conflict markers)
 * - 2+: Can indicate conflicts OR fatal errors
 *
 * Strategy: If git produced output (file exists and has content), treat as conflict
 * scenario regardless of exit code. Only throw if no output was produced.
 *
 * @param input - The three versions to merge (base, ours, theirs)
 * @returns MergeResult - The merge result with success status and content
 * @throws Error if git command fails fatally (no output produced)
 *
 * @example
 * ```typescript
 * const result = mergeYamlContent({
 *   base: 'title: Original\nstatus: open',
 *   ours: 'title: Updated\nstatus: open',
 *   theirs: 'title: Original\nstatus: closed'
 * });
 *
 * if (result.success) {
 *   console.log('Clean merge:', result.content);
 * } else {
 *   console.log('Conflicts detected:', result.content);
 * }
 * ```
 */
export function mergeYamlContent(input: MergeInput): MergeResult {
  // Create temporary directory for merge files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-merge-'));

  // Temp file paths
  const basePath = path.join(tmpDir, 'base.yaml');
  const oursPath = path.join(tmpDir, 'ours.yaml');
  const theirsPath = path.join(tmpDir, 'theirs.yaml');

  // Track whether base is empty (simulated 3-way merge)
  const baseIsEmpty = input.base.length === 0;

  try {
    // Write content to temp files
    fs.writeFileSync(basePath, input.base, 'utf8');
    fs.writeFileSync(oursPath, input.ours, 'utf8');
    fs.writeFileSync(theirsPath, input.theirs, 'utf8');

    // Execute git merge-file using execFileSync (safe from shell injection)
    try {
      execFileSync('git', ['merge-file', oursPath, basePath, theirsPath], {
        encoding: 'utf8',
      });

      // Exit code 0 means clean merge
      const mergedContent = fs.readFileSync(oursPath, 'utf8');

      return {
        success: true,
        content: mergedContent,
        hasConflicts: false,
      };
    } catch (error: any) {
      // Git merge-file exit codes:
      // - 0: Clean merge (handled above, no error thrown)
      // - 1: Conflicts detected (most common)
      // - 2+: Can indicate conflicts OR fatal errors
      //
      // Strategy: If git produced output (file exists and has content),
      // treat as conflict scenario regardless of exit code.
      // Only throw if no output was produced (indicates real error).
      const exitCode = error.status || error.code || 'unknown';

      // Debug: log what we got
      if (process.env.DEBUG_GIT_MERGE) {
        console.log('Git merge-file error:', {
          status: error.status,
          code: error.code,
          baseIsEmpty,
          stderr: error.stderr?.toString(),
          stdout: error.stdout?.toString(),
        });
      }

      // Try to read the output file - if it has content, this is a conflict scenario
      if (error.status > 0) {
        try {
          const mergedContent = fs.readFileSync(oursPath, 'utf8');

          // Validate that git produced output (not a real error)
          if (mergedContent.length > 0) {
            return {
              success: false,
              content: mergedContent,
              hasConflicts: true,
            };
          }
          // If no output, this is likely a real error - fall through to throw
        } catch (readError) {
          // File read failed - fall through to throw with details
          const stderr = error.stderr?.toString().trim();
          const stdout = error.stdout?.toString().trim();
          const errorDetails = stderr || stdout || error.message || 'Unknown error';
          throw new Error(
            `Git merge-file command failed (exit code ${exitCode}, baseIsEmpty=${baseIsEmpty}, fileExists=${fs.existsSync(oursPath)}, readError=${readError}): ${errorDetails}`
          );
        }
      }

      // No exit code or negative exit code means a fatal error occurred
      // Include stderr output which contains the actual git error message
      const stderr = error.stderr?.toString().trim();
      const stdout = error.stdout?.toString().trim();
      const errorDetails = stderr || stdout || error.message || 'Unknown error';

      throw new Error(
        `Git merge-file command failed (status=${error.status}, code=${error.code}, exitCode=${exitCode}, baseIsEmpty=${baseIsEmpty}, baseLength=${input.base.length}, oursLength=${input.ours.length}, theirsLength=${input.theirs.length}): ${errorDetails}`
      );
    }
  } finally {
    // Clean up temp files and directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Log cleanup errors but don't throw
      console.error('Warning: Failed to clean up temp files:', cleanupError);
    }
  }
}
