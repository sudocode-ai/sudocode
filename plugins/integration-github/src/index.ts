/**
 * GitHub Integration Plugin for sudocode
 *
 * Provides on-demand import of GitHub issues and discussions into sudocode specs.
 * Uses the `gh` CLI for authentication and API calls - no token management required.
 */

import type {
  IntegrationPlugin,
  IntegrationProvider,
  OnDemandImportCapable,
  PluginValidationResult,
  PluginTestResult,
  PluginConfigSchema,
  ExternalEntity,
  ExternalComment,
  ExternalChange,
  Spec,
  Issue,
} from "@sudocode-ai/types";

// Internal utilities
import {
  canHandleUrl as canHandle,
  parseUrl as parse,
  parseGitHubUrl,
  parseExternalId,
  GITHUB_URL_PATTERNS,
  type GitHubEntityType,
} from "./url-parser.js";

import {
  ghApi,
  ghAuthStatus,
  isGhInstalled,
  GhAuthError,
  GhNotFoundError,
  GhNotInstalledError,
  type GitHubIssue,
  type GitHubComment,
} from "./gh-client.js";

import {
  mapGitHubIssueToExternal,
  mapGitHubCommentToExternal,
  mapToSudocodeSpec,
  type ImportedSpecData,
} from "./mappers.js";

/**
 * GitHub-specific configuration options
 * Currently empty since we use gh CLI for auth
 */
export interface GitHubOptions {
  // No options needed - uses gh CLI authentication
}

/**
 * GitHub integration plugin
 */
const githubPlugin: IntegrationPlugin = {
  name: "github",
  displayName: "GitHub",
  version: "0.1.0",
  description: "Import GitHub issues and discussions into sudocode specs using gh CLI",

  configSchema: {
    type: "object",
    properties: {},
    // No required properties - auth handled by gh CLI
  } as PluginConfigSchema,

  validateConfig(_options: Record<string, unknown>): PluginValidationResult {
    // No configuration to validate - auth is via gh CLI
    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  },

  async testConnection(
    _options: Record<string, unknown>,
    _projectPath: string
  ): Promise<PluginTestResult> {
    // Check if gh CLI is installed
    const installed = await isGhInstalled();
    if (!installed) {
      return {
        success: false,
        configured: false,
        enabled: true,
        error: "GitHub CLI (gh) is not installed. Install from: https://cli.github.com/",
      };
    }

    // Check if authenticated
    const authenticated = await ghAuthStatus();
    if (!authenticated) {
      return {
        success: false,
        configured: false,
        enabled: true,
        error: "GitHub CLI not authenticated. Run: gh auth login",
      };
    }

    return {
      success: true,
      configured: true,
      enabled: true,
      details: {
        authMethod: "gh-cli",
      },
    };
  },

  createProvider(
    options: Record<string, unknown>,
    _projectPath: string
  ): IntegrationProvider {
    return new GitHubProvider(options as unknown as GitHubOptions);
  },
};

/**
 * GitHub provider implementation
 *
 * Implements IntegrationProvider + OnDemandImportCapable for importing
 * GitHub issues and discussions into sudocode specs.
 */
class GitHubProvider implements IntegrationProvider, OnDemandImportCapable {
  readonly name = "github";

  // Capability flags
  readonly supportsWatch = false; // No real-time watching (would need webhooks)
  readonly supportsPolling = false; // No polling (on-demand only)
  readonly supportsOnDemandImport = true; // Primary capability
  readonly supportsSearch = true; // Can search repositories
  readonly supportsPush = false; // Read-only integration

  private initialized = false;

  constructor(_options: GitHubOptions) {
    // Options currently unused - auth handled by gh CLI
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(): Promise<void> {
    // Verify gh CLI is available and authenticated
    const installed = await isGhInstalled();
    if (!installed) {
      throw new GhNotInstalledError();
    }

    const authenticated = await ghAuthStatus();
    if (!authenticated) {
      throw new GhAuthError();
    }

    this.initialized = true;
    console.log("[github] Provider initialized successfully");
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const installed = await isGhInstalled();
    if (!installed) {
      errors.push("GitHub CLI (gh) is not installed");
      return { valid: false, errors };
    }

    const authenticated = await ghAuthStatus();
    if (!authenticated) {
      errors.push("GitHub CLI not authenticated. Run: gh auth login");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    console.log("[github] Provider disposed");
  }

  // ===========================================================================
  // OnDemandImportCapable Implementation
  // ===========================================================================

  canHandleUrl(url: string): boolean {
    return canHandle(url);
  }

  parseUrl(url: string): { externalId: string; metadata?: Record<string, unknown> } | null {
    return parse(url);
  }

  async fetchByUrl(url: string): Promise<ExternalEntity | null> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return null;
    }

    return this.fetchEntity(parsed.externalId);
  }

