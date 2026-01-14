/**
 * CodeViz API routes
 *
 * Provides REST API for codebase visualization.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { analyzeCodebase, resetAnalyzer } from "codeviz/node";
import type { CodeGraph, AnalysisProgress } from "codeviz/node";
import {
  broadcastCodeGraphReady,
  broadcastCodeGraphProgress,
} from "../services/websocket.js";

/**
 * File node in the file tree
 */
interface FileNode {
  path: string;
  name: string;
  extension: string;
  directoryPath: string;
}

/**
 * Directory node in the file tree
 */
interface DirectoryNode {
  path: string;
  name: string;
  parentPath: string | null;
}

/**
 * File tree response
 */
interface FileTreeResponse {
  files: FileNode[];
  directories: DirectoryNode[];
  metadata: {
    totalFiles: number;
    totalDirectories: number;
    generatedAt: string;
  };
}

/**
 * Cache entry for file tree
 */
interface CacheEntry {
  data: FileTreeResponse;
  timestamp: number;
}

// File tree cache with 5 second TTL
const fileTreeCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000;

/**
 * Analysis state for tracking background analysis progress
 */
interface AnalysisState {
  id: string;
  status: "running" | "completed" | "failed";
  gitSha: string;
  phase?: "scanning" | "parsing" | "resolving";
  progress?: { current: number; total: number };
  currentFile?: string;
  error?: string;
  startedAt: Date;
}

// Track running analyses per project
const analysisState = new Map<string, AnalysisState>();

/**
 * Get current git HEAD SHA
 */
