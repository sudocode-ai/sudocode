/**
 * Spec Writer for OpenSpec Integration
 *
 * Writes updates to spec.md files in OpenSpec directories.
 * Used for bidirectional sync when sudocode specs are updated.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

/**
 * Update a spec.md file with new content
 *
 * @param filePath - Path to the spec.md file
 * @param content - New content to write
 * @returns true if file was updated
 */
export function updateSpecContent(filePath: string, content: string): boolean {
  if (!existsSync(filePath)) {
    console.log(`[spec-writer] File not found: ${filePath}`);
    return false;
  }

  try {
    const existingContent = readFileSync(filePath, "utf-8");

    // Only write if content actually changed
    if (existingContent.trim() === content.trim()) {
      console.log(`[spec-writer] No changes needed for ${filePath}`);
      return false;
    }

    writeFileSync(filePath, content);
    console.log(`[spec-writer] Updated spec at ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[spec-writer] Error updating ${filePath}:`, error);
    return false;
  }
}

/**
 * Update the title in a spec.md file
 * The title is typically the first H1 heading
 *
 * @param filePath - Path to the spec.md file
 * @param newTitle - New title to set
 * @returns true if title was updated
 */
export function updateSpecTitle(filePath: string, newTitle: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Find and update the first H1 heading
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^#\s+/)) {
        const existingTitle = lines[i].replace(/^#\s+/, "").trim();
        if (existingTitle === newTitle.trim()) {
          return false; // No change needed
        }
        lines[i] = `# ${newTitle.trim()}`;
        writeFileSync(filePath, lines.join("\n"));
        console.log(`[spec-writer] Updated title in ${filePath}`);
        return true;
      }
    }

    // No H1 found, prepend one
    lines.unshift(`# ${newTitle.trim()}`);
    writeFileSync(filePath, lines.join("\n"));
    console.log(`[spec-writer] Added title to ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[spec-writer] Error updating title:`, error);
    return false;
  }
}
