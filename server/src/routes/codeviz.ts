/**
 * CodeViz API routes
 *
 * Provides REST API for codebase visualization.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { execSync } from "child_process";

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

  return router;
}
