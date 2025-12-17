/**
 * Server routes for on-demand import functionality
 *
 * Provides API endpoints for importing entities from external systems
 * into sudocode specs via URL-based on-demand import.
 */

import { Router, Request, Response } from "express";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import type {
  IntegrationsConfig,
  ExternalEntity,
  ExternalLink,
  OnDemandImportCapable,
  IntegrationProvider,
} from "@sudocode-ai/types";
import {
  loadPlugin,
  getFirstPartyPlugins,
  testProviderConnection,
} from "@sudocode-ai/cli/dist/integrations/index.js";
import {
  findSpecsByExternalLink,
  findIssuesByExternalLink,
  createSpecFromExternal,
} from "@sudocode-ai/cli/dist/operations/external-links.js";
import { createIssue } from "@sudocode-ai/cli/dist/operations/issues.js";
import { createFeedback } from "@sudocode-ai/cli/dist/operations/feedback.js";
import { generateIssueId } from "@sudocode-ai/cli/dist/id-generator.js";
import type { ExternalComment } from "@sudocode-ai/types";
import { triggerExport, syncEntityToMarkdown } from "../services/export.js";
import { broadcastSpecUpdate } from "../services/websocket.js";
import {
  bulkRefresh,
  type BulkRefreshResult,
} from "../services/external-refresh-service.js";

/**
 * Provider information returned by GET /api/import/providers
 */
export interface ImportProviderInfo {
  name: string;
  displayName: string;
  supportsOnDemandImport: boolean;
  supportsSearch: boolean;
  urlPatterns: string[];
  configured: boolean;
  authMethod: "gh-cli" | "token" | "oauth" | "none";
}

/**
 * Preview response for POST /api/import/preview
 */
export interface ImportPreviewResponse {
  provider: string;
  entity: ExternalEntity;
  commentsCount?: number;
  alreadyLinked?: {
    entityId: string;
    entityType: "spec" | "issue";
    lastSyncedAt?: string;
  };
}

/**
 * Import request body for POST /api/import
 */
export interface ImportRequest {
  url: string;
  options?: {
    includeComments?: boolean;
    tags?: string[];
    priority?: number;
    parentId?: string;
  };
}

/**
 * Import response for POST /api/import
 */
export interface ImportResponse {
  entityId: string;
  entityType: "spec";
  externalLink: ExternalLink;
  feedbackCount?: number;
}

/**
 * Bulk refresh request body for POST /api/import/refresh
 */
export interface BulkRefreshRequest {
  /** Filter by provider name (optional) */
  provider?: string;
  /** Specific entity IDs to refresh (optional) */
  entityIds?: string[];
  /** Skip conflict check, overwrite local changes (default: false) */
  force?: boolean;
}

/**
 * Search request body for POST /api/import/search
 */
export interface ImportSearchRequest {
  /** Provider name to search (required) */
  provider: string;
  /** Search query (optional - if not provided, lists issues from repo) */
  query?: string;
  /** Repository to search in (e.g., "owner/repo") - used for listing without query */
  repo?: string;
  /** Page number for pagination (1-indexed, default: 1) */
  page?: number;
  /** Number of results per page (default: 20, max: 100) */
  perPage?: number;
}

/**
 * Search response for POST /api/import/search
 */
export interface ImportSearchResponse {
  provider: string;
  query?: string;
  repo?: string;
  results: ExternalEntity[];
  /** Pagination info */
  pagination?: {
    page: number;
    perPage: number;
    hasMore: boolean;
  };
}

/**
 * Batch import request body for POST /api/import/batch
 */
export interface BatchImportRequest {
  /** Provider name (required) */
  provider: string;
  /** Array of external IDs to import */
  externalIds: string[];
  /** Import options applied to all items */
  options?: {
    includeComments?: boolean;
    tags?: string[];
    priority?: number;
  };
}

/**
 * Result for a single item in batch import
 */
export interface BatchImportItemResult {
  /** External ID that was imported */
  externalId: string;
  /** Whether the import succeeded */
  success: boolean;
  /** The sudocode entity ID (spec ID) */
  entityId?: string;
  /** Action taken: created, updated, or failed */
  action: "created" | "updated" | "failed";
  /** Error message if failed */
  error?: string;
}

