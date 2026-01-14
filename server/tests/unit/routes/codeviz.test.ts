/**
 * Tests for CodeViz API routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createCodevizRouter } from "../../../src/routes/codeviz.js";
import type { Request, Response } from "express";
import type Database from "better-sqlite3";

// Mock child_process for git commands
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock codeviz library (node entry point)
vi.mock("codeviz/node", () => ({
  analyzeCodebase: vi.fn(),
  resetAnalyzer: vi.fn(),
}));

// Mock websocket broadcasts
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastCodeGraphReady: vi.fn(),
  broadcastCodeGraphProgress: vi.fn(),
}));

import { execSync } from "child_process";
import { analyzeCodebase, resetAnalyzer } from "codeviz/node";
import {
  broadcastCodeGraphReady,
  broadcastCodeGraphProgress,
} from "../../../src/services/websocket.js";

// Helper to create mock request/response
function createMockReqRes(overrides: {
  projectId?: string;
  workspacePath?: string;
  dbRows?: any[];
} = {}) {
  const dbMock = {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(overrides.dbRows?.[0] ?? undefined),
      run: vi.fn(),
      all: vi.fn().mockReturnValue(overrides.dbRows ?? []),
    }),
  } as unknown as Database.Database;

  const req = {
    project: {
      id: overrides.projectId ?? "test-project",
      path: overrides.workspacePath ?? "/test/workspace",
      db: dbMock,
    },
  } as unknown as Request;

  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res, dbMock };
}

// Helper to get route handler
function getRouteHandler(
  router: ReturnType<typeof createCodevizRouter>,
  path: string,
  method: string = "get"
) {
  const route = router.stack.find(
    (layer: any) => layer.route?.path === path
  );
  if (!route) {
    throw new Error(`Route not found: ${path}`);
  }
  const handler = route.route.stack.find(
    (layer: any) => layer.method === method
  )?.handle;
  if (!handler) {
    throw new Error(`Handler not found for ${method.toUpperCase()} ${path}`);
  }
  return handler;
}

describe("CodeViz Router", () => {
  let router: ReturnType<typeof createCodevizRouter>;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createCodevizRouter();

    // Default mock for git rev-parse
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd === "git rev-parse HEAD") {
        return "abc123def456";
      }
      if (cmd === "git ls-files") {
        return "src/index.ts\nsrc/utils.ts\nREADME.md";
      }
      return "";
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("GET /file-tree", () => {
    it("should return file tree from git ls-files", async () => {
      const { req, res } = createMockReqRes();

      const handler = getRouteHandler(router, "/file-tree");
      await handler(req, res);

      expect(execSync).toHaveBeenCalledWith("git ls-files", {
        cwd: "/test/workspace",
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({ path: "src/index.ts", name: "index.ts" }),
            expect.objectContaining({ path: "src/utils.ts", name: "utils.ts" }),
            expect.objectContaining({ path: "README.md", name: "README.md" }),
          ]),
          directories: expect.arrayContaining([
            expect.objectContaining({ path: "src", name: "src" }),
          ]),
          metadata: expect.objectContaining({
            totalFiles: 3,
            totalDirectories: 1,
          }),
        }),
      });
    });

    it("should handle errors gracefully", async () => {
      // Use unique workspace path to avoid cache returning stale data
      const { req, res } = createMockReqRes({ workspacePath: "/test/workspace-error" });

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("git command failed");
      });

      const handler = getRouteHandler(router, "/file-tree");
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        error_data: "git command failed",
        message: "Failed to get file tree",
      });
    });
  });

  describe("GET /code-graph", () => {
    it("should return cached CodeGraph when available", async () => {
      const mockCodeGraph = {
        files: [{ id: "f1", path: "src/index.ts" }],
        directories: [{ id: "d1", path: "src" }],
        symbols: [],
        imports: [],
        calls: [],
        metadata: { totalFiles: 1, totalDirectories: 1 },
      };

      const mockFileTree = {
        files: [{ path: "src/index.ts", name: "index.ts" }],
        directories: [{ path: "src", name: "src" }],
        metadata: { totalFiles: 1, totalDirectories: 1 },
      };

      const { req, res } = createMockReqRes({
        dbRows: [
          {
            git_sha: "abc123def456",
            code_graph: JSON.stringify(mockCodeGraph),
            file_tree: JSON.stringify(mockFileTree),
            analyzed_at: "2024-01-01T00:00:00Z",
            file_count: 1,
            symbol_count: 0,
            analysis_duration_ms: 100,
          },
        ],
      });

      const handler = getRouteHandler(router, "/code-graph");
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          codeGraph: mockCodeGraph,
          gitSha: "abc123def456",
          currentSha: "abc123def456",
          stale: false,
          analyzedAt: "2024-01-01T00:00:00Z",
          stats: {
            fileCount: 1,
            symbolCount: 0,
            analysisDurationMs: 100,
          },
        },
      });
    });

    it("should return 404 when no cached CodeGraph exists", async () => {
      const { req, res } = createMockReqRes({ dbRows: [] });

      // Override the db mock to return undefined for get()
      req.project!.db.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const handler = getRouteHandler(router, "/code-graph");
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        data: null,
        message: "No cached CodeGraph available",
        currentSha: "abc123def456",
      });
    });
  });

  describe("POST /analyze", () => {
    it("should start background analysis and return immediately", async () => {
      const { req, res } = createMockReqRes();

      // No cached result
      req.project!.db.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
      });

      // Mock analyzeCodebase to return a promise that resolves
      const mockGraph = {
        files: [],
        directories: [],
        symbols: [],
        imports: [],
        calls: [],
        metadata: {},
      };
      vi.mocked(analyzeCodebase).mockResolvedValue({ graph: mockGraph });

      const handler = getRouteHandler(router, "/analyze", "post");
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          analysisId: expect.any(String),
          gitSha: "abc123def456",
          status: "started",
        },
      });

      // Wait for async analysis to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(analyzeCodebase).toHaveBeenCalledWith({
        rootPath: "/test/workspace",
        respectGitignore: true,
        extractCalls: true,
        maxFiles: 10000,
        onProgress: expect.any(Function),
      });
    });

    it("should return already_cached when CodeGraph exists", async () => {
      const { req, res } = createMockReqRes({
        dbRows: [
          {
            code_graph: "{}",
            file_tree: "{}",
            analyzed_at: "2024-01-01T00:00:00Z",
            file_count: 1,
            symbol_count: 0,
            analysis_duration_ms: 100,
          },
        ],
      });

      const handler = getRouteHandler(router, "/analyze", "post");
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          analysisId: null,
          gitSha: "abc123def456",
          status: "already_cached",
        },
      });

      expect(analyzeCodebase).not.toHaveBeenCalled();
    });

    it("should broadcast progress during analysis", async () => {
      const { req, res } = createMockReqRes();

      req.project!.db.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
      });

      let progressCallback: ((progress: any) => void) | null = null;
      vi.mocked(analyzeCodebase).mockImplementation(async (options: any) => {
        progressCallback = options.onProgress;
        // Simulate progress
        progressCallback!({ phase: "scanning", current: 1, total: 10 });
        progressCallback!({
          phase: "parsing",
          current: 5,
          total: 10,
          currentFile: "src/index.ts",
        });
        return {
          graph: {
            files: [],
            directories: [],
            symbols: [],
            imports: [],
            calls: [],
            metadata: {},
          },
        };
      });

      const handler = getRouteHandler(router, "/analyze", "post");
      await handler(req, res);

      // Wait for async analysis
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(broadcastCodeGraphProgress).toHaveBeenCalledWith("test-project", {
        phase: "scanning",
        current: 1,
        total: 10,
        currentFile: undefined,
      });

      expect(broadcastCodeGraphProgress).toHaveBeenCalledWith("test-project", {
        phase: "parsing",
        current: 5,
        total: 10,
        currentFile: "src/index.ts",
      });
    });

    it("should broadcast completion when analysis finishes", async () => {
      const { req, res } = createMockReqRes();

      req.project!.db.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
      });

      const mockGraph = {
        files: [{ id: "f1" }, { id: "f2" }],
        directories: [{ id: "d1" }],
        symbols: [{ id: "s1" }],
        imports: [],
        calls: [],
        metadata: {},
      };
      vi.mocked(analyzeCodebase).mockResolvedValue({ graph: mockGraph });

      const handler = getRouteHandler(router, "/analyze", "post");
      await handler(req, res);

      // Wait for async analysis
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(broadcastCodeGraphReady).toHaveBeenCalledWith("test-project", {
        gitSha: "abc123def456",
        fileCount: 2,
        symbolCount: 1,
        analysisDurationMs: expect.any(Number),
      });

      expect(resetAnalyzer).toHaveBeenCalled();
    });
  });

  describe("GET /analyze/status", () => {
    it("should return idle when no analysis is running", async () => {
      // Use unique project ID to avoid state collisions from other tests
      const { req, res } = createMockReqRes({ projectId: "status-idle-project" });

      const handler = getRouteHandler(router, "/analyze/status");
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          status: "idle",
          gitSha: "abc123def456",
        },
      });
    });

    it("should return running status during analysis", async () => {
      // Use unique project ID for this test
      const { req, res } = createMockReqRes({ projectId: "status-running-project" });

      // First start an analysis
      req.project!.db.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
      });

      // Make analysis never resolve
      vi.mocked(analyzeCodebase).mockImplementation(
        () => new Promise(() => {})
      );

      const analyzeHandler = getRouteHandler(router, "/analyze", "post");
      await analyzeHandler(req, res);

      // Now check status - must use same project ID
      const { req: statusReq, res: statusRes } = createMockReqRes({ projectId: "status-running-project" });
      const statusHandler = getRouteHandler(router, "/analyze/status");
      await statusHandler(statusReq, statusRes);

      expect(statusRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: "running",
          gitSha: "abc123def456",
          phase: "scanning",
        }),
      });
    });
  });

  describe("File tree transformation", () => {
    it("should correctly build file and directory nodes", async () => {
      // Use unique workspace path to avoid cache collisions
      const { req, res } = createMockReqRes({ workspacePath: "/test/workspace-transform" });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git ls-files") {
          return [
            "src/components/Button.tsx",
            "src/components/Input.tsx",
            "src/utils/helpers.ts",
            "package.json",
          ].join("\n");
        }
        return "";
      });

      const handler = getRouteHandler(router, "/file-tree");
      await handler(req, res);

      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.success).toBe(true);

      const { files, directories, metadata } = response.data;

      // Check files
      expect(files).toHaveLength(4);
      expect(files.find((f: any) => f.path === "package.json")).toEqual({
        path: "package.json",
        name: "package.json",
        extension: "json",
        directoryPath: "",
      });
      expect(
        files.find((f: any) => f.path === "src/components/Button.tsx")
      ).toEqual({
        path: "src/components/Button.tsx",
        name: "Button.tsx",
        extension: "tsx",
        directoryPath: "src/components",
      });

      // Check directories
      expect(directories).toHaveLength(3);
      expect(directories.map((d: any) => d.path).sort()).toEqual([
        "src",
        "src/components",
        "src/utils",
      ]);

      // Check parent relationships
      const srcDir = directories.find((d: any) => d.path === "src");
      const componentsDir = directories.find(
        (d: any) => d.path === "src/components"
      );
      expect(srcDir.parentPath).toBeNull();
      expect(componentsDir.parentPath).toBe("src");

      // Check metadata
      expect(metadata.totalFiles).toBe(4);
      expect(metadata.totalDirectories).toBe(3);
    });

    it("should handle files at root level", async () => {
      // Use unique workspace path to avoid cache collisions
      const { req, res } = createMockReqRes({ workspacePath: "/test/workspace-root" });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === "git rev-parse HEAD") return "abc123";
        if (cmd === "git ls-files") return "README.md\n.gitignore";
        return "";
      });

      const handler = getRouteHandler(router, "/file-tree");
      await handler(req, res);

      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.data.files).toHaveLength(2);
      expect(response.data.directories).toHaveLength(0);

      response.data.files.forEach((file: any) => {
        expect(file.directoryPath).toBe("");
      });
    });
  });
});
