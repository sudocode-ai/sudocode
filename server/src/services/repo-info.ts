/**
 * Repository info service - provides git repository information
 */

import * as path from "path";
import { GitCli } from "../execution/worktree/git-cli.js";

export interface RepositoryInfo {
  name: string;
  branch: string;
  path: string;
  /** Full owner/repo identifier from git remote (e.g., "anthropic/sudocode") */
  ownerRepo?: string;
  /** Git hosting provider (e.g., "github", "gitlab", "bitbucket") */
  gitProvider?: string;
}

export interface BranchInfo {
  current: string;
  branches: string[];
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

  // Get repository name and owner/repo from git remote URL
  let repoName = path.basename(repoPath); // Fallback to directory name
  let ownerRepo: string | undefined;
  let gitProvider: string | undefined;

  try {
    const remoteOutput = gitCli["execGit"](
      "git remote get-url origin",
      repoPath
    );
    const remoteUrl = remoteOutput.trim();

    // Extract owner/repo from various URL formats:
    // - https://github.com/user/repo.git
    // - git@github.com:user/repo.git
    // - https://github.com/user/repo
    // - https://gitlab.com/user/repo.git
    // - git@gitlab.com:user/repo.git

    // Detect provider from URL
    if (remoteUrl.includes("github.com")) {
      gitProvider = "github";
    } else if (remoteUrl.includes("gitlab.com")) {
      gitProvider = "gitlab";
    } else if (remoteUrl.includes("bitbucket.org")) {
      gitProvider = "bitbucket";
    }

    // Extract owner/repo - handle both HTTPS and SSH formats
    let ownerRepoMatch;
    if (remoteUrl.startsWith("git@")) {
      // SSH format: git@github.com:owner/repo.git
      ownerRepoMatch = remoteUrl.match(/:([^/]+\/[^/]+?)(\.git)?$/);
    } else {
      // HTTPS format: https://github.com/owner/repo.git
      ownerRepoMatch = remoteUrl.match(/(?:github\.com|gitlab\.com|bitbucket\.org)\/([^/]+\/[^/]+?)(\.git)?$/);
    }

    if (ownerRepoMatch && ownerRepoMatch[1]) {
      ownerRepo = ownerRepoMatch[1];
      // Extract repo name from owner/repo
      const parts = ownerRepo.split("/");
      if (parts.length === 2) {
        repoName = parts[1];
      }
    } else {
      // Fallback: just extract repo name
      const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
      if (match && match[1]) {
        repoName = match[1];
      }
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
    ownerRepo,
    gitProvider,
  };
}

/**
 * Get branch information for a given repository path
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Current branch and list of all local branches
 * @throws Error if the path is not a valid git repository
 */
export async function getRepositoryBranches(
  repoPath: string
): Promise<BranchInfo> {
  const gitCli = new GitCli();

  // Check if repoPath is a valid git repository
  const isValidRepo = await gitCli.isValidRepo(repoPath);
  if (!isValidRepo) {
    throw new Error("Not a git repository");
  }

  // Get current branch
  let currentBranch = "(detached)";
  try {
    const output = gitCli["execGit"](
      "git rev-parse --abbrev-ref HEAD",
      repoPath
    );
    currentBranch = output.trim();
  } catch (error) {
    console.error("Failed to get current branch:", error);
  }

  // Get all local branches
  const branches: string[] = [];
  try {
    const output = gitCli["execGit"](
      "git branch --format='%(refname:short)'",
      repoPath
    );
    const branchList = output
      .trim()
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    branches.push(...branchList);
  } catch (error) {
    console.error("Failed to get branches:", error);
    // Fallback to just current branch if we can't list branches
    if (currentBranch !== "(detached)") {
      branches.push(currentBranch);
    }
  }

  return {
    current: currentBranch,
    branches,
  };
}
