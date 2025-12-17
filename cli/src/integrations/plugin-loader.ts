/**
 * Plugin loader for integration plugins
 *
 * Handles dynamic loading of integration plugins via:
 * - npm packages (e.g., "@sudocode-ai/integration-beads")
 * - Local paths (e.g., "./plugins/my-integration")
 * - Globally installed packages
 *
 * First-party plugins are loaded by short name:
 * - "beads" -> "@sudocode-ai/integration-beads"
 */

import type {
  IntegrationPlugin,
  IntegrationProviderConfig,
  IntegrationsConfig,
  PluginValidationResult,
  PluginTestResult,
} from "@sudocode-ai/types";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

/**
 * Mapping of first-party plugin short names to npm package names
 */
const FIRST_PARTY_PLUGINS: Record<string, string> = {
  github: "@sudocode-ai/integration-github",
  "spec-kit": "@sudocode-ai/integration-speckit",
  openspec: "@sudocode-ai/integration-openspec",
  beads: "@sudocode-ai/integration-beads",
};

/**
 * Cache for loaded plugins
 */
const pluginCache = new Map<string, IntegrationPlugin>();

/**
 * Cache for global node_modules path (computed once)
 */
let globalNodeModulesCache: string | null = null;

/**
 * Get the global node_modules directory path
 */
function getGlobalNodeModules(): string | null {
  if (globalNodeModulesCache !== null) {
    return globalNodeModulesCache;
  }

  try {
    const result = execSync("npm root -g", { encoding: "utf-8" }).trim();
    globalNodeModulesCache = result;
    return result;
  } catch (error) {
    console.warn("Failed to get global node_modules path:", error);
    return null;
  }
}

/**
 * Check if a plugin package exists globally (without loading it)
 *
 * @param pluginId - Plugin identifier (short name, npm package, or local path)
 * @returns true if the package exists in global node_modules
 */
export function isPluginInstalledGlobally(pluginId: string): boolean {
  const packageName = resolvePluginPath(pluginId);
  const globalNodeModules = getGlobalNodeModules();

  if (!globalNodeModules) {
    return false;
  }

  const packagePath = path.join(globalNodeModules, packageName);
  return existsSync(packagePath);
}

/**
 * Resolve a plugin identifier to an importable module path
 *
 * @param pluginId - Plugin identifier (short name, npm package, or local path)
 * @returns Module path that can be passed to import()
 */
export function resolvePluginPath(pluginId: string): string {
  // Check if it's a first-party plugin short name
  if (FIRST_PARTY_PLUGINS[pluginId]) {
    return FIRST_PARTY_PLUGINS[pluginId];
  }

  // If it starts with @ or contains /, treat as npm package or path
  if (pluginId.startsWith("@") || pluginId.includes("/")) {
    return pluginId;
  }

  // Otherwise, assume it's a first-party plugin
  return `@sudocode-ai/integration-${pluginId}`;
}

/**
 * Try to resolve a global package path
 *
 * @param packageName - npm package name (e.g., "@sudocode-ai/integration-beads")
 * @returns Full file:// URL to the package, or null if not found
 */
function resolveGlobalPackage(packageName: string): string | null {
  const globalNodeModules = getGlobalNodeModules();
  if (!globalNodeModules) {
    return null;
  }

  const packagePath = path.join(globalNodeModules, packageName);
  if (!existsSync(packagePath)) {
    return null;
  }

  // Check for package.json to find the main entry point
  const packageJsonPath = path.join(packagePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf-8")
    );
    const mainEntry = packageJson.main || "index.js";
    const fullPath = path.join(packagePath, mainEntry);

    if (!existsSync(fullPath)) {
      return null;
    }

    // Convert to file:// URL for import()
    return pathToFileURL(fullPath).href;
  } catch (error) {
    console.warn(`Failed to resolve global package ${packageName}:`, error);
    return null;
  }
}

/**
 * Load a plugin by its identifier
 *
 * @param pluginId - Plugin identifier (short name, npm package, or local path)
 * @returns The loaded plugin, or null if loading failed
 */
