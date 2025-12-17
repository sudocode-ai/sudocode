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
          console.error(`[import] Failed to sync spec ${spec.id} to markdown:`, error);
        });
      }

      // Import comments count for response
      // Note: Full comment import as IssueFeedback would require a valid issue as source,
      // which we don't have for external imports. Comments are fetched for count only.
      let feedbackCount = 0;
      if (
        options.includeComments &&
        isOnDemandCapable(matchedProvider) &&
        matchedProvider.fetchComments
      ) {
        try {
          const comments = await matchedProvider.fetchComments(entity.id);
          feedbackCount = comments.length;

          // Future enhancement: Create a synthetic issue to hold imported feedback,
          // or add a different storage mechanism for imported comments
          console.log(
            `[import] Found ${comments.length} comments for ${entity.id}. ` +
            `Comment import as feedback requires a valid issue source (future enhancement).`
          );
        } catch (error) {
          console.warn("[import] Failed to fetch comments:", error);
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
