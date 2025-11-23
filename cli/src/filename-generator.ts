/**
 * Generate human-readable filenames from spec titles
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Convert a title to snake_case filename
 * - Lowercase
 * - Replace spaces and special chars with underscores
 * - Remove consecutive underscores
 * - Trim underscores from start/end
 * - Truncate to reasonable length
 */
export function titleToFilename(title: string, maxLength: number = 50): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
    .replace(/_+/g, "_") // Replace multiple underscores with single
    .replace(/^_|_$/g, "") // Trim underscores from start/end
    .slice(0, maxLength); // Truncate to max length
}

/**
 * Generate a unified filename with format: {id}_{title_slug}.md
 * This format is used for both specs and issues to ensure consistency.
 * @param title - The entity title
 * @param id - The entity ID
 * @param extension - File extension (default: .md)
 * @returns Filename in format: {id}_{title_slug}.md
 */
export function generateUniqueFilename(
  title: string,
  id: string,
  extension: string = ".md"
): string {
  const titleSlug = titleToFilename(title);
  const filename = `${id}_${titleSlug}${extension}`;
  return filename;
}

/**
 * Find existing markdown file for an entity (supports multiple naming conventions)
 * Works for both specs and issues.
 * @param entityId - The entity ID
 * @param directory - Directory to search
 * @param title - Optional title for title-based search
 * @returns Path to existing file if found, null otherwise
 */
export function findExistingEntityFile(
  entityId: string,
  directory: string,
  title?: string
): string | null {
  // Try new unified format: {id}_{title_slug}.md
  if (title) {
    const unifiedFile = path.join(
      directory,
      `${entityId}_${titleToFilename(title)}.md`
    );
    if (fs.existsSync(unifiedFile)) {
      return unifiedFile;
    }
  }

  // Try ID-based filename (legacy for issues, and legacy specs)
  const idBasedFile = path.join(directory, `${entityId}.md`);
  if (fs.existsSync(idBasedFile)) {
    return idBasedFile;
  }

  // Try title-based filename (legacy for specs)
  if (title) {
    const titleBasedFile = path.join(directory, `${titleToFilename(title)}.md`);
    if (fs.existsSync(titleBasedFile)) {
      // Verify it's the right entity by checking ID in frontmatter
      try {
        const content = fs.readFileSync(titleBasedFile, "utf8");
        const idMatch = content.match(
          /^---\s*\n[\s\S]*?^id:\s*['"]?([^'"\n]+)['"]?\s*$/m
        );
        if (idMatch && idMatch[1] === entityId) {
          return titleBasedFile;
        }
      } catch (error) {
        // Continue searching
      }
    }

    // Try title-based with ID suffix (legacy collision resolution)
    const titleWithIdFile = path.join(
      directory,
      `${titleToFilename(title)}_${entityId}.md`
    );
    if (fs.existsSync(titleWithIdFile)) {
      return titleWithIdFile;
    }
  }

  // Search directory for any file with matching ID in frontmatter
  try {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = path.join(directory, file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const idMatch = content.match(
          /^---\s*\n[\s\S]*?^id:\s*['"]?([^'"\n]+)['"]?\s*$/m
        );
        if (idMatch && idMatch[1] === entityId) {
          return filePath;
        }
      } catch (error) {
        // Skip files we can't read
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }

  // Not found
  return null;
}
