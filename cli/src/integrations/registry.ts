/**
 * Integration provider registry
 * Central place to register and look up integration providers
 */

import type { IntegrationProvider, ProviderRegistry } from "./types.js";

/**
 * Default implementation of the provider registry
 *
 * Stores providers in a Map keyed by provider name.
 * Throws on duplicate registration to prevent accidental overwrites.
 *
 * @example
 * ```typescript
 * const registry = new DefaultProviderRegistry();
 *
 * // Register providers
 * registry.register(new JiraProvider());
 * registry.register(new BeadsProvider());
 *
 * // Look up a provider
 * const jira = registry.get('jira');
 * if (jira) {
 *   await jira.initialize(config);
 * }
 *
 * // Check if provider exists
 * if (registry.has('beads')) {
 *   console.log('Beads integration available');
 * }
 *
 * // Get all providers
 * for (const provider of registry.getAll()) {
 *   console.log(`Provider: ${provider.name}`);
 * }
 * ```
 */
export class DefaultProviderRegistry implements ProviderRegistry {
  private providers = new Map<string, IntegrationProvider>();

  /**
   * Register a provider in the registry
   *
   * @param provider - The provider to register
   * @throws Error if a provider with the same name is already registered
   */
  register(provider: IntegrationProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider '${provider.name}' already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a provider by name
   *
   * @param name - The provider name (e.g., "jira", "beads")
   * @returns The provider, or undefined if not found
   */
  get(name: string): IntegrationProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   *
   * @returns Array of all registered providers
   */
  getAll(): IntegrationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Check if a provider is registered
   *
   * @param name - The provider name
   * @returns True if a provider with this name is registered
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }
}
