/**
 * Integration plugin types for sudocode
 *
 * This module defines the plugin interface for external integrations.
 * Provider-specific implementations should be in separate packages.
 */

import type {
  SyncDirection,
  ConflictResolution,
  Spec,
  Issue,
} from "./index.js";

// =============================================================================
// Plugin Configuration
// =============================================================================

/**
 * Base configuration for any integration provider
 * Provider-specific options go in the `options` field
 */
export interface IntegrationProviderConfig {
  /** npm package name or local path to the plugin */
  plugin?: string;
  /** Whether this integration is enabled */
  enabled: boolean;
  /** Whether to automatically sync changes (default: false) */
  auto_sync?: boolean;
  /** Default sync direction for new links (default: 'bidirectional') */
  default_sync_direction?: SyncDirection;
  /** How to resolve sync conflicts (default: 'manual') */
  conflict_resolution?: ConflictResolution;
  /**
   * Whether to auto-import new entities from external system (default: true)
   * When true, new issues/specs in the external system are automatically
   * created as sudocode issues/specs with an external_link.
   */
  auto_import?: boolean;
  /**
   * What to do when an external entity is deleted (default: 'close')
   * - 'close': Close the linked sudocode issue (set status to 'closed')
   * - 'delete': Delete the linked sudocode issue entirely
   * - 'ignore': Do nothing, leave sudocode issue unchanged
   */
  delete_behavior?: "close" | "delete" | "ignore";
  /** Provider-specific configuration options */
  options?: Record<string, unknown>;
}

/**
 * Top-level integrations configuration object
 * Maps provider names to their configurations
 */
export interface IntegrationsConfig {
  [providerName: string]: IntegrationProviderConfig | undefined;
}

// =============================================================================
// Plugin Interface
// =============================================================================

/**
 * Validation result from plugin
 */
export interface PluginValidationResult {
  /** Whether the configuration is valid (no blocking errors) */
  valid: boolean;
  /** Blocking errors that prevent the plugin from working */
  errors: string[];
  /** Non-blocking warnings about the configuration */
  warnings: string[];
}

/**
 * Result from testing a plugin's connection/setup
 */
export interface PluginTestResult {
  /** Whether the test passed */
  success: boolean;
  /** Whether the plugin is configured */
  configured: boolean;
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** Error message if test failed */
  error?: string;
  /** Additional details about the test */
  details?: Record<string, unknown>;
}

/**
 * JSON Schema for UI form generation (subset of JSON Schema)
 */
export interface PluginConfigSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "boolean" | "number" | "array";
      title?: string;
      description?: string;
      default?: unknown;
      enum?: unknown[];
      required?: boolean;
    }
  >;
  required?: string[];
}

/**
 * Interface that all integration plugins must implement
 *
 * Plugins are loaded dynamically and must export an object conforming to this interface.
 *
 * @example
 * ```typescript
 * // In @sudocode-ai/integration-beads/src/index.ts
 * import type { IntegrationPlugin } from '@sudocode-ai/types';
 *
 * const plugin: IntegrationPlugin = {
 *   name: 'beads',
 *   displayName: 'Beads',
 *   version: '1.0.0',
 *   // ... implement required methods
 * };
 *
 * export default plugin;
 * ```
 */
export interface IntegrationPlugin {
  /** Unique plugin identifier (used as key in config) */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Plugin version */
  version: string;
  /** Plugin description */
  description?: string;

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * JSON Schema describing the plugin's options
   * Used by UI to generate configuration forms
   */
  configSchema?: PluginConfigSchema;

  /**
   * Validate plugin configuration
   * Called before saving config and before starting sync
   *
   * @param options - The plugin-specific options from config
   * @returns Validation result with errors and warnings
   */
  validateConfig(options: Record<string, unknown>): PluginValidationResult;

