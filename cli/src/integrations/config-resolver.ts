/**
 * Integration configuration path resolver
 * Resolves relative paths in integration configs to absolute paths
 *
 * Note: With the plugin architecture, path resolution is typically handled
 * by each plugin. This module provides generic path resolution for any
 * provider that has a `path` option in their config.
 */

import * as path from "path";
import * as fs from "fs";
import type {
  IntegrationsConfig,
  IntegrationProviderConfig,
} from "@sudocode-ai/types";

/**
 * Resolved provider configuration with absolute path
 */
export interface ResolvedProviderConfig extends IntegrationProviderConfig {
  /** Absolute path (if the provider has a path option) */
  resolvedPath?: string;
}

/**
 * Resolved integrations configuration
 * Contains only enabled integrations with resolved paths
 */
export interface ResolvedConfig {
  [providerName: string]: ResolvedProviderConfig | undefined;
}

// Legacy type aliases for backwards compatibility
export type ResolvedJiraConfig = ResolvedProviderConfig;
export type ResolvedBeadsConfig = ResolvedProviderConfig;
export type ResolvedSpecKitConfig = ResolvedProviderConfig;
export type ResolvedOpenSpecConfig = ResolvedProviderConfig;

/**
 * Resolve integration paths from relative to absolute
 *
 * @param config - The integrations configuration with relative paths
 * @param projectPath - The project root directory (where .sudocode is located)
 * @returns Resolved configuration with absolute paths for enabled integrations
 * @throws Error if a required path doesn't exist for an enabled integration
 *
 * @example
 * ```typescript
 * const config = {
 *   beads: {
 *     enabled: true,
 *     auto_sync: false,
 *     default_sync_direction: 'bidirectional',
 *     conflict_resolution: 'newest-wins',
 *     options: {
 *       path: '../other-project/.beads',
 *     },
 *   },
 * };
 *
 * const resolved = resolveIntegrationPaths(config, '/home/user/myproject');
 * // resolved.beads.resolvedPath = '/home/user/other-project/.beads'
 * ```
 */
export function resolveIntegrationPaths(
  config: IntegrationsConfig,
  projectPath: string
): ResolvedConfig {
  const resolved: ResolvedConfig = {};

  for (const [providerName, providerConfig] of Object.entries(config)) {
    if (!providerConfig?.enabled) {
      continue;
    }

    // Start with a copy of the config
    const resolvedProvider: ResolvedProviderConfig = { ...providerConfig };

    // Check if provider has a path option that needs resolution
    const pathOption = providerConfig.options?.path;
    if (typeof pathOption === "string") {
      const resolvedPath = path.resolve(projectPath, pathOption);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(
          `${providerName} path not found: ${resolvedPath} (configured: ${pathOption})`
        );
      }
      resolvedProvider.resolvedPath = resolvedPath;
    }

    resolved[providerName] = resolvedProvider;
  }

  return resolved;
}

/**
 * Get list of enabled integration provider names
 *
 * @param config - The integrations configuration
 * @returns Array of enabled provider names
 */
export function getEnabledProviders(config: IntegrationsConfig): string[] {
  return Object.entries(config)
    .filter(([, providerConfig]) => providerConfig?.enabled)
    .map(([providerName]) => providerName);
}
