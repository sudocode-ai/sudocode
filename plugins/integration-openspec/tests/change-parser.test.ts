/**
 * Unit tests for OpenSpec change parser
 *
 * Tests parsing of OpenSpec change directories including:
 * - Proposal.md section extraction
 * - Tasks.md parsing
 * - Delta directory scanning
 * - Archive detection
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  parseChangeDirectory,
  extractChangeName,
  detectArchiveStatus,
  parseProposal,
  extractTitleFromWhatChanges,
  formatTitle,
  parseChangeTasks,
  scanAffectedSpecs,
  isChangeDirectory,
  scanChangeDirectories,
  parseAllChanges,
  CHANGE_PATTERNS,
  type ParsedOpenSpecChange,
} from "../src/parser/change-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesPath = path.join(__dirname, "fixtures", "changes");

describe("OpenSpec Change Parser", () => {
  describe("CHANGE_PATTERNS", () => {
    describe("ARCHIVE_DATE pattern", () => {
      it("matches archive directory format", () => {
        const dirName = "2024-01-15-completed-feature";
        const match = dirName.match(CHANGE_PATTERNS.ARCHIVE_DATE);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("2024-01-15");
        expect(match![2]).toBe("completed-feature");
      });

      it("matches various date formats", () => {
        const dirName = "2023-12-31-year-end-cleanup";
        const match = dirName.match(CHANGE_PATTERNS.ARCHIVE_DATE);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("2023-12-31");
        expect(match![2]).toBe("year-end-cleanup");
      });

      it("does not match non-archive formats", () => {
        expect("add-feature".match(CHANGE_PATTERNS.ARCHIVE_DATE)).toBeNull();
        expect("2024-01-feature".match(CHANGE_PATTERNS.ARCHIVE_DATE)).toBeNull();
        expect("01-15-2024-feature".match(CHANGE_PATTERNS.ARCHIVE_DATE)).toBeNull();
      });
    });
  });

  describe("extractChangeName", () => {
    it("extracts name from active change path", () => {
      const dirPath = "/project/openspec/changes/add-feature";
      expect(extractChangeName(dirPath)).toBe("add-feature");
    });

    it("extracts name from archived change path (removes date prefix)", () => {
      const dirPath = "/project/openspec/changes/archive/2024-01-15-completed-feature";
      expect(extractChangeName(dirPath)).toBe("completed-feature");
    });

    it("handles paths with multiple hyphens", () => {
      const dirPath = "/project/changes/add-super-long-feature-name";
      expect(extractChangeName(dirPath)).toBe("add-super-long-feature-name");
    });
  });

  describe("detectArchiveStatus", () => {
    it("detects non-archived change", () => {
      const dirPath = "/project/openspec/changes/add-feature";
      const result = detectArchiveStatus(dirPath);

      expect(result.isArchived).toBe(false);
      expect(result.archivedAt).toBeUndefined();
    });

    it("detects archived change with date", () => {
      const dirPath = "/project/openspec/changes/archive/2024-01-15-feature";
      const result = detectArchiveStatus(dirPath);

      expect(result.isArchived).toBe(true);
      expect(result.archivedAt).toBeDefined();
      expect(result.archivedAt!.getFullYear()).toBe(2024);
      expect(result.archivedAt!.getMonth()).toBe(0); // January is 0
      expect(result.archivedAt!.getDate()).toBe(15);
    });

    it("handles archived change without valid date format", () => {
      const dirPath = "/project/openspec/changes/archive/some-feature";
      const result = detectArchiveStatus(dirPath);

      expect(result.isArchived).toBe(true);
      expect(result.archivedAt).toBeUndefined();
    });

    it("handles Windows-style paths", () => {
      const dirPath = "C:\\project\\changes\\archive\\2024-01-15-feature";
      const result = detectArchiveStatus(dirPath);

      expect(result.isArchived).toBe(true);
    });
  });

  describe("extractTitleFromWhatChanges", () => {
    it("extracts title from first line", () => {
      const content = "Add scaffold command\nMore details here";
      expect(extractTitleFromWhatChanges(content)).toBe("Add scaffold command");
    });

    it("removes bullet prefix", () => {
      const content = "- Add scaffold command\n- Another item";
      expect(extractTitleFromWhatChanges(content)).toBe("Add scaffold command");
    });

    it("removes asterisk prefix", () => {
      const content = "* Add scaffold command";
      expect(extractTitleFromWhatChanges(content)).toBe("Add scaffold command");
    });

    it("skips empty lines", () => {
      const content = "\n\n- Add scaffold command";
      expect(extractTitleFromWhatChanges(content)).toBe("Add scaffold command");
    });

    it("returns undefined for empty content", () => {
      expect(extractTitleFromWhatChanges(undefined)).toBeUndefined();
      expect(extractTitleFromWhatChanges("")).toBeUndefined();
      expect(extractTitleFromWhatChanges("\n\n")).toBeUndefined();
    });
  });

  describe("formatTitle", () => {
    it("converts hyphens to spaces", () => {
      expect(formatTitle("add-scaffold-command")).toBe("Add scaffold command");
    });

    it("converts underscores to spaces", () => {
      expect(formatTitle("add_scaffold_command")).toBe("Add scaffold command");
    });

    it("capitalizes first letter", () => {
      expect(formatTitle("feature")).toBe("Feature");
    });

    it("handles mixed separators", () => {
      expect(formatTitle("add-new_feature")).toBe("Add new feature");
    });

    it("handles single word", () => {
      expect(formatTitle("feature")).toBe("Feature");
    });
  });

  describe("parseProposal", () => {
    it("extracts all sections from proposal.md", () => {
      const filePath = path.join(fixturesPath, "add-scaffold-command", "proposal.md");
      const result = parseProposal(filePath, "add-scaffold-command");

      expect(result.why).toBeDefined();
      expect(result.why).toContain("Manual setup");
      expect(result.why).toContain("formatting mistakes");

      expect(result.whatChanges).toBeDefined();
      expect(result.whatChanges).toContain("openspec scaffold");

      expect(result.impact).toBeDefined();
      expect(result.impact).toContain("Affected specs");
    });

    it("extracts title from What Changes section", () => {
      const filePath = path.join(fixturesPath, "add-scaffold-command", "proposal.md");
      const result = parseProposal(filePath, "add-scaffold-command");

      expect(result.title).toBe("Add an `openspec scaffold <change-id>` CLI command");
    });

    it("falls back to formatted name when file is missing", () => {
      const result = parseProposal("/non/existent/file.md", "add-feature");
      expect(result.title).toBe("Add feature");
      expect(result.why).toBeUndefined();
      expect(result.whatChanges).toBeUndefined();
      expect(result.impact).toBeUndefined();
    });
  });

  describe("parseChangeTasks", () => {
    it("parses tasks from file", () => {
      const filePath = path.join(fixturesPath, "add-scaffold-command", "tasks.md");
      const result = parseChangeTasks(filePath);

      expect(result.tasks).toHaveLength(4);
      expect(result.taskCompletion).toBe(50);
    });

    it("returns empty for missing file", () => {
      const result = parseChangeTasks("/non/existent/tasks.md");

      expect(result.tasks).toEqual([]);
      expect(result.taskCompletion).toBe(0);
    });
  });

  describe("scanAffectedSpecs", () => {
    it("finds delta directories", () => {
      const dirPath = path.join(fixturesPath, "add-scaffold-command");
      const specs = scanAffectedSpecs(dirPath);

      expect(specs).toContain("cli-scaffold");
    });

    it("returns empty array when no specs directory", () => {
      const dirPath = path.join(fixturesPath, "improve-cli-output");
      const specs = scanAffectedSpecs(dirPath);

      expect(specs).toEqual([]);
    });

    it("returns empty array for non-existent directory", () => {
      const specs = scanAffectedSpecs("/non/existent/change");
      expect(specs).toEqual([]);
    });
  });

  describe("isChangeDirectory", () => {
    it("returns true for directory with proposal.md", () => {
      const dirPath = path.join(fixturesPath, "add-scaffold-command");
      expect(isChangeDirectory(dirPath)).toBe(true);
    });

    it("returns true for directory with only design.md", () => {
      const dirPath = path.join(fixturesPath, "empty-change");
      expect(isChangeDirectory(dirPath)).toBe(true);
    });

    it("returns false for non-existent directory", () => {
      expect(isChangeDirectory("/non/existent/dir")).toBe(false);
    });

    it("returns false for directory without required files", () => {
      const dirPath = path.join(fixturesPath, "add-scaffold-command", "specs");
      expect(isChangeDirectory(dirPath)).toBe(false);
    });
  });

  describe("scanChangeDirectories", () => {
    it("finds all change directories including archived", () => {
      const dirs = scanChangeDirectories(fixturesPath, true);

      expect(dirs.length).toBeGreaterThanOrEqual(3);
      expect(dirs.some((d) => d.includes("add-scaffold-command"))).toBe(true);
      expect(dirs.some((d) => d.includes("archive"))).toBe(true);
    });

    it("excludes archived when specified", () => {
      const dirs = scanChangeDirectories(fixturesPath, false);

      expect(dirs.some((d) => d.includes("archive"))).toBe(false);
    });

    it("returns empty array for non-existent path", () => {
      const dirs = scanChangeDirectories("/non/existent/path");
      expect(dirs).toEqual([]);
    });
  });

  describe("parseChangeDirectory", () => {
    let addScaffoldChange: ParsedOpenSpecChange;
    let archivedChange: ParsedOpenSpecChange;

    beforeAll(() => {
      addScaffoldChange = parseChangeDirectory(
        path.join(fixturesPath, "add-scaffold-command")
      );
      archivedChange = parseChangeDirectory(
        path.join(fixturesPath, "archive", "2024-01-15-completed-feature")
      );
    });

    describe("add-scaffold-command fixture", () => {
      it("extracts correct name", () => {
        expect(addScaffoldChange.name).toBe("add-scaffold-command");
      });

      it("extracts title from proposal", () => {
        expect(addScaffoldChange.title).toContain("openspec scaffold");
      });

      it("extracts Why section", () => {
        expect(addScaffoldChange.why).toBeDefined();
        expect(addScaffoldChange.why).toContain("Manual setup");
      });

      it("extracts What Changes section", () => {
        expect(addScaffoldChange.whatChanges).toBeDefined();
        expect(addScaffoldChange.whatChanges).toContain("CLI command");
      });

      it("extracts Impact section", () => {
        expect(addScaffoldChange.impact).toBeDefined();
        expect(addScaffoldChange.impact).toContain("Affected specs");
      });

      it("parses tasks correctly", () => {
        expect(addScaffoldChange.tasks).toHaveLength(4);
        expect(addScaffoldChange.taskCompletion).toBe(50);
      });

      it("finds affected specs", () => {
        expect(addScaffoldChange.affectedSpecs).toContain("cli-scaffold");
      });

      it("is not archived", () => {
        expect(addScaffoldChange.isArchived).toBe(false);
        expect(addScaffoldChange.archivedAt).toBeUndefined();
      });

      it("stores file path", () => {
        expect(addScaffoldChange.filePath).toContain("add-scaffold-command");
      });
    });

    describe("archived change fixture", () => {
      it("extracts name without date prefix", () => {
        expect(archivedChange.name).toBe("completed-feature");
      });

      it("is marked as archived", () => {
        expect(archivedChange.isArchived).toBe(true);
      });

      it("has archive date", () => {
        expect(archivedChange.archivedAt).toBeDefined();
        expect(archivedChange.archivedAt!.getFullYear()).toBe(2024);
      });

      it("has 100% completion", () => {
        expect(archivedChange.taskCompletion).toBe(100);
      });
    });

    it("throws error for non-existent directory", () => {
      expect(() => {
        parseChangeDirectory("/non/existent/change");
      }).toThrow();
    });
  });

  describe("parseAllChanges", () => {
    it("parses all changes in directory", () => {
      const changes = parseAllChanges(fixturesPath);

      expect(changes.length).toBeGreaterThanOrEqual(3);
    });

    it("includes both active and archived changes", () => {
      const changes = parseAllChanges(fixturesPath);

      const hasActive = changes.some((c) => !c.isArchived);
      const hasArchived = changes.some((c) => c.isArchived);

      expect(hasActive).toBe(true);
      expect(hasArchived).toBe(true);
    });

    it("excludes archived when specified", () => {
      const changes = parseAllChanges(fixturesPath, false);

      const hasArchived = changes.some((c) => c.isArchived);
      expect(hasArchived).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles change with only design.md", () => {
      const change = parseChangeDirectory(
        path.join(fixturesPath, "empty-change")
      );

      expect(change.name).toBe("empty-change");
      expect(change.title).toBe("Empty change");
      expect(change.tasks).toEqual([]);
      expect(change.taskCompletion).toBe(0);
      expect(change.why).toBeUndefined();
    });

    it("handles change without proposal.md", () => {
      const change = parseChangeDirectory(
        path.join(fixturesPath, "empty-change")
      );

      expect(change.why).toBeUndefined();
      expect(change.whatChanges).toBeUndefined();
      expect(change.impact).toBeUndefined();
    });
  });
});
