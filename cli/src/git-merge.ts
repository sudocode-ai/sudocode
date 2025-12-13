import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface MergeResult {
  merged: string;
  hasConflicts: boolean;
}

/**
 * Performs a three-way merge on YAML strings using git merge-file.
 *
 * @param base - The common ancestor YAML content
 * @param ours - Our version of the YAML content
 * @param theirs - Their version of the YAML content
 * @returns MergeResult containing merged YAML and conflict status
 */
export async function mergeYaml(base: string, ours: string, theirs: string): Promise<MergeResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-merge-'));

  const basePath = path.join(tmpDir, 'base.yaml');
  const oursPath = path.join(tmpDir, 'ours.yaml');
  const theirsPath = path.join(tmpDir, 'theirs.yaml');

  try {
    // Write the three versions to temporary files
    fs.writeFileSync(basePath, base, 'utf8');
    fs.writeFileSync(oursPath, ours, 'utf8');
    fs.writeFileSync(theirsPath, theirs, 'utf8');

    // Run git merge-file with -p flag to output to stdout
    // Exit codes: 0 = clean merge, 1 = conflicts, >1 = error
    try {
      const { stdout } = await execFileAsync('git', [
        'merge-file',
        '-p',
        oursPath,
        basePath,
        theirsPath
      ]);

      // Clean merge (exit code 0)
      return { merged: stdout, hasConflicts: false };
    } catch (error: any) {
      // Check if this is a conflict (exit code 1) vs a real error
      if (error.code === 1) {
        // Conflicts occurred, stdout contains merged result with conflict markers
        return { merged: error.stdout || '', hasConflicts: true };
      }

      // Some other error occurred (exit code > 1)
      throw new Error(`git merge-file failed: ${error.message}`);
    }
  } finally {
    // Clean up temporary files
    try {
      fs.unlinkSync(basePath);
      fs.unlinkSync(oursPath);
      fs.unlinkSync(theirsPath);
      fs.rmdirSync(tmpDir);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}
