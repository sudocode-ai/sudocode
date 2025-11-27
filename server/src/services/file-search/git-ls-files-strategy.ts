/**
 * Git ls-files search strategy
 *
 * Uses `git ls-files` command to search for files in a git repository.
 * This strategy respects .gitignore and is fast for git repositories.
 */

import { execSync } from "child_process"
import type {
  FileSearchStrategy,
  FileSearchOptions,
  FileSearchResult,
} from "./strategy.js"

/**
 * Cache entry for git ls-files output
 */
interface CacheEntry {
  /** Array of file paths from git ls-files */
  files: string[]
  /** Timestamp when this entry was created */
  timestamp: number
}

/**
 * Git ls-files strategy implementation
 *
 * Uses git ls-files to list all tracked files in a repository,
 * then filters and ranks them based on the search query.
 *
 * Features:
 * - Respects .gitignore automatically
 * - Fast for git repositories
 * - 5 second cache to reduce repeated git calls
 * - Graceful fallback for non-git directories
 */
export class GitLsFilesStrategy implements FileSearchStrategy {
  private cache: Map<string, CacheEntry> = new Map()
  private readonly cacheTTL = 5000 // 5 seconds in milliseconds

  getName(): string {
    return "git-ls-files"
  }

  /**
   * Search for files matching the query
   *
   * @param workspacePath - Absolute path to workspace root
   * @param options - Search options
   * @returns Matching files sorted by relevance
   */
  async search(
    workspacePath: string,
    options: FileSearchOptions
  ): Promise<FileSearchResult[]> {
    const { query, limit, includeDirectories } = options

    // Empty query returns empty results
    if (!query || query.trim().length === 0) {
      return []
    }

    try {
      // Get all files from git (cached)
      const allFiles = await this.getCachedFiles(workspacePath)

      // Filter directories if requested
      let filesToSearch = allFiles
      if (!includeDirectories) {
        // git ls-files only returns files by default, so no filtering needed
        // but we keep this for consistency with other strategies
        filesToSearch = allFiles.filter((path) => !path.endsWith("/"))
      }

      // Match and rank files
      const matches = filesToSearch
        .map((path) => this.matchFile(path, query))
        .filter((result): result is FileSearchResult => result !== null)
        .sort((a, b) => this.compareMatchQuality(a, b))
        .slice(0, limit)

      return matches
    } catch (error) {
      // Log error but don't throw - gracefully return empty results
      console.warn(
        `[GitLsFilesStrategy] Failed to search files in ${workspacePath}:`,
        error instanceof Error ? error.message : String(error)
      )
      return []
    }
  }

  /**
   * Get files from git ls-files with caching
   *
   * @param workspacePath - Absolute path to workspace
   * @returns Array of file paths relative to workspace root
   */
  private async getCachedFiles(workspacePath: string): Promise<string[]> {
    const now = Date.now()
    const cached = this.cache.get(workspacePath)

    // Return cached files if still valid
    if (cached && now - cached.timestamp < this.cacheTTL) {
      return cached.files
    }

    // Execute git ls-files
    try {
      const output = execSync("git ls-files", {
        cwd: workspacePath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"], // Ignore stdin, capture stdout, capture stderr
      })

      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      // Cache the results
      this.cache.set(workspacePath, {
        files,
        timestamp: now,
      })

      return files
    } catch (error) {
      // Git command failed (not a git repo, or other error)
      // Clear cache and return empty array
      this.cache.delete(workspacePath)
      throw error
    }
  }

  /**
   * Match a file path against the query
   *
   * @param path - File path relative to workspace root
   * @param query - Search query (case-insensitive)
   * @returns Match result with type, or null if no match
   */
  private matchFile(path: string, query: string): FileSearchResult | null {
    const name = path.split("/").pop()!
    const lowerQuery = query.toLowerCase()
    const lowerPath = path.toLowerCase()
    const lowerName = name.toLowerCase()

    // Exact match on filename
    if (lowerName === lowerQuery) {
      return { path, name, isFile: true, matchType: "exact" }
    }

    // Prefix match on filename
    if (lowerName.startsWith(lowerQuery)) {
      return { path, name, isFile: true, matchType: "prefix" }
    }

    // Prefix match on path
    if (lowerPath.startsWith(lowerQuery)) {
      return { path, name, isFile: true, matchType: "prefix" }
    }

    // Contains match anywhere in path
    if (lowerPath.includes(lowerQuery)) {
      return { path, name, isFile: true, matchType: "contains" }
    }

    // No match
    return null
  }

  /**
   * Compare two match results for sorting
   *
   * Priority:
   * 1. Match type (exact > prefix > contains)
   * 2. Path length (shorter first)
   * 3. Alphabetical
   *
   * @param a - First result
   * @param b - Second result
   * @returns Negative if a < b, positive if a > b, 0 if equal
   */
  private compareMatchQuality(
    a: FileSearchResult,
    b: FileSearchResult
  ): number {
    // Define match type ordering
    const matchOrder = { exact: 0, prefix: 1, contains: 2 }
    const aOrder = matchOrder[a.matchType || "contains"]
    const bOrder = matchOrder[b.matchType || "contains"]

    // Compare by match type first
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }

    // Same match type - shorter paths first
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length
    }

    // Same length - alphabetical
    return a.path.localeCompare(b.path)
  }

  /**
   * Clear the cache (useful for testing or manual invalidation)
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics (useful for debugging/monitoring)
   */
  getCacheStats(): {
    entries: number
    workspaces: string[]
  } {
    return {
      entries: this.cache.size,
      workspaces: Array.from(this.cache.keys()),
    }
  }
}
