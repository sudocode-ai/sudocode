/**
 * Tests for context aggregator
 */

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/db.js";
import { createIssue, updateIssue } from "../../../src/operations/issues.js";
import { createSpec, updateSpec } from "../../../src/operations/specs.js";
import type { CompletionSummary } from "@sudocode-ai/types";
import {
  aggregateContext,
  getRecentCompletions,
  getCompletionStats,
} from "../../../src/learning/context-aggregator.js";

describe("Context Aggregator", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  describe("aggregateContext", () => {
    it("should aggregate patterns from multiple completions", () => {
      // Create issues with completion summaries
      const summary1: CompletionSummary = {
        what_worked: ["TDD approach", "Incremental development"],
        what_failed: ["Premature optimization"],
        blocking_factors: ["API documentation incomplete"],
        key_decisions: [
          {
            decision: "Use SQLite",
            rationale: "Simple and embedded",
            alternatives_considered: ["PostgreSQL"],
          },
        ],
        code_patterns_introduced: ["Repository pattern"],
        dependencies_discovered: ["better-sqlite3"],
        time_to_complete: 4.5,
      };

      const issue1 = createIssue(db, {
        id: "issue-001",
        title: "Test Issue 1",
        content: "Content",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", {
        completion_summary: summary1,
      });

      const summary2: CompletionSummary = {
        what_worked: ["TDD approach", "Code review"],
        what_failed: ["Initial architecture"],
        blocking_factors: ["Test fixtures needed"],
        key_decisions: [],
        code_patterns_introduced: ["Repository pattern", "Builder pattern"],
        dependencies_discovered: ["vitest"],
        time_to_complete: 3.0,
      };

      const issue2 = createIssue(db, {
        id: "issue-002",
        title: "Test Issue 2",
        content: "Content",
        status: "closed",
        closed_at: "2024-01-02T00:00:00Z",
      });

      updateIssue(db, "issue-002", {
        completion_summary: summary2,
      });

      // Aggregate context
      const context = aggregateContext(db);

      // Verify aggregation
      expect(context.successful_patterns.length).toBeGreaterThan(0);

      const tddPattern = context.successful_patterns.find(p =>
        p.pattern === "TDD approach"
      );
      expect(tddPattern).toBeDefined();
      expect(tddPattern?.occurrences).toBe(2);

      const repoPattern = context.code_patterns.find(p =>
        p.pattern === "Repository pattern"
      );
      expect(repoPattern).toBeDefined();
      expect(repoPattern?.occurrences).toBe(2);

      expect(context.metrics.total_completions).toBe(2);
      expect(context.metrics.avg_completion_time).toBeCloseTo(3.75, 1);
    });

    it("should filter by date when 'since' is provided", () => {
      const summary: CompletionSummary = {
        what_worked: ["Test"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      createIssue(db, {
        id: "issue-001",
        title: "Old Issue",
        content: "Content",
        status: "closed",
        closed_at: "2023-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      createIssue(db, {
        id: "issue-002",
        title: "Recent Issue",
        content: "Content",
        status: "closed",
        closed_at: "2024-06-01T00:00:00Z",
      });

      updateIssue(db, "issue-002", { completion_summary: summary });

      // Aggregate with date filter
      const context = aggregateContext(db, { since: "2024-01-01T00:00:00Z" });

      expect(context.metrics.total_completions).toBe(1);
    });

    it("should handle empty dataset gracefully", () => {
      const context = aggregateContext(db);

      expect(context.metrics.total_completions).toBe(0);
      expect(context.successful_patterns).toEqual([]);
      expect(context.anti_patterns).toEqual([]);
    });

    it("should sort patterns by occurrence", () => {
      const summary1: CompletionSummary = {
        what_worked: ["Pattern A", "Pattern B"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const summary2: CompletionSummary = {
        what_worked: ["Pattern A"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      createIssue(db, {
        id: "issue-001",
        title: "Issue 1",
        content: "Content",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });
      updateIssue(db, "issue-001", { completion_summary: summary1 });

      createIssue(db, {
        id: "issue-002",
        title: "Issue 2",
        content: "Content",
        status: "closed",
        closed_at: "2024-01-02T00:00:00Z",
      });
      updateIssue(db, "issue-002", { completion_summary: summary2 });

      const context = aggregateContext(db);

      // Pattern A should be first (2 occurrences)
      expect(context.successful_patterns[0].pattern).toBe("Pattern A");
      expect(context.successful_patterns[0].occurrences).toBe(2);

      // Pattern B should be second (1 occurrence)
      expect(context.successful_patterns[1].pattern).toBe("Pattern B");
      expect(context.successful_patterns[1].occurrences).toBe(1);
    });
  });

  describe("getRecentCompletions", () => {
    it("should return completions since specified date", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      createIssue(db, {
        id: "issue-001",
        title: "Old",
        content: "Content",
        status: "closed",
        closed_at: "2023-01-01T00:00:00Z",
      });
      updateIssue(db, "issue-001", { completion_summary: summary });

      createIssue(db, {
        id: "issue-002",
        title: "Recent",
        content: "Content",
        status: "closed",
        closed_at: "2024-06-01T00:00:00Z",
      });
      updateIssue(db, "issue-002", { completion_summary: summary });

      const recent = getRecentCompletions(db, "2024-01-01T00:00:00Z");

      expect(recent.length).toBe(1);
      expect(recent[0].id).toBe("issue-002");
    });
  });

  describe("getCompletionStats", () => {
    it("should calculate coverage statistics", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      // Create 2 closed issues, only 1 with summary
      createIssue(db, {
        id: "issue-001",
        title: "With Summary",
        content: "Content",
        status: "closed",
      });
      updateIssue(db, "issue-001", { completion_summary: summary });

      createIssue(db, {
        id: "issue-002",
        title: "Without Summary",
        content: "Content",
        status: "closed",
      });

      const stats = getCompletionStats(db);

      expect(stats.total_with_summaries).toBe(1);
      expect(stats.total_issues_with_summaries).toBe(1);
      expect(stats.total_without_summaries).toBe(1);
      expect(stats.coverage_percentage).toBe(50);
    });
  });
});