  /**
   * Test the plugin's connection/setup
   * Called when user clicks "Test" button in UI
   *
   * @param options - The plugin-specific options from config
   * @param projectPath - Path to the sudocode project root
   * @returns Test result with success status and details
   */
  testConnection(
    options: Record<string, unknown>,
    projectPath: string
  ): Promise<PluginTestResult>;

  // ===========================================================================
  // Provider Factory
  // ===========================================================================

  /**
   * Create an IntegrationProvider instance for sync operations
   *
   * @param options - The plugin-specific options from config
   * @param projectPath - Path to the sudocode project root
   * @returns Provider instance ready for sync operations
   */
  createProvider(
    options: Record<string, unknown>,
    projectPath: string
  ): IntegrationProvider;
}

// =============================================================================
// Provider Interface (for sync operations)
// =============================================================================

/**
 * Represents an entity from an external system
 * Normalized structure for cross-provider compatibility
 */
/**
 * Represents a relationship from this entity to another
 */
export interface ExternalRelationship {
  /** Target entity ID in the external system */
  targetId: string;
  /** Target entity type */
  targetType: "spec" | "issue";
  /** Relationship type */
  relationshipType: "implements" | "blocks" | "depends-on" | "references" | "related" | "discovered-from";
}

export interface ExternalEntity {
  /** Unique identifier in the external system */
  id: string;
  /** Entity type (maps to sudocode spec or issue) */
  type: "spec" | "issue";
  /** Entity title */
  title: string;
  /** Entity description/content (optional) */
  description?: string;
  /** Status in external system (optional) */
  status?: string;
  /** Priority level (optional, 0-4 scale like sudocode) */
  priority?: number;
  /** URL to view in external system (optional) */
  url?: string;
  /** When created in external system (optional, ISO 8601) */
  created_at?: string;
  /** When last updated in external system (optional, ISO 8601) */
  updated_at?: string;
  /** Relationships from this entity to other entities (optional) */
  relationships?: ExternalRelationship[];
  /** Raw data from external system (for provider-specific handling) */
  raw?: unknown;
}

/**
 * Options for searching entities
 */
export interface SearchOptions {
  /** Repository to search in (e.g., "owner/repo") */
  repo?: string;
  /** Page number for pagination (1-indexed) */
  page?: number;
  /** Number of results per page */
  perPage?: number;
}

/**
 * Result of a search operation with pagination info
 */
export interface SearchResult {
  /** List of matching entities */
  results: ExternalEntity[];
  /** Pagination info */
  pagination?: {
    page: number;
    perPage: number;
    hasMore: boolean;
    totalCount?: number;
  };
}

/**
 * Represents a comment from an external system
 * Used for importing discussion threads alongside entities
 */
export interface ExternalComment {
  /** Unique identifier in the external system */
  id: string;
  /** Comment author (username or display name) */
  author: string;
  /** Comment body/content */
  body: string;
  /** When the comment was created (ISO 8601) */
  created_at: string;
  /** URL to view the comment in external system (optional) */
  url?: string;
}

/**
 * Interface for providers that support on-demand import
 * Implement this interface to enable URL-based import capabilities
 */
export interface OnDemandImportCapable {
  /**
   * Check if this provider can handle the given URL
   * @param url - URL to check
   * @returns true if this provider can import from this URL
   */
  canHandleUrl?(url: string): boolean;

  /**
   * Parse a URL to extract entity information
   * @param url - URL to parse
   * @returns Parsed entity info or null if URL cannot be parsed
   */
  parseUrl?(url: string): { externalId: string; metadata?: Record<string, unknown> } | null;

  /**
   * Fetch an entity by its URL
   * @param url - URL to fetch from
   * @returns The external entity or null if not found
   */
  fetchByUrl?(url: string): Promise<ExternalEntity | null>;

  /**
   * Refresh multiple entities by their external IDs
   * @param externalIds - Array of external IDs to refresh
   * @returns Array of entities (null for any that couldn't be fetched)
   */
  refreshEntities?(externalIds: string[]): Promise<(ExternalEntity | null)[]>;

