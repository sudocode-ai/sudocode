/**
 * SyncCoordinator - Orchestrates sync between sudocode and external integration providers
 *
 * Manages provider lifecycle, handles change detection, and resolves conflicts
 * during bidirectional synchronization.
 */

import type {
  IntegrationConfig,
  IntegrationsConfig,
  ExternalChange,
  ExternalLink,
  SyncResult,
  SyncConflict,
  SyncDirection,
  IntegrationProviderName,
  Spec,
  Issue,
  SpecJSONL,
  IssueJSONL,
} from "@sudocode-ai/types";
import type { IntegrationProvider } from "./types.js";
import { resolveByStrategy, logConflict } from "./utils/conflict-resolver.js";
import { readJSONLSync, writeJSONLSync } from "../jsonl.js";
import {
  findSpecsByExternalLink,
  findIssuesByExternalLink,
  getSpecFromJsonl,
  getIssueFromJsonl,
  updateSpecExternalLinkSync,
  updateIssueExternalLinkSync,
  createIssueFromExternal,
  deleteIssueFromJsonl,
  closeIssueInJsonl,
  removeExternalLinkFromIssue,
} from "../operations/external-links.js";
import * as path from "path";

/**
 * Options for creating a SyncCoordinator
 */
export interface SyncCoordinatorOptions {
  /** Project root path (where .sudocode is located) */
  projectPath: string;
  /** Integration configurations */
  config: IntegrationsConfig;
  /** Custom conflict resolution callback (for manual resolution) */
  onConflict?: (
    conflict: SyncConflict
  ) => Promise<"sudocode" | "external" | "skip">;
}

/**
 * Entity union type for specs and issues
 */
type Entity = Spec | Issue;
type EntityJSONL = SpecJSONL | IssueJSONL;

/**
 * SyncCoordinator manages integration providers and synchronization
 *
 * @example
 * ```typescript
 * const coordinator = new SyncCoordinator({
 *   projectPath: '/path/to/project',
 *   config: { jira: { enabled: true, ... } },
 * });
 *
 * coordinator.registerProvider(new JiraProvider());
 * await coordinator.start();
 *
 * // Sync all providers
 * const results = await coordinator.syncAll();
 *
 * // Link a sudocode entity to an external entity
 * await coordinator.linkEntity('i-abc', 'PROJ-123', 'jira');
 *
 * await coordinator.stop();
 * ```
 */
export class SyncCoordinator {
  private providers = new Map<string, IntegrationProvider>();
  private lastSyncTimes = new Map<string, Date>();

  constructor(private options: SyncCoordinatorOptions) {}

  // ==========================================================================
  // Provider Management
  // ==========================================================================

  /**
   * Register an integration provider
   * @param provider - The provider to register
   */
  registerProvider(provider: IntegrationProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a registered provider by name
   * @param name - Provider name
   * @returns The provider, or undefined if not found
   */
  getProvider(name: string): IntegrationProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the coordinator and initialize all enabled providers
   *
   * For each registered provider:
   * 1. Skip if not enabled in config
   * 2. Initialize with config
   * 3. Validate connection
   * 4. Start watching if auto_sync is enabled and provider supports it
   */
  async start(): Promise<void> {
    for (const [name, provider] of this.providers) {
      const config = this.getProviderConfig(name);

      if (!config?.enabled) continue;

      try {
        await provider.initialize(config);

        const validation = await provider.validate();
        if (!validation.valid) {
          console.warn(
            `[sync-coordinator] Provider ${name} validation failed:`,
            validation.errors
          );
          continue;
        }

        // Start watching if auto_sync is enabled and provider supports it
        if (
          config.auto_sync &&
          provider.supportsWatch &&
          provider.startWatching
        ) {
          provider.startWatching((changes) => {
            this.handleInboundChanges(name, changes);
          });
        }

        this.lastSyncTimes.set(name, new Date());
      } catch (error) {
        console.error(`[sync-coordinator] Failed to initialize provider ${name}:`, error);
      }
    }
  }

  /**
   * Stop the coordinator and dispose all providers
   */
  async stop(): Promise<void> {
    for (const [_name, provider] of this.providers) {
      try {
        provider.stopWatching?.();
        await provider.dispose();
      } catch (error) {
        console.error(`Error disposing provider ${_name}:`, error);
      }
    }
  }

  // ==========================================================================
  // Sync Operations
  // ==========================================================================

  /**
   * Sync all registered and enabled providers
   * @returns Array of sync results from all providers
   */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const name of this.providers.keys()) {
      const config = this.getProviderConfig(name);
      if (!config?.enabled) continue;

      try {
        const providerResults = await this.syncProvider(name);
        results.push(...providerResults);
      } catch (error) {
        results.push({
          success: false,
          entity_id: "",
          external_id: "",
          action: "skipped",
          error: `Provider ${name} sync failed: ${String(error)}`,
        });
      }
    }

