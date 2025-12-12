/**
 * Tests for tasks-parser
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseTasks,
  parseTasksContent,
  getAllTasks,
  getTaskById,
  getIncompleteTasks,
  getParallelizableTasks,
  getTasksByPhase,
  getTasksByUserStory,
  isTasksFile,
  getTaskStats,
} from "../../src/parser/tasks-parser.js";

describe("Tasks Parser", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `speckit-tasks-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("parseTasks", () => {
    it("should parse a basic tasks file", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Setup project structure
- [ ] T002: Create user model
- [x] T003: Write documentation
`
      );

      const result = parseTasks(tasksFile);

      expect(result).not.toBeNull();
      expect(result?.tasks).toHaveLength(3);
      expect(result?.stats.total).toBe(3);
      expect(result?.stats.completed).toBe(1);
      expect(result?.stats.incomplete).toBe(2);
    });

    it("should parse tasks with markers", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001 [P] Setup project structure
- [ ] T002 [US1] Create user model
- [ ] T003 [P] [US2] Implement auth
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].parallelizable).toBe(true);
      expect(result?.tasks[0].userStory).toBeNull();

      expect(result?.tasks[1].parallelizable).toBe(false);
      expect(result?.tasks[1].userStory).toBe("1");

      expect(result?.tasks[2].parallelizable).toBe(true);
      expect(result?.tasks[2].userStory).toBe("2");
    });

    it("should parse tasks with phases", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

## Phase 1: Foundation

- [ ] T001: Setup project
- [ ] T002: Create models

## Phase 2: Implementation

- [ ] T003: Implement API
- [ ] T004: Add tests
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks).toHaveLength(4);
      expect(result?.phases.size).toBe(2);
      expect(result?.phases.get(1)).toBe("Foundation");
      expect(result?.phases.get(2)).toBe("Implementation");

      expect(result?.tasks[0].phase).toBe(1);
      expect(result?.tasks[0].phaseName).toBe("Foundation");
      expect(result?.tasks[2].phase).toBe(2);
      expect(result?.tasks[2].phaseName).toBe("Implementation");
    });

    it("should parse nested tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Parent task
  - [ ] T002: Child task
    - [ ] T003: Grandchild task
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks).toHaveLength(3);
      expect(result?.tasks[0].indentLevel).toBe(0);
      expect(result?.tasks[1].indentLevel).toBe(1);
      expect(result?.tasks[2].indentLevel).toBe(2);
    });

    it("should handle uppercase X in checkbox", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [X] T001: Completed with uppercase
- [x] T002: Completed with lowercase
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].completed).toBe(true);
      expect(result?.tasks[1].completed).toBe(true);
    });

    it("should clean task descriptions", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001 [P] [US1]: Setup authentication
- [ ] T002 [P]   Extra   spaces   here
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].description).toBe("Setup authentication");
      expect(result?.tasks[1].description).toBe("Extra spaces here");
    });

    it("should return null for non-existent file", () => {
      const result = parseTasks(join(testDir, "nonexistent.md"));
      expect(result).toBeNull();
    });

    it("should handle file with no tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

No tasks defined yet.
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks).toHaveLength(0);
      expect(result?.stats.total).toBe(0);
    });

    it("should track line numbers", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: First task

- [ ] T002: Second task
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].lineNumber).toBe(3);
      expect(result?.tasks[1].lineNumber).toBe(5);
    });

    it("should preserve raw line", () => {
      const tasksFile = join(testDir, "tasks.md");
      const rawLine = "- [ ] T001 [P] [US1]: Complex task";
      writeFileSync(tasksFile, `# Tasks\n\n${rawLine}\n`);

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].rawLine).toBe(rawLine);
    });
  });

  describe("parseTasks with filters", () => {
    it("should filter by phase", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

## Phase 1

- [ ] T001: Task in phase 1

## Phase 2

- [ ] T002: Task in phase 2
`
      );

      const result = parseTasks(tasksFile, { filterPhases: [1] });

      expect(result?.tasks).toHaveLength(1);
      expect(result?.tasks[0].taskId).toBe("T001");
    });

    it("should filter incomplete only", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Completed
- [ ] T002: Incomplete
- [x] T003: Also completed
`
      );

      const result = parseTasks(tasksFile, { incompleteOnly: true });

      expect(result?.tasks).toHaveLength(1);
      expect(result?.tasks[0].taskId).toBe("T002");
    });

    it("should filter parallelizable only", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Not parallelizable
- [ ] T002 [P]: Parallelizable
- [ ] T003: Also not parallelizable
`
      );

      const result = parseTasks(tasksFile, { parallelizableOnly: true });

      expect(result?.tasks).toHaveLength(1);
      expect(result?.tasks[0].taskId).toBe("T002");
    });

    it("should combine filters", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

## Phase 1

- [x] T001 [P]: Completed parallelizable in phase 1
- [ ] T002 [P]: Incomplete parallelizable in phase 1
- [ ] T003: Incomplete not parallelizable

## Phase 2

- [ ] T004 [P]: Incomplete parallelizable in phase 2
`
      );

      const result = parseTasks(tasksFile, {
        filterPhases: [1],
        incompleteOnly: true,
        parallelizableOnly: true,
      });

      expect(result?.tasks).toHaveLength(1);
      expect(result?.tasks[0].taskId).toBe("T002");
    });
  });

  describe("parseTasksContent", () => {
    it("should parse tasks content from string", () => {
      const content = `# Tasks

- [ ] T001: First task
- [x] T002: Second task
`;

      const result = parseTasksContent(content);

      expect(result).not.toBeNull();
      expect(result?.tasks).toHaveLength(2);
      expect(result?.filePath).toBe("<string>");
    });

    it("should accept custom file path", () => {
      const content = "# Tasks\n\n- [ ] T001: Task\n";
      const result = parseTasksContent(content, "/custom/path.md");

      expect(result?.filePath).toBe("/custom/path.md");
    });
  });

  describe("getAllTasks", () => {
    it("should return all tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: First
- [ ] T002: Second
`
      );

      const tasks = getAllTasks(tasksFile);

      expect(tasks).toHaveLength(2);
    });

    it("should return empty array for non-existent file", () => {
      const tasks = getAllTasks(join(testDir, "nonexistent.md"));
      expect(tasks).toHaveLength(0);
    });
  });

  describe("getTaskById", () => {
    it("should find task by ID", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: First
- [ ] T002: Second
- [ ] T003: Third
`
      );

      const task = getTaskById(tasksFile, "T002");

      expect(task).not.toBeNull();
      expect(task?.description).toBe("Second");
    });

    it("should return null for non-existent task", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(tasksFile, "# Tasks\n\n- [ ] T001: Only task\n");

      const task = getTaskById(tasksFile, "T999");

      expect(task).toBeNull();
    });
  });

  describe("getIncompleteTasks", () => {
    it("should return only incomplete tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Done
- [ ] T002: Not done
- [x] T003: Also done
- [ ] T004: Also not done
`
      );

      const tasks = getIncompleteTasks(tasksFile);

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.taskId)).toEqual(["T002", "T004"]);
    });
  });

  describe("getParallelizableTasks", () => {
    it("should return only incomplete parallelizable tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001 [P]: Done parallelizable
- [ ] T002 [P]: Not done parallelizable
- [ ] T003: Not parallelizable
- [ ] T004 [P]: Another parallelizable
`
      );

      const tasks = getParallelizableTasks(tasksFile);

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.taskId)).toEqual(["T002", "T004"]);
    });
  });

  describe("getTasksByPhase", () => {
    it("should group tasks by phase", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

## Phase 1

- [ ] T001: Phase 1 task 1
- [ ] T002: Phase 1 task 2

## Phase 2

- [ ] T003: Phase 2 task 1
`
      );

      const byPhase = getTasksByPhase(tasksFile);

      expect(byPhase.get(1)).toHaveLength(2);
      expect(byPhase.get(2)).toHaveLength(1);
    });

    it("should put tasks without phase in phase 0", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Task without phase

## Phase 1

- [ ] T002: Task in phase 1
`
      );

      const byPhase = getTasksByPhase(tasksFile);

      expect(byPhase.get(0)).toHaveLength(1);
      expect(byPhase.get(1)).toHaveLength(1);
    });
  });

  describe("getTasksByUserStory", () => {
    it("should group tasks by user story", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001 [US1]: User story 1 task 1
- [ ] T002 [US1]: User story 1 task 2
- [ ] T003 [US2]: User story 2 task 1
- [ ] T004: Task without user story
`
      );

      const byUserStory = getTasksByUserStory(tasksFile);

      expect(byUserStory.get("1")).toHaveLength(2);
      expect(byUserStory.get("2")).toHaveLength(1);
      expect(byUserStory.get(null)).toHaveLength(1);
    });
  });

  describe("isTasksFile", () => {
    it("should return true for file with task lines", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: A task
`
      );

      expect(isTasksFile(tasksFile)).toBe(true);
    });

    it("should return false for regular markdown file", () => {
      const mdFile = join(testDir, "readme.md");
      writeFileSync(
        mdFile,
        `# README

Just a regular markdown file with checkboxes:
- [ ] Not a task
`
      );

      expect(isTasksFile(mdFile)).toBe(false);
    });

    it("should return false for non-existent file", () => {
      expect(isTasksFile(join(testDir, "nonexistent.md"))).toBe(false);
    });
  });

  describe("getTaskStats", () => {
    it("should return correct statistics", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001 [P]: Done parallelizable
- [ ] T002 [P]: Not done parallelizable
- [x] T003: Done not parallelizable
- [ ] T004: Not done not parallelizable
`
      );

      const stats = getTaskStats(tasksFile);

      expect(stats?.total).toBe(4);
      expect(stats?.completed).toBe(2);
      expect(stats?.incomplete).toBe(2);
      expect(stats?.parallelizable).toBe(2);
      expect(stats?.completionRate).toBe(50);
    });

    it("should return 0% completion rate for empty file", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(tasksFile, "# Tasks\n");

      const stats = getTaskStats(tasksFile);

      expect(stats?.completionRate).toBe(0);
    });

    it("should return null for non-existent file", () => {
      expect(getTaskStats(join(testDir, "nonexistent.md"))).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle tasks without descriptions", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001
- [ ] T002
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].description).toBe("");
      expect(result?.tasks[1].description).toBe("");
    });

    it("should handle tasks with colons in description", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Task: with: multiple: colons
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].description).toBe("Task: with: multiple: colons");
    });

    it("should handle phase headers at different levels", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

### Phase 1: Deep header

- [ ] T001: Task in phase 1
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks[0].phase).toBe(1);
    });

    it("should handle various task ID formats", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T1: Single digit
- [ ] T10: Double digit
- [ ] T100: Triple digit
- [ ] T1000: Quadruple digit
`
      );

      const result = parseTasks(tasksFile);

      expect(result?.tasks.map((t) => t.taskId)).toEqual(["T1", "T10", "T100", "T1000"]);
    });
  });
});
