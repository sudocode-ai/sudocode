import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'sudocode');
const DEPLOYMENTS_FILE = path.join(CONFIG_DIR, 'deployments.json');

/**
 * Deployment record for a GitHub Codespace
 */
export interface Deployment {
  name: string;
  repository: string;
  projectPath: string;
  hostname: string;
  port: number;
  createdAt: string;
  machine: string;
  codespaceIdleTimeout: number;
  keepAliveDuration: number;
  retentionPeriod: number;
  urls: {
    codespace: string;
    sudocode: string;
  };
}

/**
 * Configuration for tracking deployments and agent selection
 */
interface DeploymentsConfig {
  selectedAgent?: string;
  deployments: Deployment[];
}

/**
 * Get the currently selected agent
 * @returns The selected agent name, or null if none selected
 */
export async function getSelectedAgent(): Promise<string | null> {
  const config = await readDeployments();
  return config.selectedAgent || null;
}

/**
 * Set the selected agent
 * @param agent - The agent name to select
 */
export async function setSelectedAgent(agent: string): Promise<void> {
  const config = await readDeployments();
  config.selectedAgent = agent;
  await writeDeployments(config);
}

/**
 * Add or update a deployment record
 * Deduplicates by name - if a deployment with the same name exists, it will be replaced
 * @param deployment - The deployment to add or update
 */
export async function addDeployment(deployment: Deployment): Promise<void> {
  const config = await readDeployments();

  // Remove existing entry if exists (to avoid duplicates)
  config.deployments = config.deployments.filter(d => d.name !== deployment.name);

  // Add new deployment
  config.deployments.push(deployment);

  await writeDeployments(config);
}

/**
 * Remove a deployment by name
 * @param name - The name of the deployment to remove
 */
export async function removeDeployment(name: string): Promise<void> {
  const config = await readDeployments();
  config.deployments = config.deployments.filter(d => d.name !== name);
  await writeDeployments(config);
}

/**
 * List all tracked deployments
 * @returns Array of all deployments
 */
export async function listDeployments(): Promise<Deployment[]> {
  const config = await readDeployments();
  return config.deployments;
}

/**
 * Read the deployments configuration file
 * @returns The deployments configuration, or empty config if file doesn't exist
 */
async function readDeployments(): Promise<DeploymentsConfig> {
  try {
    const content = await fs.readFile(DEPLOYMENTS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // File doesn't exist or is invalid - return empty config
    return { deployments: [] };
  }
}

/**
 * Write the deployments configuration file
 * Creates the directory if it doesn't exist and sets file permissions to 600
 * @param config - The configuration to write
 */
async function writeDeployments(config: DeploymentsConfig): Promise<void> {
  // Create directory if it doesn't exist
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  // Write config file
  await fs.writeFile(DEPLOYMENTS_FILE, JSON.stringify(config, null, 2), 'utf-8');

  // Set restrictive permissions (user read/write only)
  await fs.chmod(DEPLOYMENTS_FILE, 0o600);
}
