/**
 * Tests for config API routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createConfigRouter } from "../../../src/routes/config.js";
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

// Mock the plugin loader
vi.mock("@sudocode-ai/cli/dist/integrations/index.js", () => ({
  validateIntegrationsConfig: vi.fn((config) => ({
    valid: true,
    errors: [],
    warnings: [],
  })),
  testProviderConnection: vi.fn(async (provider, config, projectPath) => ({
    success: true,
    configured: true,
    enabled: true,
    details: { mocked: true },
  })),
}));

// Helper to create mock request/response
function createMockReqRes(overrides: {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
} = {}) {
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

describe("Config Router", () => {
  let router: ReturnType<typeof createConfigRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createConfigRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /", () => {
    it("should return empty object when config.json does not exist", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Get the route handler
      const handler = router.stack.find(
        (layer) => layer.route?.path === "/" && layer.route?.methods.get
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should return config when config.json exists", async () => {
      const { req, res } = createMockReqRes();
      const mockConfig = {
        version: "0.1.0",
        worktree: { autoCreateBranches: true },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const handler = router.stack.find(
        (layer) => layer.route?.path === "/" && layer.route?.methods.get
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockConfig);
    });
  });

  describe("GET /integrations", () => {
    it("should return empty object when no integrations configured", async () => {
      const { req, res } = createMockReqRes();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations" && layer.route?.methods.get
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should return integrations section from config", async () => {
      const { req, res } = createMockReqRes();
      const mockConfig = {
        version: "0.1.0",
        integrations: {
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: "../other/.beads" },
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations" && layer.route?.methods.get
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockConfig.integrations);
    });
  });

  describe("PUT /integrations", () => {
    it("should reject invalid configuration with errors", async () => {
      // Override the mock for this specific test
      const { validateIntegrationsConfig } = await import(
        "@sudocode-ai/cli/dist/integrations/index.js"
      );
      vi.mocked(validateIntegrationsConfig).mockReturnValueOnce({
        valid: false,
        errors: ["beads.default_sync_direction must be one of: inbound, outbound, bidirectional"],
        warnings: [],
      });

      const { req, res } = createMockReqRes({
        body: {
          beads: {
            enabled: true,
            auto_sync: true,
            default_sync_direction: "invalid",
            conflict_resolution: "newest-wins",
            options: { path: ".beads" },
          },
        },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations" && layer.route?.methods.put
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid integrations configuration",
          errors: expect.arrayContaining([
            expect.stringContaining("sync_direction"),
          ]),
        })
      );
    });

    it("should save valid configuration and return warnings", async () => {
      const { req, res } = createMockReqRes({
        body: {
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: "../other/.beads" },
          },
        },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ version: "0.1.0" })
      );

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations" && layer.route?.methods.put
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/test/project/.sudocode/config.json",
        expect.stringContaining('"integrations"'),
        "utf-8"
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          integrations: req.body,
        })
      );
    });

    it("should merge with existing config", async () => {
      const { req, res } = createMockReqRes({
        body: {
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: "../other/.beads" },
          },
        },
      });

      const existingConfig = {
        version: "0.1.0",
        worktree: { autoCreateBranches: true },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingConfig));

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations" && layer.route?.methods.put
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      // Verify writeFileSync was called with merged config
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);

      expect(writtenConfig.version).toBe("0.1.0");
      expect(writtenConfig.worktree).toEqual({ autoCreateBranches: true });
      expect(writtenConfig.integrations).toEqual(req.body);
    });
  });

  describe("POST /integrations/:provider/test", () => {
    it("should return 404 for unconfigured provider", async () => {
      const { req, res } = createMockReqRes({
        params: { provider: "beads" },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations/:provider/test" &&
          layer.route?.methods.post
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("not configured"),
        })
      );
    });

    it("should return disabled status for disabled provider", async () => {
      const { req, res } = createMockReqRes({
        params: { provider: "beads" },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: false,
              auto_sync: false,
              default_sync_direction: "bidirectional",
              conflict_resolution: "newest-wins",
              options: { path: "../other/.beads" },
            },
          },
        })
      );

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations/:provider/test" &&
          layer.route?.methods.post
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          configured: true,
          enabled: false,
        })
      );
    });

    it("should delegate to plugin for testing enabled provider", async () => {
      const { req, res } = createMockReqRes({
        params: { provider: "beads" },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "bidirectional",
              conflict_resolution: "newest-wins",
              options: { path: "../other/.beads" },
            },
          },
        })
      );

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations/:provider/test" &&
          layer.route?.methods.post
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          configured: true,
          enabled: true,
        })
      );
    });

    it("should test custom plugin provider", async () => {
      const { req, res } = createMockReqRes({
        params: { provider: "custom-provider" },
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          integrations: {
            "custom-provider": {
              plugin: "@company/sudocode-integration-custom",
              enabled: true,
              auto_sync: false,
              default_sync_direction: "outbound",
              conflict_resolution: "manual",
              options: { apiKey: "secret" },
            },
          },
        })
      );

      const handler = router.stack.find(
        (layer) =>
          layer.route?.path === "/integrations/:provider/test" &&
          layer.route?.methods.post
      )?.route?.stack[0].handle;

      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          configured: true,
          enabled: true,
        })
      );
    });
  });
});
