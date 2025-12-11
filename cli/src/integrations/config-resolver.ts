/**
 * Integration configuration path resolver
 * Resolves relative paths in integration configs to absolute paths
 */

import * as path from "path";
import * as fs from "fs";
import type {
  IntegrationsConfig,
  JiraConfig,
  BeadsConfig,
  SpecKitConfig,
  OpenSpecConfig,
} from "@sudocode-ai/types";

/**
 * Jira config with resolution marker
 */
export interface ResolvedJiraConfig extends JiraConfig {
  /** Marker indicating config has been processed */
  resolved: true;
}

/**
 * Beads config with resolved path
 */
export interface ResolvedBeadsConfig extends BeadsConfig {
  /** Absolute path to beads directory */
  resolvedPath: string;
}

/**
 * SpecKit config with resolved path
 */
export interface ResolvedSpecKitConfig extends SpecKitConfig {
  /** Absolute path to spec-kit directory */
  resolvedPath: string;
}

/**
 * OpenSpec config with resolved path
 */
export interface ResolvedOpenSpecConfig extends OpenSpecConfig {
  /** Absolute path to openspec directory */
  resolvedPath: string;
}

/**
 * Resolved integrations configuration
 * Contains only enabled integrations with resolved paths
 */
export interface ResolvedConfig {
  jira?: ResolvedJiraConfig;
  beads?: ResolvedBeadsConfig;
  "spec-kit"?: ResolvedSpecKitConfig;
  openspec?: ResolvedOpenSpecConfig;
}

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
 *     path: '../other-project/.beads',
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

  // Jira doesn't have a local path, just mark as resolved
  if (config.jira?.enabled) {
    resolved.jira = { ...config.jira, resolved: true };
  }

  // Beads has a local path that needs resolution
  if (config.beads?.enabled) {
    const resolvedPath = path.resolve(projectPath, config.beads.path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Beads path not found: ${resolvedPath}`);
    }
    resolved.beads = { ...config.beads, resolvedPath };
  }

  // SpecKit has a local path that needs resolution
  if (config["spec-kit"]?.enabled) {
    const resolvedPath = path.resolve(projectPath, config["spec-kit"].path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Spec-kit path not found: ${resolvedPath}`);
    }
    resolved["spec-kit"] = { ...config["spec-kit"], resolvedPath };
  }

  // OpenSpec has a local path that needs resolution
  if (config.openspec?.enabled) {
    const resolvedPath = path.resolve(projectPath, config.openspec.path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`OpenSpec path not found: ${resolvedPath}`);
    }
    resolved.openspec = { ...config.openspec, resolvedPath };
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
  const providers: string[] = [];

  if (config.jira?.enabled) providers.push("jira");
  if (config.beads?.enabled) providers.push("beads");
  if (config["spec-kit"]?.enabled) providers.push("spec-kit");
  if (config.openspec?.enabled) providers.push("openspec");

  return providers;
}
