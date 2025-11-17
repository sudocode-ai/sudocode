/**
 * Repository info service - provides git repository information
 */

import * as path from "path";
import { GitCli } from "../execution/worktree/git-cli.js";

export interface RepositoryInfo {
  name: string;
  branch: string;
  path: string;
}

/**
 * Get repository information for a given repository path
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Repository information including name, branch, and path
 * @throws Error if the path is not a valid git repository
 */
export async function getRepositoryInfo(
  repoPath: string
): Promise<RepositoryInfo> {
  const gitCli = new GitCli();

  // Check if repoPath is a valid git repository
  const isValidRepo = await gitCli.isValidRepo(repoPath);
  if (!isValidRepo) {
    throw new Error("Not a git repository");
  }

  // Get repository name from git remote URL
  let repoName = path.basename(repoPath); // Fallback to directory name
  try {
    const remoteOutput = gitCli["execGit"](
      "git remote get-url origin",
      repoPath
    );
    const remoteUrl = remoteOutput.trim();

    // Extract repo name from various URL formats:
    // - https://github.com/user/repo.git
    // - git@github.com:user/repo.git
    // - https://github.com/user/repo
    const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (match && match[1]) {
      repoName = match[1];
    }
  } catch (error) {
    // No remote or error getting remote - use directory name as fallback
    console.log("No git remote found, using directory name as fallback");
  }

  // Get current branch
  let branch = "(detached)";
  try {
    const output = gitCli["execGit"](
      "git rev-parse --abbrev-ref HEAD",
      repoPath
    );
    branch = output.trim();
  } catch (error) {
    console.error("Failed to get current branch:", error);
  }

  return {
    name: repoName,
    branch,
    path: repoPath,
  };
}
