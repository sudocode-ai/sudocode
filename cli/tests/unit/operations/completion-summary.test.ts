/**
 * Tests for completion summary utilities
 */

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/db.js";
import { createSpec, getSpec, updateSpec } from "../../../src/operations/specs.js";
import { createIssue, getIssue, updateIssue } from "../../../src/operations/issues.js";
import type { CompletionSummary } from "@sudocode-ai/types";
import {
  parseCompletionSummary,
  serializeCompletionSummary,
  validateCompletionSummary,
  createEmptyCompletionSummary,
  rowToSpec,
  rowToIssue,
} from "../../../src/operations/completion-summary.js";

describe("Completion Summary Utilities", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  describe("parseCompletionSummary", () => {
    it("should parse valid JSON completion_summary", () => {
      const summary: CompletionSummary = {
        what_worked: ["TDD approach"],
        what_failed: ["Initial architecture"],
        blocking_factors: ["Dependency issues"],
        key_decisions: [
          {
            decision: "Use SQLite",
            rationale: "Simple and embedded",
            alternatives_considered: ["PostgreSQL", "MySQL"],
          },
        ],
        code_patterns_introduced: ["Repository pattern"],
        dependencies_discovered: ["better-sqlite3"],
      };

      const row = {
        completion_summary: JSON.stringify(summary),
      };

      const parsed = parseCompletionSummary(row);
      expect(parsed).toEqual(summary);
    });

    it("should return undefined for null completion_summary", () => {
      const row = {
        completion_summary: null,
      };

      const parsed = parseCompletionSummary(row);
      expect(parsed).toBeUndefined();
    });

    it("should return undefined for invalid JSON", () => {
      const row = {
        completion_summary: "invalid json{",
      };

      const parsed = parseCompletionSummary(row);
      expect(parsed).toBeUndefined();
    });
  });

  describe("serializeCompletionSummary", () => {
    it("should serialize completion_summary to JSON", () => {
      const summary: CompletionSummary = {
        what_worked: ["TDD"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const serialized = serializeCompletionSummary(summary);
      expect(serialized).toBe(JSON.stringify(summary));
    });

    it("should return null for undefined summary", () => {
      const serialized = serializeCompletionSummary(undefined);
      expect(serialized).toBeNull();
    });
  });

  describe("validateCompletionSummary", () => {
    it("should validate a complete summary", () => {
      const summary: CompletionSummary = {
        what_worked: ["Test"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Decision",
            rationale: "Rationale",
            alternatives_considered: ["Alt"],
          },
        ],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      expect(validateCompletionSummary(summary)).toBe(true);
    });

    it("should reject invalid summary with missing arrays", () => {
      const summary = {
        what_worked: ["Test"],
      };

      expect(validateCompletionSummary(summary)).toBe(false);
    });

    it("should reject invalid key_decisions structure", () => {
      const summary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [{ decision: "Test" }], // Missing rationale
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      expect(validateCompletionSummary(summary)).toBe(false);
    });
  });

  describe("createEmptyCompletionSummary", () => {
    it("should create an empty summary with all required fields", () => {
      const empty = createEmptyCompletionSummary();

      expect(empty).toEqual({
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      });

      expect(validateCompletionSummary(empty)).toBe(true);
    });
  });
});

describe("Spec Completion Summary Integration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  it("should store and retrieve completion_summary on spec", () => {
    // Create spec without summary
    const spec = createSpec(db, {
      id: "spec-001",
      title: "Test Spec",
      file_path: ".sudocode/specs/test.md",
      content: "Test content",
    });

    expect(spec.completion_summary).toBeUndefined();

    // Update with completion_summary
    const summary: CompletionSummary = {
      what_worked: ["Incremental approach", "Clear separation of concerns"],
      what_failed: ["Initial data model was too complex"],
      blocking_factors: ["Lack of test fixtures"],
      key_decisions: [
        {
          decision: "Use JSONL for storage",
          rationale: "Git-friendly and human-readable",
          alternatives_considered: ["Pure JSON", "Binary format"],
        },
      ],
      code_patterns_introduced: ["Repository pattern", "Event sourcing"],
      dependencies_discovered: ["uuid"],
      git_commit_range: {
        start: "abc123",
        end: "def456",
      },
      files_modified: ["src/specs.ts", "src/db.ts"],
      test_results: {
        passed: 25,
        failed: 0,
        coverage: 95,
      },
    };

    const updated = updateSpec(db, "spec-001", {
      completion_summary: summary,
    });

    expect(updated.completion_summary).toEqual(summary);

    // Retrieve and verify
    const retrieved = getSpec(db, "spec-001");
    expect(retrieved?.completion_summary).toEqual(summary);
  });

  it("should handle spec without completion_summary", () => {
    const spec = createSpec(db, {
      id: "spec-002",
      title: "Another Spec",
      file_path: ".sudocode/specs/another.md",
      content: "Content",
    });

    const retrieved = getSpec(db, "spec-002");
    expect(retrieved?.completion_summary).toBeUndefined();
  });

  it("should update completion_summary on spec", () => {
    const spec = createSpec(db, {
      id: "spec-003",
      title: "Test",
      file_path: ".sudocode/specs/test.md",
      content: "Content",
    });

    const summary1: CompletionSummary = {
      what_worked: ["First iteration"],
      what_failed: [],
      blocking_factors: [],
      key_decisions: [],
      code_patterns_introduced: [],
      dependencies_discovered: [],
    };

    updateSpec(db, "spec-003", { completion_summary: summary1 });

    const summary2: CompletionSummary = {
      what_worked: ["First iteration", "Second iteration"],
      what_failed: ["Some approach"],
      blocking_factors: [],
      key_decisions: [],
      code_patterns_introduced: [],
      dependencies_discovered: [],
    };

    updateSpec(db, "spec-003", { completion_summary: summary2 });

    const retrieved = getSpec(db, "spec-003");
    expect(retrieved?.completion_summary).toEqual(summary2);
  });
});

describe("Issue Completion Summary Integration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  it("should store and retrieve completion_summary on issue", () => {
    // Create issue without summary
    const issue = createIssue(db, {
      id: "issue-001",
      title: "Test Issue",
      content: "Test content",
    });

    expect(issue.completion_summary).toBeUndefined();

    // Update with completion_summary
    const summary: CompletionSummary = {
      what_worked: ["Pair programming", "Code review"],
      what_failed: ["Premature optimization"],
      blocking_factors: ["API documentation incomplete"],
      key_decisions: [
        {
          decision: "Use async/await",
          rationale: "Better error handling",
          alternatives_considered: ["Callbacks", "Promises"],
        },
      ],
      code_patterns_introduced: ["Async handlers"],
      dependencies_discovered: ["node-fetch"],
      time_to_complete: 4.5,
      test_results: {
        passed: 10,
        failed: 0,
      },
    };

    const updated = updateIssue(db, "issue-001", {
      completion_summary: summary,
    });

    expect(updated.completion_summary).toEqual(summary);

    // Retrieve and verify
    const retrieved = getIssue(db, "issue-001");
    expect(retrieved?.completion_summary).toEqual(summary);
  });

  it("should handle issue without completion_summary", () => {
    const issue = createIssue(db, {
      id: "issue-002",
      title: "Another Issue",
      content: "Content",
    });

    const retrieved = getIssue(db, "issue-002");
    expect(retrieved?.completion_summary).toBeUndefined();
  });
});
