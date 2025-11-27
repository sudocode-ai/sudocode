/**
 * Tests for files API routes
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFilesRouter } from "../../../src/routes/files.js"
import type { Request, Response } from "express"
import { fileSearchRegistry } from "../../../src/services/file-search/index.js"
import type {
  FileSearchStrategy,
  FileSearchOptions,
  FileSearchResult,
} from "../../../src/services/file-search/strategy.js"

// Mock strategy for testing
class MockFileSearchStrategy implements FileSearchStrategy {
  searchMock = vi.fn<
    [string, FileSearchOptions],
    Promise<FileSearchResult[]>
  >()

  getName(): string {
    return "mock-strategy"
  }

  async search(
    workspacePath: string,
    options: FileSearchOptions
  ): Promise<FileSearchResult[]> {
    return this.searchMock(workspacePath, options)
  }
}

// Helper to create mock request/response
function createMockReqRes() {
  const req = {
    query: {},
    project: {
      path: "/test/workspace",
    },
  } as unknown as Request

  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response

  return { req, res }
}

describe("Files Router", () => {
  let mockStrategy: MockFileSearchStrategy
  let router: ReturnType<typeof createFilesRouter>

  beforeEach(() => {
    // Clear registry and register mock strategy
    fileSearchRegistry.clear()
    mockStrategy = new MockFileSearchStrategy()
    fileSearchRegistry.register("git-ls-files", mockStrategy)

    // Create fresh router instance
    router = createFilesRouter()
  })

  describe("GET /files/search", () => {
    it("should search files with valid query", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "test" }

      const mockResults: FileSearchResult[] = [
        {
          path: "src/test.ts",
          name: "test.ts",
          isFile: true,
          matchType: "prefix",
        },
      ]

      mockStrategy.searchMock.mockResolvedValue(mockResults)

      // Get the route handler
      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(mockStrategy.searchMock).toHaveBeenCalledWith("/test/workspace", {
        query: "test",
        limit: 20,
        includeDirectories: false,
      })

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { results: mockResults },
      })
    })

    it("should use custom limit parameter", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "test", limit: "50" }

      mockStrategy.searchMock.mockResolvedValue([])

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(mockStrategy.searchMock).toHaveBeenCalledWith("/test/workspace", {
        query: "test",
        limit: 50,
        includeDirectories: false,
      })
    })

    it("should include directories when requested", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "test", includeDirectories: "true" }

      mockStrategy.searchMock.mockResolvedValue([])

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(mockStrategy.searchMock).toHaveBeenCalledWith("/test/workspace", {
        query: "test",
        limit: 20,
        includeDirectories: true,
      })
    })

    it("should return 400 when query parameter is missing", async () => {
      const { req, res } = createMockReqRes()
      req.query = {}

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        message: 'Query parameter "q" is required',
      })

      expect(mockStrategy.searchMock).not.toHaveBeenCalled()
    })

    it("should return 400 when query parameter is not a string", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: ["not", "a", "string"] }

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        message: 'Query parameter "q" is required',
      })

      expect(mockStrategy.searchMock).not.toHaveBeenCalled()
    })

    it("should return 500 when search fails", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "test" }

      mockStrategy.searchMock.mockRejectedValue(new Error("Search failed"))

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        error_data: "Search failed",
        message: "Failed to search files",
      })
    })

    it("should use workspace path from project context", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "test" }
      req.project = { path: "/custom/workspace/path" } as any

      mockStrategy.searchMock.mockResolvedValue([])

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(mockStrategy.searchMock).toHaveBeenCalledWith(
        "/custom/workspace/path",
        expect.any(Object)
      )
    })

    it("should handle empty search results", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "nonexistent" }

      mockStrategy.searchMock.mockResolvedValue([])

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { results: [] },
      })
    })

    it("should handle multiple results correctly", async () => {
      const { req, res } = createMockReqRes()
      req.query = { q: "component" }

      const mockResults: FileSearchResult[] = [
        {
          path: "src/components/AgentPanel.tsx",
          name: "AgentPanel.tsx",
          isFile: true,
          matchType: "prefix",
        },
        {
          path: "src/components/ExecutionMonitor.tsx",
          name: "ExecutionMonitor.tsx",
          isFile: true,
          matchType: "contains",
        },
      ]

      mockStrategy.searchMock.mockResolvedValue(mockResults)

      const route = router.stack.find((layer: any) =>
        layer.route?.path === "/search"
      )
      const handler = route.route.stack[0].handle

      await handler(req, res)

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { results: mockResults },
      })
    })
  })
})
