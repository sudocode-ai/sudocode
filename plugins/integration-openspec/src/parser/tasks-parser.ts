/**
 * Tasks Parser for OpenSpec Integration
 *
 * Parses tasks.md files from OpenSpec change directories and extracts tasks.
 *
 * OpenSpec tasks.md format (simpler than spec-kit):
 * ```markdown
 * # Tasks
 *
 * - [ ] First task to complete
 * - [x] Completed task
 * - [ ] Another incomplete task
 *   - [ ] Nested subtask (if any)
 * ```
 *
 * Task format: `- [ ] Description`
 * - Checkbox: `[ ]` (incomplete) or `[x]` (complete)
 * - Description: Rest of the line
 * - Indentation: Optional nesting via leading spaces
 */

import { readFileSync, existsSync } from "fs";

/**
 * Parsed task from an OpenSpec tasks.md file
 */
export interface ParsedTask {
  /** Task description */
  description: string;
  /** Whether the task is completed */
  completed: boolean;
  /** Line number in the source file (1-indexed) */
  lineNumber: number;
  /** Indentation level (for nested tasks) */
  indentLevel: number;
  /** Raw line from the file */
  rawLine: string;
}

/**
 * Parsed result from an OpenSpec tasks.md file
 */
export interface ParsedTasksFile {
  /** Array of parsed tasks */
  tasks: ParsedTask[];
  /** Source file path */
  filePath: string;
  /** Summary statistics */
  stats: {
    total: number;
    completed: number;
    incomplete: number;
  };
  /** Completion percentage (0-100) */
  completionPercentage: number;
}

/**
 * Regex patterns for OpenSpec task parsing
 */
export const TASK_PATTERNS = {
  /** Match task line: - [ ] Description or - [x] Description (requires space after hyphen) */
  TASK_LINE: /^(\s*)-\s+\[([ xX])\]\s*(.+)$/,
};

/**
 * Parse an OpenSpec tasks.md file and extract all tasks
 *
 * @param filePath - Absolute path to the tasks.md file
 * @returns Parsed tasks data or null if file doesn't exist
 *
 * @example
 * const tasksFile = parseTasks("/project/openspec/changes/add-feature/tasks.md");
 * console.log(tasksFile?.tasks.length); // 5
 * console.log(tasksFile?.completionPercentage); // 40
 */
export function parseTasks(filePath: string): ParsedTasksFile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return parseTasksContent(content, filePath);
  } catch (error) {
    console.error(`[tasks-parser] Failed to parse ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse tasks content from a string (for testing or in-memory parsing)
 *
 * @param content - Markdown content string
 * @param filePath - Optional file path for reference
 * @returns Parsed tasks data
 */
export function parseTasksContent(
  content: string,
  filePath: string = "<string>"
): ParsedTasksFile {
  const lines = content.split("\n");
  const tasks: ParsedTask[] = [];

  // Parse each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    // Check for task line
    const taskMatch = line.match(TASK_PATTERNS.TASK_LINE);
    if (taskMatch) {
      const task = parseTaskLine(line, taskMatch, lineNumber);
      tasks.push(task);
    }
  }

  // Calculate stats
  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    incomplete: tasks.filter((t) => !t.completed).length,
  };

  // Calculate completion percentage
  const completionPercentage =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return {
    tasks,
    filePath,
    stats,
    completionPercentage,
  };
}

/**
 * Parse a single task line
 */
function parseTaskLine(
  line: string,
  match: RegExpMatchArray,
  lineNumber: number
): ParsedTask {
  const [, leadingSpace, checkbox, description] = match;

  // Calculate indent level (2 spaces = 1 level)
  const indentLevel = Math.floor(leadingSpace.length / 2);

  return {
    description: description.trim(),
    completed: checkbox.toLowerCase() === "x",
    lineNumber,
    indentLevel,
    rawLine: line,
  };
}

/**
 * Get all tasks from a file as a simple array
 *
 * @param filePath - Path to the tasks file
 * @returns Array of parsed tasks or empty array
 */
export function getAllTasks(filePath: string): ParsedTask[] {
  const result = parseTasks(filePath);
  return result?.tasks || [];
}

/**
 * Get incomplete tasks from a file
 *
 * @param filePath - Path to the tasks file
 * @returns Array of incomplete tasks
 */
export function getIncompleteTasks(filePath: string): ParsedTask[] {
  const tasks = getAllTasks(filePath);
  return tasks.filter((t) => !t.completed);
}

/**
 * Get task completion statistics
 *
 * @param filePath - Path to the tasks file
 * @returns Statistics object or null
 */
export function getTaskStats(filePath: string): {
  total: number;
  completed: number;
  incomplete: number;
  completionPercentage: number;
} | null {
  const result = parseTasks(filePath);
  if (!result) return null;

  return {
    ...result.stats,
    completionPercentage: result.completionPercentage,
  };
}

/**
 * Calculate completion percentage from tasks array
 *
 * @param tasks - Array of parsed tasks
 * @returns Completion percentage (0-100)
 */
export function calculateCompletionPercentage(tasks: ParsedTask[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter((t) => t.completed).length;
  return Math.round((completed / tasks.length) * 100);
}

/**
 * Check if a file appears to be a valid tasks.md file
 *
 * @param filePath - Path to check
 * @returns true if the file looks like a tasks file
 */
export function isTasksFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 30); // Check first 30 lines

    // Look for task-like lines
    for (const line of lines) {
      if (TASK_PATTERNS.TASK_LINE.test(line)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
