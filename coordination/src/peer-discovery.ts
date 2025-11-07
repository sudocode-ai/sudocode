/**
 * Git-based peer discovery implementation
 */

import { exec as execCallback } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { PeerInfo } from "./types.js";

const exec = promisify(execCallback);

export interface PeerDiscoveryOptions {
  repoPath: string;
  coordinationBranch: string;
  agentId: string;
  refreshInterval: number; // milliseconds
}

export class PeerDiscovery {
  private options: PeerDiscoveryOptions;
  private refreshTimer?: NodeJS.Timeout;
  private peers: Map<string, PeerInfo> = new Map();
  private coordinationPath: string;

  constructor(options: PeerDiscoveryOptions) {
    this.options = options;
    this.coordinationPath = path.join(
      options.repoPath,
      ".sudocode",
      "coordination",
      "peers"
    );
  }

  /**
   * Initialize coordination branch and directory structure
   */
  async initialize(): Promise<void> {
    try {
      // Check if coordination branch exists remotely
      const { stdout: remoteBranches } = await exec(
        `git ls-remote --heads origin ${this.options.coordinationBranch}`,
        { cwd: this.options.repoPath }
      );

      if (!remoteBranches) {
        // Create orphan coordination branch
        await this.createCoordinationBranch();
      } else {
        // Fetch existing coordination branch
        await exec(
          `git fetch origin ${this.options.coordinationBranch}:${this.options.coordinationBranch}`,
          { cwd: this.options.repoPath }
        );
      }

      // Ensure directory structure exists
      await fs.mkdir(this.coordinationPath, { recursive: true });
    } catch (error) {
      throw new Error(
        `Failed to initialize peer discovery: ${(error as Error).message}`
      );
    }
  }

