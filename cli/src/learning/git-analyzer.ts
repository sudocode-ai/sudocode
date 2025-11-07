/**
 * Git history analyzer for extracting patterns from completed work
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface GitCommitInfo {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface GitDiffAnalysis {
  commits: GitCommitInfo[];
  files_changed: string[];
  additions: number;
  deletions: number;
  file_changes: Map<string, { additions: number; deletions: number }>;
}

export interface GitCommitRange {
  start?: string;
  end?: string;
}

/**
 * Get commits in a range (or all commits if no range specified)
 */
export async function getCommits(
  range?: GitCommitRange,
  options: { cwd?: string; maxCount?: number } = {}
): Promise<GitCommitInfo[]> {
  const cwd = options.cwd || process.cwd();
  const maxCount = options.maxCount || 100;

  let cmd = `git log --format="%H|%an|%ai|%s" --max-count=${maxCount}`;

  if (range?.start && range?.end) {
    cmd = `git log --format="%H|%an|%ai|%s" ${range.start}..${range.end}`;
  } else if (range?.start) {
    cmd = `git log --format="%H|%an|%ai|%s" ${range.start}..HEAD`;
  }

  try {
    const { stdout } = await execAsync(cmd, { cwd });
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line)
      .map((line) => {
        const [sha, author, date, message] = line.split("|");
        return { sha, author, date, message };
      });
  } catch (error: any) {
    // If no commits found or git error, return empty array
    return [];
  }
}

/**
 * Get detailed diff statistics for a commit range
 */
export async function analyzeDiff(
  range?: GitCommitRange,
  options: { cwd?: string } = {}
): Promise<GitDiffAnalysis> {
  const cwd = options.cwd || process.cwd();

  // Get commits
  const commits = await getCommits(range, options);

  // Build diff command
  let diffCmd = "git diff --numstat";
  if (range?.start && range?.end) {
    diffCmd += ` ${range.start}..${range.end}`;
  } else if (range?.start) {
    diffCmd += ` ${range.start}..HEAD`;
  } else if (commits.length > 0) {
    // If no range, use the oldest commit to HEAD
    diffCmd += ` ${commits[commits.length - 1].sha}..HEAD`;
  }

  try {
    const { stdout } = await execAsync(diffCmd, { cwd });

    const fileChanges = new Map<string, { additions: number; deletions: number }>();
    let totalAdditions = 0;
    let totalDeletions = 0;

    const lines = stdout.trim().split("\n").filter((line) => line);

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parseInt(parts[0]) || 0;
        const deletions = parseInt(parts[1]) || 0;
        const filepath = parts[2];

        fileChanges.set(filepath, { additions, deletions });
        totalAdditions += additions;
        totalDeletions += deletions;
      }
    }

    return {
      commits,
      files_changed: Array.from(fileChanges.keys()),
      additions: totalAdditions,
      deletions: totalDeletions,
      file_changes: fileChanges,
    };
  } catch (error: any) {
    return {
      commits,
      files_changed: [],
      additions: 0,
      deletions: 0,
      file_changes: new Map(),
    };
  }
}

/**
 * Get files changed in a commit range
 */
export async function getChangedFiles(
  range?: GitCommitRange,
  options: { cwd?: string } = {}
): Promise<string[]> {
  const analysis = await analyzeDiff(range, options);
  return analysis.files_changed;
}

/**
 * Get current git commit SHA
 */
export async function getCurrentCommit(options: { cwd?: string } = {}): Promise<string | null> {
  const cwd = options.cwd || process.cwd();

  try {
    const { stdout } = await execAsync("git rev-parse HEAD", { cwd });
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Check if we're in a git repository
 */
export async function isGitRepo(options: { cwd?: string } = {}): Promise<boolean> {
  const cwd = options.cwd || process.cwd();

  try {
    await execAsync("git rev-parse --git-dir", { cwd });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get git diff content (actual code changes)
 */
export async function getDiffContent(
  range?: GitCommitRange,
  options: { cwd?: string; filePattern?: string } = {}
): Promise<string> {
  const cwd = options.cwd || process.cwd();

  let cmd = "git diff";
  if (range?.start && range?.end) {
    cmd += ` ${range.start}..${range.end}`;
  } else if (range?.start) {
    cmd += ` ${range.start}..HEAD`;
  }

  if (options.filePattern) {
    cmd += ` -- ${options.filePattern}`;
  }

  try {
    const { stdout } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer
    return stdout;
  } catch (error: any) {
    return "";
  }
}

/**
 * Extract patterns from git diff analysis
 */
export function extractPatterns(analysis: GitDiffAnalysis): {
  primary_areas: string[];
  significant_changes: string[];
  test_coverage_impact: string[];
} {
  const primary_areas: string[] = [];
  const significant_changes: string[] = [];
  const test_coverage_impact: string[] = [];

  // Identify primary areas by directory
  const dirChanges = new Map<string, number>();
  for (const [filepath, changes] of analysis.file_changes) {
    const dir = filepath.includes("/") ? filepath.split("/")[0] : "root";
    const totalChanges = changes.additions + changes.deletions;
    dirChanges.set(dir, (dirChanges.get(dir) || 0) + totalChanges);
  }

  // Sort by most changed
  const sortedDirs = Array.from(dirChanges.entries()).sort((a, b) => b[1] - a[1]);
  primary_areas.push(...sortedDirs.slice(0, 3).map(([dir, count]) =>
    `${dir}/ (${count} lines changed)`
  ));

  // Identify significant file changes (> 100 lines)
  for (const [filepath, changes] of analysis.file_changes) {
    const totalChanges = changes.additions + changes.deletions;
    if (totalChanges > 100) {
      significant_changes.push(`${filepath} (+${changes.additions}/-${changes.deletions})`);
    }
  }

  // Identify test file changes
  for (const filepath of analysis.files_changed) {
    if (filepath.includes("test") || filepath.includes("spec") || filepath.endsWith(".test.ts")) {
      const changes = analysis.file_changes.get(filepath);
      if (changes) {
        test_coverage_impact.push(`${filepath} (+${changes.additions}/-${changes.deletions})`);
      }
    }
  }

  return {
    primary_areas,
    significant_changes: significant_changes.slice(0, 10), // Top 10
    test_coverage_impact,
  };
}
