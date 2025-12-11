/**
 * Integration provider types for sudocode
 * Defines interfaces for integration providers and the provider registry
 */

import type {
  Spec,
  Issue,
  ExternalEntity,
  ExternalChange,
  IntegrationConfig,
} from "@sudocode-ai/types";

/**
 * Interface that all integration providers must implement
 *
 * Providers handle communication with external systems (Jira, Beads, etc.)
 * and provide bidirectional sync capabilities.
 */
export interface IntegrationProvider {
  /** Unique name of this provider (e.g., "jira", "beads") */
  readonly name: string;
  /** Whether this provider supports real-time watching for changes */
  readonly supportsWatch: boolean;
  /** Whether this provider supports polling for changes */
  readonly supportsPolling: boolean;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Initialize the provider with configuration
   * Called once before any other methods are used
   */
  initialize(config: IntegrationConfig): Promise<void>;

  /**
   * Validate that the provider is properly configured and can connect
   * @returns Validation result with validity flag and any errors
   */
  validate(): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Clean up resources when the provider is no longer needed
   */
  dispose(): Promise<void>;

  // =========================================================================
  // Entity Operations (Outbound Sync)
  // =========================================================================

  /**
   * Fetch a single entity from the external system
   * @param externalId - The ID in the external system
   * @returns The external entity, or null if not found
   */
  fetchEntity(externalId: string): Promise<ExternalEntity | null>;

  /**
   * Search for entities in the external system
   * @param query - Optional search query
   * @returns Array of matching external entities
   */
  searchEntities(query?: string): Promise<ExternalEntity[]>;

  /**
   * Create a new entity in the external system
   * @param entity - The sudocode entity to create externally
   * @returns The ID of the newly created external entity
   */
  createEntity(entity: Partial<Spec | Issue>): Promise<string>;

  /**
   * Update an existing entity in the external system
   * @param externalId - The ID in the external system
   * @param entity - The updated sudocode entity data
   */
  updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void>;

  /**
   * Delete an entity from the external system (optional)
   * @param externalId - The ID in the external system
   */
  deleteEntity?(externalId: string): Promise<void>;

  // =========================================================================
  // Change Detection (Inbound Sync)
  // =========================================================================

  /**
   * Get changes that have occurred since a given timestamp
   * Used for polling-based sync
   * @param timestamp - Get changes after this time
   * @returns Array of changes detected
   */
  getChangesSince(timestamp: Date): Promise<ExternalChange[]>;

  // =========================================================================
  // Real-time Watching (Optional)
  // =========================================================================

  /**
   * Start watching for real-time changes (optional)
   * @param callback - Function to call when changes are detected
   */
  startWatching?(callback: (changes: ExternalChange[]) => void): void;

  /**
   * Stop watching for real-time changes (optional)
   */
  stopWatching?(): void;

  // =========================================================================
  // Field Mapping
  // =========================================================================

  /**
   * Map an external entity to sudocode format
   * @param external - The external entity
   * @returns Partial spec and/or issue data
   */
  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  };

  /**
   * Map a sudocode entity to external format
   * @param entity - The sudocode spec or issue
   * @returns Partial external entity data
   */
  mapFromSudocode(entity: Spec | Issue): Partial<ExternalEntity>;

  // =========================================================================
  // ID Helpers
  // =========================================================================

  /**
   * Parse an external ID into provider and ID components
   * @param id - The external ID (may include provider prefix)
   * @returns Object with provider name and ID
   */
  parseExternalId(id: string): { provider: string; id: string };

  /**
   * Format an ID with the provider prefix
   * @param id - The raw external ID
   * @returns Formatted ID with provider prefix (e.g., "jira:PROJ-123")
   */
  formatExternalId(id: string): string;
}

/**
 * Registry for managing integration providers
 *
 * Provides a central place to register and look up providers by name.
 */
export interface ProviderRegistry {
  /**
   * Register a provider in the registry
   * @param provider - The provider to register
   * @throws Error if a provider with the same name is already registered
   */
  register(provider: IntegrationProvider): void;

  /**
   * Get a provider by name
   * @param name - The provider name
   * @returns The provider, or undefined if not found
   */
  get(name: string): IntegrationProvider | undefined;

  /**
   * Get all registered providers
   * @returns Array of all providers
   */
  getAll(): IntegrationProvider[];

  /**
   * Check if a provider is registered
   * @param name - The provider name
   * @returns True if registered
   */
  has(name: string): boolean;
}
