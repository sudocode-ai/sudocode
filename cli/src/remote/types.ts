/**
 * Shared types for remote deployment system
 */

/**
 * Options for spawning a remote deployment
 */
export interface SpawnOptions {
  /** Git repository owner */
  owner?: string;
  /** Git repository name */
  repo?: string;
  /** Branch to deploy */
  branch?: string;
  /** Server port */
  port?: number;
  /** Machine type/size */
  machine?: string;
  /** Idle timeout in minutes */
  idleTimeout?: number;
  /** Keep-alive duration in hours */
  keepAliveHours?: number;
  /** Retention period in days */
  retentionPeriod?: number;
  /** Git remote name (default: 'origin') */
  remote?: string;
  /** Development mode - use local sudocode packages instead of npm */
  dev?: boolean;
  /** Don't open browser automatically after deployment */
  noOpen?: boolean;
}

/**
 * Git context information
 */
export interface GitInfo {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  idleTimeout: number;
  keepAliveHours: number;
}

/**
 * Provider-specific options
 */
export interface ProviderOptions {
  machine: string;
  retentionPeriod: number;
}

/**
 * Deployment URLs
 */
export interface DeploymentUrls {
  workspace: string;
  sudocode: string;
  ssh: string;
}

/**
 * Information about a deployment
 */
export interface DeploymentInfo {
  id: string;
  name: string;
  provider: 'codespaces' | 'coder';
  git: GitInfo;
  status: DeploymentStatus;
  createdAt: string;
  urls: DeploymentUrls;
  keepAliveHours: number;
  idleTimeout: number;
  machine?: string;
  retentionPeriod?: number;
}

/**
 * Deployment status
 */
export type DeploymentStatus = 
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'provisioning'
  | 'failed';
