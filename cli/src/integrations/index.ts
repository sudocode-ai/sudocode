/**
 * Integration module for sudocode
 * Provides plugin loading, configuration validation, path resolution,
 * provider interfaces, sync coordination, and registry for external integrations
 */

// Plugin loading (dynamic imports)
export {
  loadPlugin,
  loadConfiguredPlugins,
  resolvePluginPath,
  validateProviderConfig,
  testProviderConnection,
  getFirstPartyPlugins,
  clearPluginCache,
  isPluginInstalledGlobally,
} from "./plugin-loader.js";

// Configuration validation
export {
  validateIntegrationsConfig,
  validateIntegrationsConfigWithPlugins,
  type ValidationResult,
} from "./config-validator.js";

// Configuration path resolution
export {
  resolveIntegrationPaths,
  getEnabledProviders,
  type ResolvedConfig,
  type ResolvedProviderConfig,
  // Legacy type aliases
  type ResolvedJiraConfig,
  type ResolvedBeadsConfig,
  type ResolvedSpecKitConfig,
  type ResolvedOpenSpecConfig,
} from "./config-resolver.js";

// Provider interface and types
export type { IntegrationProvider, ProviderRegistry } from "./types.js";

// Base provider class
export { BaseIntegrationProvider } from "./base-provider.js";

// Provider registry
export { DefaultProviderRegistry } from "./registry.js";

// Sync coordinator
export {
  SyncCoordinator,
  type SyncCoordinatorOptions,
} from "./sync-coordinator.js";

// Conflict resolution utilities
export {
  resolveByStrategy,
  logConflict,
  createConflictLog,
  isConflict,
  type ConflictLog,
} from "./utils/conflict-resolver.js";
