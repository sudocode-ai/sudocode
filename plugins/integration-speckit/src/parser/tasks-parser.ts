/**
 * Tasks Parser for Spec-Kit Integration
 *
 * Parses tasks.md files from spec-kit and extracts individual tasks.
 *
 * Expected format:
 * ```markdown
 * # Tasks
 *
 * ## Phase 1: Foundation
 *
 * - [ ] T001 [P] Setup project structure
 * - [ ] T002 [US1] Create user model
 * - [x] T003: Completed task
 *
 * ## Phase 2: Implementation
 *
 * - [ ] T004 [P] [US2] Implement authentication
 * ```
 *
 * Task format: `- [ ] T001 [P?] [US?] Description`
 * - Checkbox: `[ ]` (incomplete) or `[x]` (complete)
 * - Task ID: T followed by digits (T001, T002, etc.)
 * - Parallelizable: Optional `[P]` marker
 * - User Story: Optional `[US1]`, `[US2]`, etc.
 * - Description: Rest of the line
 */

import { readFileSync, existsSync } from "fs";
import {
  PATTERNS,
  extractMetadata,
  extractTitle,
  cleanTaskDescription,
  parseDate,
} from "./markdown-utils.js";

/**
 * Parsed task from a tasks.md file
 */
export interface ParsedTask {
  /** Task identifier (e.g., "T001") */
  taskId: string;
  /** Task description (cleaned of markers) */
  description: string;
  /** Whether the task is completed */
  completed: boolean;
  /** Whether the task can be done in parallel with others */
  parallelizable: boolean;
  /** User story reference if present (e.g., "1", "2") */
  userStory: string | null;
  /** Phase number if the task is in a phase section */
  phase: number | null;
  /** Phase name if available */
  phaseName: string | null;
  /** Line number in the source file (1-indexed) */
  lineNumber: number;
  /** Indentation level (for nested tasks) */
  indentLevel: number;
  /** Raw line from the file */
  rawLine: string;
}

/**
 * Parsed result from a tasks.md file
 */
export interface ParsedTasksFile {
  /** Optional title from the file */
  title: string | null;
  /** All metadata key-value pairs */
  metadata: Map<string, string>;
  /** Array of parsed tasks */
  tasks: ParsedTask[];
  /** Map of phase number to phase name */
  phases: Map<number, string>;
  /** Source file path */
  filePath: string;
  /** Summary statistics */
  stats: {
    total: number;
    completed: number;
    incomplete: number;
    parallelizable: number;
  };
}

/**
 * Options for parsing tasks files
 */
export interface ParseTasksOptions {
  /** Filter to only include tasks in specific phases */
  filterPhases?: number[];
  /** Filter to only include incomplete tasks */
  incompleteOnly?: boolean;
  /** Filter to only include parallelizable tasks */
  parallelizableOnly?: boolean;
}

/**
 * Parse a tasks.md file and extract all tasks
 *
 * @param filePath - Absolute path to the tasks.md file
 * @param options - Parsing options
 * @returns Parsed tasks data or null if file doesn't exist
 *
 * @example
 * const tasksFile = parseTasks("/project/.specify/specs/001-auth/tasks.md");
 * console.log(tasksFile?.tasks.length); // 10
 * console.log(tasksFile?.stats.completed); // 3
 */
export function parseTasks(
  filePath: string,
  options: ParseTasksOptions = {}
): ParsedTasksFile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return parseTasksContent(content, filePath, options);
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
 * @param options - Parsing options
 * @returns Parsed tasks data or null
 */
export function parseTasksContent(
  content: string,
  filePath: string = "<string>",
  options: ParseTasksOptions = {}
): ParsedTasksFile | null {
  const lines = content.split("\n");
  const tasks: ParsedTask[] = [];
  const phases: Map<number, string> = new Map();

  // Extract title and metadata
  const title = extractTitle(lines);
  const metadata = extractMetadata(lines);

  // Track current phase
  let currentPhase: number | null = null;
  let currentPhaseName: string | null = null;

  // Parse each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    // Check for phase header
    const phaseMatch = line.match(PATTERNS.PHASE_HEADER);
    if (phaseMatch) {
      currentPhase = parseInt(phaseMatch[1], 10);
      currentPhaseName = phaseMatch[2]?.trim() || null;
      phases.set(currentPhase, currentPhaseName || `Phase ${currentPhase}`);
      continue;
    }

    // Check for task line
    const taskMatch = line.match(PATTERNS.TASK_LINE);
    if (taskMatch) {
      const task = parseTaskLine(
        line,
        taskMatch,
        lineNumber,
        currentPhase,
        currentPhaseName
      );

      // Apply filters
      if (shouldIncludeTask(task, options)) {
        tasks.push(task);
      }
    }
  }

  // Calculate stats
  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    incomplete: tasks.filter((t) => !t.completed).length,
    parallelizable: tasks.filter((t) => t.parallelizable).length,
  };

  return {
    title,
    metadata,
    tasks,
    phases,
    filePath,
    stats,
  };
}