function getGitSha(workspacePath: string): string {
  const sha = execSync("git rev-parse HEAD", {
    cwd: workspacePath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return sha;
}

/**
 * Get cached CodeGraph from database
 */
function getCachedCodeGraph(
  db: import("better-sqlite3").Database,
  gitSha: string
): {
  codeGraph: CodeGraph;
  fileTree: FileTreeResponse;
  analyzedAt: string;
  fileCount: number;
  symbolCount: number;
  analysisDurationMs: number;
} | null {
  const stmt = db.prepare(`
    SELECT code_graph, file_tree, analyzed_at, file_count, symbol_count, analysis_duration_ms
    FROM code_graph_cache
    WHERE git_sha = ?
  `);
  const row = stmt.get(gitSha) as {
    code_graph: string;
    file_tree: string;
    analyzed_at: string;
    file_count: number;
    symbol_count: number;
    analysis_duration_ms: number;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    codeGraph: JSON.parse(row.code_graph),
    fileTree: JSON.parse(row.file_tree),
    analyzedAt: row.analyzed_at,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    analysisDurationMs: row.analysis_duration_ms,
  };
}

/**
 * Store CodeGraph in database cache
 */
function storeCodeGraph(
  db: import("better-sqlite3").Database,
  gitSha: string,
  codeGraph: CodeGraph,
  fileTree: FileTreeResponse,
  analysisDurationMs: number
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO code_graph_cache
    (git_sha, code_graph, file_tree, analyzed_at, file_count, symbol_count, analysis_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    gitSha,
    JSON.stringify(codeGraph),
    JSON.stringify(fileTree),
    new Date().toISOString(),
    codeGraph.files.length,
    codeGraph.symbols.length,
    analysisDurationMs
  );
}

/**
 * Build file tree from git ls-files output
 */
function buildFileTree(workspacePath: string): FileTreeResponse {
  // Execute git ls-files
  const output = execSync("git ls-files", {
    cwd: workspacePath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const filePaths = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Build files array
  const files: FileNode[] = filePaths.map((filePath) => {
    const parts = filePath.split("/");
    const name = parts.pop()!;
    const directoryPath = parts.length > 0 ? parts.join("/") : "";
    const extensionMatch = name.match(/\.([^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : "";

    return {
      path: filePath,
      name,
      extension,
      directoryPath,
    };
  });

  // Build directories set from file paths
  const directorySet = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    // Add all parent directories
    for (let i = 1; i < parts.length; i++) {
      directorySet.add(parts.slice(0, i).join("/"));
    }
  }

  // Convert to directory nodes
  const directories: DirectoryNode[] = Array.from(directorySet)
    .sort()
    .map((dirPath) => {
      const parts = dirPath.split("/");
      const name = parts.pop()!;
      const parentPath = parts.length > 0 ? parts.join("/") : null;

      return {
        path: dirPath,
        name,
        parentPath,
      };
    });

  return {
    files,
    directories,
    metadata: {
      totalFiles: files.length,
      totalDirectories: directories.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Get file tree with caching
 */
function getCachedFileTree(workspacePath: string): FileTreeResponse {
  const now = Date.now();
  const cached = fileTreeCache.get(workspacePath);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const data = buildFileTree(workspacePath);
  fileTreeCache.set(workspacePath, { data, timestamp: now });
  return data;
}

/**
 * Create codeviz router
 *
 * Note: Project context is accessed via req.project
 * which is injected by the requireProject() middleware
 *
 * @returns Express router with codeviz endpoints
 */
export function createCodevizRouter(): Router {
  const router = Router();

  /**
   * GET /api/codeviz/file-tree
   *
   * Get the codebase file tree structure for visualization.
   * Uses git ls-files for fast, accurate file listing that respects .gitignore.
   *
   * Returns:
   * {
   *   success: true,
   *   data: {
   *     files: [{ path, name, extension, directoryPath }],
   *     directories: [{ path, name, parentPath }],
   *     metadata: { totalFiles, totalDirectories, generatedAt }
   *   }
   * }
   */
  router.get("/file-tree", async (req: Request, res: Response) => {
    try {
      const workspacePath = req.project!.path;
      const fileTree = getCachedFileTree(workspacePath);

      res.json({
        success: true,
        data: fileTree,
      });
    } catch (error) {
      console.error("[CodeViz] Failed to get file tree:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get file tree",
      });
    }
  });

  /**
   * GET /api/codeviz/code-graph
   *
   * Get the cached CodeGraph for the current git SHA.
   * Returns 404 if no cached CodeGraph exists for the current SHA.
   */
  router.get("/code-graph", async (req: Request, res: Response) => {
    try {
      const workspacePath = req.project!.path;
      const db = req.project!.db;
      const gitSha = getGitSha(workspacePath);

      const cached = getCachedCodeGraph(db, gitSha);

      if (!cached) {
        res.status(404).json({
          success: false,
          data: null,
          message: "No cached CodeGraph for current SHA",
          currentSha: gitSha,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          codeGraph: cached.codeGraph,
          gitSha,
          analyzedAt: cached.analyzedAt,
          stats: {
            fileCount: cached.fileCount,
            symbolCount: cached.symbolCount,
            analysisDurationMs: cached.analysisDurationMs,
          },
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to get code graph:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get code graph",
      });
    }
  });

  /**
   * POST /api/codeviz/analyze
   *
   * Trigger background CodeGraph analysis.
   * If an analysis is already running for this project, returns the existing analysis info.
   */
  router.post("/analyze", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;
      const workspacePath = req.project!.path;
      const db = req.project!.db;
      const gitSha = getGitSha(workspacePath);

      // Check if analysis is already running
      const existing = analysisState.get(projectId);
      if (existing && existing.status === "running") {
        res.json({
          success: true,
          data: {
            analysisId: existing.id,
            gitSha: existing.gitSha,
            status: "already_running",
          },
        });
        return;
      }

      // Check if we already have a cached result for this SHA
      const cached = getCachedCodeGraph(db, gitSha);
      if (cached) {
        res.json({
          success: true,
          data: {
            analysisId: null,
            gitSha,
            status: "already_cached",
          },
        });
        return;
      }

      // Create new analysis state
      const analysisId = randomUUID();
      const state: AnalysisState = {
        id: analysisId,
        status: "running",
        gitSha,
        phase: "scanning",
        startedAt: new Date(),
      };
      analysisState.set(projectId, state);

      // Start background analysis (don't await)
      const startTime = Date.now();
      analyzeCodebase({
        rootPath: workspacePath,
        respectGitignore: true,
        extractCalls: true,
        maxFiles: 10000,
        onProgress: (progress: AnalysisProgress) => {
          // Update state
          state.phase = progress.phase;
          state.progress = { current: progress.current, total: progress.total };
          state.currentFile = progress.currentFile;

          // Broadcast progress to WebSocket clients
          broadcastCodeGraphProgress(projectId, {
            phase: progress.phase,
            current: progress.current,
            total: progress.total,
            currentFile: progress.currentFile,
          });
        },
      })
        .then((result) => {
          const analysisDurationMs = Date.now() - startTime;
          const fileTree = getCachedFileTree(workspacePath);

          // Store in database
          storeCodeGraph(db, gitSha, result.graph, fileTree, analysisDurationMs);

          // Update state
          state.status = "completed";
          state.phase = undefined;
          state.progress = undefined;
          state.currentFile = undefined;

          // Broadcast completion
          broadcastCodeGraphReady(projectId, {
            gitSha,
            fileCount: result.graph.files.length,
            symbolCount: result.graph.symbols.length,
            analysisDurationMs,
          });

          // Clean up parser caches
          resetAnalyzer();

          console.log(
            `[CodeViz] Analysis completed for ${projectId}: ${result.graph.files.length} files, ${result.graph.symbols.length} symbols in ${analysisDurationMs}ms`
          );
        })
        .catch((error) => {
          state.status = "failed";
          state.error = error instanceof Error ? error.message : String(error);
          console.error(`[CodeViz] Analysis failed for ${projectId}:`, error);
        });

      res.json({
        success: true,
        data: {
          analysisId,
          gitSha,
          status: "started",
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to start analysis:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to start analysis",
      });
    }
  });

  /**
   * GET /api/codeviz/analyze/status
   *
   * Get the current analysis status for this project.
   */
  router.get("/analyze/status", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;
      const workspacePath = req.project!.path;
      const gitSha = getGitSha(workspacePath);

      const state = analysisState.get(projectId);

      if (!state) {
        res.json({
          success: true,
          data: {
            status: "idle",
            gitSha,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          analysisId: state.id,
          status: state.status,
          gitSha: state.gitSha,
          phase: state.phase,
          progress: state.progress,
          currentFile: state.currentFile,
          error: state.error,
          startedAt: state.startedAt.toISOString(),
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to get analysis status:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get analysis status",
      });
    }
  });

  return router;
}
