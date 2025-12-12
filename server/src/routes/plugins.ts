/**
 * Server routes for plugin management
 *
 * Provides API endpoints for listing, activating, and configuring integration plugins.
 */

import { Router, Request, Response } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";
import type {
  IntegrationsConfig,
  IntegrationProviderConfig,
} from "@sudocode-ai/types";
import {
  getFirstPartyPlugins,
  loadPlugin,
  validateProviderConfig,
  testProviderConnection,
} from "@sudocode-ai/cli/dist/integrations/index.js";

/**
 * Helper to read config.json
 */
function readConfig(sudocodeDir: string): Record<string, unknown> {
  const configPath = path.join(sudocodeDir, "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

/**
 * Helper to write config.json
 */
function writeConfig(
  sudocodeDir: string,
  config: Record<string, unknown>
): void {
  const configPath = path.join(sudocodeDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Check if a plugin is installed by attempting to load it
 */
async function isPluginInstalled(pluginName: string): Promise<boolean> {
  const plugin = await loadPlugin(pluginName);
  return plugin !== null;
}

export interface PluginInfo {
  name: string;
  displayName?: string;
  package: string;
  version?: string;
  description?: string;
  installed: boolean;
  activated: boolean;
  enabled: boolean;
  configSchema?: unknown;
  options?: Record<string, unknown>;
  // Integration-level config
  integrationConfig?: {
    auto_sync?: boolean;
    auto_import?: boolean;
    delete_behavior?: "close" | "delete" | "ignore";
    conflict_resolution?: "newest-wins" | "sudocode-wins" | "external-wins" | "manual";
    default_sync_direction?: "inbound" | "outbound" | "bidirectional";
  };
}

export function createPluginsRouter(): Router {
  const router = Router();

  /**
   * GET /api/plugins - List all available plugins with their status
   *
   * Returns both first-party plugins and any custom plugins configured in config.json
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const firstPartyPlugins = getFirstPartyPlugins();
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      const plugins: PluginInfo[] = await Promise.all(
        firstPartyPlugins.map(async (p) => {
          const installed = await isPluginInstalled(p.name);
          const providerConfig = integrations[p.name];
          const activated = !!providerConfig;
          const enabled = providerConfig?.enabled ?? false;

          let displayName: string | undefined;
          let version: string | undefined;
          let description: string | undefined;
          let configSchema: unknown | undefined;

          if (installed) {
            const plugin = await loadPlugin(p.name);
            if (plugin) {
              displayName = plugin.displayName;
              version = plugin.version;
              description = plugin.description;
              configSchema = plugin.configSchema;
            }
          }

          return {
            name: p.name,
            displayName,
            package: p.package,
            version,
            description,
            installed,
            activated,
            enabled,
            configSchema,
            options: providerConfig?.options,
            integrationConfig: providerConfig
              ? {
                  auto_sync: providerConfig.auto_sync,
                  auto_import: providerConfig.auto_import,
                  delete_behavior: providerConfig.delete_behavior,
                  conflict_resolution: providerConfig.conflict_resolution,
                  default_sync_direction: providerConfig.default_sync_direction,
                }
              : undefined,
          };
        })
      );

      // Also include any custom plugins from config that aren't first-party
      const firstPartyNames = new Set(firstPartyPlugins.map((p) => p.name));
      for (const [name, providerConfig] of Object.entries(integrations)) {
        if (!firstPartyNames.has(name) && providerConfig) {
          const pluginId = providerConfig.plugin || name;
          const installed = await isPluginInstalled(pluginId);

          let displayName: string | undefined;
          let version: string | undefined;
          let description: string | undefined;
          let configSchema: unknown | undefined;

          if (installed) {
            const plugin = await loadPlugin(pluginId);
            if (plugin) {
              displayName = plugin.displayName;
              version = plugin.version;
              description = plugin.description;
              configSchema = plugin.configSchema;
            }
          }

          plugins.push({
            name,
            displayName,
            package: pluginId,
            version,
            description,
            installed,
            activated: true,
            enabled: providerConfig.enabled ?? false,
            configSchema,
            options: providerConfig.options,
            integrationConfig: {
              auto_sync: providerConfig.auto_sync,
              auto_import: providerConfig.auto_import,
              delete_behavior: providerConfig.delete_behavior,
              conflict_resolution: providerConfig.conflict_resolution,
              default_sync_direction: providerConfig.default_sync_direction,
            },
          });
        }
      }

      res.status(200).json({ success: true, data: { plugins } });
    } catch (error) {
      console.error("Failed to list plugins:", error);
      res.status(500).json({ error: "Failed to list plugins" });
    }
  });

  /**
   * GET /api/plugins/:name - Get details for a specific plugin
   */
  router.get("/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;
      const providerConfig = integrations[name];

      const installed = await isPluginInstalled(name);

      if (!installed) {
        res.status(404).json({
          error: `Plugin '${name}' is not installed`,
          installed: false,
        });
        return;
      }

      const plugin = await loadPlugin(name);
      if (!plugin) {
        res.status(500).json({ error: `Failed to load plugin '${name}'` });
        return;
      }

      const pluginInfo: PluginInfo = {
        name,
        displayName: plugin.displayName,
        package: `@sudocode-ai/integration-${name}`,
        version: plugin.version,
        description: plugin.description,
        installed: true,
        activated: !!providerConfig,
        enabled: providerConfig?.enabled ?? false,
        configSchema: plugin.configSchema,
        options: providerConfig?.options,
      };

      res.status(200).json({ success: true, data: pluginInfo });
    } catch (error) {
      console.error("Failed to get plugin:", error);
      res.status(500).json({ error: "Failed to get plugin details" });
    }
  });

  /**
   * POST /api/plugins/:name/activate - Activate a plugin
   *
   * Creates an entry in config.json integrations section with enabled: true
   * Optionally accepts initial options in the request body
   */
  router.post("/:name/activate", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { options = {} } = req.body as { options?: Record<string, unknown> };

      // Check if plugin is installed
      const installed = await isPluginInstalled(name);
      if (!installed) {
        res.status(400).json({
          error: `Plugin '${name}' is not installed. Install with: sudocode plugin install ${name}`,
          installed: false,
        });
        return;
      }

      // Load plugin to validate options
      const plugin = await loadPlugin(name);
      if (!plugin) {
        res.status(500).json({ error: `Failed to load plugin '${name}'` });
        return;
      }

      // Validate options if provided
      if (Object.keys(options).length > 0) {
        const validation = plugin.validateConfig(options);
        if (!validation.valid) {
          res.status(400).json({
            error: "Invalid plugin options",
            errors: validation.errors,
            warnings: validation.warnings,
          });
          return;
        }
      }

      // Read and update config
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      // Create or update provider config
      const providerConfig: IntegrationProviderConfig = {
        enabled: true,
        auto_sync: true, // Enable auto-sync by default when activating
        options,
        ...(integrations[name] || {}),
      };
      providerConfig.enabled = true; // Ensure enabled is set
      providerConfig.auto_sync = true; // Ensure auto_sync is enabled
      if (Object.keys(options).length > 0) {
        providerConfig.options = options;
      }

      integrations[name] = providerConfig;
      config.integrations = integrations;

      // Write updated config
      writeConfig(req.project!.sudocodeDir, config);

      // Reload integration sync service to pick up new config
      if (req.project!.integrationSyncService) {
        await req.project!.integrationSyncService.reload();
      }

      res.status(200).json({
        success: true,
        data: {
          message: `Plugin '${name}' activated`,
          plugin: {
            name,
            displayName: plugin.displayName,
            enabled: true,
            options: providerConfig.options,
          },
        },
      });
    } catch (error) {
      console.error("Failed to activate plugin:", error);
      res.status(500).json({ error: "Failed to activate plugin" });
    }
  });

  /**
   * POST /api/plugins/:name/deactivate - Deactivate a plugin
   *
   * Sets enabled: false in config.json (keeps the configuration)
   */
  router.post("/:name/deactivate", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      if (!integrations[name]) {
        res.status(404).json({
          error: `Plugin '${name}' is not configured`,
        });
        return;
      }

      // Set enabled to false (preserve other config)
      integrations[name].enabled = false;
      integrations[name].auto_sync = false; // Also disable auto-sync
      config.integrations = integrations;

      writeConfig(req.project!.sudocodeDir, config);

      // Reload integration sync service to stop watching/polling
      if (req.project!.integrationSyncService) {
        await req.project!.integrationSyncService.reload();
      }

      res.status(200).json({
        success: true,
        data: {
          message: `Plugin '${name}' deactivated`,
        },
      });
    } catch (error) {
      console.error("Failed to deactivate plugin:", error);
      res.status(500).json({ error: "Failed to deactivate plugin" });
    }
  });

  /**
   * PUT /api/plugins/:name/options - Update plugin options and integration config
   *
   * Validates options against plugin schema before saving
   * Also accepts integrationConfig for sync settings
   */
  router.put("/:name/options", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { options = {}, integrationConfig = {} } = req.body as {
        options?: Record<string, unknown>;
        integrationConfig?: {
          auto_sync?: boolean;
          auto_import?: boolean;
          delete_behavior?: "close" | "delete" | "ignore";
          conflict_resolution?: "newest-wins" | "sudocode-wins" | "external-wins" | "manual";
          default_sync_direction?: "inbound" | "outbound" | "bidirectional";
        };
      };

      // Check if plugin is installed
      const installed = await isPluginInstalled(name);
      if (!installed) {
        res.status(400).json({
          error: `Plugin '${name}' is not installed`,
        });
        return;
      }

      // Validate options if provided
      if (Object.keys(options).length > 0) {
        const validation = await validateProviderConfig(name, {
          enabled: true,
          options,
        });

        if (!validation.valid) {
          res.status(400).json({
            error: "Invalid plugin options",
            errors: validation.errors,
            warnings: validation.warnings,
          });
          return;
        }
      }

      // Read and update config
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      if (!integrations[name]) {
        // Create new entry if not exists
        integrations[name] = {
          enabled: false,
          options,
        };
      } else {
        if (Object.keys(options).length > 0) {
          integrations[name].options = options;
        }
      }

      // Apply integration config settings
      if (integrationConfig.auto_sync !== undefined) {
        integrations[name].auto_sync = integrationConfig.auto_sync;
      }
      if (integrationConfig.auto_import !== undefined) {
        integrations[name].auto_import = integrationConfig.auto_import;
      }
      if (integrationConfig.delete_behavior !== undefined) {
        integrations[name].delete_behavior = integrationConfig.delete_behavior;
      }
      if (integrationConfig.conflict_resolution !== undefined) {
        integrations[name].conflict_resolution = integrationConfig.conflict_resolution;
      }
      if (integrationConfig.default_sync_direction !== undefined) {
        integrations[name].default_sync_direction = integrationConfig.default_sync_direction;
      }

      config.integrations = integrations;
      writeConfig(req.project!.sudocodeDir, config);

      // Reload integration sync service to pick up new options
      if (req.project!.integrationSyncService) {
        await req.project!.integrationSyncService.reload();
      }

      res.status(200).json({
        success: true,
        data: {
          options,
          integrationConfig,
        },
      });
    } catch (error) {
      console.error("Failed to update plugin options:", error);
      res.status(500).json({ error: "Failed to update plugin options" });
    }
  });

  /**
   * POST /api/plugins/:name/test - Test plugin connection
   *
   * Verifies the plugin can connect with current configuration
   */
  router.post("/:name/test", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;
      const providerConfig = integrations[name];

      if (!providerConfig) {
        res.status(404).json({
          success: false,
          error: `Plugin '${name}' is not configured`,
        });
        return;
      }

      const result = await testProviderConnection(
        name,
        providerConfig,
        req.project!.path
      );

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("Failed to test plugin:", error);
      res.status(500).json({
        success: false,
        error: "Failed to test plugin connection",
      });
    }
  });

  /**
   * POST /api/plugins/:name/install - Install a plugin via npm
   *
   * Installs the plugin package globally so it can be loaded
   */
  router.post("/:name/install", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { package: packageName } = req.body as { package?: string };

      // Determine the package to install
      const targetPackage =
        packageName || `@sudocode-ai/integration-${name}`;

      // Check if already installed
      const alreadyInstalled = await isPluginInstalled(name);
      if (alreadyInstalled) {
        res.status(200).json({
          success: true,
          data: {
            message: `Plugin '${name}' is already installed`,
            alreadyInstalled: true,
          },
        });
        return;
      }

      // Install the package
      try {
        execSync(`npm install -g ${targetPackage}`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (installError) {
        const error = installError as { stderr?: string; message?: string };
        res.status(500).json({
          success: false,
          error: `Failed to install package: ${error.stderr || error.message}`,
        });
        return;
      }

      // Verify installation
      const installed = await isPluginInstalled(name);
      if (!installed) {
        res.status(500).json({
          success: false,
          error: `Package installed but plugin '${name}' could not be loaded`,
        });
        return;
      }

      // Load plugin to get info
      const plugin = await loadPlugin(name);

      res.status(200).json({
        success: true,
        data: {
          message: `Plugin '${name}' installed successfully`,
          plugin: plugin
            ? {
                name,
                displayName: plugin.displayName,
                version: plugin.version,
                description: plugin.description,
              }
            : { name },
        },
      });
    } catch (error) {
      console.error("Failed to install plugin:", error);
      res.status(500).json({ error: "Failed to install plugin" });
    }
  });

  /**
   * DELETE /api/plugins/:name - Remove plugin configuration
   *
   * Removes the plugin entry from config.json entirely
   */
  router.delete("/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      if (!integrations[name]) {
        res.status(404).json({
          error: `Plugin '${name}' is not configured`,
        });
        return;
      }

      delete integrations[name];
      config.integrations = integrations;

      writeConfig(req.project!.sudocodeDir, config);

      // Reload integration sync service to unregister removed provider
      if (req.project!.integrationSyncService) {
        await req.project!.integrationSyncService.reload();
      }

      res.status(200).json({
        success: true,
        data: {
          message: `Plugin '${name}' configuration removed`,
        },
      });
    } catch (error) {
      console.error("Failed to remove plugin:", error);
      res.status(500).json({ error: "Failed to remove plugin configuration" });
    }
  });

  return router;
}