  /**
   * Create orphan coordination branch
   */
  private async createCoordinationBranch(): Promise<void> {
    const { repoPath, coordinationBranch } = this.options;

    try {
      // Save current branch
      const { stdout: currentBranch } = await exec("git branch --show-current", {
        cwd: repoPath,
      });

      // Create orphan branch
      await exec(`git checkout --orphan ${coordinationBranch}`, {
        cwd: repoPath,
      });
      await exec("git rm -rf .", { cwd: repoPath }).catch(() => {
        // Ignore errors if no files to remove
      });

      // Create initial structure
      await fs.mkdir(this.coordinationPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".sudocode", "coordination", "README.md"),
        "# Coordination Branch\n\nThis branch is used for P2P agent coordination. Do not commit manually.\n"
      );

      // Commit and push
      await exec("git add .sudocode/coordination/", { cwd: repoPath });
      await exec('git commit -m "Initialize coordination branch"', {
        cwd: repoPath,
      });
      await exec(`git push -u origin ${coordinationBranch}`, { cwd: repoPath });

      // Return to original branch
      await exec(`git checkout ${currentBranch.trim()}`, { cwd: repoPath });
    } catch (error) {
      throw new Error(
        `Failed to create coordination branch: ${(error as Error).message}`
      );
    }
  }

  /**
   * Publish peer information to Git
   */
  async publishPeerInfo(peerInfo: PeerInfo): Promise<void> {
    const { repoPath, coordinationBranch, agentId } = this.options;
    const peerFile = path.join(this.coordinationPath, `agent-${agentId}.json`);

    try {
      // Checkout coordination branch
      await exec(`git checkout ${coordinationBranch}`, { cwd: repoPath });

      // Write peer info
      await fs.mkdir(this.coordinationPath, { recursive: true });
      await fs.writeFile(peerFile, JSON.stringify(peerInfo, null, 2));

      // Commit and force push
      await exec(
        `git add .sudocode/coordination/peers/agent-${agentId}.json`,
        { cwd: repoPath }
      );

      // Check if there are changes to commit
      const { stdout: status } = await exec("git status --porcelain", {
        cwd: repoPath,
      });

      if (status.trim()) {
        // Amend previous commit if exists, otherwise create new commit
        const { stdout: commitCount } = await exec(
          `git rev-list --count ${coordinationBranch}`,
          { cwd: repoPath }
        );

        if (parseInt(commitCount.trim()) > 1) {
          await exec(`git commit --amend --no-edit`, { cwd: repoPath });
        } else {
          await exec(`git commit -m "Peer: ${agentId}"`, { cwd: repoPath });
        }

        await exec(`git push -f origin ${coordinationBranch}`, {
          cwd: repoPath,
        });
      }

      // Return to original branch
      const { stdout: currentBranch } = await exec("git branch --show-current", {
        cwd: repoPath,
      });
      if (currentBranch.trim() !== coordinationBranch) {
        await exec(`git checkout -`, { cwd: repoPath });
      }
    } catch (error) {
      throw new Error(
        `Failed to publish peer info: ${(error as Error).message}`
      );
    }
  }

  /**
   * Fetch peer information from Git
   */
  async fetchPeers(): Promise<Map<string, PeerInfo>> {
    const { repoPath, coordinationBranch, agentId } = this.options;

    try {
      // Save current branch
      const { stdout: currentBranch } = await exec("git branch --show-current", {
        cwd: repoPath,
      });

      // Fetch latest coordination branch
      await exec(`git fetch origin ${coordinationBranch}`, { cwd: repoPath });

      // Checkout coordination branch
      await exec(`git checkout ${coordinationBranch}`, { cwd: repoPath });

      // Read peer files
      const files = await fs.readdir(this.coordinationPath);
      const peerFiles = files.filter(
        (f) => f.startsWith("agent-") && f.endsWith(".json")
      );

      this.peers.clear();
      const now = Date.now();

      for (const file of peerFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.coordinationPath, file),
            "utf-8"
          );
          const peerInfo: PeerInfo = JSON.parse(content);

          // Filter stale peers (TTL expired)
          const age = now - new Date(peerInfo.lastSeen).getTime();
          if (age < peerInfo.ttl * 1000) {
            // Skip self
            if (peerInfo.agentId !== agentId) {
              this.peers.set(peerInfo.agentId, peerInfo);
            }
          }
        } catch (error) {
          console.warn(`Failed to parse peer file ${file}:`, error);
        }
      }

      // Return to original branch
      await exec(`git checkout ${currentBranch.trim()}`, { cwd: repoPath });

      return this.peers;
    } catch (error) {
      throw new Error(`Failed to fetch peers: ${(error as Error).message}`);
    }
  }

  /**
   * Start periodic peer discovery
   */
  startPeriodicDiscovery(
    callback: (peers: Map<string, PeerInfo>) => void
  ): void {
    // Initial fetch
    this.fetchPeers()
      .then((peers) => callback(peers))
      .catch((error) =>
        console.error("Failed to fetch peers:", error)
      );

    // Periodic refresh
    this.refreshTimer = setInterval(() => {
      this.fetchPeers()
        .then((peers) => callback(peers))
        .catch((error) => console.error("Failed to fetch peers:", error));
    }, this.options.refreshInterval);
  }

  /**
   * Stop periodic peer discovery
   */
  stopPeriodicDiscovery(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Get current peers
   */
  getPeers(): Map<string, PeerInfo> {
    return this.peers;
  }

  /**
   * Remove peer file (called on shutdown)
   */
  async removePeerInfo(): Promise<void> {
    const { repoPath, coordinationBranch, agentId } = this.options;
    const peerFile = path.join(this.coordinationPath, `agent-${agentId}.json`);

    try {
      // Checkout coordination branch
      await exec(`git checkout ${coordinationBranch}`, { cwd: repoPath });

      // Remove peer file
      await fs.unlink(peerFile).catch(() => {
        // Ignore if file doesn't exist
      });

      // Commit and push
      await exec(
        `git add .sudocode/coordination/peers/agent-${agentId}.json`,
        { cwd: repoPath }
      );

      const { stdout: status } = await exec("git status --porcelain", {
        cwd: repoPath,
      });

      if (status.trim()) {
        await exec(`git commit -m "Remove peer: ${agentId}"`, {
          cwd: repoPath,
        });
        await exec(`git push origin ${coordinationBranch}`, { cwd: repoPath });
      }

      // Return to original branch
      await exec("git checkout -", { cwd: repoPath });
    } catch (error) {
      console.warn(`Failed to remove peer info: ${(error as Error).message}`);
    }
  }
}
