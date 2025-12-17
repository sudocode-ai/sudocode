/**
 * Tests for tasks-writer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  updateTaskStatus,
  getTaskStatus,
  getAllTaskStatuses,
} from "../../src/writer/tasks-writer.js";

describe("Tasks Writer", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `speckit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("updateTaskStatus", () => {
    it("should mark an incomplete task as complete", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Setup authentication
- [ ] T002: Implement login flow
- [ ] T003: Add logout functionality
`
      );

      const result = updateTaskStatus(tasksFile, "T001", true);

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(false);
      expect(result.newStatus).toBe(true);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [x] T001: Setup authentication");
      expect(content).toContain("- [ ] T002: Implement login flow");
    });

    it("should mark a complete task as incomplete", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Setup authentication
- [ ] T002: Implement login flow
`
      );

      const result = updateTaskStatus(tasksFile, "T001", false);

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(true);
      expect(result.newStatus).toBe(false);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [ ] T001: Setup authentication");
    });

    it("should handle uppercase X in checkbox", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [X] T001: Task with uppercase X
`
      );

      const result = updateTaskStatus(tasksFile, "T001", false);

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(true);
      expect(result.newStatus).toBe(false);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [ ] T001: Task with uppercase X");
    });

    it("should preserve indentation for nested tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Parent task
  - [ ] T002: Nested task
    - [ ] T003: Deeply nested task
`
      );

      const result = updateTaskStatus(tasksFile, "T002", true);

      expect(result.success).toBe(true);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [ ] T001: Parent task");
      expect(content).toContain("  - [x] T002: Nested task");
      expect(content).toContain("    - [ ] T003: Deeply nested task");
    });

    it("should return error for non-existent file", () => {
      const result = updateTaskStatus(
        join(testDir, "nonexistent.md"),
        "T001",
        true
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for non-existent task", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Only task
`
      );

      const result = updateTaskStatus(tasksFile, "T999", true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("T999 not found");
    });

    it("should return error for invalid task ID format", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(tasksFile, "# Tasks\n");

      const result = updateTaskStatus(tasksFile, "invalid", true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid task ID format");
    });

    it("should return error for empty file path", () => {
      const result = updateTaskStatus("", "T001", true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should preserve task description after colon", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Complex task: with extra colons: in description
`
      );

      updateTaskStatus(tasksFile, "T001", true);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain(
        "- [x] T001: Complex task: with extra colons: in description"
      );
    });

    it("should handle tasks without descriptions", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001
- [ ] T002
`
      );

      updateTaskStatus(tasksFile, "T001", true);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [x] T001");
      expect(content).toContain("- [ ] T002");
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

      updateTaskStatus(tasksFile, "T1", true);
      updateTaskStatus(tasksFile, "T100", true);

      const content = readFileSync(tasksFile, "utf-8");
      expect(content).toContain("- [x] T1: Single digit");
      expect(content).toContain("- [ ] T10: Double digit");
      expect(content).toContain("- [x] T100: Triple digit");
      expect(content).toContain("- [ ] T1000: Quadruple digit");
    });
  });

  describe("getTaskStatus", () => {
    it("should return true for completed task", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Completed task
`
      );

      expect(getTaskStatus(tasksFile, "T001")).toBe(true);
    });

    it("should return false for incomplete task", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Incomplete task
`
      );

      expect(getTaskStatus(tasksFile, "T001")).toBe(false);
    });

    it("should return null for non-existent task", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [ ] T001: Only task
`
      );

      expect(getTaskStatus(tasksFile, "T999")).toBeNull();
    });

    it("should return null for non-existent file", () => {
      expect(getTaskStatus(join(testDir, "nonexistent.md"), "T001")).toBeNull();
    });
  });

  describe("getAllTaskStatuses", () => {
    it("should return all task statuses", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Completed
- [ ] T002: Incomplete
- [X] T003: Also completed
- [ ] T004: Also incomplete
`
      );

      const statuses = getAllTaskStatuses(tasksFile);

      expect(statuses.size).toBe(4);
      expect(statuses.get("T001")).toBe(true);
      expect(statuses.get("T002")).toBe(false);
      expect(statuses.get("T003")).toBe(true);
      expect(statuses.get("T004")).toBe(false);
    });

    it("should return empty map for non-existent file", () => {
      const statuses = getAllTaskStatuses(join(testDir, "nonexistent.md"));
      expect(statuses.size).toBe(0);
    });

    it("should return empty map for file with no tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

No tasks yet.
`
      );

      const statuses = getAllTaskStatuses(tasksFile);
      expect(statuses.size).toBe(0);
    });

    it("should handle nested tasks", () => {
      const tasksFile = join(testDir, "tasks.md");
      writeFileSync(
        tasksFile,
        `# Tasks

- [x] T001: Parent
  - [ ] T002: Child
    - [x] T003: Grandchild
`
      );

      const statuses = getAllTaskStatuses(tasksFile);

      expect(statuses.size).toBe(3);
      expect(statuses.get("T001")).toBe(true);
      expect(statuses.get("T002")).toBe(false);
      expect(statuses.get("T003")).toBe(true);
    });
  });
});
