/**
 * Git Merge-File Wrapper
 *
 * Wrapper around `git merge-file` command for three-way merging of YAML content.
 * Enables git's native three-way merge algorithm to work on YAML representations.
 *
 * Security: Uses execFile (not exec) to prevent shell injection vulnerabilities.
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

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
 * Security: Uses execFile with array arguments to prevent shell injection.
 *
 * Git merge-file exit codes:
 * - 0: Clean merge, no conflicts
 * - 1: Conflicts detected (but merge still produces output with conflict markers)
 * - >1: Fatal error
 *
 * @param input - The three versions to merge (base, ours, theirs)
 * @returns Promise<MergeResult> - The merge result with success status and content
 * @throws Error if git command fails fatally (exit code > 1)
 *
 * @example
 * ```typescript
 * const result = await mergeYamlContent({
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
export async function mergeYamlContent(input: MergeInput): Promise<MergeResult> {
  // Create temporary directory for merge files
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-merge-'));

  // Temp file paths
  const basePath = path.join(tmpDir, 'base.yaml');
  const oursPath = path.join(tmpDir, 'ours.yaml');
  const theirsPath = path.join(tmpDir, 'theirs.yaml');

  try {
    // Write content to temp files
    await Promise.all([
      fs.promises.writeFile(basePath, input.base, 'utf8'),
      fs.promises.writeFile(oursPath, input.ours, 'utf8'),
      fs.promises.writeFile(theirsPath, input.theirs, 'utf8'),
    ]);

    // Execute git merge-file using execFile (safe from shell injection)
    // Format: git merge-file <current-file> <base-file> <other-file>
    // The merge result is written to <current-file> (oursPath in this case)
    try {
      await execFileAsync('git', ['merge-file', oursPath, basePath, theirsPath], {
        encoding: 'utf8',
      });

      // Exit code 0 means clean merge
      const mergedContent = await fs.promises.readFile(oursPath, 'utf8');

      return {
        success: true,
        content: mergedContent,
        hasConflicts: false,
      };
    } catch (error: any) {
      // Exit code 1 means conflicts were detected
      // The file still contains the merge result with conflict markers
      if (error.code === 1) {
        const mergedContent = await fs.promises.readFile(oursPath, 'utf8');

        return {
          success: false,
          content: mergedContent,
          hasConflicts: true,
        };
      }

      // Exit code > 1 means a fatal error occurred
      // Include stderr output which contains the actual git error message
      const stderr = error.stderr?.toString().trim();
      const stdout = error.stdout?.toString().trim();
      const errorDetails = stderr || stdout || error.message || 'Unknown error';

      throw new Error(
        `Git merge-file command failed: ${errorDetails}`
      );
    }
  } finally {
    // Clean up temp files and directory
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Log cleanup errors but don't throw - the merge operation itself succeeded/failed already
      console.error('Warning: Failed to clean up temp files:', cleanupError);
    }
  }
}

/**
 * Synchronous version of mergeYamlContent
 *
 * Uses synchronous file operations and child_process.execFileSync.
 * Useful in contexts where async is not available or desired.
 *
 * Security: Uses execFileSync with array arguments to prevent shell injection.
 *
 * @param input - The three versions to merge (base, ours, theirs)
 * @returns MergeResult - The merge result with success status and content
 * @throws Error if git command fails fatally (exit code > 1)
 */
export function mergeYamlContentSync(input: MergeInput): MergeResult {
  // Create temporary directory for merge files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-merge-'));

  // Temp file paths
  const basePath = path.join(tmpDir, 'base.yaml');
  const oursPath = path.join(tmpDir, 'ours.yaml');
  const theirsPath = path.join(tmpDir, 'theirs.yaml');

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
      // Exit code 1 means conflicts were detected
      if (error.status === 1) {
        const mergedContent = fs.readFileSync(oursPath, 'utf8');

        return {
          success: false,
          content: mergedContent,
          hasConflicts: true,
        };
      }

      // Exit code > 1 means a fatal error occurred
      // Include stderr output which contains the actual git error message
      const stderr = error.stderr?.toString().trim();
      const stdout = error.stdout?.toString().trim();
      const errorDetails = stderr || stdout || error.message || 'Unknown error';

      throw new Error(
        `Git merge-file command failed: ${errorDetails}`
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
