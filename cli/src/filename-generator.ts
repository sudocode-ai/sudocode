/**
 * Generate human-readable filenames from spec titles
 */

import * as fs from 'fs';
import * as path from 'path';

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
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_')          // Replace multiple underscores with single
    .replace(/^_|_$/g, '')        // Trim underscores from start/end
    .slice(0, maxLength);         // Truncate to max length
}

/**
 * Generate a unique filename based on title, with ID suffix if collision
 * @param title - The spec title
 * @param id - The spec ID (used for collision resolution)
 * @param directory - Directory to check for collisions
 * @param extension - File extension (default: .md)
 * @returns Unique filename
 */
export function generateUniqueFilename(
  title: string,
  id: string,
  directory: string,
  extension: string = '.md'
): string {
  const baseFilename = titleToFilename(title);

  // Try base filename first
  const baseFile = baseFilename + extension;
  const basePath = path.join(directory, baseFile);

  // If file doesn't exist, use base filename
  if (!fs.existsSync(basePath)) {
    return baseFile;
  }

  // Check if existing file is for the same spec (by reading its frontmatter ID)
  try {
    const existingContent = fs.readFileSync(basePath, 'utf8');
    const idMatch = existingContent.match(/^---\s*\n[\s\S]*?^id:\s*['"]?([^'"\n]+)['"]?\s*$/m);

    if (idMatch && idMatch[1] === id) {
      // Same spec, use the existing filename
      return baseFile;
    }
  } catch (error) {
    // If we can't read the file, assume it's a collision
  }

  // Collision detected - append ID
  const collisionFilename = `${baseFilename}_${id}${extension}`;
  return collisionFilename;
}

/**
 * Find existing markdown file for a spec (supports both naming conventions)
 * @param specId - The spec ID
 * @param directory - Directory to search
 * @param title - Optional title for title-based search
 * @returns Path to existing file if found, null otherwise
 */
export function findExistingSpecFile(
  specId: string,
  directory: string,
  title?: string
): string | null {
  // Try ID-based filename first (legacy)
  const idBasedFile = path.join(directory, `${specId}.md`);
  if (fs.existsSync(idBasedFile)) {
    return idBasedFile;
  }

  // Try title-based filename
  if (title) {
    const titleBasedFile = path.join(directory, `${titleToFilename(title)}.md`);
    if (fs.existsSync(titleBasedFile)) {
      // Verify it's the right spec by checking ID in frontmatter
      try {
        const content = fs.readFileSync(titleBasedFile, 'utf8');
        const idMatch = content.match(/^---\s*\n[\s\S]*?^id:\s*['"]?([^'"\n]+)['"]?\s*$/m);
        if (idMatch && idMatch[1] === specId) {
          return titleBasedFile;
        }
      } catch (error) {
        // Continue searching
      }
    }

    // Try title-based with ID suffix
    const titleWithIdFile = path.join(directory, `${titleToFilename(title)}_${specId}.md`);
    if (fs.existsSync(titleWithIdFile)) {
      return titleWithIdFile;
    }
  }

  // Not found
  return null;
}
