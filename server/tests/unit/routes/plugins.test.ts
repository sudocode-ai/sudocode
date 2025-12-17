/**
 * Tests for plugins API routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createPluginsRouter } from "../../../src/routes/plugins.js";
import type { Request, Response } from "express";
import * as fs from "fs";

// Mock fs module
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Track which plugins are "installed" (simulates either local or global)
const installedPlugins = new Set(["beads", "github"]);

// Track which plugins are installed globally (subset of installedPlugins)
const globallyInstalledPlugins = new Set(["beads"]);

// Plugin capabilities for different plugin types
const pluginCapabilities: Record<
  string,
  {
    supportsWatch: boolean;
    supportsPolling: boolean;
    supportsOnDemandImport: boolean;
    supportsSearch: boolean;
    supportsPush: boolean;
  }
> = {
  beads: {
    supportsWatch: true,
    supportsPolling: false,
    supportsOnDemandImport: false,
    supportsSearch: false,
    supportsPush: false,
  },
  github: {
    supportsWatch: false,
    supportsPolling: false,
    supportsOnDemandImport: true,
    supportsSearch: true,
    supportsPush: false,
  },
};

// Mock the plugin loader
vi.mock("@sudocode-ai/cli/dist/integrations/index.js", () => ({
  getFirstPartyPlugins: vi.fn(() => [
    { name: "beads", package: "@sudocode-ai/integration-beads" },
    { name: "github", package: "@sudocode-ai/integration-github" },
  ]),
  loadPlugin: vi.fn(async (name: string) => {
    if (installedPlugins.has(name)) {
      const capabilities = pluginCapabilities[name] || {
        supportsWatch: false,
        supportsPolling: false,
        supportsOnDemandImport: false,
        supportsSearch: false,
        supportsPush: false,
      };
      return {
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        version: "0.1.0",
        description: `${name} integration plugin`,
        configSchema: {
          type: "object",
          properties:
            name === "beads"
              ? { path: { type: "string", required: true } }
              : {}, // github has empty properties
          required: name === "beads" ? ["path"] : [],
        },
        validateConfig: (options: Record<string, unknown>) => {
          if (name === "beads" && !options.path) {
            return {
              valid: false,
              errors: ["path is required"],
              warnings: [],
            };
          }
          return { valid: true, errors: [], warnings: [] };
        },
        testConnection: async () => ({
          success: true,
          configured: true,
          enabled: true,
        }),
        createProvider: () => ({
          supportsWatch: capabilities.supportsWatch,
          supportsPolling: capabilities.supportsPolling,
          supportsOnDemandImport: capabilities.supportsOnDemandImport,
          supportsSearch: capabilities.supportsSearch,
          supportsPush: capabilities.supportsPush,
        }),
      };
    }
    return null;
  }),
  isPluginInstalledGlobally: vi.fn((name: string) => globallyInstalledPlugins.has(name)),
  validateProviderConfig: vi.fn(async (name: string, config: unknown) => ({
    valid: true,
    errors: [],
    warnings: [],
  })),
  testProviderConnection: vi.fn(async () => ({
    success: true,
    configured: true,
    enabled: true,
    details: { mocked: true },
  })),
}));

// Helper to create mock request/response
function createMockReqRes(
  overrides: {
    params?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  } = {}
) {
  const req = {
    params: overrides.params || {},
    body: overrides.body || {},
    query: overrides.query || {},
    project: {
      id: "test-project",
      path: "/test/project",
      sudocodeDir: "/test/project/.sudocode",
      db: {},
    },
  } as unknown as Request;

  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to find route handler
function findHandler(
  router: ReturnType<typeof createPluginsRouter>,
  path: string,
  method: "get" | "post" | "put" | "delete"
) {
  return router.stack.find(
    (layer) => layer.route?.path === path && layer.route?.methods[method]
  )?.route?.stack[0].handle;
}

describe("Plugins Router", () => {
  let router: ReturnType<typeof createPluginsRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createPluginsRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /", () => {
    it("should list all available plugins", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            plugins: expect.arrayContaining([
              expect.objectContaining({
                name: "beads",
                package: "@sudocode-ai/integration-beads",
              }),
            ]),
          }),
        })
      );
    });

    it("should show activation status for configured plugins", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
          },
        })
      );

      const handler = findHandler(router, "/", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      const response = vi.mocked(res.json).mock.calls[0][0];
      const beadsPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "beads"
      );

      expect(beadsPlugin).toMatchObject({
        name: "beads",
        activated: true,
        enabled: true,
      });
    });

    it("should return capabilities for configured plugins", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
            github: {
              enabled: true,
            },
          },
        })
      );

      const handler = findHandler(router, "/", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      const response = vi.mocked(res.json).mock.calls[0][0];

      // Check beads capabilities (supports watch)
      const beadsPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "beads"
      );
      expect(beadsPlugin.capabilities).toEqual({
        supportsWatch: true,
        supportsPolling: false,
        supportsOnDemandImport: false,
        supportsSearch: false,
        supportsPush: false,
      });

      // Check github capabilities (supports on-demand import and search)
      const githubPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "github"
      );
      expect(githubPlugin.capabilities).toEqual({
        supportsWatch: false,
        supportsPolling: false,
        supportsOnDemandImport: true,
        supportsSearch: true,
        supportsPush: false,
      });
    });

    it("should return capabilities for installed plugins even if not configured", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      const response = vi.mocked(res.json).mock.calls[0][0];

      // Beads should have capabilities since it's installed (even though not configured)
      const beadsPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "beads"
      );
      expect(beadsPlugin.capabilities).toEqual({
        supportsWatch: true,
        supportsPolling: false,
        supportsOnDemandImport: false,
        supportsSearch: false,
        supportsPush: false,
      });

      // Github should also have capabilities
      const githubPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "github"
      );
      expect(githubPlugin.capabilities).toEqual({
        supportsWatch: false,
        supportsPolling: false,
        supportsOnDemandImport: true,
        supportsSearch: true,
        supportsPush: false,
      });
    });

    it("should detect plugin installed via metapackage (not globally)", async () => {
      // github is in installedPlugins but NOT in globallyInstalledPlugins
      // This simulates a plugin installed via metapackage
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      const response = vi.mocked(res.json).mock.calls[0][0];

      // Github should be detected as installed even though it's not global
      const githubPlugin = response.data.plugins.find(
        (p: { name: string }) => p.name === "github"
      );
      expect(githubPlugin.installed).toBe(true);
      expect(githubPlugin.capabilities).toBeDefined();
    });
  });

  describe("GET /:name", () => {
    it("should return 404 for non-installed plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "jira" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("not installed"),
        })
      );
    });

    it("should return plugin details for installed plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            name: "beads",
            displayName: "Beads",
            installed: true,
          }),
        })
      );
    });
  });

  describe("POST /:name/activate", () => {
    it("should return 400 for non-installed plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "jira" },
        body: {},
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/activate", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("not installed"),
        })
      );
    });

    it("should activate plugin with valid options", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
        body: { options: { path: ".beads" } },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/activate", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("activated"),
          }),
        })
      );

      // Verify config was written
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.integrations.beads.enabled).toBe(true);
    });

    it("should reject invalid options when validation fails", async () => {
      // Use a plugin name that's installed but will fail validation
      // The mock validates that path must be provided
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
        body: { options: { path: "" } }, // Empty path should be rejected
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      // Override validateProviderConfig for this test
      const { validateProviderConfig } = await import(
        "@sudocode-ai/cli/dist/integrations/index.js"
      );
      vi.mocked(validateProviderConfig).mockResolvedValueOnce({
        valid: false,
        errors: ["path cannot be empty"],
        warnings: [],
      });

      // Create a fresh router that will use the mocked validation
      const freshRouter = createPluginsRouter();
      const handler = findHandler(freshRouter, "/:name/options", "put");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid plugin options",
          errors: expect.arrayContaining(["path cannot be empty"]),
        })
      );
    });
  });

  describe("POST /:name/deactivate", () => {
    it("should return 404 for non-configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/deactivate", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("not configured"),
        })
      );
    });

    it("should deactivate configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
          },
        })
      );

      const handler = findHandler(router, "/:name/deactivate", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("deactivated"),
          }),
        })
      );

      // Verify enabled was set to false
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.integrations.beads.enabled).toBe(false);
    });
  });

  describe("PUT /:name/options", () => {
    it("should return 400 for non-installed plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "jira" },
        body: { path: ".jira" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/options", "put");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should update options for configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
        body: { options: { path: ".new-beads" } },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
          },
        })
      );

      const handler = findHandler(router, "/:name/options", "put");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            options: { path: ".new-beads" },
          }),
        })
      );
    });
  });

  describe("POST /:name/test", () => {
    it("should return 404 for non-configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/test", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should test connection for configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
          },
        })
      );

      const handler = findHandler(router, "/:name/test", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            success: true,
          }),
        })
      );
    });
  });

  describe("POST /:name/install", () => {
    it("should return already installed for globally installed plugin", async () => {
      // beads is in both installedPlugins and globallyInstalledPlugins
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
        body: {},
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/install", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("already installed globally"),
            alreadyInstalled: true,
          }),
        })
      );
    });

    it("should return already installed for metapackage/local plugin", async () => {
      // github is in installedPlugins but NOT in globallyInstalledPlugins
      // This simulates a plugin installed via metapackage
      const { req, res } = createMockReqRes({
        params: { name: "github" },
        body: {},
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name/install", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("via metapackage or local node_modules"),
            alreadyInstalled: true,
          }),
        })
      );
    });
  });

  describe("POST /:name/sync", () => {
    it("should return 500 when integrationSyncService is not available", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      // No integrationSyncService on project
      req.project!.integrationSyncService = undefined;

      const handler = findHandler(router, "/:name/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("not available"),
        })
      );
    });

    it("should sync provider and return results", async () => {
      const mockSyncResults = [
        {
          entity_id: "i-abc1",
          external_id: "ext-1",
          action: "created",
          success: true,
        },
        {
          entity_id: "i-abc2",
          external_id: "ext-2",
          action: "updated",
          success: true,
        },
        {
          entity_id: "",
          external_id: "ext-3",
          action: "skipped",
          success: true,
        },
      ];

      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      req.project!.integrationSyncService = {
        syncProvider: vi.fn().mockResolvedValue(mockSyncResults),
      } as unknown as typeof req.project.integrationSyncService;

      const handler = findHandler(router, "/:name/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("beads"),
            results: mockSyncResults,
          }),
        })
      );
      expect(
        req.project!.integrationSyncService!.syncProvider
      ).toHaveBeenCalledWith("beads");
    });

    it("should return 500 when sync fails", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      req.project!.integrationSyncService = {
        syncProvider: vi
          .fn()
          .mockRejectedValue(new Error("Provider not found")),
      } as unknown as typeof req.project.integrationSyncService;

      const handler = findHandler(router, "/:name/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Provider not found"),
        })
      );
    });
  });

  describe("POST /sync", () => {
    it("should return 500 when integrationSyncService is not available", async () => {
      const { req, res } = createMockReqRes();
      req.project!.integrationSyncService = undefined;

      const handler = findHandler(router, "/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("not available"),
        })
      );
    });

    it("should sync all providers and return results", async () => {
      const mockSyncResults = [
        {
          entity_id: "i-abc1",
          external_id: "ext-1",
          action: "created",
          success: true,
        },
        {
          entity_id: "s-xyz2",
          external_id: "ext-2",
          action: "created",
          success: true,
        },
      ];

      const { req, res } = createMockReqRes();
      req.project!.integrationSyncService = {
        syncAll: vi.fn().mockResolvedValue(mockSyncResults),
      } as unknown as typeof req.project.integrationSyncService;

      const handler = findHandler(router, "/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("all providers"),
            results: mockSyncResults,
          }),
        })
      );
      expect(req.project!.integrationSyncService!.syncAll).toHaveBeenCalled();
    });

    it("should return 500 when syncAll fails", async () => {
      const { req, res } = createMockReqRes();
      req.project!.integrationSyncService = {
        syncAll: vi.fn().mockRejectedValue(new Error("Sync failed")),
      } as unknown as typeof req.project.integrationSyncService;

      const handler = findHandler(router, "/sync", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("Sync failed"),
        })
      );
    });
  });

  describe("DELETE /:name", () => {
    it("should return 404 for non-configured plugin", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = findHandler(router, "/:name", "delete");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should remove plugin configuration", async () => {
      const { req, res } = createMockReqRes({
        params: { name: "beads" },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              options: { path: ".beads" },
            },
          },
        })
      );

      const handler = findHandler(router, "/:name", "delete");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            message: expect.stringContaining("removed"),
          }),
        })
      );

      // Verify config was updated
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);
      expect(writtenConfig.integrations.beads).toBeUndefined();
    });
  });
});
