import { execSync } from 'child_process';
import { GitContextError } from './errors.js';

export interface GitContext {
  owner: string;
  repo: string;
  branch: string;
}

export interface DetectContextOptions {
  repo?: string;
  branch?: string;
  cwd?: string;
}

export class GitContextDetector {
  /**
   * Check if the current directory is a git repository
   */
  static isGitRepository(cwd?: string): boolean {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: cwd || process.cwd(),
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch name
   */
  static getCurrentBranch(cwd?: string): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: cwd || process.cwd(),
        stdio: 'pipe',
        encoding: 'utf-8'
      }).trim();
      
      if (!branch) {
        throw new GitContextError(
          'Could not determine current branch',
          'Ensure you are on a valid git branch'
        );
      }
      
      return branch;
    } catch (error) {
      if (error instanceof GitContextError) {
        throw error;
      }
      
      const message = error instanceof Error ? error.message : String(error);
      throw new GitContextError(
        `Failed to get current branch: ${message}`,
        'Ensure you are in a git repository with at least one commit'
      );
    }
  }

  /**
   * Parse owner and repo from a git remote URL
   * Supports both HTTPS and SSH formats:
   * - https://github.com/owner/repo.git
   * - git@github.com:owner/repo.git
   */
  static parseRemote(remote: string): { owner: string; repo: string } {
    if (!remote) {
      throw new GitContextError(
        'Remote URL is empty',
        'Configure a GitHub remote with: git remote add origin <url>'
      );
    }

    // Pattern matches:
    // - https://github.com/owner/repo.git
    // - git@github.com:owner/repo.git
    // - https://github.com/owner/repo (without .git)
    const pattern = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/;
    const match = remote.match(pattern);

    if (!match) {
      throw new GitContextError(
        `Invalid GitHub remote URL format: ${remote}`,
        'Remote must be a GitHub repository URL'
      );
    }

    const [, owner, repo] = match;

    if (!owner || !repo) {
      throw new GitContextError(
        `Could not extract owner/repo from remote URL: ${remote}`,
        'Ensure the remote URL is in the format: https://github.com/owner/repo.git'
      );
    }

    return { owner, repo };
  }

  /**
   * Detect git context (owner, repo, branch) from local git configuration
   * Supports --repo and --branch flag overrides
   */
  static detectContext(options: DetectContextOptions = {}): GitContext {
    const cwd = options.cwd || process.cwd();

    // Check if in a git repository
    if (!this.isGitRepository(cwd)) {
      throw new GitContextError(
        'Not in a git repository',
        'Run this command from within a git repository or initialize one with: git init'
      );
    }

    // Get current branch (or use override)
    const branch = options.branch || this.getCurrentBranch(cwd);

    // Get owner and repo from remote or override
    let owner: string;
    let repo: string;

    if (options.repo) {
      // Parse --repo flag (format: owner/repo)
      const parts = options.repo.split('/');
      if (parts.length !== 2) {
        throw new GitContextError(
          'Invalid --repo format. Expected: owner/repo',
          'Use format: --repo owner/repo'
        );
      }
      [owner, repo] = parts;
    } else {
      // Auto-detect from git remote
      try {
        const remoteUrl = execSync('git config --get remote.origin.url', {
          cwd,
          stdio: 'pipe',
          encoding: 'utf-8'
        }).trim();

        if (!remoteUrl) {
          throw new GitContextError(
            'No remote.origin.url found in git config',
            'Add a GitHub remote with: git remote add origin <url>'
          );
        }

        const parsed = this.parseRemote(remoteUrl);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch (error) {
        if (error instanceof GitContextError) {
          throw error;
        }
        
        const message = error instanceof Error ? error.message : String(error);
        throw new GitContextError(
          `Failed to detect git context: ${message}`,
          'Ensure you have a valid GitHub remote configured'
        );
      }
    }

    return { owner, repo, branch };
  }
}