    return results;
  }

  /**
   * Sync a specific provider
   * @param providerName - Name of the provider to sync
   * @returns Array of sync results
   */
  async syncProvider(providerName: string): Promise<SyncResult[]> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const lastSync = this.lastSyncTimes.get(providerName) || new Date(0);
    const changes = await provider.getChangesSince(lastSync);

    const results = await this.handleInboundChanges(providerName, changes);
    this.lastSyncTimes.set(providerName, new Date());

    return results;
  }

  /**
   * Sync a specific entity's external links
   * @param entityId - Sudocode entity ID (s-xxxx or i-xxxx)
   * @returns Array of sync results for each link
   */
  async syncEntity(entityId: string): Promise<SyncResult[]> {
    const entity = this.loadEntity(entityId);

    if (!entity?.external_links?.length) {
      return [
        {
          success: true,
          entity_id: entityId,
          external_id: "",
          action: "skipped",
        },
      ];
    }

    const results: SyncResult[] = [];
    for (const link of entity.external_links) {
      if (!link.sync_enabled) continue;

      try {
        const result = await this.syncSingleLink(entity, link);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          entity_id: entityId,
          external_id: link.external_id,
          action: "skipped",
          error: String(error),
        });
      }
    }

    return results;
  }

  // ==========================================================================
  // Link Management
  // ==========================================================================

  /**
   * Link a sudocode entity to an external entity
   *
   * @param entityId - Sudocode entity ID
   * @param externalId - External system entity ID
   * @param provider - Provider name
   * @param options - Link options (sync direction, enabled)
   */
  async linkEntity(
    entityId: string,
    externalId: string,
    provider: string,
    options?: { sync_direction?: SyncDirection; sync_enabled?: boolean }
  ): Promise<void> {
    const entity = this.loadEntity(entityId);
    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const link: ExternalLink = {
      provider: provider as IntegrationProviderName,
      external_id: externalId,
      sync_enabled: options?.sync_enabled ?? true,
      sync_direction: options?.sync_direction ?? "bidirectional",
      last_synced_at: new Date().toISOString(),
    };

    const links = entity.external_links || [];

    // Check if link already exists
    const existingIndex = links.findIndex(
      (l) => l.provider === provider && l.external_id === externalId
    );

    if (existingIndex >= 0) {
      // Update existing link
      links[existingIndex] = { ...links[existingIndex], ...link };
    } else {
      // Add new link
      links.push(link);
    }

    this.updateEntityLinks(entityId, links);
  }

  /**
   * Remove a link between a sudocode entity and an external entity
   *
   * @param entityId - Sudocode entity ID
   * @param externalId - External system entity ID
   */
  async unlinkEntity(entityId: string, externalId: string): Promise<void> {
    const entity = this.loadEntity(entityId);
    if (!entity?.external_links) return;

    const links = entity.external_links.filter(
      (l) => l.external_id !== externalId
    );
    this.updateEntityLinks(entityId, links);
  }

  /**
   * Handle deletion of a sudocode entity - propagate to external systems
   *
   * Call this when a sudocode entity is deleted to propagate the deletion
   * to all linked external systems.
   *
   * @param entityId - Sudocode entity ID that was deleted
   * @param externalLinks - The external_links from the deleted entity
   * @returns Array of sync results
   */
  async handleEntityDeleted(
    entityId: string,
    externalLinks: ExternalLink[]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    if (!externalLinks || externalLinks.length === 0) {
      return results;
    }

    for (const link of externalLinks) {
      // Skip if sync is disabled or inbound-only
      if (!link.sync_enabled) continue;
      if (link.sync_direction === "inbound") continue;

      const provider = this.providers.get(link.provider);
      if (!provider) continue;

      const config = this.getProviderConfig(link.provider);
      const deleteBehavior = config?.delete_behavior || "close";

      try {
        if (deleteBehavior === "delete" && provider.deleteEntity) {
          await provider.deleteEntity(link.external_id);
          results.push({
            success: true,
            entity_id: entityId,
            external_id: link.external_id,
            action: "updated",
          });
        } else if (deleteBehavior === "close" && provider.updateEntity) {
          await provider.updateEntity(link.external_id, { status: "closed" } as Partial<Issue>);
          results.push({
            success: true,
            entity_id: entityId,
            external_id: link.external_id,
            action: "updated",
          });
        } else {
          results.push({
            success: true,
            entity_id: entityId,
            external_id: link.external_id,
            action: "skipped",
          });
        }
      } catch (error) {
        results.push({
          success: false,
          entity_id: entityId,
          external_id: link.external_id,
          action: "skipped",
          error: String(error),
        });
      }
    }

    return results;
  }

  // ==========================================================================
  // Internal Methods - Change Handling
  // ==========================================================================

  /**
   * Handle inbound changes from an external provider
   */
  private async handleInboundChanges(
    providerName: string,
    changes: ExternalChange[]
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    const provider = this.providers.get(providerName);
    if (!provider) return results;

    for (const change of changes) {
      try {
        const result = await this.processInboundChange(
          providerName,
          provider,
          change
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          entity_id: "",
          external_id: change.entity_id,
          action: "skipped",
          error: String(error),
        });
      }
    }

    return results;
  }

  /**
   * Process a single inbound change
   */
  private async processInboundChange(
    providerName: string,
    provider: IntegrationProvider,
    change: ExternalChange
  ): Promise<SyncResult> {
    const config = this.getProviderConfig(providerName);
    const sudocodeDir = path.join(this.options.projectPath, ".sudocode");

    // Find linked sudocode entity
    const linkedEntity = this.findLinkedEntity(providerName, change.entity_id);

    // Handle NEW entities (auto-import)
    if (!linkedEntity && change.change_type === "created") {
      // Auto-import if enabled (defaults to true)
      const autoImport = config?.auto_import !== false;

      if (autoImport && change.data) {
        // Map external entity to sudocode format
        const mapped = provider.mapToSudocode(change.data);
        const issueData = mapped.issue;

        if (issueData && change.entity_type === "issue") {
          // Create sudocode issue with auto-link
          const newIssue = createIssueFromExternal(sudocodeDir, {
            title: issueData.title || change.data.title,
            content: issueData.content || change.data.description,
            status: issueData.status || "open",
            priority: issueData.priority ?? change.data.priority ?? 2,
            external: {
              provider: providerName as IntegrationProviderName,
              external_id: change.entity_id,
              sync_direction: config?.default_sync_direction || "bidirectional",
            },
          });

          return {
            success: true,
            entity_id: newIssue.id,
            external_id: change.entity_id,
            action: "created",
          };
        }
      }

      return {
        success: true,
        entity_id: "",
        external_id: change.entity_id,
        action: "skipped",
      };
    }

    // Handle UPDATED entities without link (skip)
    if (!linkedEntity && change.change_type === "updated") {
      return {
        success: true,
        entity_id: "",
        external_id: change.entity_id,
        action: "skipped",
      };
    }

    // Handle DELETED entities
    if (change.change_type === "deleted") {
      if (!linkedEntity) {
        return {
          success: true,
          entity_id: "",
          external_id: change.entity_id,
          action: "skipped",
        };
      }

      // Get delete behavior from config (defaults to 'close')
      const deleteBehavior = config?.delete_behavior || "close";

      if (deleteBehavior === "ignore") {
        // Disable sync on the stale link to avoid future sync errors
        updateIssueExternalLinkSync(sudocodeDir, linkedEntity.id, change.entity_id, {
          sync_enabled: false,
        });
        return {
          success: true,
          entity_id: linkedEntity.id,
          external_id: change.entity_id,
          action: "skipped",
        };
      }

      if (deleteBehavior === "delete") {
        deleteIssueFromJsonl(sudocodeDir, linkedEntity.id);
        return {
          success: true,
          entity_id: linkedEntity.id,
          external_id: change.entity_id,
          action: "updated", // Using 'updated' as there's no 'deleted' action type
        };
      }

      // Default: close the issue AND remove the stale external link
      closeIssueInJsonl(sudocodeDir, linkedEntity.id);
      // Clean up the external link to avoid orphaned reference
      removeExternalLinkFromIssue(sudocodeDir, linkedEntity.id, change.entity_id);
      return {
        success: true,
        entity_id: linkedEntity.id,
        external_id: change.entity_id,
        action: "updated",
      };
    }

    // Check for conflicts
    const link = linkedEntity?.external_links?.find(
      (l) => l.external_id === change.entity_id
    );

    if (link && change.data?.updated_at && linkedEntity) {
      const conflict = this.detectConflict(linkedEntity, change, link);
      if (conflict) {
        const resolution = await this.resolveConflict(conflict);

        if (resolution === "skip") {
          return {
            success: true,
            entity_id: linkedEntity.id,
            external_id: change.entity_id,
            action: "skipped",
          };
        }

        if (resolution === "sudocode") {
          // Push sudocode version to external
          await provider.updateEntity(change.entity_id, linkedEntity);
          this.updateLinkSyncTime(linkedEntity.id, link.external_id);
          return {
            success: true,
            entity_id: linkedEntity.id,
            external_id: change.entity_id,
            action: "updated",
          };
        }
      }
    }

    // Apply inbound change (external wins or no conflict)
    if (change.data && linkedEntity) {
      const mapped = provider.mapToSudocode(change.data);
      const updates = mapped.spec || mapped.issue;

      if (updates) {
        this.applyUpdatesToEntity(linkedEntity.id, updates);
        if (link) {
          this.updateLinkSyncTime(linkedEntity.id, link.external_id);
        }
        return {
          success: true,
          entity_id: linkedEntity.id,
          external_id: change.entity_id,
          action: "updated",
        };
      }
    }

    return {
      success: true,
      entity_id: linkedEntity?.id || "",
      external_id: change.entity_id,
      action: "skipped",
    };
  }

  /**
   * Sync a single external link
   */
  private async syncSingleLink(
    entity: Entity,
    link: ExternalLink
  ): Promise<SyncResult> {
    console.log(`[sync-coordinator] syncSingleLink: entity=${entity.id}, external=${link.external_id}, direction=${link.sync_direction}`);

    const provider = this.providers.get(link.provider);
    if (!provider) {
      console.log(`[sync-coordinator] Provider not registered: ${link.provider}`);
      return {
        success: false,
        entity_id: entity.id,
        external_id: link.external_id,
        action: "skipped",
        error: `Provider not registered: ${link.provider}`,
      };
    }

    try {
      // Fetch current external state
      console.log(`[sync-coordinator] Fetching external entity ${link.external_id}`);
      const externalEntity = await provider.fetchEntity(link.external_id);
      if (!externalEntity) {
        console.log(`[sync-coordinator] External entity not found: ${link.external_id}`);
        return {
          success: false,
          entity_id: entity.id,
          external_id: link.external_id,
          action: "skipped",
          error: "External entity not found",
        };
      }
      console.log(`[sync-coordinator] External entity found, status=${externalEntity.status}`);

      // Check for conflicts
      const change: ExternalChange = {
        entity_id: link.external_id,
        entity_type: externalEntity.type,
        change_type: "updated",
        timestamp: externalEntity.updated_at || new Date().toISOString(),
        data: externalEntity,
      };

      const conflict = this.detectConflict(entity, change, link);
      console.log(`[sync-coordinator] Conflict detected: ${conflict !== null}`);

      if (conflict) {
        const resolution = await this.resolveConflict(conflict);
        console.log(`[sync-coordinator] Conflict resolution: ${resolution}`);

        if (resolution === "skip") {
          return {
            success: true,
            entity_id: entity.id,
            external_id: link.external_id,
            action: "skipped",
          };
        }

        if (resolution === "sudocode") {
          // Push sudocode to external
          console.log(`[sync-coordinator] Pushing sudocode to external (conflict resolution), entity:`, JSON.stringify(entity));
          await provider.updateEntity(link.external_id, entity);
          this.updateLinkSyncTime(entity.id, link.external_id);
          return {
            success: true,
            entity_id: entity.id,
            external_id: link.external_id,
            action: "updated",
          };
        }

        // External wins - apply to sudocode
        const mapped = provider.mapToSudocode(externalEntity);
        const updates = mapped.spec || mapped.issue;
        if (updates) {
          this.applyUpdatesToEntity(entity.id, updates);
        }
        this.updateLinkSyncTime(entity.id, link.external_id);
        return {
          success: true,
          entity_id: entity.id,
          external_id: link.external_id,
          action: "updated",
        };
      }

      // No conflict - sync based on direction
      console.log(`[sync-coordinator] No conflict, checking direction: ${link.sync_direction}`);
      if (
        link.sync_direction === "outbound" ||
        link.sync_direction === "bidirectional"
      ) {
        console.log(`[sync-coordinator] Calling provider.updateEntity with:`, JSON.stringify(entity));
        await provider.updateEntity(link.external_id, entity);
        console.log(`[sync-coordinator] provider.updateEntity completed`);
      } else {
        console.log(`[sync-coordinator] Skipping updateEntity - direction is ${link.sync_direction}`);
      }

      this.updateLinkSyncTime(entity.id, link.external_id);
      return {
        success: true,
        entity_id: entity.id,
        external_id: link.external_id,
        action: "updated",
      };
    } catch (error) {
      console.error(`[sync-coordinator] syncSingleLink error:`, error);
      return {
        success: false,
        entity_id: entity.id,
        external_id: link.external_id,
        action: "skipped",
        error: String(error),
      };
    }
  }

  // ==========================================================================
  // Internal Methods - Conflict Detection and Resolution
  // ==========================================================================

  /**
   * Detect if there's a conflict between sudocode and external versions
   */
  private detectConflict(
    entity: Entity,
    change: ExternalChange,
    link: ExternalLink
  ): SyncConflict | null {
    const sudocodeUpdated = new Date(entity.updated_at);
    const externalUpdated = new Date(change.data?.updated_at || 0);
    const lastSynced = link.last_synced_at
      ? new Date(link.last_synced_at)
      : new Date(0);

    // Conflict if both updated since last sync
    if (sudocodeUpdated > lastSynced && externalUpdated > lastSynced) {
      return {
        sudocode_entity_id: entity.id,
        external_id: change.entity_id,
        provider: link.provider,
        sudocode_updated_at: entity.updated_at,
        external_updated_at: change.data?.updated_at || "",
      };
    }

    return null;
  }

  /**
   * Resolve a sync conflict based on configured strategy
   */
  private async resolveConflict(
    conflict: SyncConflict
  ): Promise<"sudocode" | "external" | "skip"> {
    const config = this.getProviderConfig(conflict.provider);
    const strategy = config?.conflict_resolution || "newest-wins";

    if (strategy === "manual" && this.options.onConflict) {
      const resolution = await this.options.onConflict(conflict);
      logConflict({
        timestamp: new Date().toISOString(),
        conflict,
        resolution,
        strategy,
      });
      return resolution;
    }

    const resolution = resolveByStrategy(conflict, strategy);
    logConflict({
      timestamp: new Date().toISOString(),
      conflict,
      resolution,
      strategy,
    });
    return resolution;
  }

  // ==========================================================================
  // Internal Methods - Entity Operations
  // ==========================================================================

  /**
   * Get provider config from options
   */
  private getProviderConfig(name: string): IntegrationConfig | undefined {
    return this.options.config[name as keyof IntegrationsConfig] as
      | IntegrationConfig
      | undefined;
  }

  /**
   * Determine if an ID is for a spec or issue
   */
  private getEntityType(id: string): "spec" | "issue" {
    return id.startsWith("s-") ? "spec" : "issue";
  }

  /**
   * Get the JSONL file path for an entity type
   */
  private getEntityFilePath(type: "spec" | "issue"): string {
    const sudocodePath = path.join(this.options.projectPath, ".sudocode");
    return type === "spec"
      ? path.join(sudocodePath, "specs.jsonl")
      : path.join(sudocodePath, "issues.jsonl");
  }

  /**
   * Load an entity from JSONL storage
   */
  /**
   * Load an entity from JSONL storage
   */
  private loadEntity(id: string): Entity | null {
    const sudocodeDir = path.join(this.options.projectPath, ".sudocode");
    let jsonlEntity: EntityJSONL | null = null;

    if (id.startsWith("s-")) {
      jsonlEntity = getSpecFromJsonl(sudocodeDir, id);
    } else {
      jsonlEntity = getIssueFromJsonl(sudocodeDir, id);
    }

    if (!jsonlEntity) return null;
    return this.toEntity(jsonlEntity);
  }

  /**
   * Convert JSONL entity to domain Entity
   */
  private toEntity(jsonl: EntityJSONL): Entity {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { relationships, tags, feedback, ...entityData } = jsonl as any;
    return entityData as Entity;
  }

  /**
   * Find a sudocode entity linked to an external entity
   */
  private findLinkedEntity(
    provider: string,
    externalId: string
  ): Entity | null {
    const sudocodeDir = path.join(this.options.projectPath, ".sudocode");
    const providerName = provider as IntegrationProviderName;

    console.log(`[sync-coordinator] findLinkedEntity: looking for provider=${providerName}, external_id=${externalId}`);

    // Search specs
    const specs = findSpecsByExternalLink(
      sudocodeDir,
      providerName,
      externalId
    );
    if (specs.length > 0) {
      console.log(`[sync-coordinator] findLinkedEntity: found spec ${specs[0].id}`);
      return this.toEntity(specs[0]);
    }

    // Search issues
    const issues = findIssuesByExternalLink(
      sudocodeDir,
      providerName,
      externalId
    );
    if (issues.length > 0) {
      console.log(`[sync-coordinator] findLinkedEntity: found issue ${issues[0].id}`);
      return this.toEntity(issues[0]);
    }

    console.log(`[sync-coordinator] findLinkedEntity: no linked entity found`);
    return null;
  }

  /**
   * Update external_links on an entity
   */
  private updateEntityLinks(id: string, links: ExternalLink[]): void {
    const type = this.getEntityType(id);
    const filePath = this.getEntityFilePath(type);

    const entities = readJSONLSync<EntityJSONL>(filePath);
    const index = entities.findIndex((e) => e.id === id);

    if (index >= 0) {
      (entities[index] as any).external_links = links;
      (entities[index] as any).updated_at = new Date().toISOString();
      writeJSONLSync(filePath, entities);
    }
  }

  /**
   * Update the last_synced_at timestamp on a link
   */
  /**
   * Update the last_synced_at timestamp on a link
   */
  private updateLinkSyncTime(entityId: string, externalId: string): void {
    const sudocodeDir = path.join(this.options.projectPath, ".sudocode");
    const updates = { last_synced_at: new Date().toISOString() };

    try {
      if (entityId.startsWith("s-")) {
        updateSpecExternalLinkSync(sudocodeDir, entityId, externalId, updates);
      } else {
        updateIssueExternalLinkSync(sudocodeDir, entityId, externalId, updates);
      }
    } catch (error) {
      // Ignore if entity/link not found (race condition)
    }
  }

  /**
   * Apply partial updates to an entity
   */
  private applyUpdatesToEntity(
    id: string,
    updates: Partial<Spec | Issue>
  ): void {
    const type = this.getEntityType(id);
    const filePath = this.getEntityFilePath(type);

    const entities = readJSONLSync<EntityJSONL>(filePath);
    const index = entities.findIndex((e) => e.id === id);

    if (index >= 0) {
      const current = entities[index];
      // Apply updates while preserving relationships, tags, etc.
      const { id: _id, uuid: _uuid, ...safeUpdates } = updates as any;
      entities[index] = {
        ...current,
        ...safeUpdates,
        updated_at: new Date().toISOString(),
      };
      writeJSONLSync(filePath, entities);
    }
  }
}
