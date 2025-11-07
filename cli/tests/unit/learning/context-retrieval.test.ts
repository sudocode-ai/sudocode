/**
 * Tests for context retrieval
 */

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/db.js";
import { createIssue, updateIssue } from "../../../src/operations/issues.js";
import { createSpec, updateSpec } from "../../../src/operations/specs.js";
import { setTags } from "../../../src/operations/tags.js";
import type { CompletionSummary } from "@sudocode-ai/types";
import {
  getRelevantContextForIssue,
  getRelevantContextForSpec,
  formatContextForAgent,
} from "../../../src/learning/context-retrieval.js";

describe("Context Retrieval", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });
  });

  describe("getRelevantContextForIssue", () => {
    it("should find similar completed issues", () => {
      const summary: CompletionSummary = {
        what_worked: ["Pattern matching worked well"],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      // Create a completed issue with similar title
      const completedIssue = createIssue(db, {
        id: "issue-001",
        title: "Implement authentication system",
        content: "Add user authentication with JWT tokens",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      // Create new issue with similar content
      const newIssue = createIssue(db, {
        id: "issue-002",
        title: "Add authentication for API endpoints",
        content: "Need to secure API with JWT authentication",
        status: "open",
      });

      // Get relevant context
      const context = getRelevantContextForIssue(db, newIssue);

      // Should find the similar issue
      expect(context.similar_issues.length).toBeGreaterThan(0);
      expect(context.similar_issues[0].issue.id).toBe("issue-001");
      expect(context.similar_issues[0].similarity_score).toBeGreaterThan(0);
    });

    it("should extract patterns from similar work", () => {
      const summary: CompletionSummary = {
        what_worked: ["TDD approach", "Code review"],
        what_failed: ["Skipping tests"],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: ["Repository pattern"],
        dependencies_discovered: [],
      };

      const completedIssue = createIssue(db, {
        id: "issue-001",
        title: "Implement user registration",
        content: "Add user registration feature",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      const newIssue = createIssue(db, {
        id: "issue-002",
        title: "Implement user login",
        content: "Add user login feature",
        status: "open",
      });

      const context = getRelevantContextForIssue(db, newIssue);

      // Should extract patterns
      expect(context.applicable_patterns.length).toBeGreaterThan(0);

      const successPattern = context.applicable_patterns.find(p =>
        p.pattern === "TDD approach"
      );
      expect(successPattern).toBeDefined();
      expect(successPattern?.type).toBe("success");

      const antiPattern = context.applicable_patterns.find(p =>
        p.pattern === "Skipping tests"
      );
      expect(antiPattern).toBeDefined();
      expect(antiPattern?.type).toBe("anti-pattern");

      const codePattern = context.applicable_patterns.find(p =>
        p.pattern === "Repository pattern"
      );
      expect(codePattern).toBeDefined();
      expect(codePattern?.type).toBe("code-pattern");
    });

    it("should identify gotchas from similar work", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: ["API rate limiting", "Test data setup"],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const completedIssue = createIssue(db, {
        id: "issue-001",
        title: "Integrate external API",
        content: "Add third-party API integration",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      const newIssue = createIssue(db, {
        id: "issue-002",
        title: "Add another API integration",
        content: "Integrate with payment API",
        status: "open",
      });

      const context = getRelevantContextForIssue(db, newIssue);

      // Should find gotchas
      expect(context.known_gotchas.length).toBeGreaterThan(0);
      expect(context.known_gotchas.some(g =>
        g.blocker === "API rate limiting"
      )).toBe(true);
    });

    it("should extract key decisions from similar work", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Use bcrypt for password hashing",
            rationale: "Industry standard and secure",
            alternatives_considered: ["scrypt", "argon2"],
          },
        ],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const completedIssue = createIssue(db, {
        id: "issue-001",
        title: "Implement password storage",
        content: "Secure password storage",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      const newIssue = createIssue(db, {
        id: "issue-002",
        title: "Add password reset",
        content: "Password reset functionality",
        status: "open",
      });

      const context = getRelevantContextForIssue(db, newIssue);

      // Should find decisions
      expect(context.relevant_decisions.length).toBeGreaterThan(0);
      expect(context.relevant_decisions[0].decision).toContain("bcrypt");
    });

    it("should respect maxSimilarItems option", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      // Create 5 completed issues
      for (let i = 1; i <= 5; i++) {
        const issue = createIssue(db, {
          id: `issue-${String(i).padStart(3, "0")}`,
          title: `Test issue ${i}`,
          content: "authentication feature",
          status: "closed",
          closed_at: "2024-01-01T00:00:00Z",
        });

        updateIssue(db, issue.id, { completion_summary: summary });
      }

      const newIssue = createIssue(db, {
        id: "issue-new",
        title: "New authentication task",
        content: "authentication feature",
        status: "open",
      });

      const context = getRelevantContextForIssue(db, newIssue, {
        maxSimilarItems: 2,
      });

      // Should return at most 2 similar items
      expect(context.similar_issues.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getRelevantContextForSpec", () => {
    it("should find similar completed specs", () => {
      const summary: CompletionSummary = {
        what_worked: [],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const completedSpec = createSpec(db, {
        id: "spec-001",
        title: "Authentication System Design",
        file_path: ".sudocode/specs/auth.md",
        content: "Design for user authentication with JWT",
        archived: true,
        archived_at: "2024-01-01T00:00:00Z",
      });

      updateSpec(db, "spec-001", { completion_summary: summary });

      const newSpec = createSpec(db, {
        id: "spec-002",
        title: "API Authentication Design",
        file_path: ".sudocode/specs/api-auth.md",
        content: "Design for API authentication using JWT tokens",
      });

      const context = getRelevantContextForSpec(db, newSpec);

      expect(context.similar_specs.length).toBeGreaterThan(0);
      expect(context.similar_specs[0].spec.id).toBe("spec-001");
    });
  });

  describe("formatContextForAgent", () => {
    it("should format context as markdown", () => {
      const summary: CompletionSummary = {
        what_worked: ["Pattern A"],
        what_failed: [],
        blocking_factors: ["Blocker A"],
        key_decisions: [
          {
            decision: "Use TypeScript",
            rationale: "Type safety",
            alternatives_considered: ["JavaScript"],
          },
        ],
        code_patterns_introduced: [],
        dependencies_discovered: [],
      };

      const completedIssue = createIssue(db, {
        id: "issue-001",
        title: "Test Issue",
        content: "test content",
        status: "closed",
        closed_at: "2024-01-01T00:00:00Z",
      });

      updateIssue(db, "issue-001", { completion_summary: summary });

      const newIssue = createIssue(db, {
        id: "issue-002",
        title: "Test Issue 2",
        content: "test content",
        status: "open",
      });

      const context = getRelevantContextForIssue(db, newIssue);
      const formatted = formatContextForAgent(context);

      // Should be valid markdown
      expect(formatted).toContain("# Relevant Context");
      expect(formatted).toContain("## Similar Completed Work");
      expect(formatted).toContain("issue-001");
      expect(formatted).toContain("Pattern A");
      expect(formatted).toContain("Blocker A");
      expect(formatted).toContain("Use TypeScript");
    });
  });
});
