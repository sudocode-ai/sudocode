/**
 * Deploy module exports
 *
 * This module provides all deployment-related functionality for remote environments,
 * primarily GitHub Codespaces.
 */

export { deployRemote, type DeployOptions } from './codespaces.js';
export { listDeploymentsCommand, stopDeployment, cleanupDeployments } from './commands.js';
export {
  addDeployment,
  removeDeployment,
  listDeployments,
  getSelectedAgent,
  setSelectedAgent,
  type Deployment
} from './config/deployments.js';
export {
  checkGhCliInstalled,
  checkGhAuthenticated,
  getCurrentRepo,
  createCodespace,
  deleteCodespace,
  listCodespaces,
  type CodespaceConfig
} from './utils/gh-cli.js';
