import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

export interface MergeResult {
  merged: string;      // Merged YAML (may contain conflict markers)
  hasConflicts: boolean;  // True if conflicts exist
}

/**
 * Performs three-way merge on YAML strings using git merge-file
 *
 * @param base - Common ancestor YAML content
 * @param ours - Our version YAML content
 * @param theirs - Their version YAML content
 * @returns MergeResult with merged YAML and conflict status
 */
export async function mergeYaml(
  base: string,
  ours: string,
  theirs: string
): Promise<MergeResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-merge-'));

  try {
    // Write temp files
    const basePath = path.join(tmpDir, 'base.yaml');
    const oursPath = path.join(tmpDir, 'ours.yaml');
    const theirsPath = path.join(tmpDir, 'theirs.yaml');

    fs.writeFileSync(basePath, base, 'utf8');
    fs.writeFileSync(oursPath, ours, 'utf8');
    fs.writeFileSync(theirsPath, theirs, 'utf8');

    // Run git merge-file
    // Note: git merge-file uses the order: <current> <base> <other>
    // which corresponds to: ours base theirs
    try {
      const { stdout } = await execFileAsync('git', [
        'merge-file', '-p', oursPath, basePath, theirsPath
      ]);
      return { merged: stdout, hasConflicts: false };
    } catch (error: any) {
      if (error.code === 1) {
        // Conflicts - stdout has merged result with markers
        return { merged: error.stdout || '', hasConflicts: true };
      }
      throw new Error(`git merge-file failed: ${error.message}`);
    }
  } finally {
    // Cleanup temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
