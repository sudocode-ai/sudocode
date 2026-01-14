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
import {
  analyzeCodebase,
  resetAnalyzer,
  analyzeIncrementally,
  MemoryCache,
  CodebaseWatcher,
  type IncrementalCacheStorage,
  type FileChange,
} from "codeviz/node";
import type { CodeGraph, AnalysisProgress, IncrementalProgress } from "codeviz/node";
import {
  broadcastCodeGraphReady,
  broadcastCodeGraphProgress,
  broadcastFileChangesDetected,
  broadcastWatcherStarted,
  broadcastWatcherStopped,
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
  phase?: "scanning" | "parsing" | "resolving" | "detecting" | "extracting";
  progress?: { current: number; total: number };
  currentFile?: string;
  error?: string;
  startedAt: Date;
}

// Track running analyses per project
const analysisState = new Map<string, AnalysisState>();

// Incremental analysis cache per project
const incrementalCaches = new Map<string, IncrementalCacheStorage>();

// File watchers per project
const projectWatchers = new Map<string, CodebaseWatcher>();

/**
 * Watcher state info with reference counting
 */
interface WatcherState {
  projectId: string;
  workspacePath: string;
  autoAnalyze: boolean;
  /** Number of subscribers (clients) using this watcher */
  subscriberCount: number;
}

// Store watcher metadata
const watcherStates = new Map<string, WatcherState>();

/**
 * Get or create incremental cache for a project
 */
function getIncrementalCache(projectId: string): IncrementalCacheStorage {
  let cache = incrementalCaches.get(projectId);
  if (!cache) {
    cache = new MemoryCache();
    incrementalCaches.set(projectId, cache);
  }
  return cache;
}

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
 * Get cached CodeGraph from database for specific SHA
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
  cachedSha: string;
} | null {
  const stmt = db.prepare(`
    SELECT git_sha, code_graph, file_tree, analyzed_at, file_count, symbol_count, analysis_duration_ms
    FROM code_graph_cache
    WHERE git_sha = ?
  `);
  const row = stmt.get(gitSha) as {
    git_sha: string;
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
    cachedSha: row.git_sha,
  };
}

/**
 * Get the most recent cached CodeGraph (regardless of SHA)
 */
