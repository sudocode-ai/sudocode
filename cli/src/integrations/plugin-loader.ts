/**
 * Plugin loader for integration plugins
 *
 * Handles dynamic loading of integration plugins via:
 * - npm packages (e.g., "@sudocode-ai/integration-beads")
 * - Local paths (e.g., "./plugins/my-integration")
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

/**
 * Mapping of first-party plugin short names to npm package names
 */
const FIRST_PARTY_PLUGINS: Record<string, string> = {
  beads: "@sudocode-ai/integration-beads",
  "spec-kit": "@sudocode-ai/integration-speckit",
  openspec: "@sudocode-ai/integration-openspec",
};

/**
 * Cache for loaded plugins
 */
const pluginCache = new Map<string, IntegrationPlugin>();

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

  try {
    // Dynamic import
    const module = await import(modulePath);

    // Plugin should be the default export
    const plugin: IntegrationPlugin = module.default || module;

    // Validate plugin has required fields
    if (!isValidPlugin(plugin)) {
      console.error(
        `Invalid plugin '${pluginId}': missing required fields (name, displayName, version, validateConfig, testConnection, createProvider)`
      );
      return null;
    }

    // Cache the plugin
    pluginCache.set(pluginId, plugin);
    return plugin;
  } catch (error) {
    // Plugin not installed or failed to load
    const err = error as Error;
    if (
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.code === "MODULE_NOT_FOUND"
    ) {
      console.warn(
        `Plugin '${pluginId}' not installed. Install with: npm install ${modulePath}`
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
