/**
 * CLI commands for P2P agent coordination
 */

import chalk from "chalk";
import Table from "cli-table3";
import {
  CoordinationAgent,
  createDefaultConfig,
  generateAgentId,
} from "@sudocode-ai/coordination";
import * as fs from "fs/promises";
import * as path from "path";

// Global coordination agent instance
let agent: CoordinationAgent | null = null;
const COORD_STATE_FILE = ".sudocode/coordination-state.json";

interface CoordinationState {
  agentId: string;
  running: boolean;
  startedAt?: string;
}

/**
 * Load coordination state from file
 */
async function loadCoordinationState(): Promise<CoordinationState | null> {
  try {
    const content = await fs.readFile(COORD_STATE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save coordination state to file
 */
async function saveCoordinationState(state: CoordinationState): Promise<void> {
  await fs.mkdir(path.dirname(COORD_STATE_FILE), { recursive: true });
  await fs.writeFile(COORD_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Delete coordination state file
 */
async function deleteCoordinationState(): Promise<void> {
  try {
    await fs.unlink(COORD_STATE_FILE);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Handle coord start command
 */
export async function handleCoordStart(options: {
  agentId?: string;
  capabilities?: string[];
  branch?: string;
}): Promise<void> {
  try {
    // Check if already running
    const state = await loadCoordinationState();
    if (state?.running) {
      console.log(chalk.yellow("Coordination agent is already running"));
      console.log(chalk.gray(`  Agent ID: ${state.agentId}`));
      console.log(chalk.gray(`  Started at: ${state.startedAt}`));
      return;
    }

    // Generate or use provided agent ID
    const agentId = options.agentId || (state?.agentId ?? generateAgentId());

    // Create config
    const config = createDefaultConfig(agentId, {
      capabilities: options.capabilities || ["code", "review", "test"],
      coordinationBranch: options.branch || "coordination",
    });

    // Create and start agent
    console.log(chalk.blue("Starting coordination agent..."));
    console.log(chalk.gray(`  Agent ID: ${agentId}`));
    console.log(chalk.gray(`  Capabilities: ${config.capabilities.join(", ")}`));

    agent = new CoordinationAgent(config);
    await agent.start();

    // Save state
    await saveCoordinationState({
      agentId,
      running: true,
      startedAt: new Date().toISOString(),
    });

    console.log(chalk.green("\u2713 Coordination agent started successfully"));
    console.log(
      chalk.gray(
        `  Use 'sudocode coord status' to check status, 'sudocode coord stop' to stop`
      )
    );
  } catch (error) {
    console.error(
      chalk.red("Failed to start coordination agent:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord stop command
 */
export async function handleCoordStop(): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running) {
      console.log(chalk.yellow("Coordination agent is not running"));
      return;
    }

    console.log(chalk.blue("Stopping coordination agent..."));

    if (agent) {
      await agent.stop();
      agent = null;
    }

    // Delete state file
    await deleteCoordinationState();

    console.log(chalk.green("\u2713 Coordination agent stopped"));
  } catch (error) {
    console.error(
      chalk.red("Failed to stop coordination agent:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord status command
 */
export async function handleCoordStatus(): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running) {
      console.log(chalk.yellow("Coordination agent is not running"));
      console.log(
        chalk.gray("  Start with: sudocode coord start")
      );
      return;
    }

    console.log(chalk.blue("Coordination Agent Status"));
    console.log(chalk.gray("-".repeat(50)));
    console.log(`  Status: ${chalk.green("Running")}`);
    console.log(`  Agent ID: ${chalk.cyan(state.agentId)}`);
    console.log(`  Started: ${chalk.gray(state.startedAt)}`);

    if (agent) {
      const status = agent.getStatus();
      const connectedPeers = agent.getConnectedPeers();
      const activeWork = agent.getAllActiveWork();
      const metadata = agent.getAllAgentMetadata();

      console.log(`  Network Status: ${chalk.cyan(status)}`);
      console.log(`  Connected Peers: ${chalk.cyan(connectedPeers.length)}`);
      console.log(`  Active Agents: ${chalk.cyan(activeWork.size)}`);

      // Show active work
      if (activeWork.size > 0) {
        console.log(chalk.blue("\nActive Work:"));
        for (const [agentId, work] of activeWork) {
          console.log(`  ${chalk.cyan(agentId)}:`);
          console.log(`    Status: ${work.status}`);
          if (work.issues.length > 0) {
            console.log(`    Issues: ${work.issues.join(", ")}`);
          }
          if (work.specs.length > 0) {
            console.log(`    Specs: ${work.specs.join(", ")}`);
          }
          if (work.files.length > 0) {
            console.log(
              `    Files: ${work.files.slice(0, 3).join(", ")}${work.files.length > 3 ? "..." : ""}`
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(
      chalk.red("Failed to get coordination status:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord peers command
 */
export async function handleCoordPeers(): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running || !agent) {
      console.log(chalk.yellow("Coordination agent is not running"));
      return;
    }

    const connectedPeers = agent.getConnectedPeers();
    const metadata = agent.getAllAgentMetadata();

    console.log(chalk.blue(`Connected Peers (${connectedPeers.length})`));
    console.log(chalk.gray("-".repeat(50)));

    if (connectedPeers.length === 0) {
      console.log(chalk.gray("  No peers connected"));
      return;
    }

    const table = new Table({
      head: ["Agent ID", "Status", "Last Seen", "Capabilities"],
      colWidths: [30, 15, 20, 30],
    });

    for (const peer of connectedPeers) {
      const meta = metadata.get(peer.agentId);
      const lastSeen = meta
        ? new Date(meta.lastSeen).toLocaleString()
        : "Unknown";
      const capabilities = meta ? meta.capabilities.join(", ") : "Unknown";

      table.push([
        peer.agentId,
        chalk.green(peer.status),
        lastSeen,
        capabilities,
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    console.error(
      chalk.red("Failed to list peers:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord leases command
 */
export async function handleCoordLeases(): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running || !agent) {
      console.log(chalk.yellow("Coordination agent is not running"));
      return;
    }

    const leaseManager = agent.getLeaseManager();
    const myLeases = leaseManager.getMyLeases();

    console.log(chalk.blue(`My Leases (${myLeases.size})`));
    console.log(chalk.gray("-".repeat(50)));

    if (myLeases.size === 0) {
      console.log(chalk.gray("  No leases held"));
      return;
    }

    const table = new Table({
      head: ["Resource", "Type", "Acquired", "Expires"],
      colWidths: [40, 15, 20, 20],
    });

    for (const [resource, lease] of myLeases) {
      const acquired = new Date(lease.acquiredAt).toLocaleString();
      const expires = new Date(lease.expires).toLocaleString();

      table.push([resource, lease.leaseType, acquired, expires]);
    }

    console.log(table.toString());
  } catch (error) {
    console.error(
      chalk.red("Failed to list leases:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord lease command
 */
export async function handleCoordLease(
  resource: string,
  options: { type?: string; priority?: number }
): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running || !agent) {
      console.log(chalk.yellow("Coordination agent is not running"));
      return;
    }

    const leaseManager = agent.getLeaseManager();

    const type = (options.type || "file") as "file" | "issue" | "spec";
    const priority = options.priority || 5;

    console.log(chalk.blue(`Acquiring lease on ${resource}...`));

    const acquired = await leaseManager.acquireLease({
      path: resource,
      type,
      priority,
    });

    if (acquired) {
      console.log(chalk.green(`\u2713 Lease acquired on ${resource}`));
    } else {
      console.log(chalk.red(`\u2717 Failed to acquire lease on ${resource}`));
      console.log(
        chalk.gray("  Resource may be held by another agent")
      );
    }
  } catch (error) {
    console.error(
      chalk.red("Failed to acquire lease:"),
      (error as Error).message
    );
    process.exit(1);
  }
}

/**
 * Handle coord release command
 */
export async function handleCoordRelease(resource: string): Promise<void> {
  try {
    const state = await loadCoordinationState();

    if (!state?.running || !agent) {
      console.log(chalk.yellow("Coordination agent is not running"));
      return;
    }

    const leaseManager = agent.getLeaseManager();

    console.log(chalk.blue(`Releasing lease on ${resource}...`));

    const released = await leaseManager.releaseLease(resource);

    if (released) {
      console.log(chalk.green(`\u2713 Lease released on ${resource}`));
    } else {
      console.log(chalk.red(`\u2717 Failed to release lease on ${resource}`));
      console.log(chalk.gray("  Lease may not be held by this agent"));
    }
  } catch (error) {
    console.error(
      chalk.red("Failed to release lease:"),
      (error as Error).message
    );
    process.exit(1);
  }
}