function getLatestCachedCodeGraph(
  db: import("better-sqlite3").Database
): {
  codeGraph: CodeGraph;
  fileTree: FileTreeResponse;
  analyzedAt: string;
  fileCount: number;
  symbolCount: number;
  analysisDurationMs: number;
  cachedSha: string;
} | null {
  const stmt = db.prepare(`
    SELECT git_sha, code_graph, file_tree, analyzed_at, file_count, symbol_count, analysis_duration_ms
    FROM code_graph_cache
    ORDER BY analyzed_at DESC
    LIMIT 1
  `);
  const row = stmt.get() as {
    git_sha: string;
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
    cachedSha: row.git_sha,
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
   * Get the cached CodeGraph. Returns the most recent cached version.
   * If the cache is from a different SHA than current HEAD, includes stale: true.
   * Returns 404 only if no cache exists at all.
   */
  router.get("/code-graph", async (req: Request, res: Response) => {
    try {
      const workspacePath = req.project!.path;
      const db = req.project!.db;
      const gitSha = getGitSha(workspacePath);

      // First try exact SHA match
      let cached = getCachedCodeGraph(db, gitSha);
      let isStale = false;

      // If no exact match, get the latest cache (stale but usable)
      if (!cached) {
        cached = getLatestCachedCodeGraph(db);
        if (cached) {
          isStale = true;
        }
      }

      if (!cached) {
        res.status(404).json({
          success: false,
          data: null,
          message: "No cached CodeGraph available",
          currentSha: gitSha,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          codeGraph: cached.codeGraph,
          gitSha: cached.cachedSha,
          currentSha: gitSha,
          stale: isStale,
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

  /**
   * POST /api/codeviz/analyze/incremental
   *
   * Perform incremental analysis - only re-analyze changed files.
   * Uses cached extraction data for unchanged files.
   */
  router.post("/analyze/incremental", async (req: Request, res: Response) => {
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

      // Get or create incremental cache
      const cache = getIncrementalCache(projectId);

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

      // Start incremental analysis (don't await)
      const startTime = Date.now();
      analyzeIncrementally({
        rootPath: workspacePath,
        cache,
        respectGitignore: true,
        extractCalls: true,
        maxFiles: 10000,
        useMtimeHeuristic: true,
        onProgress: (progress: IncrementalProgress) => {
          // Update state
          state.phase = progress.phase;
          state.progress = { current: progress.current, total: progress.total };
          state.currentFile = progress.currentFile;

          // Broadcast progress
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

          // Broadcast completion with incremental stats
          broadcastCodeGraphReady(projectId, {
            gitSha,
            fileCount: result.graph.files.length,
            symbolCount: result.graph.symbols.length,
            analysisDurationMs,
            incremental: {
              extractedFiles: result.stats.extractedFiles,
              cachedFiles: result.stats.cachedFiles,
              fullResolution: result.stats.fullResolution,
            },
          });

          // Clean up parser caches
          resetAnalyzer();

          console.log(
            `[CodeViz] Incremental analysis completed for ${projectId}: ` +
              `${result.stats.extractedFiles} extracted, ${result.stats.cachedFiles} cached ` +
              `(${result.graph.files.length} total files, ${result.graph.symbols.length} symbols) ` +
              `in ${analysisDurationMs}ms`
          );
        })
        .catch((error) => {
          state.status = "failed";
          state.error = error instanceof Error ? error.message : String(error);
          console.error(
            `[CodeViz] Incremental analysis failed for ${projectId}:`,
            error
          );
        });

      res.json({
        success: true,
        data: {
          analysisId,
          gitSha,
          status: "started",
          incremental: true,
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to start incremental analysis:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to start incremental analysis",
      });
    }
  });

  /**
   * GET /api/codeviz/cache/stats
   *
   * Get incremental cache statistics for this project.
   */
  router.get("/cache/stats", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;
      const cache = incrementalCaches.get(projectId);

      if (!cache) {
        res.json({
          success: true,
          data: {
            initialized: false,
            stats: null,
          },
        });
        return;
      }

      const stats = cache.getStats();

      res.json({
        success: true,
        data: {
          initialized: true,
          stats: {
            totalEntries: stats.totalEntries,
            hitCount: stats.hitCount,
            missCount: stats.missCount,
            hitRate:
              stats.hitCount + stats.missCount > 0
                ? stats.hitCount / (stats.hitCount + stats.missCount)
                : 0,
            lastCleared: stats.lastCleared,
          },
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to get cache stats:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get cache stats",
      });
    }
  });

  /**
   * POST /api/codeviz/cache/clear
   *
   * Clear incremental cache for this project.
   */
  router.post("/cache/clear", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;
      const cache = incrementalCaches.get(projectId);

      if (cache) {
        cache.clear();
      }

      res.json({
        success: true,
        data: {
          cleared: true,
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to clear cache:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to clear cache",
      });
    }
  });

  /**
   * POST /api/codeviz/watch/start
   *
   * Start file watcher for this project.
   * Broadcasts file change events via WebSocket.
   * Can optionally auto-trigger incremental analysis on changes.
   */
  router.post("/watch/start", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;
      const workspacePath = req.project!.path;
      const { autoAnalyze = true } = req.body as { autoAnalyze?: boolean };

      // Check if already watching - increment subscriber count
      const existingWatcher = projectWatchers.get(projectId);
      const existingState = watcherStates.get(projectId);
      if (existingWatcher && existingWatcher.isWatching() && existingState) {
        // Increment subscriber count
        existingState.subscriberCount++;
        // Update autoAnalyze if any subscriber wants it
        if (autoAnalyze) {
          existingState.autoAnalyze = true;
        }
        console.log(
          `[CodeViz] Watcher subscriber added for ${projectId} (now ${existingState.subscriberCount} subscribers)`
        );
        res.json({
          success: true,
          data: {
            status: "already_watching",
            watchCount: existingWatcher.getWatchCount(),
            subscriberCount: existingState.subscriberCount,
          },
        });
        return;
      }

      // Create new watcher
      const watcher = new CodebaseWatcher({
        rootPath: workspacePath,
        debounceMs: 500, // 500ms debounce for batching rapid changes
      });

      // Store watcher state with initial subscriber count of 1
      watcherStates.set(projectId, {
        projectId,
        workspacePath,
        autoAnalyze,
        subscriberCount: 1,
      });

      // Handle file changes
      watcher.on("change", (changes: FileChange[]) => {
        console.log(
          `[CodeViz] File changes detected for ${projectId}: ${changes.length} files`
        );

        // Broadcast changes to WebSocket clients
        broadcastFileChangesDetected(projectId, {
          changes: changes.map((c) => ({
            path: c.path,
            fileId: c.fileId,
            changeType: c.changeType,
          })),
          timestamp: Date.now(),
        });

        // Auto-trigger incremental analysis if enabled
        const state = watcherStates.get(projectId);
        if (state?.autoAnalyze) {
          // Trigger incremental analysis in background
          triggerIncrementalAnalysis(projectId, req.project!);
        }
      });

      // Handle watcher errors
      watcher.on("error", (error: Error) => {
        console.error(`[CodeViz] Watcher error for ${projectId}:`, error.message);
      });

      // Start watching
      watcher.start();
      projectWatchers.set(projectId, watcher);

      // Broadcast watcher started
      broadcastWatcherStarted(projectId, {
        watchCount: watcher.getWatchCount(),
      });

      console.log(
        `[CodeViz] Started file watcher for ${projectId} (${watcher.getWatchCount()} directories, autoAnalyze: ${autoAnalyze})`
      );

      res.json({
        success: true,
        data: {
          status: "started",
          watchCount: watcher.getWatchCount(),
          autoAnalyze,
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to start watcher:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to start file watcher",
      });
    }
  });

  /**
   * POST /api/codeviz/watch/stop
   *
   * Stop file watcher for this project.
   * Uses reference counting - only stops when all subscribers have unsubscribed.
   */
  router.post("/watch/stop", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;

      const watcher = projectWatchers.get(projectId);
      const state = watcherStates.get(projectId);

      if (!watcher || !state) {
        res.json({
          success: true,
          data: {
            status: "not_watching",
          },
        });
        return;
      }

      // Decrement subscriber count
      state.subscriberCount--;

      // Only stop watcher when no subscribers remain
      if (state.subscriberCount <= 0) {
        await watcher.stop();
        projectWatchers.delete(projectId);
        watcherStates.delete(projectId);

        // Broadcast watcher stopped
        broadcastWatcherStopped(projectId);

        console.log(`[CodeViz] Stopped file watcher for ${projectId} (no subscribers remaining)`);

        res.json({
          success: true,
          data: {
            status: "stopped",
          },
        });
      } else {
        console.log(
          `[CodeViz] Watcher subscriber removed for ${projectId} (${state.subscriberCount} subscribers remaining)`
        );
        res.json({
          success: true,
          data: {
            status: "unsubscribed",
            subscriberCount: state.subscriberCount,
          },
        });
      }
    } catch (error) {
      console.error("[CodeViz] Failed to stop watcher:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to stop file watcher",
      });
    }
  });

  /**
   * GET /api/codeviz/watch/status
   *
   * Get file watcher status for this project.
   */
  router.get("/watch/status", async (req: Request, res: Response) => {
    try {
      const projectId = req.project!.id;

      const watcher = projectWatchers.get(projectId);
      const state = watcherStates.get(projectId);

      if (!watcher || !watcher.isWatching()) {
        res.json({
          success: true,
          data: {
            watching: false,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          watching: true,
          watchCount: watcher.getWatchCount(),
          autoAnalyze: state?.autoAnalyze ?? false,
          subscriberCount: state?.subscriberCount ?? 0,
        },
      });
    } catch (error) {
      console.error("[CodeViz] Failed to get watcher status:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get watcher status",
      });
    }
  });

  return router;
}

/**
 * Trigger incremental analysis in the background
 */
function triggerIncrementalAnalysis(
  projectId: string,
  project: { path: string; db: import("better-sqlite3").Database }
): void {
  // Check if analysis is already running
  const existing = analysisState.get(projectId);
  if (existing && existing.status === "running") {
    console.log(
      `[CodeViz] Skipping auto-analysis for ${projectId} - analysis already running`
    );
    return;
  }

  const workspacePath = project.path;
  const db = project.db;

  // Get git SHA
  let gitSha: string;
  try {
    gitSha = execSync("git rev-parse HEAD", {
      cwd: workspacePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    console.error(`[CodeViz] Failed to get git SHA for ${projectId}`);
    return;
  }

  // Get or create incremental cache
  const cache = getIncrementalCache(projectId);

  // Create new analysis state
  const analysisId = randomUUID();
  const state: AnalysisState = {
    id: analysisId,
    status: "running",
    gitSha,
    phase: "detecting",
    startedAt: new Date(),
  };
  analysisState.set(projectId, state);

  // Start incremental analysis
  const startTime = Date.now();
  analyzeIncrementally({
    rootPath: workspacePath,
    cache,
    respectGitignore: true,
    extractCalls: true,
    maxFiles: 10000,
    useMtimeHeuristic: true,
    onProgress: (progress: IncrementalProgress) => {
      state.phase = progress.phase;
      state.progress = { current: progress.current, total: progress.total };
      state.currentFile = progress.currentFile;

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

      // Build file tree
      const fileTree = buildFileTreeFromGit(workspacePath);

      // Store in database
      storeCodeGraphInDb(db, gitSha, result.graph, fileTree, analysisDurationMs);

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
        incremental: {
          extractedFiles: result.stats.extractedFiles,
          cachedFiles: result.stats.cachedFiles,
          fullResolution: result.stats.fullResolution,
        },
      });

      // Clean up parser caches
      resetAnalyzer();

      console.log(
        `[CodeViz] Auto-analysis completed for ${projectId}: ` +
          `${result.stats.extractedFiles} extracted, ${result.stats.cachedFiles} cached ` +
          `in ${analysisDurationMs}ms`
      );
    })
    .catch((error) => {
      state.status = "failed";
      state.error = error instanceof Error ? error.message : String(error);
      console.error(`[CodeViz] Auto-analysis failed for ${projectId}:`, error);
    });
}

/**
 * Build file tree from git ls-files (helper for auto-analysis)
 */
function buildFileTreeFromGit(workspacePath: string): FileTreeResponse {
  const output = execSync("git ls-files", {
    cwd: workspacePath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const filePaths = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const files: FileNode[] = filePaths.map((filePath) => {
    const parts = filePath.split("/");
    const name = parts.pop()!;
    const directoryPath = parts.length > 0 ? parts.join("/") : "";
    const extensionMatch = name.match(/\.([^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : "";

    return { path: filePath, name, extension, directoryPath };
  });

  const directorySet = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      directorySet.add(parts.slice(0, i).join("/"));
    }
  }

  const directories: DirectoryNode[] = Array.from(directorySet)
    .sort()
    .map((dirPath) => {
      const parts = dirPath.split("/");
      const name = parts.pop()!;
      const parentPath = parts.length > 0 ? parts.join("/") : null;
      return { path: dirPath, name, parentPath };
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
 * Store CodeGraph in database (helper for auto-analysis)
 */
function storeCodeGraphInDb(
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
