/**
 * Tests for Issues API DELETE endpoint - External Link Propagation
 *
 * Tests that deleting an issue with external links properly propagates
 * the deletion to external systems via the IntegrationSyncService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";

// Mock the modules before importing
vi.mock("@sudocode-ai/cli/dist/id-generator.js", () => ({
  generateIssueId: vi.fn(),
}));

vi.mock("@sudocode-ai/cli/dist/operations/external-links.js", () => ({
  getIssueFromJsonl: vi.fn(),
}));

vi.mock("../../../src/services/issues.js", () => ({
  getAllIssues: vi.fn(),
  getIssueById: vi.fn(),
  createNewIssue: vi.fn(),
  updateExistingIssue: vi.fn(),
  deleteExistingIssue: vi.fn(),
}));

vi.mock("../../../src/services/websocket.js", () => ({
  broadcastIssueUpdate: vi.fn(),
}));

vi.mock("../../../src/services/export.js", () => ({
  triggerExport: vi.fn(),
  executeExportNow: vi.fn(),
  syncEntityToMarkdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { createIssuesRouter } from "../../../src/routes/issues.js";
import {
  getIssueById,
  deleteExistingIssue,
} from "../../../src/services/issues.js";
import { getIssueFromJsonl } from "@sudocode-ai/cli/dist/operations/external-links.js";
import { broadcastIssueUpdate } from "../../../src/services/websocket.js";
import { triggerExport } from "../../../src/services/export.js";
import { existsSync } from "fs";

const mockGetIssueById = vi.mocked(getIssueById);
const mockDeleteExistingIssue = vi.mocked(deleteExistingIssue);
const mockGetIssueFromJsonl = vi.mocked(getIssueFromJsonl);
const mockBroadcastIssueUpdate = vi.mocked(broadcastIssueUpdate);
const mockTriggerExport = vi.mocked(triggerExport);
const mockExistsSync = vi.mocked(existsSync);

describe("Issues DELETE Route - External Link Propagation", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockIntegrationSyncService: {
    handleEntityDeleted: ReturnType<typeof vi.fn>;
  };
  let router: ReturnType<typeof createIssuesRouter>;
  let deleteHandler: (req: Request, res: Response) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock integration sync service
    mockIntegrationSyncService = {
      handleEntityDeleted: vi.fn().mockResolvedValue([]),
    };

    // Create mock response
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    // Create router and extract delete handler
    router = createIssuesRouter();
    // Find the DELETE /:id route handler
    const deleteRoute = (router as any).stack.find(
      (layer: any) =>
        layer.route?.path === "/:id" &&
        layer.route?.methods?.delete
    );
    deleteHandler = deleteRoute.route.stack[0].handle;

    // Default mock implementations
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("when issue has external links and integrationSyncService exists", () => {
    beforeEach(() => {
      const externalLinks = [
        {
          provider: "beads",
          external_id: "beads-123",
          sync_enabled: true,
          sync_direction: "bidirectional" as const,
        },
        {
          provider: "jira",
          external_id: "PROJ-456",
          sync_enabled: true,
          sync_direction: "outbound" as const,
        },
      ];

      mockGetIssueById.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      });

      mockGetIssueFromJsonl.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
        external_links: externalLinks,
      });

      mockDeleteExistingIssue.mockReturnValue(true);
    });

    it("should propagate deletion to external systems", async () => {
      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Verify handleEntityDeleted was called with the external links
      expect(mockIntegrationSyncService.handleEntityDeleted).toHaveBeenCalledWith(
        "i-test",
        expect.arrayContaining([
          expect.objectContaining({
            provider: "beads",
            external_id: "beads-123",
          }),
          expect.objectContaining({
            provider: "jira",
            external_id: "PROJ-456",
          }),
        ])
      );

      // Verify the issue was deleted
      expect(mockDeleteExistingIssue).toHaveBeenCalledWith({}, "i-test");

      // Verify success response
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "i-test", deleted: true },
      });
    });

    it("should read external links from JSONL before deleting", async () => {
      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Verify getIssueFromJsonl was called before delete
      expect(mockGetIssueFromJsonl).toHaveBeenCalledWith("/test/.sudocode", "i-test");

      // The order matters: read links -> delete issue -> propagate
      const getIssueFromJsonlCallOrder = mockGetIssueFromJsonl.mock.invocationCallOrder[0];
      const deleteCallOrder = mockDeleteExistingIssue.mock.invocationCallOrder[0];
      expect(getIssueFromJsonlCallOrder).toBeLessThan(deleteCallOrder);
    });

    it("should still delete successfully even if propagation fails", async () => {
      mockIntegrationSyncService.handleEntityDeleted.mockRejectedValue(
        new Error("Propagation failed")
      );

      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Propagation error should be caught and logged, but delete should still succeed
      expect(mockDeleteExistingIssue).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "i-test", deleted: true },
      });
    });
  });

  describe("when issue has external links but no integrationSyncService", () => {
    beforeEach(() => {
      mockGetIssueById.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      });

      mockGetIssueFromJsonl.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
        external_links: [
          {
            provider: "beads",
            external_id: "beads-123",
            sync_enabled: true,
          },
        ],
      });

      mockDeleteExistingIssue.mockReturnValue(true);
    });

    it("should delete successfully without propagation", async () => {
      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          // No integrationSyncService
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Issue should still be deleted
      expect(mockDeleteExistingIssue).toHaveBeenCalledWith({}, "i-test");
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "i-test", deleted: true },
      });
    });
  });

  describe("when issue has no external links", () => {
    beforeEach(() => {
      mockGetIssueById.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      });

      mockGetIssueFromJsonl.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
        // No external_links
      });

      mockDeleteExistingIssue.mockReturnValue(true);
    });

    it("should delete without calling handleEntityDeleted", async () => {
      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Should not try to propagate when there are no external links
      expect(mockIntegrationSyncService.handleEntityDeleted).not.toHaveBeenCalled();

      // Issue should still be deleted
      expect(mockDeleteExistingIssue).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "i-test", deleted: true },
      });
    });
  });

  describe("when issue not found", () => {
    beforeEach(() => {
      mockGetIssueById.mockReturnValue(null);
    });

    it("should return 404", async () => {
      mockRequest = {
        params: { id: "i-nonexistent" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        message: "Issue not found: i-nonexistent",
      });

      // Should not attempt deletion or propagation
      expect(mockDeleteExistingIssue).not.toHaveBeenCalled();
      expect(mockIntegrationSyncService.handleEntityDeleted).not.toHaveBeenCalled();
    });
  });

  describe("when JSONL returns null (no data in file)", () => {
    beforeEach(() => {
      mockGetIssueById.mockReturnValue({
        id: "i-test",
        uuid: "uuid-test",
        title: "Test Issue",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      });

      mockGetIssueFromJsonl.mockReturnValue(null);
      mockDeleteExistingIssue.mockReturnValue(true);
    });

    it("should delete without propagation when JSONL is empty", async () => {
      mockRequest = {
        params: { id: "i-test" },
        project: {
          id: "proj-1",
          db: {} as any,
          sudocodeDir: "/test/.sudocode",
          integrationSyncService: mockIntegrationSyncService as any,
        },
      };

      await deleteHandler(mockRequest as Request, mockResponse as Response);

      // Should not try to propagate when JSONL returns null
      expect(mockIntegrationSyncService.handleEntityDeleted).not.toHaveBeenCalled();

      // Issue should still be deleted
      expect(mockDeleteExistingIssue).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "i-test", deleted: true },
      });
    });
  });
});
