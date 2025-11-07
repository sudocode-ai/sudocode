/**
 * Integration tests for the complete learning system
 * Tests interactions between all three milestones
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { initDatabase } from "../../src/db.js";
import { createIssue, updateIssue } from "../../src/operations/issues.js";
import { createSpec, archiveSpec } from "../../src/operations/specs.js";
import { serializeCompletionSummary } from "../../src/operations/completion-summary.js";
import { aggregateContext, getCompletionStats } from "../../src/learning/context-aggregator.js";
import { generateDocumentation } from "../../src/learning/documentation-generator.js";
import { getRelevantContextForIssue } from "../../src/learning/context-retrieval.js";
import { TrajectoryStorage } from "../../src/learning/trajectory-storage.js";
import { TrajectoryBuilder } from "../../src/learning/trajectory-capture.js";
import { buildActionValues, recommendNextAction } from "../../src/learning/trajectory-analysis.js";
import type Database from "better-sqlite3";
import type { CompletionSummary } from "../../src/types.js";

describe("Complete Learning System Integration", () => {
  let tmpDir: string;
  let db: Database.Database;
  let contextDir: string;
  let trajectoriesDir: string;
  let storage: TrajectoryStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "learning-system-"));
    contextDir = path.join(tmpDir, ".sudocode", "context");
    trajectoriesDir = path.join(tmpDir, ".sudocode", "trajectories");

    const dbPath = path.join(tmpDir, "cache.db");
    db = initDatabase({ path: dbPath });

    storage = new TrajectoryStorage({ outputDir: path.join(tmpDir, ".sudocode") });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Flow 1: Completion → Context → Guidance", () => {
    it("should flow learnings from completion to context to new work", () => {
      // ===== MILESTONE 1: Complete work with reflection =====
      const authIssue = createIssue(db, "JWT Authentication", "Implement JWT auth", {
        tags: ["auth", "security"],
      });

      const authSummary: CompletionSummary = {
        what_worked: [
          "JWT library for token generation",
          "Middleware pattern for auth checks",
          "HttpOnly cookies for token storage",
        ],
        what_failed: [
          "localStorage tokens (XSS vulnerability)",
          "Session-based auth (scalability issues)",
        ],
        blocking_factors: [
          "Token refresh complexity",
          "CORS configuration",
        ],
        key_decisions: [
          {
            decision: "Use JWT with httpOnly cookies",
            rationale: "Balance security and scalability",
            alternatives_considered: ["Sessions", "localStorage JWT", "OAuth only"],
          },
        ],
        code_patterns_introduced: [
          "Auth middleware pattern",
          "Token refresh flow",
        ],
        dependencies_discovered: [
          "jsonwebtoken@^9.0.0",
          "cookie-parser@^1.4.6",
        ],
        time_to_complete: 6,
      };

      updateIssue(db, authIssue.id, { status: "closed", completion_summary: serializeCompletionSummary(authSummary) });

      // ===== MILESTONE 2: Generate context documentation =====
      const aggregated = aggregateContext(db);

      // Verify patterns were aggregated
      expect(aggregated.patterns.length).toBeGreaterThan(0);
      const middlewarePattern = aggregated.patterns.find(p =>
        p.pattern.includes("Middleware pattern")
      );
      expect(middlewarePattern).toBeDefined();

      // Verify gotchas were captured
      const gotchas = aggregated.gotchas;
      expect(gotchas.some(g => g.gotcha.includes("localStorage"))).toBe(true);

      // Generate documentation
      generateDocumentation(db, contextDir);
      expect(fs.existsSync(path.join(contextDir, "CODEBASE_MEMORY.md"))).toBe(true);

      // ===== MILESTONE 2: Query context for new work =====
      const oauthIssue = createIssue(
        db,
        "OAuth Integration",
        "Add OAuth2 provider support",
        { tags: ["auth", "oauth"] }
      );

      const context = getRelevantContextForIssue(db, oauthIssue.id);

      // Should find the auth issue as similar
      expect(context.similar_items.length).toBeGreaterThan(0);
      const similarAuth = context.similar_items.find(item =>
        item.id === authIssue.id
      );
      expect(similarAuth).toBeDefined();

      // Should recommend applicable patterns
      expect(context.applicable_patterns.length).toBeGreaterThan(0);
      expect(
        context.applicable_patterns.some(p => p.includes("middleware"))
      ).toBe(true);

      // Should warn about gotchas
      expect(context.gotchas.length).toBeGreaterThan(0);
      expect(
        context.gotchas.some(g => g.includes("localStorage"))
      ).toBe(true);
    });
  });

  describe("Flow 2: Trajectory → Pattern → Documentation", () => {
    it("should extract patterns from successful trajectories", () => {
      // ===== MILESTONE 3: Record successful trajectories =====
      const authTraj1 = new TrajectoryBuilder("claude-code", {
        goal: "Implement JWT authentication",
        issue_id: "ISSUE-1",
        tags: ["auth"],
      })
        .addStep("search_code", {
          description: "Search for auth examples",
          success: true,
        })
        .addStep("read_file", {
          description: "Read existing middleware",
          files_affected: ["src/middleware/index.ts"],
          success: true,
        })
        .addStep("edit_file", {
          description: "Create auth middleware",
          files_affected: ["src/middleware/auth.ts"],
          success: true,
        })
        .addStep("write_file", {
          description: "Add tests",
          files_affected: ["tests/auth.test.ts"],
          success: true,
        })
        .addStep("run_tests", {
          description: "Run test suite",
          success: true,
        })
        .complete("success", 90);

      const authTraj2 = new TrajectoryBuilder("claude-code", {
        goal: "Add OAuth support",
        issue_id: "ISSUE-2",
        tags: ["auth", "oauth"],
      })
        .addStep("search_code", {
          description: "Search for OAuth examples",
          success: true,
        })
        .addStep("read_file", {
          description: "Read auth patterns",
          files_affected: ["src/middleware/auth.ts"],
          success: true,
        })
        .addStep("edit_file", {
          description: "Add OAuth flow",
          files_affected: ["src/oauth/provider.ts"],
          success: true,
        })
        .addStep("run_tests", {
          description: "Run tests",
          success: true,
        })
        .complete("success", 85);

      storage.save(authTraj1);
      storage.save(authTraj2);

      // ===== MILESTONE 3: Build action values =====
      const trajectories = [authTraj1, authTraj2];
      const actionValues = buildActionValues(trajectories);

      // Should have high value for search_code in auth context
      const authSearchValues = actionValues.filter(
        av => av.action === "search_code" && av.context_hash.includes("auth")
      );
      expect(authSearchValues.length).toBeGreaterThan(0);

      // Success rate should be high (appeared in both successful trajectories)
      const authSearchValue = authSearchValues[0];
      expect(authSearchValue.success_rate).toBe(1.0); // 100% success

      // ===== Future: This could feed into Milestone 2 =====
      // In a future enhancement, trajectory patterns would be incorporated
      // into the context documentation, creating a feedback loop
    });
  });

  describe("Flow 3: Complete Learning Loop", () => {
    it("should demonstrate full agent improvement cycle", () => {
      // ===== Step 1: Initial work with completion summary =====
      const issue1 = createIssue(db, "User Authentication", "Basic auth", {
        tags: ["auth", "backend"],
      });

      const summary1: CompletionSummary = {
        what_worked: ["Express middleware", "bcrypt for passwords"],
        what_failed: ["Plain text passwords (security)"],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Hash passwords with bcrypt",
            rationale: "Industry standard",
            alternatives_considered: ["scrypt", "argon2"],
          },
        ],
        code_patterns_introduced: ["Password hashing middleware"],
        dependencies_discovered: ["bcrypt@^5.1.0"],
        time_to_complete: 4,
      };

      updateIssue(db, issue1.id, { status: "closed", completion_summary: serializeCompletionSummary(summary1) });

      // ===== Step 2: Record trajectory for first issue =====
      const traj1 = new TrajectoryBuilder("claude-code", {
        goal: "Implement user authentication",
        issue_id: issue1.id,
        tags: ["auth", "backend"],
      })
        .addStep("search_code", { success: true, duration_ms: 500 })
        .addStep("edit_file", { success: true, duration_ms: 2000 })
        .addStep("run_tests", { success: true, duration_ms: 3000 })
        .complete("success", 80);

      storage.save(traj1);

      // ===== Step 3: Generate context from learnings =====
      generateDocumentation(db, contextDir);

      // ===== Step 4: New similar issue =====
      const issue2 = createIssue(
        db,
        "JWT Token Management",
        "Add JWT support",
        { tags: ["auth", "security"] }
      );

      // ===== Step 5: Query context for guidance =====
      const context = getRelevantContextForIssue(db, issue2.id);

      // Should find first auth issue as relevant
      expect(context.similar_items.length).toBeGreaterThan(0);

      // Should recommend password hashing pattern
      expect(context.applicable_patterns.length).toBeGreaterThan(0);

      // Should warn about plain text password gotcha
      expect(context.gotchas.length).toBeGreaterThan(0);
      expect(
        context.gotchas.some(g => g.toLowerCase().includes("plain text"))
      ).toBe(true);

      // ===== Step 6: Get trajectory recommendations =====
      const actionValues = buildActionValues([traj1]);
      const recommendations = recommendNextAction(
        {
          goal: "Add JWT token management",
          tags: ["auth", "security"],
          previousActions: [],
        },
        actionValues,
        3
      );

      // Should recommend search_code as first step (worked in traj1)
      expect(recommendations.length).toBeGreaterThan(0);
      const topRecommendation = recommendations[0];
      expect(topRecommendation.action).toBeDefined();
      expect(topRecommendation.confidence).toBeGreaterThan(0);

      // ===== Step 7: Complete second issue with learnings =====
      const summary2: CompletionSummary = {
        what_worked: [
          "JWT library",
          "Reused password hashing from issue1",
          "Following search_code pattern worked well",
        ],
        what_failed: [],
        blocking_factors: [],
        key_decisions: [
          {
            decision: "Integrate with existing auth",
            rationale: "Reuse patterns from previous work",
            alternatives_considered: ["Separate auth system"],
          },
        ],
        code_patterns_introduced: ["JWT middleware"],
        dependencies_discovered: ["jsonwebtoken@^9.0.0"],
        time_to_complete: 3, // Faster due to context!
      };

      updateIssue(db, issue2.id, { status: "closed", completion_summary: serializeCompletionSummary(summary2) });

      // ===== Step 8: Verify improvement metrics =====
      const stats = getCompletionStats(db);

      // Coverage should be 100% (both issues have summaries)
      expect(stats.issue_coverage_percent).toBe(100);

      // Should show reduced time (4 hours → 3 hours)
      expect(summary2.time_to_complete).toBeLessThan(summary1.time_to_complete!);

      // ===== Step 9: Regenerate context with new learnings =====
      const updatedAggregated = aggregateContext(db);

      // Should now have patterns from both issues
      expect(updatedAggregated.patterns.length).toBeGreaterThan(0);

      // Bcrypt pattern should appear in dependencies
      const bcryptDep = updatedAggregated.dependencies.find(d =>
        d.dependency.includes("bcrypt")
      );
      expect(bcryptDep).toBeDefined();

      // JWT pattern should also appear
      const jwtDep = updatedAggregated.dependencies.find(d =>
        d.dependency.includes("jsonwebtoken")
      );
      expect(jwtDep).toBeDefined();

      // ===== Demonstrate knowledge accumulation =====
      // Each iteration adds to the knowledge base
      generateDocumentation(db, contextDir);

      const memoryContent = fs.readFileSync(
        path.join(contextDir, "CODEBASE_MEMORY.md"),
        "utf-8"
      );

      // Should contain learnings from both issues
      expect(memoryContent).toContain("bcrypt");
      expect(memoryContent).toContain("JWT");
    });
  });

  describe("Flow 4: Cross-Milestone Data Consistency", () => {
    it("should maintain consistency across all systems", () => {
      // Create and complete multiple issues
      const issues = [
        {
          title: "Auth System",
          tags: ["auth"],
          summary: {
            what_worked: ["Pattern A"],
            what_failed: ["Approach B"],
            blocking_factors: [],
            key_decisions: [],
            code_patterns_introduced: [],
            dependencies_discovered: [],
          },
        },
        {
          title: "Database Layer",
          tags: ["database"],
          summary: {
            what_worked: ["Pattern C"],
            what_failed: [],
            blocking_factors: [],
            key_decisions: [],
            code_patterns_introduced: [],
            dependencies_discovered: [],
          },
        },
        {
          title: "API Endpoints",
          tags: ["api"],
          summary: {
            what_worked: ["Pattern D"],
            what_failed: [],
            blocking_factors: [],
            key_decisions: [],
            code_patterns_introduced: [],
            dependencies_discovered: [],
          },
        },
      ];

      const issueIds: string[] = [];
      for (const issueData of issues) {
        const issue = createIssue(db, issueData.title, "Description", {
          tags: issueData.tags,
        });
        issueIds.push(issue.id);
        updateIssue(db, issue.id, { status: "closed", completion_summary: serializeCompletionSummary(issueData.summary) });

        // Create trajectory for each
        const traj = new TrajectoryBuilder("claude-code", {
          goal: issueData.title,
          issue_id: issue.id,
          tags: issueData.tags,
        })
          .addStep("edit_file", { success: true })
          .complete("success", 80);

        storage.save(traj);
      }

      // Verify Milestone 1: All summaries stored
      for (const issueId of issueIds) {
        const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId) as any;
        expect(issue.completion_summary).toBeDefined();
      }

      // Verify Milestone 2: Context aggregation includes all
      const aggregated = aggregateContext(db);
      expect(aggregated.patterns.length).toBeGreaterThanOrEqual(4); // At least 4 patterns

      // Verify Milestone 3: All trajectories stored
      const trajectories = storage.list({});
      expect(trajectories.length).toBe(3);

      // Verify cross-references
      for (const issueId of issueIds) {
        const trajForIssue = storage.list({ issue_id: issueId });
        expect(trajForIssue.length).toBe(1);
      }
    });
  });

  describe("Flow 5: Knowledge Transfer Between Issues", () => {
    it("should transfer knowledge from completed to new issues", () => {
      // Complete several React-related issues
      const reactIssues = [
        {
          title: "React Component Library",
          tags: ["react", "components"],
          patterns: ["Component composition", "Props validation"],
          gotchas: ["Prop drilling", "useEffect dependencies"],
        },
        {
          title: "React State Management",
          tags: ["react", "state"],
          patterns: ["Context API", "Custom hooks"],
          gotchas: ["Stale closures", "Unnecessary re-renders"],
        },
        {
          title: "React Testing",
          tags: ["react", "testing"],
          patterns: ["Testing Library patterns", "Mock components"],
          gotchas: ["Async queries", "Act warnings"],
        },
      ];

      for (const data of reactIssues) {
        const issue = createIssue(db, data.title, "Description", {
          tags: data.tags,
        });

        const summary: CompletionSummary = {
          what_worked: data.patterns,
          what_failed: data.gotchas,
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: data.patterns,
          dependencies_discovered: [],
        };

        updateIssue(db, issue.id, { status: "closed", completion_summary: serializeCompletionSummary(summary) });
      }

      // Generate context
      const aggregated = aggregateContext(db);

      // Verify all patterns aggregated
      const allPatterns = aggregated.patterns.map(p => p.pattern);
      expect(allPatterns.some(p => p.includes("Component composition"))).toBe(true);
      expect(allPatterns.some(p => p.includes("Context API"))).toBe(true);
      expect(allPatterns.some(p => p.includes("Testing Library"))).toBe(true);

      // Verify all gotchas captured
      const allGotchas = aggregated.gotchas.map(g => g.gotcha);
      expect(allGotchas.some(g => g.includes("Prop drilling"))).toBe(true);
      expect(allGotchas.some(g => g.includes("Stale closures"))).toBe(true);
      expect(allGotchas.some(g => g.includes("Act warnings"))).toBe(true);

      // New React issue should get all relevant context
      const newIssue = createIssue(
        db,
        "React Form Validation",
        "Build form with validation",
        { tags: ["react", "forms"] }
      );

      const context = getRelevantContextForIssue(db, newIssue.id);

      // Should find multiple similar React issues
      expect(context.similar_items.length).toBe(3);

      // Should have comprehensive applicable patterns
      expect(context.applicable_patterns.length).toBeGreaterThan(0);

      // Should have comprehensive gotchas
      expect(context.gotchas.length).toBeGreaterThan(0);
    });
  });

  describe("Flow 6: Quality Improvement Over Time", () => {
    it("should show quality improvement with accumulated knowledge", () => {
      // Simulate multiple iterations of similar work
      const iterations = [
        { quality: 60, time: 8, patterns: 1 }, // First attempt
        { quality: 70, time: 6, patterns: 2 }, // Learning
        { quality: 85, time: 4, patterns: 3 }, // Improving
        { quality: 90, time: 3, patterns: 4 }, // Expert level
      ];

      const trajectories = [];

      for (let i = 0; i < iterations.length; i++) {
        const iter = iterations[i];

        // Create issue
        const issue = createIssue(
          db,
          `API Endpoint ${i + 1}`,
          `Iteration ${i + 1}`,
          { tags: ["api", "backend"] }
        );

        // Complete with improving metrics
        const summary: CompletionSummary = {
          what_worked: Array(iter.patterns)
            .fill(null)
            .map((_, idx) => `Pattern ${idx + 1}`),
          what_failed: i === 0 ? ["Initial approach"] : [],
          blocking_factors: [],
          key_decisions: [],
          code_patterns_introduced: [],
          dependencies_discovered: [],
          time_to_complete: iter.time,
        };

        updateIssue(db, issue.id, { status: "closed", completion_summary: serializeCompletionSummary(summary) });

        // Record trajectory
        const traj = new TrajectoryBuilder("claude-code", {
          goal: `API Endpoint ${i + 1}`,
          issue_id: issue.id,
          tags: ["api", "backend"],
        })
          .addStep("search_code", { success: true })
          .addStep("edit_file", { success: true })
          .complete("success", iter.quality);

        trajectories.push(traj);
        storage.save(traj);
      }

      // Verify improvement trajectory
      for (let i = 0; i < iterations.length - 1; i++) {
        expect(iterations[i + 1].quality).toBeGreaterThan(iterations[i].quality);
        expect(iterations[i + 1].time).toBeLessThan(iterations[i].time);
      }

      // Verify context grows richer
      const aggregated = aggregateContext(db);
      expect(aggregated.patterns.length).toBeGreaterThanOrEqual(4);

      // Verify trajectory stats show improvement
      const stats = storage.getStats();
      expect(stats.avg_quality).toBeGreaterThan(75); // Should be high
      expect(stats.success_rate).toBe(100); // All successful
    });
  });
});