/**
 * Batch import response for POST /api/import/batch
 */
export interface BatchImportResponse {
  /** Provider used */
  provider: string;
  /** Number of entities created */
  created: number;
  /** Number of entities updated */
  updated: number;
  /** Number of entities that failed */
  failed: number;
  /** Per-item results */
  results: BatchImportItemResult[];
}

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
 * Compute SHA256 hash of content for change detection
 */
function computeContentHash(title: string, content: string): string {
  const hash = createHash("sha256");
  hash.update(title);
  hash.update(content || "");
  return hash.digest("hex");
}

/**
 * Format a comment for import as IssueFeedback content
 */
function formatImportedComment(comment: ExternalComment): string {
  const dateStr = new Date(comment.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  let content = `**@${comment.author}** commented on ${dateStr}:\n\n${comment.body}`;

  if (comment.url) {
    content += `\n\n---\n*Imported from [${comment.url}](${comment.url})*`;
  }

  return content;
}

/**
 * Check if a provider supports on-demand import
 */
function isOnDemandCapable(
  provider: IntegrationProvider
): provider is IntegrationProvider & OnDemandImportCapable {
  return provider.supportsOnDemandImport === true;
}

/**
 * Get URL patterns from a provider (if available)
 */
function getProviderUrlPatterns(provider: IntegrationProvider): string[] {
  // Try to get URL patterns from the provider
  // Some providers may expose this information
  if ("urlPatterns" in provider) {
    return (provider as unknown as { urlPatterns: string[] }).urlPatterns;
  }

  // Default patterns based on known providers
  const defaultPatterns: Record<string, string[]> = {
    github: [
      "https://github.com/{owner}/{repo}/issues/{number}",
      "https://github.com/{owner}/{repo}/discussions/{number}",
    ],
    beads: ["beads://{workspace}/{id}"],
    jira: ["https://{domain}.atlassian.net/browse/{key}"],
  };

  return defaultPatterns[provider.name] || [];
}

/**
 * Determine auth method for a provider
 */
function getProviderAuthMethod(
  providerName: string
): "gh-cli" | "token" | "oauth" | "none" {
  // Known auth methods for providers
  const authMethods: Record<string, "gh-cli" | "token" | "oauth" | "none"> = {
    github: "gh-cli",
    jira: "token",
    beads: "none",
  };

  return authMethods[providerName] || "token";
}

export function createImportRouter(): Router {
  const router = Router();

  /**
   * GET /api/import/providers - List available import providers
   *
   * Returns all configured providers that support on-demand import
   */
  router.get("/providers", async (req: Request, res: Response) => {
    try {
      const firstPartyPlugins = getFirstPartyPlugins();
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      const providers: ImportProviderInfo[] = [];

      // Check first-party plugins
      for (const p of firstPartyPlugins) {
        const providerConfig = integrations[p.name];
        const plugin = await loadPlugin(p.name);

        if (!plugin) {
          continue;
        }

        // Create provider to check capabilities
        try {
          const provider = plugin.createProvider(
            providerConfig?.options || {},
            req.project!.path
          );

          // Only include providers that support on-demand import
          if (provider.supportsOnDemandImport) {
            // Test if configured (has auth, etc.)
            const testResult = await testProviderConnection(
              p.name,
              providerConfig || { enabled: false },
              req.project!.path
            );

            providers.push({
              name: p.name,
              displayName: plugin.displayName,
              supportsOnDemandImport: true,
              supportsSearch: provider.supportsSearch,
              urlPatterns: getProviderUrlPatterns(provider),
              configured: testResult.configured,
              authMethod: getProviderAuthMethod(p.name),
            });
          }
        } catch (error) {
          // Provider creation failed - skip
          console.warn(`[import] Failed to create provider ${p.name}:`, error);
        }
      }

      // Also check custom plugins from config
      const firstPartyNames = new Set(firstPartyPlugins.map((p) => p.name));
      for (const [name, providerConfig] of Object.entries(integrations)) {
        if (!firstPartyNames.has(name) && providerConfig) {
          const pluginId = providerConfig.plugin || name;
          const plugin = await loadPlugin(pluginId);

          if (!plugin) {
            continue;
          }

          try {
            const provider = plugin.createProvider(
              providerConfig.options || {},
              req.project!.path
            );

            if (provider.supportsOnDemandImport) {
              const testResult = await testProviderConnection(
                name,
                providerConfig,
                req.project!.path
              );

              providers.push({
                name,
                displayName: plugin.displayName,
                supportsOnDemandImport: true,
                supportsSearch: provider.supportsSearch,
                urlPatterns: getProviderUrlPatterns(provider),
                configured: testResult.configured,
                authMethod: getProviderAuthMethod(name),
              });
            }
          } catch (error) {
            console.warn(
              `[import] Failed to create custom provider ${name}:`,
              error
            );
          }
        }
      }

      res.status(200).json({
        success: true,
        data: { providers },
      });
    } catch (error) {
      console.error("[import] Failed to list providers:", error);
      res.status(500).json({
        success: false,
        error: "Failed to list import providers",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/import/preview - Preview an import before creating entity
   *
   * Fetches entity from external system and checks if already imported
   */
  router.post("/preview", async (req: Request, res: Response) => {
    try {
      const { url } = req.body as { url?: string };

      if (!url || typeof url !== "string") {
        res.status(400).json({
          success: false,
          error: "URL is required",
          message: "Request body must include a valid URL string",
        });
        return;
      }

      // Get all enabled providers
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;
      const firstPartyPlugins = getFirstPartyPlugins();

      // Find provider that can handle this URL
      let matchedProvider: IntegrationProvider | null = null;
      let matchedProviderName: string | null = null;

      // Check first-party plugins
      for (const p of firstPartyPlugins) {
        const plugin = await loadPlugin(p.name);
        if (!plugin) continue;

        const providerConfig = integrations[p.name];
        const provider = plugin.createProvider(
          providerConfig?.options || {},
          req.project!.path
        );

        if (isOnDemandCapable(provider) && provider.canHandleUrl?.(url)) {
          matchedProvider = provider;
          matchedProviderName = p.name;
          break;
        }
      }

      // Check custom providers if no match
      if (!matchedProvider) {
        const firstPartyNames = new Set(firstPartyPlugins.map((p) => p.name));
        for (const [name, providerConfig] of Object.entries(integrations)) {
          if (!firstPartyNames.has(name) && providerConfig) {
            const pluginId = providerConfig.plugin || name;
            const plugin = await loadPlugin(pluginId);
            if (!plugin) continue;

            const provider = plugin.createProvider(
              providerConfig.options || {},
              req.project!.path
            );

            if (isOnDemandCapable(provider) && provider.canHandleUrl?.(url)) {
              matchedProvider = provider;
              matchedProviderName = name;
              break;
            }
          }
        }
      }

      if (!matchedProvider || !matchedProviderName) {
        res.status(422).json({
          success: false,
          error: "No provider found",
          message: `No configured provider can handle URL: ${url}`,
        });
        return;
      }

      // Initialize provider if needed
      await matchedProvider.initialize();

      // Fetch entity by URL
      const entity = isOnDemandCapable(matchedProvider)
        ? await matchedProvider.fetchByUrl?.(url)
        : null;

      if (!entity) {
        res.status(404).json({
          success: false,
          error: "Entity not found",
          message: `Could not fetch entity from URL: ${url}`,
        });
        return;
      }

      // Check if already imported
      let alreadyLinked: ImportPreviewResponse["alreadyLinked"] | undefined;

      const existingSpecs = findSpecsByExternalLink(
        req.project!.sudocodeDir,
        matchedProviderName,
        entity.id
      );

      if (existingSpecs.length > 0) {
        const existingSpec = existingSpecs[0];
        const link = existingSpec.external_links?.find(
          (l) =>
            l.provider === matchedProviderName && l.external_id === entity.id
        );

        alreadyLinked = {
          entityId: existingSpec.id,
          entityType: "spec",
          lastSyncedAt: link?.last_synced_at,
        };
      } else {
        // Also check issues
        const existingIssues = findIssuesByExternalLink(
          req.project!.sudocodeDir,
          matchedProviderName,
          entity.id
        );

        if (existingIssues.length > 0) {
          const existingIssue = existingIssues[0];
          const link = existingIssue.external_links?.find(
            (l) =>
              l.provider === matchedProviderName && l.external_id === entity.id
          );

          alreadyLinked = {
            entityId: existingIssue.id,
            entityType: "issue",
            lastSyncedAt: link?.last_synced_at,
          };
        }
      }

      // Fetch comments count if supported
      let commentsCount: number | undefined;
      if (isOnDemandCapable(matchedProvider) && matchedProvider.fetchComments) {
        try {
          const comments = await matchedProvider.fetchComments(entity.id);
          commentsCount = comments.length;
        } catch {
          // Ignore errors fetching comments for preview
        }
      }

      // Clean up provider
      await matchedProvider.dispose();

      const response: ImportPreviewResponse = {
        provider: matchedProviderName,
        entity,
        commentsCount,
        alreadyLinked,
      };

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("[import] Preview failed:", error);

      // Handle specific error types
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("not authenticated") ||
        errorMessage.includes("auth")
      ) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: "Preview failed",
        message: errorMessage,
      });
    }
  });

  /**
   * POST /api/import/search - Search for entities in external systems
   *
   * Searches a provider for entities matching a query, or lists issues from a repo
   */
  router.post("/search", async (req: Request, res: Response) => {
    try {
      const {
        provider: providerName,
        query,
        repo,
        page = 1,
        perPage = 20,
      } = req.body as ImportSearchRequest;

      if (!providerName || typeof providerName !== "string") {
        res.status(400).json({
          success: false,
          error: "Provider is required",
          message: "Request body must include a valid provider name",
        });
        return;
      }

      // Either query or repo must be provided
      if (!query && !repo) {
        res.status(400).json({
          success: false,
          error: "Query or repo is required",
          message:
            "Request body must include a search query or repo to list issues from",
        });
        return;
      }

      // Get config
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      // Try to load the provider
      const plugin = await loadPlugin(providerName);

      if (!plugin) {
        res.status(404).json({
          success: false,
          error: "Provider not found",
          message: `Provider "${providerName}" is not installed`,
        });
        return;
      }

      const providerConfig = integrations[providerName];
      const provider = plugin.createProvider(
        providerConfig?.options || {},
        req.project!.path
      );

      // Check if provider supports search
      if (!provider.supportsSearch) {
        res.status(422).json({
          success: false,
          error: "Search not supported",
          message: `Provider "${providerName}" does not support search`,
        });
        return;
      }

      // Initialize provider
      await provider.initialize();

      // Search for entities with options
      const searchResult = await provider.searchEntities(query, {
        repo,
        page,
        perPage: Math.min(perPage, 100),
      });

      // Clean up provider
      await provider.dispose();

      // Handle both old array format and new SearchResult format
      const isSearchResult =
        searchResult &&
        typeof searchResult === "object" &&
        "results" in searchResult;
      const results = isSearchResult
        ? (searchResult as { results: ExternalEntity[] }).results
        : (searchResult as ExternalEntity[]);
      const pagination = isSearchResult
        ? (searchResult as { pagination?: ImportSearchResponse["pagination"] })
            .pagination
        : undefined;

      const response: ImportSearchResponse = {
        provider: providerName,
        query,
        repo,
        results,
        pagination,
      };

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("[import] Search failed:", error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("not authenticated") ||
        errorMessage.includes("auth")
      ) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: "Search failed",
        message: errorMessage,
      });
    }
  });

  /**
   * POST /api/import/batch - Batch import entities with upsert behavior
   *
   * Creates or updates specs from external entities. If an entity is already
   * imported, it updates the existing spec instead of creating a duplicate.
   */
  router.post("/batch", async (req: Request, res: Response) => {
    try {
      const {
        provider: providerName,
        externalIds,
        options = {},
      } = req.body as BatchImportRequest;

      // Validation
      if (!providerName || typeof providerName !== "string") {
        res.status(400).json({
          success: false,
          error: "Provider is required",
          message: "Request body must include a valid provider name",
        });
        return;
      }

      if (!Array.isArray(externalIds) || externalIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "External IDs required",
          message: "Request body must include a non-empty array of external IDs",
        });
        return;
      }

      // Get config
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;

      // Load the provider
      const plugin = await loadPlugin(providerName);
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: "Provider not found",
          message: `Provider "${providerName}" is not installed`,
        });
        return;
      }

      const providerConfig = integrations[providerName];
      const provider = plugin.createProvider(
        providerConfig?.options || {},
        req.project!.path
      );

      // Check capabilities
      if (!isOnDemandCapable(provider)) {
        res.status(422).json({
          success: false,
          error: "Import not supported",
          message: `Provider "${providerName}" does not support on-demand import`,
        });
        return;
      }

      // Initialize provider
      await provider.initialize();

      const results: BatchImportItemResult[] = [];
      let created = 0;
      let updated = 0;
      let failed = 0;

      // Process each external ID
      for (const externalId of externalIds) {
        try {
          // Fetch the entity
          const entity = await provider.fetchEntity(externalId);

          if (!entity) {
            results.push({
              externalId,
              success: false,
              action: "failed",
              error: "Entity not found",
            });
            failed++;
            continue;
          }

          // Check if already imported
          const existingSpecs = findSpecsByExternalLink(
            req.project!.sudocodeDir,
            providerName,
            entity.id
          );

          const now = new Date().toISOString();

          if (existingSpecs.length > 0) {
            // Update existing spec
            const existingSpec = existingSpecs[0];

            // Import updateSpec from CLI
            const { updateSpec } = await import(
              "@sudocode-ai/cli/dist/operations/specs.js"
            );
            const { updateSpecExternalLinkSync } = await import(
              "@sudocode-ai/cli/dist/operations/external-links.js"
            );

            // Update the spec content
            updateSpec(req.project!.db, existingSpec.id, {
              title: entity.title,
              content: entity.description || "",
              priority: options.priority ?? entity.priority ?? existingSpec.priority,
            });

            // Update the external link sync timestamp
            updateSpecExternalLinkSync(
              req.project!.sudocodeDir,
              existingSpec.id,
              entity.id,
              {
                last_synced_at: now,
                external_updated_at: entity.updated_at,
              }
            );

            // Broadcast update
            broadcastSpecUpdate(req.project!.id, existingSpec.id, "updated", {
              ...existingSpec,
              title: entity.title,
              content: entity.description || "",
            });

            results.push({
              externalId,
              success: true,
              entityId: existingSpec.id,
              action: "updated",
            });
            updated++;
          } else {
            // Create new spec
            const spec = createSpecFromExternal(req.project!.sudocodeDir, {
              title: entity.title,
              content: entity.description || "",
              priority: options.priority ?? entity.priority ?? 2,
              external: {
                provider: providerName,
                external_id: entity.id,
                sync_direction: "inbound",
              },
              relationships: entity.relationships?.map((r) => ({
                targetExternalId: r.targetId,
                targetType: r.targetType,
                relationshipType: r.relationshipType,
              })),
            });

            // Broadcast creation
            broadcastSpecUpdate(req.project!.id, spec.id, "created", spec);

            results.push({
              externalId,
              success: true,
              entityId: spec.id,
              action: "created",
            });
            created++;
          }
        } catch (itemError) {
          const errorMessage =
            itemError instanceof Error ? itemError.message : String(itemError);
          results.push({
            externalId,
            success: false,
            action: "failed",
            error: errorMessage,
          });
          failed++;
        }
      }

      // Clean up provider
      await provider.dispose();

      // Trigger export if any changes were made
      if (created > 0 || updated > 0) {
        triggerExport(req.project!.db, req.project!.sudocodeDir);
      }

      const response: BatchImportResponse = {
        provider: providerName,
        created,
        updated,
        failed,
        results,
      };

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("[import] Batch import failed:", error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("not authenticated") ||
        errorMessage.includes("auth")
      ) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: "Batch import failed",
        message: errorMessage,
      });
    }
  });

  /**
   * POST /api/import - Import entity and create spec
   *
   * Creates a spec with external_link from the given URL
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { url, options = {} } = req.body as ImportRequest;

      if (!url || typeof url !== "string") {
        res.status(400).json({
          success: false,
          error: "URL is required",
          message: "Request body must include a valid URL string",
        });
        return;
      }

      // Get all enabled providers
      const config = readConfig(req.project!.sudocodeDir);
      const integrations = (config.integrations || {}) as IntegrationsConfig;
      const firstPartyPlugins = getFirstPartyPlugins();

      // Find provider that can handle this URL
      let matchedProvider: IntegrationProvider | null = null;
      let matchedProviderName: string | null = null;

      // Check first-party plugins
      for (const p of firstPartyPlugins) {
        const plugin = await loadPlugin(p.name);
        if (!plugin) continue;

        const providerConfig = integrations[p.name];
        const provider = plugin.createProvider(
          providerConfig?.options || {},
          req.project!.path
        );

        if (isOnDemandCapable(provider) && provider.canHandleUrl?.(url)) {
          matchedProvider = provider;
          matchedProviderName = p.name;
          break;
        }
      }

      // Check custom providers if no match
      if (!matchedProvider) {
        const firstPartyNames = new Set(firstPartyPlugins.map((p) => p.name));
        for (const [name, providerConfig] of Object.entries(integrations)) {
          if (!firstPartyNames.has(name) && providerConfig) {
            const pluginId = providerConfig.plugin || name;
            const plugin = await loadPlugin(pluginId);
            if (!plugin) continue;

            const provider = plugin.createProvider(
              providerConfig.options || {},
              req.project!.path
            );

            if (isOnDemandCapable(provider) && provider.canHandleUrl?.(url)) {
              matchedProvider = provider;
              matchedProviderName = name;
              break;
            }
          }
        }
      }

      if (!matchedProvider || !matchedProviderName) {
        res.status(422).json({
          success: false,
          error: "No provider found",
          message: `No configured provider can handle URL: ${url}`,
        });
        return;
      }

      // Initialize provider
      await matchedProvider.initialize();

      // Fetch entity by URL
      const entity = isOnDemandCapable(matchedProvider)
        ? await matchedProvider.fetchByUrl?.(url)
        : null;

      if (!entity) {
        res.status(404).json({
          success: false,
          error: "Entity not found",
          message: `Could not fetch entity from URL: ${url}`,
        });
        return;
      }

      // Check if already imported
      const existingSpecs = findSpecsByExternalLink(
        req.project!.sudocodeDir,
        matchedProviderName,
        entity.id
      );

      if (existingSpecs.length > 0) {
        res.status(409).json({
          success: false,
          error: "Already imported",
          message: `Entity already imported as spec: ${existingSpecs[0].id}`,
          data: {
            entityId: existingSpecs[0].id,
            entityType: "spec",
          },
        });
        return;
      }

      // Compute content hash
      const contentHash = computeContentHash(
        entity.title,
        entity.description || ""
      );
      const now = new Date().toISOString();

      // Create spec with external link
      const spec = createSpecFromExternal(req.project!.sudocodeDir, {
        title: entity.title,
        content: entity.description || "",
        priority: options.priority ?? entity.priority ?? 2,
        external: {
          provider: matchedProviderName,
          external_id: entity.id,
          sync_direction: "inbound",
        },
        relationships: entity.relationships?.map((r) => ({
          targetExternalId: r.targetId,
          targetType: r.targetType,
          relationshipType: r.relationshipType,
        })),
      });

      // Update external_link with additional metadata
      // Note: This is stored in JSONL, so we need to update there
      const externalLink: ExternalLink = {
        provider: matchedProviderName,
        external_id: entity.id,
        external_url: entity.url,
        sync_enabled: true,
        sync_direction: "inbound",
        last_synced_at: now,
        external_updated_at: entity.updated_at,
        content_hash: contentHash,
        imported_at: now,
        import_metadata: {
          imported_by: "api",
          original_status: entity.status,
          original_type: entity.type,
        },
      };

      // Trigger export to JSONL files
      triggerExport(req.project!.db, req.project!.sudocodeDir);

      // Sync to markdown file (fire and forget)
      const syncPromise = syncEntityToMarkdown(
        req.project!.db,
        spec.id,
        "spec",
        req.project!.sudocodeDir
      );
      if (syncPromise && typeof syncPromise.catch === "function") {
        syncPromise.catch((error: Error) => {
          console.error(
            `[import] Failed to sync spec ${spec.id} to markdown:`,
            error
          );
        });
      }

      // Import comments as IssueFeedback
      let feedbackCount = 0;
      if (
        options.includeComments &&
        isOnDemandCapable(matchedProvider) &&
        matchedProvider.fetchComments
      ) {
        try {
          const comments = await matchedProvider.fetchComments(entity.id);

          if (comments.length > 0) {
            // Create a placeholder issue to serve as the feedback source
            // TODO: Support feedback without an issue.
            const { id: placeholderIssueId, uuid: placeholderIssueUuid } =
              generateIssueId(req.project!.db, req.project!.sudocodeDir);

            const placeholderIssue = createIssue(req.project!.db, {
              id: placeholderIssueId,
              uuid: placeholderIssueUuid,
              title: `Imported comments for: ${entity.title}`,
              content:
                `This issue was created to hold imported comments from [${entity.url}](${entity.url}).\n\n` +
                `Provider: ${matchedProviderName}\n` +
                `External ID: ${entity.id}\n` +
                `Imported at: ${now}\n` +
                `Comments: ${comments.length}`,
              status: "closed",
              priority: 4, // Lowest priority - placeholder only
            });

            console.log(
              `[import] Created placeholder issue ${placeholderIssue.id} for ${comments.length} comments`
            );

            // Import each comment as IssueFeedback
            for (const comment of comments) {
              try {
                createFeedback(req.project!.db, {
                  from_id: placeholderIssue.id,
                  to_id: spec.id,
                  feedback_type: "comment",
                  content: formatImportedComment(comment),
                  agent: "import",
                  created_at: comment.created_at,
                });
                feedbackCount++;
              } catch (feedbackError) {
                console.warn(
                  `[import] Failed to create feedback for comment ${comment.id}:`,
                  feedbackError
                );
              }
            }

            console.log(
              `[import] Successfully imported ${feedbackCount} of ${comments.length} comments as feedback`
            );
          }
        } catch (error) {
          console.warn("[import] Failed to fetch/import comments:", error);
        }
      }

      // Clean up provider
      await matchedProvider.dispose();

      // Broadcast spec creation
      broadcastSpecUpdate(req.project!.id, spec.id, "created", spec);

      const response: ImportResponse = {
        entityId: spec.id,
        entityType: "spec",
        externalLink,
        feedbackCount: feedbackCount > 0 ? feedbackCount : undefined,
      };

      res.status(201).json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("[import] Import failed:", error);

      // Handle specific error types
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("not authenticated") ||
        errorMessage.includes("auth")
      ) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: "Import failed",
        message: errorMessage,
      });
    }
  });

  /**
   * POST /api/import/refresh - Refresh multiple entities from external sources
   *
   * Request body:
   * - provider?: string - Filter by provider name
   * - entityIds?: string[] - Specific entity IDs to refresh
   * - force?: boolean - Skip conflict check, overwrite local changes
   *
   * Response:
   * - refreshed: number - Count of successfully refreshed entities
   * - skipped: number - Count of skipped entities (no changes or local changes without force)
   * - failed: number - Count of failed refreshes
   * - stale: number - Count of stale links (external entity deleted)
   * - results: Array<{entityId, status, error?}> - Per-entity results
   */
  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      const { provider, entityIds, force } = req.body as BulkRefreshRequest;

      // Validate entityIds if provided
      if (entityIds !== undefined) {
        if (!Array.isArray(entityIds)) {
          res.status(400).json({
            success: false,
            error: "Invalid request",
            message: "entityIds must be an array of strings",
          });
          return;
        }

        if (!entityIds.every((id) => typeof id === "string")) {
          res.status(400).json({
            success: false,
            error: "Invalid request",
            message: "entityIds must contain only strings",
          });
          return;
        }
      }

      // Validate provider if provided
      if (provider !== undefined && typeof provider !== "string") {
        res.status(400).json({
          success: false,
          error: "Invalid request",
          message: "provider must be a string",
        });
        return;
      }

      // Execute bulk refresh
      const result: BulkRefreshResult = await bulkRefresh(
        req.project!.db,
        req.project!.sudocodeDir,
        req.project!.path,
        {
          provider,
          entityIds,
          force: force === true,
        }
      );

      // Trigger export if any entities were updated
      if (result.refreshed > 0) {
        triggerExport(req.project!.db, req.project!.sudocodeDir);
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("[import] Bulk refresh failed:", error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      res.status(500).json({
        success: false,
        error: "Bulk refresh failed",
        message: errorMessage,
      });
    }
  });

  return router;
}
