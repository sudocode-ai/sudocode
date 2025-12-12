/**
 * IntegrationSyncService - Background service for external integration synchronization
 *
 * Manages the lifecycle of integration plugins and coordinates sync operations
 * between sudocode and external systems (Jira, Beads, etc.).
 *
 * Features:
 * - Loads integration config from .sudocode/config.json
 * - Dynamically loads plugins via plugin-loader
 * - Creates and registers providers with SyncCoordinator
 * - Handles polling-based auto-sync for enabled providers
 * - Broadcasts sync events via WebSocket
 */

import { existsSync, readFileSync } from "fs";
import * as path from "path";
import type { IntegrationsConfig, SyncResult } from "@sudocode-ai/types";
import {
  SyncCoordinator,
  loadPlugin,
} from "@sudocode-ai/cli/dist/integrations/index.js";
// IntegrationProvider type used for casting plugin providers to coordinator type
import type { IntegrationProvider } from "@sudocode-ai/cli/dist/integrations/types.js";
import { broadcastToProject } from "./websocket.js";

/** Default polling interval for auto-sync (5 minutes) */
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum polling interval (30 seconds) */
const MIN_POLL_INTERVAL_MS = 30 * 1000;

/**
 * Options for creating IntegrationSyncService
 */
export interface IntegrationSyncServiceOptions {
  /** Project ID for WebSocket broadcasts */
  projectId: string;
  /** Absolute path to project root */
  projectPath: string;
  /** Absolute path to .sudocode directory */
  sudocodeDir: string;
  /** Custom polling interval in ms (default: 5 minutes) */
  pollIntervalMs?: number;
  /** Whether to start auto-sync on initialization (default: true) */
  autoStart?: boolean;
}

/**
 * Status of a provider's sync state
 */
export interface ProviderSyncStatus {
  name: string;
  enabled: boolean;
  autoSync: boolean;
  lastSyncAt: Date | null;
  lastSyncResult: "success" | "error" | "pending" | null;
  lastError: string | null;
  isPolling: boolean;
  isWatching: boolean;
}

/**
 * Sync event types for WebSocket broadcasts
 */
export type IntegrationSyncEvent =
  | { type: "sync:started"; provider: string; timestamp: string }
  | {
      type: "sync:completed";
      provider: string;
      results: SyncResult[];
      timestamp: string;
    }
  | { type: "sync:error"; provider: string; error: string; timestamp: string }
  | {
      type: "sync:all:started";
      providers: string[];
      timestamp: string;
    }
  | {
      type: "sync:all:completed";
      results: SyncResult[];
      timestamp: string;
    };

/**
 * IntegrationSyncService manages background synchronization with external systems
 */
export class IntegrationSyncService {
  private coordinator: SyncCoordinator | null = null;
  private config: IntegrationsConfig = {};
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private providerStatus: Map<string, ProviderSyncStatus> = new Map();
  private isRunning = false;
  private readonly options: Required<IntegrationSyncServiceOptions>;

  constructor(options: IntegrationSyncServiceOptions) {
    this.options = {
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      autoStart: true,
      ...options,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize and start the integration sync service
   *
   * 1. Loads config from .sudocode/config.json
   * 2. Loads enabled plugins
   * 3. Creates providers and registers with coordinator
   * 4. Starts polling/watching for auto-sync providers
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(
        `[integration-sync] Service already running for ${this.options.projectId}`
      );
      return;
    }

    console.log(
      `[integration-sync] Starting for project ${this.options.projectId}`
    );

    try {
      // 1. Load config
      this.config = this.loadConfig();
      const enabledProviders = this.getEnabledProviderNames();

      if (enabledProviders.length === 0) {
        console.log(`[integration-sync] No enabled integrations found`);
        this.isRunning = true;
        return;
      }

      console.log(
        `[integration-sync] Found ${enabledProviders.length} enabled provider(s): ${enabledProviders.join(", ")}`
      );

      // 2. Create coordinator
      this.coordinator = new SyncCoordinator({
        projectPath: this.options.projectPath,
        config: this.config,
        onConflict: async (conflict) => {
          // For now, use default strategy from config
          // Future: could prompt user via WebSocket
          console.log(
            `[integration-sync] Conflict detected: ${conflict.sudocode_entity_id} <-> ${conflict.external_id}`
          );
          return "skip";
        },
      });

      // 3. Load plugins and create providers
      for (const providerName of enabledProviders) {
        await this.loadAndRegisterProvider(providerName);
      }

      // 4. Start coordinator (initializes providers, starts watching)
      await this.coordinator.start();

      // 5. Start polling for providers with auto_sync enabled
      if (this.options.autoStart) {
        this.startPolling();
      }

      this.isRunning = true;
      console.log(
        `[integration-sync] Service started for ${this.options.projectId}`
      );
    } catch (error) {
      console.error(`[integration-sync] Failed to start:`, error);
      throw error;
    }
  }

