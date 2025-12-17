/**
 * Tasks Writer for OpenSpec Integration
 *
 * Writes updates to tasks.md files in OpenSpec change directories.
 * Used for bidirectional sync when sudocode issues are updated.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { TASK_PATTERNS } from "../parser/tasks-parser.js";

/**
 * Update all task checkboxes in a tasks.md file
 *
 * @param filePath - Path to the tasks.md file
 * @param completed - Whether all tasks should be marked as completed
 * @returns true if file was updated, false if no changes needed or file doesn't exist
 */
export function updateAllTasksCompletion(
  filePath: string,
  completed: boolean
): boolean {
  if (!existsSync(filePath)) {
    console.log(`[tasks-writer] File not found: ${filePath}`);
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let modified = false;

    const updatedLines = lines.map((line) => {
      const match = line.match(TASK_PATTERNS.TASK_LINE);
      if (match) {
        const [, leadingSpace, checkbox, description] = match;
        const isCompleted = checkbox.toLowerCase() === "x";

        // Only modify if state needs to change
        if (completed && !isCompleted) {
          modified = true;
          return `${leadingSpace}- [x] ${description}`;
        } else if (!completed && isCompleted) {
          modified = true;
          return `${leadingSpace}- [ ] ${description}`;
        }
      }
      return line;
    });

    if (modified) {
      writeFileSync(filePath, updatedLines.join("\n"));
      console.log(
        `[tasks-writer] Updated tasks in ${filePath} to completed=${completed}`
      );
      return true;
    }

    console.log(`[tasks-writer] No changes needed for ${filePath}`);
    return false;
  } catch (error) {
    console.error(`[tasks-writer] Error updating ${filePath}:`, error);
    return false;
  }
}

/**
 * Update a specific task by line number
 *
 * @param filePath - Path to the tasks.md file
 * @param lineNumber - 1-indexed line number of the task
 * @param completed - Whether the task should be marked as completed
 * @returns true if task was updated
 */
export function updateTaskByLine(
  filePath: string,
  lineNumber: number,
  completed: boolean
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const lineIndex = lineNumber - 1; // Convert to 0-indexed

    if (lineIndex < 0 || lineIndex >= lines.length) {
      console.error(`[tasks-writer] Line ${lineNumber} out of range`);
      return false;
    }

    const line = lines[lineIndex];
    const match = line.match(TASK_PATTERNS.TASK_LINE);

    if (!match) {
      console.error(`[tasks-writer] Line ${lineNumber} is not a task line`);
      return false;
    }

    const [, leadingSpace, checkbox, description] = match;
    const isCompleted = checkbox.toLowerCase() === "x";

    // Only modify if state needs to change
    if (completed !== isCompleted) {
      const newCheckbox = completed ? "x" : " ";
      lines[lineIndex] = `${leadingSpace}- [${newCheckbox}] ${description}`;
      writeFileSync(filePath, lines.join("\n"));
      console.log(
        `[tasks-writer] Updated task at line ${lineNumber} to completed=${completed}`
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[tasks-writer] Error updating task:`, error);
    return false;
  }
}

/**
 * Update a task by matching its description
 *
 * @param filePath - Path to the tasks.md file
 * @param description - Task description to match (case-insensitive)
 * @param completed - Whether the task should be marked as completed
 * @returns true if task was found and updated
 */
export function updateTaskByDescription(
  filePath: string,
  description: string,
  completed: boolean
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const searchLower = description.toLowerCase().trim();
    let modified = false;

    const updatedLines = lines.map((line) => {
      if (modified) return line; // Only update first match

      const match = line.match(TASK_PATTERNS.TASK_LINE);
      if (match) {
        const [, leadingSpace, checkbox, taskDesc] = match;
        if (taskDesc.toLowerCase().trim() === searchLower) {
          const isCompleted = checkbox.toLowerCase() === "x";
          if (completed !== isCompleted) {
            modified = true;
            const newCheckbox = completed ? "x" : " ";
            return `${leadingSpace}- [${newCheckbox}] ${taskDesc}`;
          }
        }
      }
      return line;
    });

    if (modified) {
      writeFileSync(filePath, updatedLines.join("\n"));
      console.log(
        `[tasks-writer] Updated task "${description}" to completed=${completed}`
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[tasks-writer] Error updating task:`, error);
    return false;
  }
}