export async function loadPlugin(
  pluginId: string
): Promise<IntegrationPlugin | null> {
  // Check cache first
  const cached = pluginCache.get(pluginId);
  if (cached) {
    return cached;
  }

  const modulePath = resolvePluginPath(pluginId);

  // Try regular import first (for local node_modules or linked packages)
  try {
    const module = await import(modulePath);
    const plugin: IntegrationPlugin = module.default || module;

    if (!isValidPlugin(plugin)) {
      console.error(
        `Invalid plugin '${pluginId}': missing required fields (name, displayName, version, validateConfig, testConnection, createProvider)`
      );
      return null;
    }

    pluginCache.set(pluginId, plugin);
    return plugin;
  } catch (error) {
    const err = error as { code?: string; message?: string };

    // If module not found, try global packages
    if (
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.code === "MODULE_NOT_FOUND"
    ) {
      const globalPath = resolveGlobalPackage(modulePath);

      if (globalPath) {
        try {
          const module = await import(globalPath);
          const plugin: IntegrationPlugin = module.default || module;

          if (!isValidPlugin(plugin)) {
            console.error(
              `Invalid plugin '${pluginId}': missing required fields (name, displayName, version, validateConfig, testConnection, createProvider)`
            );
            return null;
          }

          pluginCache.set(pluginId, plugin);
          return plugin;
        } catch (globalError) {
          console.error(
            `Failed to load global plugin '${pluginId}':`,
            (globalError as Error).message
          );
          return null;
        }
      }

      console.warn(
        `Plugin '${pluginId}' not installed. Install with: npm install -g ${modulePath}`
      );
    } else {
      console.error(`Failed to load plugin '${pluginId}':`, err.message);
    }
    return null;
  }
}

/**
 * Check if an object is a valid IntegrationPlugin
 */
function isValidPlugin(plugin: unknown): plugin is IntegrationPlugin {
  if (!plugin || typeof plugin !== "object") {
    return false;
  }

  const p = plugin as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.displayName === "string" &&
    typeof p.version === "string" &&
    typeof p.validateConfig === "function" &&
    typeof p.testConnection === "function" &&
    typeof p.createProvider === "function"
  );
}

/**
 * Load all configured plugins
 *
 * @param config - Integrations configuration
 * @returns Map of provider name to loaded plugin
 */
export async function loadConfiguredPlugins(
  config: IntegrationsConfig
): Promise<Map<string, IntegrationPlugin>> {
  const plugins = new Map<string, IntegrationPlugin>();

  for (const [providerName, providerConfig] of Object.entries(config)) {
    if (!providerConfig?.enabled) {
      continue;
    }

    // Determine plugin ID: use explicit plugin field, or fall back to provider name
    const pluginId = providerConfig.plugin || providerName;
    const plugin = await loadPlugin(pluginId);

    if (plugin) {
      plugins.set(providerName, plugin);
    }
  }

  return plugins;
}

/**
 * Validate a provider's configuration using its plugin
 *
 * @param providerName - Name of the provider in config
 * @param providerConfig - The provider's configuration
 * @returns Validation result from the plugin, or error if plugin not loaded
 */
export async function validateProviderConfig(
  providerName: string,
  providerConfig: IntegrationProviderConfig
): Promise<PluginValidationResult> {
  const pluginId = providerConfig.plugin || providerName;
  const plugin = await loadPlugin(pluginId);

  if (!plugin) {
    return {
      valid: false,
      errors: [`Plugin '${pluginId}' not installed or failed to load`],
      warnings: [],
    };
  }

  // Delegate validation to plugin
  return plugin.validateConfig(providerConfig.options || {});
}

/**
 * Test a provider's connection using its plugin
 *
 * @param providerName - Name of the provider in config
 * @param providerConfig - The provider's configuration
 * @param projectPath - Path to the sudocode project
 * @returns Test result from the plugin
 */
export async function testProviderConnection(
  providerName: string,
  providerConfig: IntegrationProviderConfig,
  projectPath: string
): Promise<PluginTestResult> {
  const pluginId = providerConfig.plugin || providerName;
  const plugin = await loadPlugin(pluginId);

  if (!plugin) {
    return {
      success: false,
      configured: true,
      enabled: providerConfig.enabled,
      error: `Plugin '${pluginId}' not installed or failed to load`,
    };
  }

  // Delegate test to plugin
  return plugin.testConnection(providerConfig.options || {}, projectPath);
}

/**
 * Get a list of available first-party plugins
 */
export function getFirstPartyPlugins(): Array<{
  name: string;
  package: string;
}> {
  return Object.entries(FIRST_PARTY_PLUGINS).map(([name, pkg]) => ({
    name,
    package: pkg,
  }));
}

/**
 * Clear the plugin cache (useful for testing)
 */
export function clearPluginCache(): void {
  pluginCache.clear();
}

/**
 * Extend Error to include 'code' property for module not found errors
 */
declare global {
  interface Error {
    code?: string;
  }
}