  /**
   * Stop the integration sync service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(
      `[integration-sync] Stopping for project ${this.options.projectId}`
    );

    // Stop all polling timers
    for (const [providerName, timer] of this.pollTimers) {
      clearInterval(timer);
      const status = this.providerStatus.get(providerName);
      if (status) {
        status.isPolling = false;
      }
    }
    this.pollTimers.clear();

    // Stop coordinator (disposes providers, stops watching)
    if (this.coordinator) {
      await this.coordinator.stop();
      this.coordinator = null;
    }

    this.isRunning = false;
    console.log(
      `[integration-sync] Service stopped for ${this.options.projectId}`
    );
  }

  /**
   * Reload configuration and restart providers
   *
   * Call this when config.json changes
   */
  async reload(): Promise<void> {
    console.log(
      `[integration-sync] Reloading config for ${this.options.projectId}`
    );
    await this.stop();
    await this.start();
  }

  // ==========================================================================
  // Sync Operations
  // ==========================================================================

  /**
   * Trigger sync for all enabled providers
   */
  async syncAll(): Promise<SyncResult[]> {
    if (!this.coordinator) {
      throw new Error("IntegrationSyncService not started");
    }

    const providerNames = this.getEnabledProviderNames();
    this.broadcast({
      type: "sync:all:started",
      providers: providerNames,
      timestamp: new Date().toISOString(),
    });

    try {
      const results = await this.coordinator.syncAll();

      this.broadcast({
        type: "sync:all:completed",
        results,
        timestamp: new Date().toISOString(),
      });

      // Update status for all providers
      for (const name of providerNames) {
        this.updateProviderStatus(name, {
          lastSyncAt: new Date(),
          lastSyncResult: "success",
          lastError: null,
        });
      }

      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Update status for all providers
      for (const name of providerNames) {
        this.updateProviderStatus(name, {
          lastSyncAt: new Date(),
          lastSyncResult: "error",
          lastError: errorMsg,
        });
      }

      throw error;
    }
  }

