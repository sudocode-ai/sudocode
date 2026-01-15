import { execSync } from 'child_process';

/**
 * Git repository context
 */
export interface GitContext {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Options for context detection
 */
export interface GitContextOptions {
  owner?: string;
  repo?: string;
  branch?: string;
  remote?: string;
}

/**
 * Service to detect git repository context from local git configuration
 */
export class GitContextDetector {
  /**
   * Check if current directory is in a git repository
   */
  isGitRepository(): boolean {
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe', encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name
   */
  getCurrentBranch(): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      return branch;
    } catch (error) {
      throw new Error('Failed to get current branch: not in a git repository');
    }
  }

  /**
   * Get remote URL for specified remote (defaults to 'origin')
   */
  getRemoteUrl(remote: string = 'origin'): string {
    try {
      const url = execSync(`git remote get-url ${remote}`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      return url;
    } catch (error) {
      throw new Error(`Failed to get remote URL for '${remote}'`);
    }
  }

  /**
   * Parse owner and repo from git remote URL
   * Supports both HTTPS and SSH formats:
   * - https://github.com/owner/repo.git
   * - git@github.com:owner/repo.git
   */
  parseRemote(remote: string): { owner: string; repo: string } {
    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = remote.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?$/);
    if (httpsMatch) {
      return {
        owner: httpsMatch[1],
        repo: httpsMatch[2],
      };
    }

    // SSH format: git@github.com:owner/repo.git
    const sshMatch = remote.match(/git@[^:]+:([^/]+)\/([^/]+?)(\.git)?$/);
    if (sshMatch) {
      return {
        owner: sshMatch[1],
        repo: sshMatch[2],
      };
    }

    throw new Error(`Unable to parse git remote URL: ${remote}`);
  }

  /**
   * Detect full git context with optional overrides
   * @param options - Optional overrides for owner, repo, branch, or remote name
   * @returns GitContext with owner, repo, and branch
   */
  detectContext(options: GitContextOptions = {}): GitContext {
    // Check if in git repository
    if (!this.isGitRepository()) {
      throw new Error('Not in a git repository');
    }

    // Get branch (with override)
    const branch = options.branch ?? this.getCurrentBranch();

    // If owner and repo are both provided, use them
    if (options.owner && options.repo) {
      return {
        owner: options.owner,
        repo: options.repo,
        branch,
      };
    }

    // Get remote URL and parse it
    const remoteName = options.remote ?? 'origin';
    const remoteUrl = this.getRemoteUrl(remoteName);
    const { owner: detectedOwner, repo: detectedRepo } = this.parseRemote(remoteUrl);

    // Use overrides if provided, otherwise use detected values
    const owner = options.owner ?? detectedOwner;
    const repo = options.repo ?? detectedRepo;

    return {
      owner,
      repo,
      branch,
    };
  }
}
