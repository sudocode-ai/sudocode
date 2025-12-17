/**
 * Tasks Writer for Spec-Kit Integration
 *
 * Updates task checkbox status in tasks.md files.
 * Tasks are formatted as: `- [ ] T001: Task description` or `- [x] T001: Task description`
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";

/**
 * Result of a task status update operation
 */
export interface TaskUpdateResult {
  success: boolean;
  error?: string;
  previousStatus?: boolean;
  newStatus?: boolean;
}

/**
 * Regex pattern to match task lines in tasks.md
 * Matches: `- [ ] T001: description` or `- [x] T001: description`
 * Captures:
 * - Group 1: Leading whitespace and bullet
 * - Group 2: Checkbox state (space or x)
 * - Group 3: Task ID (e.g., T001)
 * - Group 4: Rest of line (description)
 */
const TASK_LINE_REGEX = /^(\s*-\s*)\[([ xX])\]\s*(T\d+)(.*)$/;

/**
 * Update a task's checkbox status in a tasks.md file
 *
 * @param tasksFilePath - Absolute path to the tasks.md file
 * @param taskId - Task identifier (e.g., "T001")
 * @param completed - Whether the task should be marked as completed
 * @returns Result of the update operation
 *
 * @example
 * updateTaskStatus("/project/.specify/specs/001-auth/tasks.md", "T001", true);
 * // Changes `- [ ] T001: Setup auth` to `- [x] T001: Setup auth`
 *
 * updateTaskStatus("/project/.specify/specs/001-auth/tasks.md", "T001", false);
 * // Changes `- [x] T001: Setup auth` to `- [ ] T001: Setup auth`
 */
export function updateTaskStatus(
  tasksFilePath: string,
  taskId: string,
  completed: boolean
): TaskUpdateResult {
  // Validate inputs
  if (!tasksFilePath) {
    return { success: false, error: "Tasks file path is required" };
  }

  if (!taskId || !/^T\d+$/.test(taskId)) {
    return {
      success: false,
      error: `Invalid task ID format: ${taskId}. Expected format: T001, T002, etc.`,
    };
  }

  // Check if file exists
  if (!existsSync(tasksFilePath)) {
    return { success: false, error: `Tasks file not found: ${tasksFilePath}` };
  }

  try {
    // Read the file
    const content = readFileSync(tasksFilePath, "utf-8");
    const lines = content.split("\n");

    let taskFound = false;
    let previousStatus: boolean | undefined;
    const newCheckbox = completed ? "x" : " ";

    // Process each line
    const updatedLines = lines.map((line) => {
      const match = line.match(TASK_LINE_REGEX);

      if (match && match[3] === taskId) {
        taskFound = true;
        const [, prefix, currentCheckbox, id, rest] = match;
        previousStatus = currentCheckbox.toLowerCase() === "x";

        // Return updated line with new checkbox state
        return `${prefix}[${newCheckbox}] ${id}${rest}`;
      }

      return line;
    });

    if (!taskFound) {
      return {
        success: false,
        error: `Task ${taskId} not found in ${tasksFilePath}`,
      };
    }

    // Write the updated content atomically
    const updatedContent = updatedLines.join("\n");
    writeFileAtomic(tasksFilePath, updatedContent);

    return {
      success: true,
      previousStatus,
      newStatus: completed,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update task status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get the current status of a task
 *
 * @param tasksFilePath - Absolute path to the tasks.md file
 * @param taskId - Task identifier (e.g., "T001")
 * @returns The task's completion status, or null if not found
 */
export function getTaskStatus(
  tasksFilePath: string,
  taskId: string
): boolean | null {
  if (!existsSync(tasksFilePath)) {
    return null;
  }

  try {
    const content = readFileSync(tasksFilePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(TASK_LINE_REGEX);
      if (match && match[3] === taskId) {
        return match[2].toLowerCase() === "x";
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get all tasks and their statuses from a tasks.md file
 *
 * @param tasksFilePath - Absolute path to the tasks.md file
 * @returns Map of task IDs to their completion status
 */
export function getAllTaskStatuses(
  tasksFilePath: string
): Map<string, boolean> {
  const statuses = new Map<string, boolean>();

  if (!existsSync(tasksFilePath)) {
    return statuses;
  }

  try {
    const content = readFileSync(tasksFilePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(TASK_LINE_REGEX);
      if (match) {
        const taskId = match[3];
        const isCompleted = match[2].toLowerCase() === "x";
        statuses.set(taskId, isCompleted);
      }
    }
  } catch {
    // Return empty map on error
  }

  return statuses;
}

/**
 * Write file atomically using temp file + rename pattern
 *
 * @param filePath - Target file path
 * @param content - Content to write
 */
function writeFileAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tempPath, content, "utf-8");

  // Rename is atomic on most file systems
  renameSync(tempPath, filePath);
}
