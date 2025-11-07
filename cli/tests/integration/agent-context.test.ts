/**
 * Integration tests for Milestone 2: Agent Context Integration
 * Tests context aggregation, documentation generation, and retrieval
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initDatabase } from "../../src/db.js";
import { createIssue, updateIssue } from "../../src/operations/issues.js";
import { createSpec, archiveSpec } from "../../src/operations/specs.js";
import { serializeCompletionSummary } from "../../src/operations/completion-summary.js";
import { aggregateContext } from "../../src/learning/context-aggregator.js";
import { generateDocumentation } from "../../src/learning/documentation-generator.js";
import {
  getRelevantContextForIssue,
  getRelevantContextForSpec,
  formatContextForAgent,
} from "../../src/learning/context-retrieval.js";
import {
  handleContextGenerate,
  handleContextQuery,
  handleContextStats,
} from "../../src/cli/context-commands.js";
import type Database from "better-sqlite3";
import type { CommandContext, CompletionSummary } from "../../src/types.js";

describe("Milestone 2: Agent Context Integration", () => {
  let tmpDir: string;
  let contextDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-integration-"));
    contextDir = path.join(tmpDir, ".sudocode", "context");

    const dbPath = path.join(tmpDir, "cache.db");
    db = initDatabase({ path: dbPath });

    ctx = {
      db,
      outputDir: tmpDir,
      jsonOutput: false,
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Context Aggregation", () => {
    it("should aggregate patterns from multiple completion summaries", () => {
      // Create issues with completion summaries
      const issue1 = createIssue(db, "Auth Implementation", "Add JWT auth", {
        tags: ["auth", "security"],
      });
      const summary1: CompletionSummary = {
        what_worked: ["JWT tokens", "Middleware pattern"],
        what_failed: ["Session cookies"],
        blocking_factors: ["Token refresh complexity"],
        key_decisions: [
          {
            decision: "Use JWT",
            rationale: "Stateless auth",
            alternatives_considered: ["Sessions", "OAuth"],
          },
        ],
        code_patterns_introduced: ["Auth middleware", "Token validation"],
        dependencies_discovered: ["jsonwebtoken@^9.0.0"],
        time_to_complete: 5,
      };
      updateIssue(db, issue1.id, {
        status: "closed",
        completion_summary: serializeCompletionSummary(summary1),
      });

      const issue2 = createIssue(db, "Database Layer", "Add Postgres support", {
        tags: ["database", "backend"],
      });
      const summary2: CompletionSummary = {
        what_worked: ["TypeORM", "Migration system"],
        what_failed: ["Raw SQL queries"],
        blocking_factors: ["Schema design"],
        key_decisions: [
          {
            decision: "Use TypeORM",
            rationale: "Type-safe queries",
            alternatives_considered: ["Prisma", "Knex"],
          },
        ],
        code_patterns_introduced: ["Repository pattern", "Entity models"],
        dependencies_discovered: ["typeorm@^0.3.0", "pg@^8.0.0"],
        time_to_complete: 8,
      };
      updateIssue(db, issue2.id, {
        status: "closed",
        completion_summary: serializeCompletionSummary(summary2),
      });

      const issue3 = createIssue(db, "API Endpoints", "REST API", {
        tags: ["api", "backend"],
      });
      const summary3: CompletionSummary = {
        what_worked: ["Express router", "Middleware pattern"],
        what_failed: ["Custom routing"],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Use Express",
            rationale: "Well-established",
            alternatives_considered: ["Fastify", "Koa"],
          },
        ],
        code_patterns_introduced: ["Router pattern", "Middleware pattern"],
        dependencies_discovered: ["express@^4.18.0"],
        time_to_complete: 3,
      };
      updateIssue(db, issue3.id, { status: "closed", completion_summary: serializeCompletionSummary(summary3) });

      // Aggregate context
      const aggregated = aggregateContext(db);

      // Verify patterns aggregation
      expect(aggregated.patterns.length).toBeGreaterThan(0);
      const middlewarePattern = aggregated.patterns.find(p =>
        p.pattern.includes("Middleware pattern")
      );
      expect(middlewarePattern).toBeDefined();
      expect(middlewarePattern?.frequency).toBe(2); // Appears in issue1 and issue3
      expect(middlewarePattern?.sources).toHaveLength(2);

      // Verify gotchas aggregation
      const gotchas = aggregated.gotchas;
      expect(gotchas.some(g => g.gotcha.includes("Session cookies"))).toBe(true);
      expect(gotchas.some(g => g.gotcha.includes("Raw SQL queries"))).toBe(true);

      // Verify decisions aggregation
      const decisions = aggregated.key_decisions;
      expect(decisions.length).toBe(3);
      expect(decisions.some(d => d.decision.includes("JWT"))).toBe(true);

      // Verify dependencies
      const deps = aggregated.dependencies;
      expect(deps.some(d => d.dependency === "jsonwebtoken@^9.0.0")).toBe(true);
      expect(deps.some(d => d.dependency === "typeorm@^0.3.0")).toBe(true);
    });

    it("should calculate coverage statistics", () => {
      // Create issues - some with summaries, some without
      const issue1 = createIssue(db, "Issue 1", "With summary");
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["Pattern A"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const issue2 = createIssue(db, "Issue 2", "Without summary");
      updateIssue(db, issue2.id, { status: "closed" });

      const issue3 = createIssue(db, "Issue 3", "With summary");
      closeIssue(
        db,
        issue3.id,
        serializeCompletionSummary({
          what_worked: ["Pattern B"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const aggregated = aggregateContext(db);

      // 2 out of 3 closed issues have summaries = 66.67%
      expect(aggregated.coverage_stats.closed_issues).toBe(3);
      expect(aggregated.coverage_stats.issues_with_summary).toBe(2);
      expect(aggregated.coverage_stats.issue_coverage_percent).toBeCloseTo(66.67, 0);
    });

    it("should filter by date range", () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      // Create old issue
      const oldIssue = createIssue(db, "Old Issue", "Old work");
      db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(
        pastDate.toISOString(),
        oldIssue.id
      );
      closeIssue(
        db,
        oldIssue.id,
        serializeCompletionSummary({
          what_worked: ["Old pattern"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      // Create recent issue
      const recentIssue = createIssue(db, "Recent Issue", "Recent work");
      closeIssue(
        db,
        recentIssue.id,
        serializeCompletionSummary({
          what_worked: ["New pattern"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      // Aggregate with date filter
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const aggregated = aggregateContext(db, {
        since: yesterday.toISOString(),
      });

      // Should only include recent issue
      const patterns = aggregated.patterns;
      expect(patterns.some(p => p.pattern.includes("New pattern"))).toBe(true);
      expect(patterns.some(p => p.pattern.includes("Old pattern"))).toBe(false);
    });
  });

  describe("Documentation Generation", () => {
    it("should generate complete documentation structure", () => {
      // Create issues with various learnings
      const issue1 = createIssue(db, "Auth", "Authentication", {
        tags: ["auth", "security"],
      });
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["JWT tokens"],
          what_failed: ["Insecure token storage"],
          blocking_factors: [],
          key_decisions: [
            {
              decision: "Store tokens in httpOnly cookies",
              rationale: "Prevent XSS attacks",
              alternatives_considered: ["localStorage", "sessionStorage"],
            },
          ],
          code_patterns_introduced: ["Token refresh pattern"],
          dependencies_discovered: [],
        })
      );

      // Generate documentation
      generateDocumentation(db, contextDir);

      // Verify directory structure
      expect(fs.existsSync(contextDir)).toBe(true);
      expect(fs.existsSync(path.join(contextDir, "CODEBASE_MEMORY.md"))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, "patterns"))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, "gotchas"))).toBe(true);
      expect(fs.existsSync(path.join(contextDir, "decisions"))).toBe(true);

      // Verify CODEBASE_MEMORY.md content
      const memoryContent = fs.readFileSync(
        path.join(contextDir, "CODEBASE_MEMORY.md"),
        "utf-8"
      );
      expect(memoryContent).toContain("# Codebase Memory");
      expect(memoryContent).toContain("JWT tokens");
      expect(memoryContent).toContain("Insecure token storage");

      // Verify patterns documentation
      const patternsFiles = fs.readdirSync(path.join(contextDir, "patterns"));
      expect(patternsFiles.length).toBeGreaterThan(0);

      // Verify gotchas documentation
      const gotchasFiles = fs.readdirSync(path.join(contextDir, "gotchas"));
      expect(gotchasFiles.length).toBeGreaterThan(0);

      // Verify decisions documentation
      const decisionsFiles = fs.readdirSync(path.join(contextDir, "decisions"));
      expect(decisionsFiles.length).toBeGreaterThan(0);
    });

    it("should update documentation with new learnings", () => {
      // Generate initial documentation
      const issue1 = createIssue(db, "Issue 1", "First learning");
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["Pattern 1"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );
      generateDocumentation(db, contextDir);

      const initialMemory = fs.readFileSync(
        path.join(contextDir, "CODEBASE_MEMORY.md"),
        "utf-8"
      );
      expect(initialMemory).toContain("Pattern 1");

      // Add new learning
      const issue2 = createIssue(db, "Issue 2", "Second learning");
      closeIssue(
        db,
        issue2.id,
        serializeCompletionSummary({
          what_worked: ["Pattern 2"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      // Regenerate documentation
      generateDocumentation(db, contextDir);

      const updatedMemory = fs.readFileSync(
        path.join(contextDir, "CODEBASE_MEMORY.md"),
        "utf-8"
      );
      expect(updatedMemory).toContain("Pattern 1");
      expect(updatedMemory).toContain("Pattern 2");
    });
  });

  describe("Context Retrieval", () => {
    it("should find relevant context for similar issues", () => {
      // Create past issues with summaries
      const authIssue = createIssue(db, "JWT Authentication", "Implement JWT", {
        tags: ["auth", "security"],
      });
      closeIssue(
        db,
        authIssue.id,
        serializeCompletionSummary({
          what_worked: ["JWT library", "Middleware"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: ["Auth middleware"],
          dependencies_discovered: [],
        })
      );

      const dbIssue = createIssue(db, "Database Setup", "Postgres", {
        tags: ["database"],
      });
      closeIssue(
        db,
        dbIssue.id,
        serializeCompletionSummary({
          what_worked: ["TypeORM"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      // Create new issue seeking context
      const newIssue = createIssue(
        db,
        "OAuth Implementation",
        "Add OAuth2 authentication flow",
        { tags: ["auth", "oauth"] }
      );

      // Get relevant context
      const context = getRelevantContextForIssue(db, newIssue.id);

      // Should find auth issue as similar (shares "auth" tag)
      expect(context.similar_items.length).toBeGreaterThan(0);
      const similarAuth = context.similar_items.find(item =>
        item.id === authIssue.id
      );
      expect(similarAuth).toBeDefined();
      expect(similarAuth!.similarity_score).toBeGreaterThan(0);

      // Should have higher similarity than database issue
      const similarDb = context.similar_items.find(item =>
        item.id === dbIssue.id
      );
      if (similarDb) {
        expect(similarAuth!.similarity_score).toBeGreaterThan(
          similarDb.similarity_score
        );
      }

      // Should extract applicable patterns
      expect(context.applicable_patterns.some(p =>
        p.includes("Auth middleware")
      )).toBe(true);
    });

    it("should rank by similarity score", () => {
      // Create issues with varying similarity
      const issue1 = createIssue(
        db,
        "React Authentication Form",
        "Build login form with React",
        { tags: ["react", "auth", "frontend"] }
      );
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["React hooks"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const issue2 = createIssue(
        db,
        "React Dashboard",
        "Build admin dashboard",
        { tags: ["react", "frontend"] }
      );
      closeIssue(
        db,
        issue2.id,
        serializeCompletionSummary({
          what_worked: ["React components"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const issue3 = createIssue(db, "Backend API", "REST API", {
        tags: ["backend", "api"],
      });
      closeIssue(
        db,
        issue3.id,
        serializeCompletionSummary({
          what_worked: ["Express"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      // New React auth issue
      const newIssue = createIssue(
        db,
        "React Auth Flow",
        "Implement authentication in React app",
        { tags: ["react", "auth"] }
      );

      const context = getRelevantContextForIssue(db, newIssue.id);

      // issue1 should be most similar (shares react + auth tags)
      expect(context.similar_items[0].id).toBe(issue1.id);

      // Scores should be in descending order
      for (let i = 0; i < context.similar_items.length - 1; i++) {
        expect(context.similar_items[i].similarity_score).toBeGreaterThanOrEqual(
          context.similar_items[i + 1].similarity_score
        );
      }
    });

    it("should format context for agent consumption", () => {
      const issue = createIssue(db, "API Development", "Build REST API", {
        tags: ["api", "backend"],
      });
      closeIssue(
        db,
        issue.id,
        serializeCompletionSummary({
          what_worked: ["Express framework"],
          what_failed: ["Custom routing"],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: ["Router pattern"],
          dependencies_discovered: [],
        })
      );

      const newIssue = createIssue(db, "GraphQL API", "Add GraphQL", {
        tags: ["api", "graphql"],
      });

      const context = getRelevantContextForIssue(db, newIssue.id);
      const formatted = formatContextForAgent(context);

      // Should be valid markdown
      expect(formatted).toContain("# Context Briefing");
      expect(formatted).toContain("## Similar Past Work");
      expect(formatted).toContain("## Applicable Patterns");
      expect(formatted).toContain("## Known Gotchas");

      // Should include similarity scores
      expect(formatted).toMatch(/Similarity: \d+%/);
    });
  });

  describe("CLI Commands", () => {
    it("should handle context generate command", async () => {
      // Create issues with summaries
      const issue = createIssue(db, "Test Issue", "Description");
      closeIssue(
        db,
        issue.id,
        serializeCompletionSummary({
          what_worked: ["Test pattern"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      await handleContextGenerate(ctx, {});

      // Verify documentation was generated
      const contextPath = path.join(tmpDir, ".sudocode", "context");
      expect(fs.existsSync(contextPath)).toBe(true);
      expect(
        fs.existsSync(path.join(contextPath, "CODEBASE_MEMORY.md"))
      ).toBe(true);
    });

    it("should handle context query command", async () => {
      // Create issues
      const issue1 = createIssue(db, "Auth Issue", "JWT auth", {
        tags: ["auth"],
      });
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["JWT"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const issue2 = createIssue(db, "New Auth Task", "OAuth", {
        tags: ["auth"],
      });

      // Query should not throw
      await expect(
        handleContextQuery(ctx, issue2.id, {})
      ).resolves.not.toThrow();
    });

    it("should handle context stats command", async () => {
      // Create mix of issues with and without summaries
      const issue1 = createIssue(db, "Issue 1", "With summary");
      closeIssue(
        db,
        issue1.id,
        serializeCompletionSummary({
          what_worked: ["Pattern"],
          what_failed: [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
        })
      );

      const issue2 = createIssue(db, "Issue 2", "No summary");
      updateIssue(db, issue2.id, { status: "closed" });

      // Stats should not throw
      await expect(
        handleContextStats(ctx, {})
      ).resolves.not.toThrow();
    });
  });
});
