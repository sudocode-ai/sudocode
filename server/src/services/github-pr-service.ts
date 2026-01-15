/**
 * GitHubPRService - Manages GitHub PR creation and status via gh CLI
 *
 * Uses the GitHub CLI (gh) for all GitHub interactions.
 * Requires gh to be installed and authenticated.
 */

import { spawn } from "child_process";
import type { BatchPRStatus } from "@sudocode-ai/types";

/**
 * Options for creating a PR
 */
export interface CreatePROptions {
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Source branch name */
  head: string;
  /** Target branch name (default: main) */
  base: string;
  /** Create as draft PR */
  draft: boolean;
}

/**
 * Result of PR creation
 */
export interface CreatePRResult {
  /** GitHub PR number */
  pr_number: number;
  /** GitHub PR URL */
  pr_url: string;
}

/**
 * Error thrown when GitHub CLI operations fail
 */
export class GitHubPRError extends Error {
  constructor(
    public code: "GH_NOT_FOUND" | "GH_AUTH_FAILED" | "GH_COMMAND_FAILED" | "PR_NOT_FOUND",
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = "GitHubPRError";
  }
}

/**
 * Service for managing GitHub PRs via the gh CLI
 */
export class GitHubPRService {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Execute a gh command and return the output
   */
  private async executeGh(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("gh", args, {
        cwd: this.repoPath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new GitHubPRError(
              "GH_NOT_FOUND",
              "GitHub CLI (gh) not found",
              "Please install gh: https://cli.github.com/"
            )
          );
        } else {
          reject(
            new GitHubPRError(
              "GH_COMMAND_FAILED",
              `Failed to execute gh command`,
              error.message
            )
          );
        }
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          // Check for common error patterns
          if (stderr.includes("not logged in") || stderr.includes("authentication")) {
            reject(
              new GitHubPRError(
                "GH_AUTH_FAILED",
                "GitHub CLI authentication failed",
                "Please run 'gh auth login' to authenticate"
              )
            );
          } else {
            reject(
              new GitHubPRError(
                "GH_COMMAND_FAILED",
                `gh command failed with exit code ${code}`,
                stderr || stdout
              )
            );
          }
        }
      });
    });
  }

  /**
   * Check if gh CLI is available and authenticated
   */
  async checkAvailability(): Promise<{ available: boolean; authenticated: boolean; error?: string }> {
    try {
      // Check if gh is installed
      await this.executeGh(["--version"]);

      // Check if authenticated
      await this.executeGh(["auth", "status"]);

      return { available: true, authenticated: true };
    } catch (error) {
      if (error instanceof GitHubPRError) {
        if (error.code === "GH_NOT_FOUND") {
          return { available: false, authenticated: false, error: error.message };
        }
        if (error.code === "GH_AUTH_FAILED") {
          return { available: true, authenticated: false, error: error.message };
        }
      }
      return {
        available: false,
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a new PR
   */
  async createPR(options: CreatePROptions): Promise<CreatePRResult> {
    const args = [
      "pr",
      "create",
      "--head",
      options.head,
      "--base",
      options.base,
      "--title",
      options.title,
      "--body",
      options.body,
    ];

    if (options.draft) {
      args.push("--draft");
    }

    const output = await this.executeGh(args);

    // Parse the PR URL from the output
    // gh pr create outputs the PR URL as the last line
    const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new GitHubPRError(
        "GH_COMMAND_FAILED",
        "Failed to parse PR URL from gh output",
        output
      );
    }

    return {
      pr_number: parseInt(urlMatch[1], 10),
      pr_url: urlMatch[0],
    };
  }

  /**
   * Get PR status from GitHub
   */
  async getPRStatus(prNumber: number): Promise<BatchPRStatus> {
    try {
      const output = await this.executeGh([
        "pr",
        "view",
        prNumber.toString(),
        "--json",
        "state,isDraft,reviewDecision",
      ]);

      const data = JSON.parse(output);

      // Map GitHub state to BatchPRStatus
      if (data.state === "MERGED") {
        return "merged";
      }
      if (data.state === "CLOSED") {
        return "closed";
      }
      if (data.isDraft) {
        return "draft";
      }
      if (data.reviewDecision === "APPROVED") {
        return "approved";
      }
      return "open";
    } catch (error) {
      if (error instanceof GitHubPRError && error.details?.includes("no pull requests found")) {
        throw new GitHubPRError(
          "PR_NOT_FOUND",
          `PR #${prNumber} not found`,
          error.details
        );
      }
      throw error;
    }
  }

  /**
   * Close a PR without merging
   */
  async closePR(prNumber: number): Promise<void> {
    await this.executeGh(["pr", "close", prNumber.toString()]);
  }

  /**
   * Merge a PR
   */
  async mergePR(
    prNumber: number,
    options: { strategy?: "squash" | "merge" | "rebase"; deleteSourceBranch?: boolean } = {}
  ): Promise<void> {
    const args = ["pr", "merge", prNumber.toString()];

    if (options.strategy === "squash") {
      args.push("--squash");
    } else if (options.strategy === "rebase") {
      args.push("--rebase");
    } else {
      args.push("--merge");
    }

    if (options.deleteSourceBranch) {
      args.push("--delete-branch");
    }

    await this.executeGh(args);
  }

  /**
   * Get the URL for a PR
   */
  getPRUrl(prNumber: number): string {
    // We need repo info for this - could be parsed from git remote
    // For now, return relative URL that frontend can construct
    return `#${prNumber}`;
  }

  /**
   * Add a comment to a PR
   */
  async addComment(prNumber: number, body: string): Promise<void> {
    await this.executeGh(["pr", "comment", prNumber.toString(), "--body", body]);
  }

  /**
   * Get PR details including files changed
   */
  async getPRDetails(prNumber: number): Promise<{
    title: string;
    body: string;
    state: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    commits: number;
  }> {
    const output = await this.executeGh([
      "pr",
      "view",
      prNumber.toString(),
      "--json",
      "title,body,state,additions,deletions,changedFiles,commits",
    ]);

    const data = JSON.parse(output);
    return {
      title: data.title,
      body: data.body,
      state: data.state,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changedFiles,
      commits: data.commits?.length ?? 0,
    };
  }
}