  /**
   * Fetch comments for an entity
   * @param externalId - External ID of the entity
   * @returns Array of comments
   */
  fetchComments?(externalId: string): Promise<ExternalComment[]>;
}

/**
 * Represents a change detected in an external system
 * Used for incremental sync operations
 */
export interface ExternalChange {
  /** Entity ID that changed */
  entity_id: string;
  /** Type of entity that changed */
  entity_type: "spec" | "issue";
  /** Type of change */
  change_type: "created" | "updated" | "deleted";
  /** When the change occurred (ISO 8601) */
  timestamp: string;
  /** The entity data (present for created/updated, absent for deleted) */
  data?: ExternalEntity;
}

/**
 * Result of a sync operation for a single entity
 */
export interface SyncResult {
  /** Whether the sync operation succeeded */
  success: boolean;
  /** Sudocode entity ID */
  entity_id: string;
  /** External system entity ID */
  external_id: string;
  /** What action was taken */
  action: "created" | "updated" | "skipped" | "conflict";
  /** Error message if sync failed (optional) */
  error?: string;
}

/**
 * Represents a sync conflict between sudocode and external system
 */
export interface SyncConflict {
  /** Sudocode entity ID */
  sudocode_entity_id: string;
  /** External system entity ID */
  external_id: string;
  /** Integration provider name */
  provider: string;
  /** When sudocode entity was last updated (ISO 8601) */
  sudocode_updated_at: string;
  /** When external entity was last updated (ISO 8601) */
  external_updated_at: string;
}

/**
 * Interface for sync operations with an external system
 *
 * Created by IntegrationPlugin.createProvider()
 */
export interface IntegrationProvider {
  /** Provider name (matches plugin name) */
  readonly name: string;
  /** Whether this provider supports real-time watching for changes */
  readonly supportsWatch: boolean;
  /** Whether this provider supports polling for changes */
  readonly supportsPolling: boolean;
  /** Whether this provider supports on-demand import via URL */
  readonly supportsOnDemandImport: boolean;
  /** Whether this provider supports search operations */
  readonly supportsSearch: boolean;
  /** Whether this provider supports pushing changes to external system */
  readonly supportsPush: boolean;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Initialize the provider (called once before sync operations) */
  initialize(): Promise<void>;

  /** Clean up resources when the provider is no longer needed */
  dispose(): Promise<void>;

  // ===========================================================================
  // Entity Operations
  // ===========================================================================

  /** Fetch a single entity from the external system */
  fetchEntity(externalId: string): Promise<ExternalEntity | null>;

  /** Search for entities in the external system */
  searchEntities(
    query?: string,
    options?: SearchOptions
  ): Promise<ExternalEntity[] | SearchResult>;

  /** Create a new entity in the external system */
  createEntity(entity: Partial<Spec | Issue>): Promise<string>;

  /** Update an existing entity in the external system */
  updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void>;

  /** Delete an entity from the external system (optional) */
  deleteEntity?(externalId: string): Promise<void>;

  // ===========================================================================
  // Change Detection
  // ===========================================================================

  /** Get changes since a timestamp (for polling) */
  getChangesSince(timestamp: Date): Promise<ExternalChange[]>;

  /** Start watching for real-time changes (optional) */
  startWatching?(callback: (changes: ExternalChange[]) => void): void;

  /** Stop watching for real-time changes (optional) */
  stopWatching?(): void;

  // ===========================================================================
  // Field Mapping
  // ===========================================================================

  /** Map an external entity to sudocode format */
  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  };

  /** Map a sudocode entity to external format */
  mapFromSudocode(entity: Spec | Issue): Partial<ExternalEntity>;
}

// =============================================================================
// Legacy Exports (for backwards compatibility during migration)
// =============================================================================

/** @deprecated Use IntegrationProviderConfig instead */
export type IntegrationConfig = IntegrationProviderConfig;
