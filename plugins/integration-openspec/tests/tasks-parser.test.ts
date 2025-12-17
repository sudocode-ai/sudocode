/**
 * Unit tests for OpenSpec tasks parser
 *
 * Tests parsing of OpenSpec tasks.md files including:
 * - Task line matching
 * - Completion status
 * - Indentation levels
 * - Statistics calculation
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  parseTasks,
  parseTasksContent,
  getAllTasks,
  getIncompleteTasks,
  getTaskStats,
  calculateCompletionPercentage,
  isTasksFile,
  TASK_PATTERNS,
  type ParsedTask,
} from "../src/parser/tasks-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesPath = path.join(__dirname, "fixtures", "changes");

describe("OpenSpec Tasks Parser", () => {
  describe("TASK_PATTERNS", () => {
    describe("TASK_LINE pattern", () => {
      it("matches incomplete task", () => {
        const line = "- [ ] Task description";
        const match = line.match(TASK_PATTERNS.TASK_LINE);

        expect(match).not.toBeNull();
        expect(match![1]).toBe(""); // leading space
        expect(match![2]).toBe(" "); // checkbox
        expect(match![3]).toBe("Task description");
      });

      it("matches completed task", () => {
        const line = "- [x] Completed task";
        const match = line.match(TASK_PATTERNS.TASK_LINE);

        expect(match).not.toBeNull();
        expect(match![2]).toBe("x");
        expect(match![3]).toBe("Completed task");
      });

      it("matches task with uppercase X", () => {
        const line = "- [X] Completed task";
        const match = line.match(TASK_PATTERNS.TASK_LINE);

        expect(match).not.toBeNull();
        expect(match![2]).toBe("X");
      });

      it("matches indented task", () => {
        const line = "  - [ ] Nested task";
        const match = line.match(TASK_PATTERNS.TASK_LINE);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("  "); // 2 spaces
        expect(match![3]).toBe("Nested task");
      });

      it("matches deeply indented task", () => {
        const line = "    - [ ] Deeply nested task";
        const match = line.match(TASK_PATTERNS.TASK_LINE);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("    "); // 4 spaces
      });

      it("does not match non-task lines", () => {
        expect("- Regular list item".match(TASK_PATTERNS.TASK_LINE)).toBeNull();
        expect("Some text".match(TASK_PATTERNS.TASK_LINE)).toBeNull();
        expect("## Heading".match(TASK_PATTERNS.TASK_LINE)).toBeNull();
        expect("-[ ] No space".match(TASK_PATTERNS.TASK_LINE)).toBeNull();
      });
    });
  });

  describe("parseTasksContent", () => {
    it("parses simple task list", () => {
      const content = `# Tasks

- [ ] First task
- [x] Second task
- [ ] Third task
`;
      const result = parseTasksContent(content);

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].description).toBe("First task");
      expect(result.tasks[0].completed).toBe(false);
      expect(result.tasks[1].completed).toBe(true);
      expect(result.tasks[2].completed).toBe(false);
    });

    it("calculates correct statistics", () => {
      const content = `- [ ] Task 1
- [x] Task 2
- [x] Task 3
- [ ] Task 4
`;
      const result = parseTasksContent(content);

      expect(result.stats.total).toBe(4);
      expect(result.stats.completed).toBe(2);
      expect(result.stats.incomplete).toBe(2);
      expect(result.completionPercentage).toBe(50);
    });

    it("handles empty content", () => {
      const result = parseTasksContent("");

      expect(result.tasks).toHaveLength(0);
      expect(result.stats.total).toBe(0);
      expect(result.completionPercentage).toBe(0);
    });

    it("tracks line numbers correctly", () => {
      const content = `# Tasks

- [ ] First task
- [x] Second task
`;
      const result = parseTasksContent(content);

      expect(result.tasks[0].lineNumber).toBe(3);
      expect(result.tasks[1].lineNumber).toBe(4);
    });

    it("calculates indent levels", () => {
      const content = `- [ ] Top level
  - [ ] Nested once
    - [ ] Nested twice
`;
      const result = parseTasksContent(content);

      expect(result.tasks[0].indentLevel).toBe(0);
      expect(result.tasks[1].indentLevel).toBe(1);
      expect(result.tasks[2].indentLevel).toBe(2);
    });

    it("preserves raw line content", () => {
      const content = `- [ ] Task with **bold** text`;
      const result = parseTasksContent(content);

      expect(result.tasks[0].rawLine).toBe("- [ ] Task with **bold** text");
    });
  });

  describe("parseTasks (file)", () => {
    it("parses add-scaffold-command tasks.md", () => {
      const filePath = path.join(
        fixturesPath,
        "add-scaffold-command",
        "tasks.md"
      );
      const result = parseTasks(filePath);

      expect(result).not.toBeNull();
      expect(result!.tasks).toHaveLength(4);
      expect(result!.stats.completed).toBe(2);
      expect(result!.stats.incomplete).toBe(2);
      expect(result!.completionPercentage).toBe(50);
    });

    it("parses archived change tasks.md with 100% completion", () => {
      const filePath = path.join(
        fixturesPath,
        "archive",
        "2024-01-15-completed-feature",
        "tasks.md"
      );
      const result = parseTasks(filePath);

      expect(result).not.toBeNull();
      expect(result!.tasks).toHaveLength(3);
      expect(result!.stats.completed).toBe(3);
      expect(result!.completionPercentage).toBe(100);
    });

    it("returns null for non-existent file", () => {
      const result = parseTasks("/non/existent/file.md");
      expect(result).toBeNull();
    });
  });

  describe("getAllTasks", () => {
    it("returns all tasks from file", () => {
      const filePath = path.join(
        fixturesPath,
        "add-scaffold-command",
        "tasks.md"
      );
      const tasks = getAllTasks(filePath);

      expect(tasks).toHaveLength(4);
    });

    it("returns empty array for non-existent file", () => {
      const tasks = getAllTasks("/non/existent/file.md");
      expect(tasks).toEqual([]);
    });
  });

  describe("getIncompleteTasks", () => {
    it("returns only incomplete tasks", () => {
      const filePath = path.join(
        fixturesPath,
        "add-scaffold-command",
        "tasks.md"
      );
      const tasks = getIncompleteTasks(filePath);

      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => !t.completed)).toBe(true);
    });
  });

  describe("getTaskStats", () => {
    it("returns correct statistics", () => {
      const filePath = path.join(
        fixturesPath,
        "add-scaffold-command",
        "tasks.md"
      );
      const stats = getTaskStats(filePath);

      expect(stats).not.toBeNull();
      expect(stats!.total).toBe(4);
      expect(stats!.completed).toBe(2);
      expect(stats!.incomplete).toBe(2);
      expect(stats!.completionPercentage).toBe(50);
    });

    it("returns null for non-existent file", () => {
      const stats = getTaskStats("/non/existent/file.md");
      expect(stats).toBeNull();
    });
  });

  describe("calculateCompletionPercentage", () => {
    it("calculates percentage correctly", () => {
      const tasks: ParsedTask[] = [
        {
          description: "Task 1",
          completed: true,
          lineNumber: 1,
          indentLevel: 0,
          rawLine: "",
        },
        {
          description: "Task 2",
          completed: true,
          lineNumber: 2,
          indentLevel: 0,
          rawLine: "",
        },
        {
          description: "Task 3",
          completed: false,
          lineNumber: 3,
          indentLevel: 0,
          rawLine: "",
        },
        {
          description: "Task 4",
          completed: false,
          lineNumber: 4,
          indentLevel: 0,
          rawLine: "",
        },
      ];

      expect(calculateCompletionPercentage(tasks)).toBe(50);
    });

    it("returns 0 for empty array", () => {
      expect(calculateCompletionPercentage([])).toBe(0);
    });

    it("returns 100 for all completed", () => {
      const tasks: ParsedTask[] = [
        {
          description: "Task 1",
          completed: true,
          lineNumber: 1,
          indentLevel: 0,
          rawLine: "",
        },
      ];

      expect(calculateCompletionPercentage(tasks)).toBe(100);
    });

    it("rounds to nearest integer", () => {
      const tasks: ParsedTask[] = [
        {
          description: "Task 1",
          completed: true,
          lineNumber: 1,
          indentLevel: 0,
          rawLine: "",
        },
        {
          description: "Task 2",
          completed: false,
          lineNumber: 2,
          indentLevel: 0,
          rawLine: "",
        },
        {
          description: "Task 3",
          completed: false,
          lineNumber: 3,
          indentLevel: 0,
          rawLine: "",
        },
      ];

      expect(calculateCompletionPercentage(tasks)).toBe(33); // 33.33... rounded
    });
  });

  describe("isTasksFile", () => {
    it("returns true for valid tasks file", () => {
      const filePath = path.join(
        fixturesPath,
        "add-scaffold-command",
        "tasks.md"
      );
      expect(isTasksFile(filePath)).toBe(true);
    });

    it("returns false for non-existent file", () => {
      expect(isTasksFile("/non/existent/file.md")).toBe(false);
    });

    it("returns false for file without tasks", () => {
      const filePath = path.join(
        fixturesPath,
        "improve-cli-output",
        "proposal.md"
      );
      expect(isTasksFile(filePath)).toBe(false);
    });
  });
});
