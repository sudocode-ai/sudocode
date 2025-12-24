/**
 * Tests for import API routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createImportRouter } from "../../../src/routes/import.js";
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

// Mock provider that supports on-demand import
const mockOnDemandProvider = {
  name: "github",
  supportsWatch: false,
  supportsPolling: false,
  supportsOnDemandImport: true,
  supportsSearch: true,
  supportsPush: false,
  initialize: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  canHandleUrl: vi.fn((url: string) => url.includes("github.com")),
  parseUrl: vi.fn((url: string) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (match) {
      return { externalId: `${match[1]}/${match[2]}#${match[3]}` };
    }
    return null;
  }),
  fetchByUrl: vi.fn(),
  fetchComments: vi.fn(),
  fetchEntity: vi.fn(),
  searchEntities: vi.fn(),
  createEntity: vi.fn(),
  updateEntity: vi.fn(),
  getChangesSince: vi.fn(),
  mapToSudocode: vi.fn(),
  mapFromSudocode: vi.fn(),
};

// Mock plugin loader
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
        createProvider: () => mockOnDemandProvider,
      };
    }
    return null;
  }),
  testProviderConnection: vi.fn(async () => ({
    success: true,
    configured: true,
    enabled: true,
    details: { mocked: true },
  })),
}));

// Mock external-links operations
vi.mock("@sudocode-ai/cli/dist/operations/external-links.js", () => ({
  findSpecsByExternalLink: vi.fn(() => []),
  findIssuesByExternalLink: vi.fn(() => []),
  createSpecFromExternal: vi.fn((sudocodeDir: string, input: any) => ({
    id: "s-test123",
    uuid: "test-uuid-123",
    title: input.title,
    content: input.content,
    file_path: `specs/s-test123.md`,
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

// Mock issue operations
vi.mock("@sudocode-ai/cli/dist/operations/issues.js", () => ({
  createIssue: vi.fn((db: any, input: any) => ({
    id: input.id,
    uuid: input.uuid,
    title: input.title,
    content: input.content,
    status: input.status,
    priority: input.priority,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
}));

// Mock feedback operations
vi.mock("@sudocode-ai/cli/dist/operations/feedback.js", () => ({
  createFeedback: vi.fn((db: any, input: any) => ({
    id: `feedback-${Date.now()}`,
    from_id: input.from_id,
    from_uuid: "mock-from-uuid",
    to_id: input.to_id,
    to_uuid: "mock-to-uuid",
    feedback_type: input.feedback_type,
    content: input.content,
    agent: input.agent,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
}));

// Mock id-generator
vi.mock("@sudocode-ai/cli/dist/id-generator.js", () => ({
  generateIssueId: vi.fn(() => ({
    id: "i-import1",
    uuid: "import-uuid-123",
  })),
}));

// Mock export service
vi.mock("../../../src/services/export.js", () => ({
  triggerExport: vi.fn(),
  syncEntityToMarkdown: vi.fn().mockResolvedValue(undefined),
}));

// Mock websocket service
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastSpecUpdate: vi.fn(),
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
  router: ReturnType<typeof createImportRouter>,
  path: string,
  method: "get" | "post" | "put" | "delete"
) {
  return router.stack.find(
    (layer) => layer.route?.path === path && layer.route?.methods[method]
  )?.route?.stack[0].handle;
}

describe("Import Router", () => {
  let router: ReturnType<typeof createImportRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createImportRouter();

    // Setup default mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /providers", () => {
    it("should list available import providers", async () => {
      const { req, res } = createMockReqRes();

      const handler = findHandler(router, "/providers", "get");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            providers: expect.arrayContaining([
              expect.objectContaining({
                name: "github",
                displayName: "GitHub",
                supportsOnDemandImport: true,
                supportsSearch: true,
                configured: true,
                authMethod: "gh-cli",
              }),
            ]),
          }),
        })
      );
    });

    it("should only include providers that support on-demand import", async () => {
      const { req, res } = createMockReqRes();

      const handler = findHandler(router, "/providers", "get");
      await handler!(req, res, () => {});

      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.data.providers.every((p: any) => p.supportsOnDemandImport)).toBe(true);
    });
  });

  describe("POST /preview", () => {
    it("should return 400 if URL is missing", async () => {
      const { req, res } = createMockReqRes({ body: {} });

      const handler = findHandler(router, "/preview", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "URL is required",
        })
      );
    });

    it("should return 422 if no provider can handle the URL", async () => {
      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(false);

      const { req, res } = createMockReqRes({
        body: { url: "https://unknown.com/issue/123" },
      });

      const handler = findHandler(router, "/preview", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "No provider found",
        })
      );
    });

    it("should return 404 if entity is not found", async () => {
      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(null);

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/999" },
      });

      const handler = findHandler(router, "/preview", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "Entity not found",
        })
      );
    });

    it("should return preview data for valid URL", async () => {
      const mockEntity = {
        id: "owner/repo#123",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
        status: "open",
        url: "https://github.com/owner/repo/issues/123",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);
      mockOnDemandProvider.fetchComments.mockResolvedValueOnce([
        { id: "c1", author: "user", body: "comment 1", created_at: "2024-01-01" },
        { id: "c2", author: "user", body: "comment 2", created_at: "2024-01-02" },
      ]);

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/123" },
      });

      const handler = findHandler(router, "/preview", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            provider: "github",
            entity: mockEntity,
            commentsCount: 2,
          }),
        })
      );
    });

    it("should detect already imported entities", async () => {
      const mockEntity = {
        id: "owner/repo#123",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      // Mock that entity is already imported
      const { findSpecsByExternalLink } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValueOnce([
        {
          id: "s-existing",
          uuid: "existing-uuid",
          title: "Existing Spec",
          file_path: "specs/s-existing.md",
          content: "",
          priority: 2,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          external_links: [
            {
              provider: "github",
              external_id: "owner/repo#123",
              sync_enabled: true,
              sync_direction: "inbound",
              last_synced_at: "2024-01-01T00:00:00Z",
            },
          ],
          relationships: [],
          tags: [],
        },
      ]);

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/123" },
      });

      const handler = findHandler(router, "/preview", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            alreadyLinked: expect.objectContaining({
              entityId: "s-existing",
              entityType: "spec",
              lastSyncedAt: "2024-01-01T00:00:00Z",
            }),
          }),
        })
      );
    });
  });

  describe("POST /", () => {
    it("should return 400 if URL is missing", async () => {
      const { req, res } = createMockReqRes({ body: {} });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "URL is required",
        })
      );
    });

    it("should return 422 if no provider can handle the URL", async () => {
      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(false);

      const { req, res } = createMockReqRes({
        body: { url: "https://unknown.com/issue/123" },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it("should return 404 if entity is not found", async () => {
      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(null);

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/999" },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 409 if entity is already imported", async () => {
      const mockEntity = {
        id: "owner/repo#123",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      // Mock that entity is already imported
      const { findSpecsByExternalLink } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValueOnce([
        {
          id: "s-existing",
          uuid: "existing-uuid",
          title: "Existing Spec",
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

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/123" },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "Already imported",
          data: expect.objectContaining({
            entityId: "s-existing",
            entityType: "spec",
          }),
        })
      );
    });

    it("should successfully import entity and create spec", async () => {
      const mockEntity = {
        id: "owner/repo#123",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
        status: "open",
        url: "https://github.com/owner/repo/issues/123",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/123" },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            entityId: "s-test123",
            entityType: "spec",
            externalLink: expect.objectContaining({
              provider: "github",
              external_id: "owner/repo#123",
              sync_enabled: true,
              sync_direction: "inbound",
              content_hash: expect.any(String),
              imported_at: expect.any(String),
            }),
          }),
        })
      );
    });

    it("should import comments as IssueFeedback when includeComments requested", async () => {
      const mockEntity = {
        id: "owner/repo#123",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
        url: "https://github.com/owner/repo/issues/123",
      };

      const mockComments = [
        { id: "c1", author: "user1", body: "First comment", created_at: "2024-01-01T10:00:00Z", url: "https://github.com/owner/repo/issues/123#issuecomment-1" },
        { id: "c2", author: "user2", body: "Second comment", created_at: "2024-01-02T12:00:00Z", url: "https://github.com/owner/repo/issues/123#issuecomment-2" },
      ];

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);
      mockOnDemandProvider.fetchComments.mockResolvedValueOnce(mockComments);

      const { createIssue } = await import("@sudocode-ai/cli/dist/operations/issues.js");
      const { createFeedback } = await import("@sudocode-ai/cli/dist/operations/feedback.js");
      const { generateIssueId } = await import("@sudocode-ai/cli/dist/id-generator.js");

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/123",
          options: { includeComments: true },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);

      // Verify placeholder issue was created
      expect(vi.mocked(generateIssueId)).toHaveBeenCalled();
      expect(vi.mocked(createIssue)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: "i-import1",
          uuid: "import-uuid-123",
          title: expect.stringContaining("Imported comments for:"),
          status: "closed",
          priority: 4,
        })
      );

      // Verify feedback was created for each comment
      expect(vi.mocked(createFeedback)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(createFeedback)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          from_id: "i-import1",
          to_id: "s-test123",
          feedback_type: "comment",
          agent: "import",
          content: expect.stringContaining("@user1"),
        })
      );
      expect(vi.mocked(createFeedback)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          from_id: "i-import1",
          to_id: "s-test123",
          feedback_type: "comment",
          agent: "import",
          content: expect.stringContaining("@user2"),
        })
      );

      // Verify response includes feedbackCount
      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.data.feedbackCount).toBe(2);
    });

    it("should not import comments when includeComments is false", async () => {
      const mockEntity = {
        id: "owner/repo#456",
        type: "issue" as const,
        title: "Test Issue Without Comments",
        description: "Test description",
        url: "https://github.com/owner/repo/issues/456",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      const { createIssue } = await import("@sudocode-ai/cli/dist/operations/issues.js");
      const { createFeedback } = await import("@sudocode-ai/cli/dist/operations/feedback.js");

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/456",
          options: { includeComments: false },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);

      // Verify no placeholder issue or feedback was created
      expect(vi.mocked(createIssue)).not.toHaveBeenCalled();
      expect(vi.mocked(createFeedback)).not.toHaveBeenCalled();

      // Verify response does not include feedbackCount
      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.data.feedbackCount).toBeUndefined();
    });

    it("should handle empty comments array gracefully", async () => {
      const mockEntity = {
        id: "owner/repo#789",
        type: "issue" as const,
        title: "Issue With No Comments",
        description: "Test description",
        url: "https://github.com/owner/repo/issues/789",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);
      mockOnDemandProvider.fetchComments.mockResolvedValueOnce([]);

      const { createIssue } = await import("@sudocode-ai/cli/dist/operations/issues.js");
      const { createFeedback } = await import("@sudocode-ai/cli/dist/operations/feedback.js");

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/789",
          options: { includeComments: true },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);

      // Verify no placeholder issue or feedback was created for empty comments
      expect(vi.mocked(createIssue)).not.toHaveBeenCalled();
      expect(vi.mocked(createFeedback)).not.toHaveBeenCalled();

      // Verify response does not include feedbackCount when no comments
      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.data.feedbackCount).toBeUndefined();
    });

    it("should preserve comment timestamps in feedback", async () => {
      const mockEntity = {
        id: "owner/repo#101",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
        url: "https://github.com/owner/repo/issues/101",
      };

      const originalTimestamp = "2023-06-15T14:30:00Z";
      const mockComments = [
        { id: "c1", author: "user1", body: "Historical comment", created_at: originalTimestamp },
      ];

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);
      mockOnDemandProvider.fetchComments.mockResolvedValueOnce(mockComments);

      const { createFeedback } = await import("@sudocode-ai/cli/dist/operations/feedback.js");

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/101",
          options: { includeComments: true },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);

      // Verify original timestamp is preserved
      expect(vi.mocked(createFeedback)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          created_at: originalTimestamp,
        })
      );
    });

    it("should format comment content with author attribution", async () => {
      const mockEntity = {
        id: "owner/repo#102",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test description",
        url: "https://github.com/owner/repo/issues/102",
      };

      const mockComments = [
        {
          id: "c1",
          author: "testuser",
          body: "This is the comment body",
          created_at: "2024-03-15T10:00:00Z",
          url: "https://github.com/owner/repo/issues/102#issuecomment-1",
        },
      ];

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);
      mockOnDemandProvider.fetchComments.mockResolvedValueOnce(mockComments);

      const { createFeedback } = await import("@sudocode-ai/cli/dist/operations/feedback.js");

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/102",
          options: { includeComments: true },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(201);

      // Verify content format includes author, date, body, and import attribution
      expect(vi.mocked(createFeedback)).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          content: expect.stringMatching(/@testuser.*commented.*This is the comment body.*Imported from/s),
        })
      );
    });

    it("should respect priority option", async () => {
      const mockEntity = {
        id: "owner/repo#456",
        type: "issue" as const,
        title: "High Priority Issue",
        description: "Important issue",
        url: "https://github.com/owner/repo/issues/456",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      const { createSpecFromExternal } = await import(
        "@sudocode-ai/cli/dist/operations/external-links.js"
      );

      const { req, res } = createMockReqRes({
        body: {
          url: "https://github.com/owner/repo/issues/456",
          options: { priority: 0 },
        },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(vi.mocked(createSpecFromExternal)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          priority: 0,
        })
      );
    });

    it("should trigger export and broadcast after import", async () => {
      const mockEntity = {
        id: "owner/repo#789",
        type: "issue" as const,
        title: "Test Issue",
        description: "Test",
        url: "https://github.com/owner/repo/issues/789",
      };

      mockOnDemandProvider.canHandleUrl.mockReturnValueOnce(true);
      mockOnDemandProvider.fetchByUrl.mockResolvedValueOnce(mockEntity);

      const { triggerExport } = await import("../../../src/services/export.js");
      const { broadcastSpecUpdate } = await import("../../../src/services/websocket.js");

      const { req, res } = createMockReqRes({
        body: { url: "https://github.com/owner/repo/issues/789" },
      });

      const handler = findHandler(router, "/", "post");
      await handler!(req, res, () => {});

      expect(vi.mocked(triggerExport)).toHaveBeenCalled();
      expect(vi.mocked(broadcastSpecUpdate)).toHaveBeenCalledWith(
        "test-project",
        "s-test123",
        "created",
        expect.any(Object)
      );
    });
  });
});
