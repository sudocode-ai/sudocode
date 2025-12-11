/**
 * Base integration provider abstract class
 * Provides common functionality for all integration providers
 */

import type {
  IntegrationConfig,
  ExternalEntity,
  ExternalChange,
  Spec,
  Issue,
} from "@sudocode-ai/types";
import type { IntegrationProvider } from "./types.js";

/**
 * Abstract base class for integration providers
 *
 * Provides default implementations for common functionality like ID parsing/formatting
 * and lifecycle management. Subclasses must implement the abstract methods.
 *
 * @example
 * ```typescript
 * class JiraProvider extends BaseIntegrationProvider {
 *   readonly name = 'jira';
 *   readonly supportsWatch = true;
 *   readonly supportsPolling = true;
 *
 *   protected async doInitialize(): Promise<void> {
 *     // Set up Jira API client
 *   }
 *
 *   async validate(): Promise<{ valid: boolean; errors: string[] }> {
 *     // Validate Jira connection
 *   }
 *
 *   // ... implement other abstract methods
 * }
 * ```
 */
export abstract class BaseIntegrationProvider implements IntegrationProvider {
  /** Unique provider name - must be implemented by subclass */
  abstract readonly name: string;
  /** Whether provider supports real-time watching */
  abstract readonly supportsWatch: boolean;
  /** Whether provider supports polling for changes */
  abstract readonly supportsPolling: boolean;

  /** The configuration for this provider */
  protected config!: IntegrationConfig;
  /** Whether the provider has been initialized */
  protected initialized = false;

  /**
   * Initialize the provider with configuration
   * Calls the subclass-specific doInitialize method
   */
  async initialize(config: IntegrationConfig): Promise<void> {
    this.config = config;
    await this.doInitialize();
    this.initialized = true;
  }

  /**
   * Subclass-specific initialization logic
   * Called by initialize() after storing the config
   */
  protected abstract doInitialize(): Promise<void>;

  /**
   * Clean up resources when provider is no longer needed
   * Stops watching if applicable and resets initialized flag
   */
  async dispose(): Promise<void> {
    if (this.supportsWatch) {
      this.stopWatching?.();
    }
    this.initialized = false;
  }

  /**
   * Parse an external ID into provider and ID components
   *
   * Handles both prefixed ("jira:PROJ-123") and bare ("PROJ-123") formats.
   * For bare IDs, uses this provider's name as the provider.
   *
   * @param id - The external ID to parse
   * @returns Object with provider name and ID
   */
  parseExternalId(id: string): { provider: string; id: string } {
    if (id.includes(":")) {
      const [provider, ...rest] = id.split(":");
      return { provider, id: rest.join(":") };
    }
    return { provider: this.name, id };
  }

  /**
   * Format an ID with this provider's prefix
   *
   * @param id - The raw external ID
   * @returns Formatted ID (e.g., "jira:PROJ-123")
   */
  formatExternalId(id: string): string {
    return `${this.name}:${id}`;
  }

  // =========================================================================
  // Abstract methods that subclasses must implement
  // =========================================================================

  abstract validate(): Promise<{ valid: boolean; errors: string[] }>;
  abstract fetchEntity(externalId: string): Promise<ExternalEntity | null>;
  abstract searchEntities(query?: string): Promise<ExternalEntity[]>;
  abstract createEntity(entity: Partial<Spec | Issue>): Promise<string>;
  abstract updateEntity(
    externalId: string,
    entity: Partial<Spec | Issue>
  ): Promise<void>;
  abstract getChangesSince(timestamp: Date): Promise<ExternalChange[]>;
  abstract mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  };
  abstract mapFromSudocode(entity: Spec | Issue): Partial<ExternalEntity>;

  // =========================================================================
  // Optional methods - can be overridden by subclasses
  // =========================================================================

  /**
   * Start watching for real-time changes (optional)
   * Override in subclasses that support watching
   */
  startWatching?(callback: (changes: ExternalChange[]) => void): void;

  /**
   * Stop watching for real-time changes (optional)
   * Override in subclasses that support watching
   */
  stopWatching?(): void;

  /**
   * Delete an entity from the external system (optional)
   * Override in subclasses that support deletion
   */
  deleteEntity?(externalId: string): Promise<void>;
}
