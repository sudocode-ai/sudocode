/**
 * Integration tests for import API flow
 *
 * Tests the complete import workflow from URL to spec creation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createImportRouter } from "../../src/routes/import.js";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

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

// Track mock state
let mockConfigData: Record<string, unknown> = {};
let mockSpecsData: string[] = [];
let mockIssuesData: string[] = [];

// Mock provider
const mockProvider = {
  name: "github",
  supportsWatch: false,
  supportsPolling: false,
  supportsOnDemandImport: true,
  supportsSearch: true,
  supportsPush: false,
  initialize: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  canHandleUrl: vi.fn((url: string) => url.includes("github.com")),
  parseUrl: vi.fn(),
  fetchByUrl: vi.fn(),
  fetchComments: vi.fn().mockResolvedValue([]),
  fetchEntity: vi.fn(),
  searchEntities: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  getChangesSince: vi.fn(),
  mapToSudocode: vi.fn(),
  mapFromSudocode: vi.fn(),
};

// Mock the plugin loader
vi.mock("@sudocode-ai/cli/dist/integrations/index.js", () => ({
  getFirstPartyPlugins: vi.fn(() => [
    { name: "github", package: "@sudocode-ai/integration-github" },
  ]),
  loadPlugin: vi.fn(async (name: string) => {
    if (name === "github") {
      return {
        name: "github",
        displayName: "GitHub",
        version: "0.1.0",
        description: "GitHub integration plugin",
        validateConfig: () => ({ valid: true, errors: [], warnings: [] }),
        testConnection: async () => ({
          success: true,
          configured: true,
          enabled: true,
        }),
        createProvider: () => mockProvider,
      };
    }
    return null;
  }),
  testProviderConnection: vi.fn(async () => ({
    success: true,
    configured: true,
    enabled: true,
  })),
}));

// Mock JSONL operations
vi.mock("@sudocode-ai/cli/dist/operations/external-links.js", () => ({
  findSpecsByExternalLink: vi.fn(() => []),
  findIssuesByExternalLink: vi.fn(() => []),
  createSpecFromExternal: vi.fn((sudocodeDir: string, input: any) => ({
    id: "s-import1",
    uuid: "import-uuid-123",
    title: input.title,
    content: input.content || "",
    file_path: `specs/s-import1.md`,
    priority: input.priority || 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    external_links: [
      {
        provider: input.external.provider,
        external_id: input.external.external_id,
        sync_enabled: true,
        sync_direction: input.external.sync_direction,
      },
    ],
    relationships: [],
    tags: [],
  })),
}));

// Mock export service
vi.mock("../../src/services/export.js", () => ({
  triggerExport: vi.fn(),
  syncEntityToMarkdown: vi.fn().mockResolvedValue(undefined),
}));

// Mock websocket service
vi.mock("../../src/services/websocket.js", () => ({
  broadcastSpecUpdate: vi.fn(),
}));


describe("Import Flow Integration", () => {
  let app: express.Application;
  let testProjectDir: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test app
    app = express();
    app.use(express.json());

    // Mock project middleware
    app.use((req, _res, next) => {
      testProjectDir = path.join(tmpdir(), "test-sudocode");
      (req as any).project = {
        id: "test-project",
        path: testProjectDir,
        sudocodeDir: path.join(testProjectDir, ".sudocode"),
        db: {},
      };
      next();
    });

    app.use("/api/import", createImportRouter());

    // Setup fs mocks
    vi.mocked(fs.existsSync).mockImplementation((p: string | Buffer | URL) => {
      const pathStr = p.toString();
      if (pathStr.includes("config.json")) return true;
      if (pathStr.includes("specs.jsonl")) return true;
      if (pathStr.includes("issues.jsonl")) return true;
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((p: string | Buffer | URL) => {
      const pathStr = p.toString();
      if (pathStr.includes("config.json")) {
        return JSON.stringify(mockConfigData);
      }
      if (pathStr.includes("specs.jsonl")) {
        return mockSpecsData.join("\n");
      }
      if (pathStr.includes("issues.jsonl")) {
        return mockIssuesData.join("\n");
      }
      return "";
    });

    // Reset mock data
    mockConfigData = {};
    mockSpecsData = [];
    mockIssuesData = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/import/providers", () => {
    it("should return list of providers supporting on-demand import", async () => {
      const response = await request(app)
        .get("/api/import/providers")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.providers).toHaveLength(1);
      expect(response.body.data.providers[0]).toMatchObject({
        name: "github",
        displayName: "GitHub",
        supportsOnDemandImport: true,
        configured: true,
        authMethod: "gh-cli",
      });
    });
  });

  describe("POST /api/import/preview", () => {
    it("should return preview for valid GitHub URL", async () => {
      const mockEntity = {
        id: "octocat/hello-world#42",
        type: "issue" as const,
        title: "Found a bug",
        description: "Something is broken",
        status: "open",
        url: "https://github.com/octocat/hello-world/issues/42",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T00:00:00Z",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);
      mockProvider.fetchComments.mockResolvedValue([
        { id: "c1", author: "user", body: "test", created_at: "2024-01-01" },
      ]);

      const response = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://github.com/octocat/hello-world/issues/42" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.provider).toBe("github");
      expect(response.body.data.entity.title).toBe("Found a bug");
      expect(response.body.data.commentsCount).toBe(1);
      expect(response.body.data.alreadyLinked).toBeUndefined();
    });

    it("should indicate if entity is already imported", async () => {
      const mockEntity = {
        id: "octocat/hello-world#42",
        type: "issue" as const,
        title: "Found a bug",
        description: "Something is broken",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      // Mock already imported
      const { findSpecsByExternalLink } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValueOnce([
        {
          id: "s-existing",
          uuid: "uuid-existing",
          title: "Found a bug",
          file_path: "specs/s-existing.md",
          content: "",
          priority: 2,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          external_links: [
            {
              provider: "github",
              external_id: "octocat/hello-world#42",
              sync_enabled: true,
              sync_direction: "inbound",
              last_synced_at: "2024-01-10T00:00:00Z",
            },
          ],
          relationships: [],
          tags: [],
        },
      ]);

      const response = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://github.com/octocat/hello-world/issues/42" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.alreadyLinked).toMatchObject({
        entityId: "s-existing",
        entityType: "spec",
        lastSyncedAt: "2024-01-10T00:00:00Z",
      });
    });

    it("should return 400 for missing URL", async () => {
      const response = await request(app)
        .post("/api/import/preview")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("URL is required");
    });

    it("should return 422 for unsupported URL", async () => {
      mockProvider.canHandleUrl.mockReturnValue(false);

      const response = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://unsupported.com/issue/1" })
        .expect(422);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("No provider found");
    });

    it("should return 404 when entity not found", async () => {
      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://github.com/octocat/hello-world/issues/99999" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Entity not found");
    });
  });

  describe("POST /api/import", () => {
    it("should import GitHub issue and create spec", async () => {
      const mockEntity = {
        id: "octocat/hello-world#42",
        type: "issue" as const,
        title: "Found a bug",
        description: "Something is broken",
        status: "open",
        priority: 1,
        url: "https://github.com/octocat/hello-world/issues/42",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T00:00:00Z",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const response = await request(app)
        .post("/api/import")
        .send({ url: "https://github.com/octocat/hello-world/issues/42" })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.entityId).toBe("s-import1");
      expect(response.body.data.entityType).toBe("spec");
      expect(response.body.data.externalLink).toMatchObject({
        provider: "github",
        external_id: "octocat/hello-world#42",
        sync_enabled: true,
        sync_direction: "inbound",
      });
      expect(response.body.data.externalLink.content_hash).toBeDefined();
      expect(response.body.data.externalLink.imported_at).toBeDefined();
    });

    it("should import with custom priority", async () => {
      const mockEntity = {
        id: "octocat/hello-world#43",
        type: "issue" as const,
        title: "High priority issue",
        description: "Urgent fix needed",
        url: "https://github.com/octocat/hello-world/issues/43",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const { createSpecFromExternal } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );

      await request(app)
        .post("/api/import")
        .send({
          url: "https://github.com/octocat/hello-world/issues/43",
          options: { priority: 0 },
        })
        .expect(201);

      expect(vi.mocked(createSpecFromExternal)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          priority: 0,
        })
      );
    });

    it("should count comments when includeComments requested", async () => {
      const mockEntity = {
        id: "octocat/hello-world#44",
        type: "issue" as const,
        title: "Issue with comments",
        description: "Needs discussion",
        url: "https://github.com/octocat/hello-world/issues/44",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);
      mockProvider.fetchComments.mockResolvedValue([
        { id: "c1", author: "alice", body: "First comment", created_at: "2024-01-01" },
        { id: "c2", author: "bob", body: "Second comment", created_at: "2024-01-02" },
        { id: "c3", author: "charlie", body: "Third comment", created_at: "2024-01-03" },
      ]);

      const response = await request(app)
        .post("/api/import")
        .send({
          url: "https://github.com/octocat/hello-world/issues/44",
          options: { includeComments: true },
        })
        .expect(201);

      // Comments are counted but not yet imported as feedback (future enhancement)
      expect(response.body.data.feedbackCount).toBe(3);
    });

    it("should return 409 for duplicate import", async () => {
      const mockEntity = {
        id: "octocat/hello-world#42",
        type: "issue" as const,
        title: "Found a bug",
        description: "Something is broken",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const { findSpecsByExternalLink } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValueOnce([
        {
          id: "s-existing",
          uuid: "uuid-existing",
          title: "Found a bug",
          file_path: "specs/s-existing.md",
          content: "",
          priority: 2,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          external_links: [],
          relationships: [],
          tags: [],
        },
      ]);

      const response = await request(app)
        .post("/api/import")
        .send({ url: "https://github.com/octocat/hello-world/issues/42" })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Already imported");
      expect(response.body.data.entityId).toBe("s-existing");
    });

    it("should trigger export and broadcast after successful import", async () => {
      const mockEntity = {
        id: "octocat/hello-world#45",
        type: "issue" as const,
        title: "New feature",
        description: "Feature request",
        url: "https://github.com/octocat/hello-world/issues/45",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const { triggerExport, syncEntityToMarkdown } = await import(
        "../../src/services/export.js"
      );
      const { broadcastSpecUpdate } = await import(
        "../../src/services/websocket.js"
      );

      await request(app)
        .post("/api/import")
        .send({ url: "https://github.com/octocat/hello-world/issues/45" })
        .expect(201);

      expect(vi.mocked(triggerExport)).toHaveBeenCalled();
      expect(vi.mocked(syncEntityToMarkdown)).toHaveBeenCalledWith(
        expect.anything(),
        "s-import1",
        "spec",
        expect.any(String)
      );
      expect(vi.mocked(broadcastSpecUpdate)).toHaveBeenCalledWith(
        "test-project",
        "s-import1",
        "created",
        expect.any(Object)
      );
    });

    it("should store content hash for change detection", async () => {
      const mockEntity = {
        id: "octocat/hello-world#46",
        type: "issue" as const,
        title: "Track changes",
        description: "Content for hashing",
        url: "https://github.com/octocat/hello-world/issues/46",
        updated_at: "2024-01-15T00:00:00Z",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const response = await request(app)
        .post("/api/import")
        .send({ url: "https://github.com/octocat/hello-world/issues/46" })
        .expect(201);

      // Content hash should be a SHA256 hex string (64 characters)
      expect(response.body.data.externalLink.content_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should include import metadata", async () => {
      const mockEntity = {
        id: "octocat/hello-world#47",
        type: "issue" as const,
        title: "Issue with metadata",
        description: "Description",
        status: "open",
        url: "https://github.com/octocat/hello-world/issues/47",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);

      const response = await request(app)
        .post("/api/import")
        .send({ url: "https://github.com/octocat/hello-world/issues/47" })
        .expect(201);

      expect(response.body.data.externalLink.import_metadata).toMatchObject({
        imported_by: "api",
        original_status: "open",
        original_type: "issue",
      });
    });
  });

  describe("Complete Import Flow", () => {
    it("should handle complete preview -> import flow", async () => {
      const mockEntity = {
        id: "octocat/hello-world#100",
        type: "issue" as const,
        title: "Complete flow test",
        description: "Testing the complete import flow",
        status: "open",
        url: "https://github.com/octocat/hello-world/issues/100",
        updated_at: "2024-01-15T00:00:00Z",
      };

      mockProvider.canHandleUrl.mockReturnValue(true);
      mockProvider.fetchByUrl.mockResolvedValue(mockEntity);
      mockProvider.fetchComments.mockResolvedValue([
        { id: "c1", author: "user", body: "Looks good!", created_at: "2024-01-10" },
      ]);

      // Step 1: Preview
      const previewResponse = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://github.com/octocat/hello-world/issues/100" })
        .expect(200);

      expect(previewResponse.body.success).toBe(true);
      expect(previewResponse.body.data.provider).toBe("github");
      expect(previewResponse.body.data.entity.title).toBe("Complete flow test");
      expect(previewResponse.body.data.commentsCount).toBe(1);
      expect(previewResponse.body.data.alreadyLinked).toBeUndefined();

      // Step 2: Import
      const importResponse = await request(app)
        .post("/api/import")
        .send({
          url: "https://github.com/octocat/hello-world/issues/100",
          options: { includeComments: true },
        })
        .expect(201);

      expect(importResponse.body.success).toBe(true);
      expect(importResponse.body.data.entityType).toBe("spec");
      expect(importResponse.body.data.feedbackCount).toBe(1);

      // Step 3: Verify duplicate detection on subsequent preview
      const { findSpecsByExternalLink } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValueOnce([
        {
          id: importResponse.body.data.entityId,
          uuid: "uuid",
          title: "Complete flow test",
          file_path: "specs/s-import1.md",
          content: "",
          priority: 2,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          external_links: [
            {
              provider: "github",
              external_id: "octocat/hello-world#100",
              sync_enabled: true,
              sync_direction: "inbound",
              last_synced_at: new Date().toISOString(),
            },
          ],
          relationships: [],
          tags: [],
        },
      ]);

      const duplicatePreview = await request(app)
        .post("/api/import/preview")
        .send({ url: "https://github.com/octocat/hello-world/issues/100" })
        .expect(200);

      expect(duplicatePreview.body.data.alreadyLinked).toBeDefined();
      expect(duplicatePreview.body.data.alreadyLinked.entityId).toBe(
        importResponse.body.data.entityId
      );
    });
  });
});