  /**
   * Trigger sync for a specific provider
   */
  async syncProvider(providerName: string): Promise<SyncResult[]> {
    if (!this.coordinator) {
      throw new Error("IntegrationSyncService not started");
    }

    this.broadcast({
      type: "sync:started",
      provider: providerName,
      timestamp: new Date().toISOString(),
    });

    try {
      const results = await this.coordinator.syncProvider(providerName);

      this.broadcast({
        type: "sync:completed",
        provider: providerName,
        results,
        timestamp: new Date().toISOString(),
      });

      this.updateProviderStatus(providerName, {
        lastSyncAt: new Date(),
        lastSyncResult: "success",
        lastError: null,
      });

      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.broadcast({
        type: "sync:error",
        provider: providerName,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      this.updateProviderStatus(providerName, {
        lastSyncAt: new Date(),
        lastSyncResult: "error",
        lastError: errorMsg,
      });

      throw error;
    }
  }

  /**
   * Sync a specific entity's external links
   */
  async syncEntity(entityId: string): Promise<SyncResult[]> {
    if (!this.coordinator) {
      return [];
    }

    return await this.coordinator.syncEntity(entityId);
  }

  // ==========================================================================
  // Link Management
  // ==========================================================================

  /**
   * Link a sudocode entity to an external entity
   */
  async linkEntity(
    entityId: string,
    externalId: string,
    provider: string,
    options?: { sync_direction?: "inbound" | "outbound" | "bidirectional" }
  ): Promise<void> {
    if (!this.coordinator) {
      throw new Error("IntegrationSyncService not started");
    }

    await this.coordinator.linkEntity(entityId, externalId, provider, options);
  }

  /**
   * Unlink a sudocode entity from an external entity
   */
  async unlinkEntity(entityId: string, externalId: string): Promise<void> {
    if (!this.coordinator) {
      throw new Error("IntegrationSyncService not started");
    }

    await this.coordinator.unlinkEntity(entityId, externalId);
  }

  /**
   * Handle deletion of a sudocode entity - propagate to external systems
   *
   * Call this BEFORE deleting a sudocode entity to propagate the deletion
   * to all linked external systems. You must pass the entity's external_links
   * since the entity may be deleted from storage before this is called.
   *
   * @param entityId - Sudocode entity ID being deleted
   * @param externalLinks - The external_links from the entity being deleted
   * @returns Array of sync results
   */
  async handleEntityDeleted(
    entityId: string,
    externalLinks: Array<{
      provider: string;
      external_id: string;
      sync_enabled?: boolean;
      sync_direction?: "inbound" | "outbound" | "bidirectional";
    }>
  ): Promise<SyncResult[]> {
    if (!this.coordinator) {
      return [];
    }

    if (!externalLinks || externalLinks.length === 0) {
      return [];
    }

    return await this.coordinator.handleEntityDeleted(entityId, externalLinks as any);
  }

  // ==========================================================================
  // Status and Info
  // ==========================================================================

  /**
   * Get sync status for all providers
   */
  getStatus(): ProviderSyncStatus[] {
    return Array.from(this.providerStatus.values());
  }

  /**
   * Get sync status for a specific provider
   */
  getProviderStatus(providerName: string): ProviderSyncStatus | null {
    return this.providerStatus.get(providerName) || null;
  }

  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get list of registered provider names
   */
  getRegisteredProviders(): string[] {
    return this.coordinator?.getProviderNames() || [];
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Load integration config from .sudocode/config.json
   */
  private loadConfig(): IntegrationsConfig {
    const configPath = path.join(this.options.sudocodeDir, "config.json");

    if (!existsSync(configPath)) {
      return {};
    }

    try {
      const content = readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      return (config.integrations || {}) as IntegrationsConfig;
    } catch (error) {
      console.error(`[integration-sync] Failed to load config:`, error);
      return {};
    }
  }

  /**
   * Get names of enabled providers
   */
  private getEnabledProviderNames(): string[] {
    return Object.entries(this.config)
      .filter(([_, config]) => config?.enabled)
      .map(([name]) => name);
  }

  /**
   * Load a plugin and register its provider
   */
  private async loadAndRegisterProvider(providerName: string): Promise<void> {
    const providerConfig = this.config[providerName];
    if (!providerConfig) return;

    // Determine plugin ID (could be custom or first-party)
    const pluginId = providerConfig.plugin || providerName;

    try {
      const plugin = await loadPlugin(pluginId);
      if (!plugin) {
        console.warn(
          `[integration-sync] Plugin '${pluginId}' not installed, skipping provider '${providerName}'`
        );
        return;
      }

      // Create provider from plugin
      // Cast to CLI's IntegrationProvider type since the plugin may return a compatible but differently typed object
      const provider = plugin.createProvider(
        providerConfig.options || {},
        this.options.projectPath
      ) as unknown as IntegrationProvider;

      // Register with coordinator
      this.coordinator!.registerProvider(provider);

      // Initialize status
      this.providerStatus.set(providerName, {
        name: providerName,
        enabled: true,
        autoSync: providerConfig.auto_sync ?? false,
        lastSyncAt: null,
        lastSyncResult: null,
        lastError: null,
        isPolling: false,
        isWatching: provider.supportsWatch && (providerConfig.auto_sync ?? false),
      });

      console.log(
        `[integration-sync] Registered provider '${providerName}' (plugin: ${plugin.displayName} v${plugin.version})`
      );
    } catch (error) {
      console.error(
        `[integration-sync] Failed to load provider '${providerName}':`,
        error
      );
    }
  }

  /**
   * Start polling timers for auto-sync providers
   */
  private startPolling(): void {
    for (const [providerName, providerConfig] of Object.entries(this.config)) {
      if (!providerConfig?.enabled || !providerConfig.auto_sync) continue;

      const provider = this.coordinator?.getProvider(providerName);
      if (!provider) continue;

      // Skip if provider uses watching instead of polling
      if (provider.supportsWatch) {
        console.log(
          `[integration-sync] Provider '${providerName}' uses real-time watching, skipping polling`
        );
        continue;
      }

      if (!provider.supportsPolling) {
        console.log(
          `[integration-sync] Provider '${providerName}' doesn't support polling, skipping`
        );
        continue;
      }

      // Start polling timer
      const interval = Math.max(
        this.options.pollIntervalMs,
        MIN_POLL_INTERVAL_MS
      );

      const timer = setInterval(async () => {
        try {
          console.log(`[integration-sync] Polling provider '${providerName}'`);
          await this.syncProvider(providerName);
        } catch (error) {
          console.error(
            `[integration-sync] Poll sync failed for '${providerName}':`,
            error
          );
        }
      }, interval);

      this.pollTimers.set(providerName, timer);

      const status = this.providerStatus.get(providerName);
      if (status) {
        status.isPolling = true;
      }

      console.log(
        `[integration-sync] Started polling for '${providerName}' every ${interval / 1000}s`
      );
    }
  }

  /**
   * Update provider status
   */
  private updateProviderStatus(
    providerName: string,
    updates: Partial<ProviderSyncStatus>
  ): void {
    const status = this.providerStatus.get(providerName);
    if (status) {
      Object.assign(status, updates);
    }
  }

  /**
   * Broadcast sync event via WebSocket
   */
  private broadcast(event: IntegrationSyncEvent): void {
    // Destructure to exclude original type, then add namespaced type
    const { type, ...eventData } = event;
    broadcastToProject(this.options.projectId, {
      type: `integration:${type}`,
      ...eventData,
    });
  }
}

/**
 * Create an IntegrationSyncService for a project
 *
 * This is a factory function used by ProjectManager
 */
export function createIntegrationSyncService(
  options: IntegrationSyncServiceOptions
): IntegrationSyncService {
  return new IntegrationSyncService(options);
}