  async fetchEntity(externalId: string): Promise<ExternalEntity | null> {
    const parsed = parseExternalId(externalId);
    if (!parsed) {
      console.warn(`[github] Invalid external ID format: ${externalId}`);
      return null;
    }

    const { owner, repo, number } = parsed;

    try {
      // Fetch issue via gh api
      const issue = await ghApi<GitHubIssue>(
        `/repos/${owner}/${repo}/issues/${number}`
      );

      return mapGitHubIssueToExternal(issue, owner, repo);
    } catch (error) {
      if (error instanceof GhNotFoundError) {
        console.log(`[github] Entity not found: ${externalId}`);
        return null;
      }
      throw error;
    }
  }

  async fetchComments(externalId: string): Promise<ExternalComment[]> {
    const parsed = parseExternalId(externalId);
    if (!parsed) {
      console.warn(`[github] Invalid external ID format: ${externalId}`);
      return [];
    }

    const { owner, repo, number } = parsed;

    try {
      const comments = await ghApi<GitHubComment[]>(
        `/repos/${owner}/${repo}/issues/${number}/comments`
      );

      return comments.map(mapGitHubCommentToExternal);
    } catch (error) {
      if (error instanceof GhNotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async refreshEntities(externalIds: string[]): Promise<(ExternalEntity | null)[]> {
    // Fetch entities in sequence (to avoid rate limiting)
    const results: (ExternalEntity | null)[] = [];

    for (const id of externalIds) {
      try {
        const entity = await this.fetchEntity(id);
        results.push(entity);
      } catch {
        results.push(null);
      }
    }

    return results;
  }

  // ===========================================================================
  // IntegrationProvider Implementation
  // ===========================================================================

  async searchEntities(query?: string): Promise<ExternalEntity[]> {
    if (!query) {
      console.warn("[github] Search requires a query");
      return [];
    }

    try {
      // Use GitHub search API
      const result = await ghApi<{ items: GitHubIssue[] }>(
        `/search/issues?q=${encodeURIComponent(query)}&per_page=20`
      );

      return result.items.map((issue) => {
        // Extract owner/repo from html_url
        const urlMatch = issue.html_url.match(
          /github\.com\/([^/]+)\/([^/]+)\/issues\/\d+/
        );
        const owner = urlMatch?.[1] || "unknown";
        const repo = urlMatch?.[2] || "unknown";
        return mapGitHubIssueToExternal(issue, owner, repo);
      });
    } catch (error) {
      console.error("[github] Search failed:", error);
      return [];
    }
  }

  async createEntity(_entity: Partial<Spec | Issue>): Promise<string> {
    // Read-only integration - push not supported
    throw new Error("GitHub integration is read-only. Push not supported.");
  }

  async updateEntity(
    _externalId: string,
    _entity: Partial<Spec | Issue>
  ): Promise<void> {
    // Read-only integration - push not supported
    throw new Error("GitHub integration is read-only. Push not supported.");
  }

  async deleteEntity(_externalId: string): Promise<void> {
    // Read-only integration - push not supported
    throw new Error("GitHub integration is read-only. Delete not supported.");
  }

  async getChangesSince(_timestamp: Date): Promise<ExternalChange[]> {
    // No polling support - on-demand only
    return [];
  }

  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  } {
    // GitHub entities always map to specs
    // ImportedSpecData extends Partial<Spec> with optional labels field
    const specData = mapToSudocodeSpec(external);
    // Extract labels separately as they're stored as tags at a different layer
    const { labels: _labels, ...spec } = specData;
    return { spec };
  }

  mapFromSudocode(_entity: Spec | Issue): Partial<ExternalEntity> {
    // Read-only integration - reverse mapping not needed
    throw new Error("GitHub integration is read-only. Reverse mapping not supported.");
  }
}

// Export types
export type { GitHubEntityType };

// Export URL pattern constants for external use
export { GITHUB_URL_PATTERNS };

// Export error classes
export { GhAuthError, GhNotFoundError, GhNotInstalledError, GhRateLimitError } from "./gh-client.js";

// Export utility functions
export { canHandleUrl, parseUrl, parseGitHubUrl, parseExternalId } from "./url-parser.js";
export { ghApi, ghAuthStatus, isGhInstalled } from "./gh-client.js";
export {
  mapGitHubIssueToExternal,
  mapGitHubCommentToExternal,
  mapToSudocodeSpec,
  type ImportedSpecData,
} from "./mappers.js";

// Export provider class for direct instantiation
export { GitHubProvider };

// Default export is the plugin
export default githubPlugin;
