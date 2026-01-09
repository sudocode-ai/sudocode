/**
 * File Handler for ACP Agent Executions
 *
 * Provides basic passthrough handlers for file operations requested by ACP agents.
 * All file paths are resolved relative to the working directory.
 *
 * @module execution/handlers/file-handler
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, resolve, relative, isAbsolute } from "path";

/**
 * FileHandler
 *
 * Handles file read/write operations for agent tool calls.
 * All paths are validated and resolved relative to workDir.
 */
export class FileHandler {
  constructor(private readonly workDir: string) {}

  /**
   * Read a file from disk
   *
   * Resolves the path relative to workDir and returns file contents.
   *
   * @param path - File path (absolute or relative to workDir)
   * @returns File contents as string
   * @throws Error if file cannot be read or is outside workDir
   */
  async onRead(path: string): Promise<string> {
    const resolvedPath = this.resolvePath(path);

    console.log(`[FileHandler] Reading file`, {
      requestedPath: path,
      resolvedPath,
      workDir: this.workDir,
    });

    // Validate path is within workDir
    this.validatePath(resolvedPath);

    try {
      const content = await readFile(resolvedPath, "utf-8");
      console.log(
        `[FileHandler] Read ${content.length} chars from ${path}`
      );
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FileHandler] Failed to read ${path}:`, message);
      throw new Error(`Failed to read file ${path}: ${message}`);
    }
  }

  /**
   * Write a file to disk
   *
   * Resolves the path relative to workDir and writes content.
   * Creates parent directories if they don't exist.
   *
   * @param path - File path (absolute or relative to workDir)
   * @param content - Content to write
   * @throws Error if file cannot be written or is outside workDir
   */
  async onWrite(path: string, content: string): Promise<void> {
    const resolvedPath = this.resolvePath(path);

    console.log(`[FileHandler] Writing file`, {
      requestedPath: path,
      resolvedPath,
      workDir: this.workDir,
      contentLength: content.length,
    });

    // Validate path is within workDir
    this.validatePath(resolvedPath);

    try {
      // Ensure parent directory exists
      await mkdir(dirname(resolvedPath), { recursive: true });

      await writeFile(resolvedPath, content, "utf-8");
      console.log(
        `[FileHandler] Wrote ${content.length} chars to ${path}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FileHandler] Failed to write ${path}:`, message);
      throw new Error(`Failed to write file ${path}: ${message}`);
    }
  }

  /**
   * Resolve a path relative to workDir
   *
   * If the path is absolute, it's used directly (but validated).
   * If relative, it's resolved against workDir.
   *
   * @param path - File path
   * @returns Resolved absolute path
   */
  private resolvePath(path: string): string {
    if (isAbsolute(path)) {
      return path;
    }
    return resolve(this.workDir, path);
  }

  /**
   * Validate that a path is within workDir
   *
   * Prevents path traversal attacks by ensuring the resolved path
   * is within the working directory.
   *
   * @param resolvedPath - Absolute resolved path
   * @throws Error if path is outside workDir
   */
  private validatePath(resolvedPath: string): void {
    const relativePath = relative(this.workDir, resolvedPath);

    // If the relative path starts with "..", it's outside workDir
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(
        `Path ${resolvedPath} is outside the working directory ${this.workDir}`
      );
    }
  }
}