/**
 * Parse a single task line
 */
function parseTaskLine(
  line: string,
  match: RegExpMatchArray,
  lineNumber: number,
  phase: number | null,
  phaseName: string | null
): ParsedTask {
  const [, leadingSpace, checkbox, taskId, rest] = match;

  // Calculate indent level (2 spaces = 1 level)
  const indentLevel = Math.floor(leadingSpace.replace("-", "").length / 2);

  // Check for parallelizable marker
  const parallelizable = PATTERNS.PARALLELIZABLE.test(rest);

  // Check for user story marker
  const userStoryMatch = rest.match(PATTERNS.USER_STORY);
  const userStory = userStoryMatch ? userStoryMatch[1] : null;

  // Clean description
  const description = cleanTaskDescription(rest);

  return {
    taskId,
    description,
    completed: checkbox.toLowerCase() === "x",
    parallelizable,
    userStory,
    phase,
    phaseName,
    lineNumber,
    indentLevel,
    rawLine: line,
  };
}

/**
 * Check if a task should be included based on filters
 */
function shouldIncludeTask(
  task: ParsedTask,
  options: ParseTasksOptions
): boolean {
  // Phase filter
  if (options.filterPhases && options.filterPhases.length > 0) {
    if (task.phase === null || !options.filterPhases.includes(task.phase)) {
      return false;
    }
  }

  // Incomplete only filter
  if (options.incompleteOnly && task.completed) {
    return false;
  }

  // Parallelizable only filter
  if (options.parallelizableOnly && !task.parallelizable) {
    return false;
  }

  return true;
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
 * Get a specific task by ID
 *
 * @param filePath - Path to the tasks file
 * @param taskId - Task ID to find (e.g., "T001")
 * @returns The task or null if not found
 */
export function getTaskById(
  filePath: string,
  taskId: string
): ParsedTask | null {
  const tasks = getAllTasks(filePath);
  return tasks.find((t) => t.taskId === taskId) || null;
}

/**
 * Get incomplete tasks ready for work (not blocked by dependencies)
 *
 * @param filePath - Path to the tasks file
 * @returns Array of incomplete tasks
 */
export function getIncompleteTasks(filePath: string): ParsedTask[] {
  const result = parseTasks(filePath, { incompleteOnly: true });
  return result?.tasks || [];
}

/**
 * Get tasks that can be worked on in parallel
 *
 * @param filePath - Path to the tasks file
 * @returns Array of parallelizable incomplete tasks
 */
export function getParallelizableTasks(filePath: string): ParsedTask[] {
  const result = parseTasks(filePath, {
    incompleteOnly: true,
    parallelizableOnly: true,
  });
  return result?.tasks || [];
}

/**
 * Get tasks grouped by phase
 *
 * @param filePath - Path to the tasks file
 * @returns Map of phase number to tasks in that phase
 */
export function getTasksByPhase(filePath: string): Map<number, ParsedTask[]> {
  const result = parseTasks(filePath);
  const byPhase = new Map<number, ParsedTask[]>();

  if (!result) return byPhase;

  for (const task of result.tasks) {
    const phase = task.phase ?? 0; // Default to phase 0 for tasks without phase
    const phaseTasks = byPhase.get(phase) || [];
    phaseTasks.push(task);
    byPhase.set(phase, phaseTasks);
  }

  return byPhase;
}

/**
 * Get tasks grouped by user story
 *
 * @param filePath - Path to the tasks file
 * @returns Map of user story ID to tasks
 */
export function getTasksByUserStory(
  filePath: string
): Map<string | null, ParsedTask[]> {
  const result = parseTasks(filePath);
  const byUserStory = new Map<string | null, ParsedTask[]>();

  if (!result) return byUserStory;

  for (const task of result.tasks) {
    const storyTasks = byUserStory.get(task.userStory) || [];
    storyTasks.push(task);
    byUserStory.set(task.userStory, storyTasks);
  }

  return byUserStory;
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
      if (PATTERNS.TASK_LINE.test(line)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
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
  parallelizable: number;
  completionRate: number;
} | null {
  const result = parseTasks(filePath);
  if (!result) return null;

  return {
    ...result.stats,
    completionRate:
      result.stats.total > 0
        ? Math.round((result.stats.completed / result.stats.total) * 100)
        : 0,
  };
}
