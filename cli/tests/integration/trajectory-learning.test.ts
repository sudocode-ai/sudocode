/**
 * Integration tests for Milestone 3: Trajectory Learning System
 * Tests trajectory capture, storage, analysis, and recommendations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TrajectoryStorage } from "../../src/learning/trajectory-storage.js";
import { TrajectoryBuilder, TrajectoryRecorder } from "../../src/learning/trajectory-capture.js";
import {
  findSimilarTrajectories,
  extractActionPatterns,
  buildActionValues,
  recommendNextAction,
} from "../../src/learning/trajectory-analysis.js";
import {
  handleTrajectoryList,
  handleTrajectoryShow,
  handleTrajectoryAnalyze,
  handleTrajectoryRecommend,
  handleTrajectoryStats,
} from "../../src/cli/trajectory-commands.js";
import type { Trajectory, ActionType } from "../../src/learning/trajectory-types.js";
import type { CommandContext } from "../../src/types.js";
import { initDatabase } from "../../src/db.js";
import type Database from "better-sqlite3";

describe("Milestone 3: Trajectory Learning Integration", () => {
  let tmpDir: string;
  let trajectoriesDir: string;
  let storage: TrajectoryStorage;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trajectory-integration-"));
    trajectoriesDir = path.join(tmpDir, ".sudocode", "trajectories");

    const dbPath = path.join(tmpDir, "cache.db");
    db = initDatabase({ path: dbPath });

    storage = new TrajectoryStorage({ outputDir: path.join(tmpDir, ".sudocode") });

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

  describe("Trajectory Capture and Storage", () => {
    it("should capture and store a complete trajectory", () => {
      // Build a trajectory
      const builder = new TrajectoryBuilder("claude-code", {
        goal: "Implement authentication",
        issue_id: "ISSUE-123",
        tags: ["auth", "security"],
      });

      builder
        .addStep("search_code", {
          description: "Search for existing auth patterns",
          success: true,
          duration_ms: 500,
        })
        .addStep("read_file", {
          description: "Read auth middleware",
          files_affected: ["src/middleware/auth.ts"],
          success: true,
          duration_ms: 200,
        })
        .addStep("edit_file", {
          description: "Update auth middleware",
          files_affected: ["src/middleware/auth.ts"],
          success: true,
          duration_ms: 1500,
        })
        .addStep("run_tests", {
          description: "Run auth tests",
          success: true,
          duration_ms: 3000,
        })
        .setGitInfo({
          start_commit: "abc123",
          end_commit: "def456",
          files_changed: ["src/middleware/auth.ts", "tests/auth.test.ts"],
        });

      const trajectory = builder.complete("success", 85);

      // Store trajectory
      storage.save(trajectory);

      // Verify storage
      const loaded = storage.load(trajectory.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(trajectory.id);
      expect(loaded!.steps).toHaveLength(4);
      expect(loaded!.outcome).toBe("success");
      expect(loaded!.quality.quality_score).toBe(85);
      expect(loaded!.context.goal).toBe("Implement authentication");
    });

    it("should capture trajectory with automatic quality scoring", () => {
      const builder = new TrajectoryBuilder("claude-code", {
        goal: "Fix bug",
        issue_id: "ISSUE-456",
        tags: ["bugfix"],
      });

      builder
        .addStep("search_code", { success: true, duration_ms: 100 })
        .addStep("edit_file", { success: true, duration_ms: 500 })
        .addStep("run_tests", { success: true, duration_ms: 2000 });

      // Complete without explicit quality score (auto-calculate)
      const trajectory = builder.complete("success");

      expect(trajectory.quality.quality_score).toBeGreaterThan(0);
      expect(trajectory.quality.quality_score).toBeLessThanOrEqual(100);
      expect(trajectory.quality.efficiency).toBeGreaterThan(0);
    });

    it("should handle trajectory with rework", () => {
      const builder = new TrajectoryBuilder("claude-code", {
        goal: "Implement feature",
        issue_id: "ISSUE-789",
        tags: ["feature"],
      });

      builder
        .addStep("edit_file", { success: true })
        .addStep("run_tests", { success: false }) // Tests failed
        .markReworkNeeded("Tests failed, need to fix implementation")
        .addStep("edit_file", { success: true }) // Rework
        .addStep("run_tests", { success: true });

      const trajectory = builder.complete("success");

      expect(trajectory.quality.rework_count).toBe(1);
      // Quality should be reduced due to rework
      expect(trajectory.quality.quality_score).toBeLessThan(100);
    });

    it("should organize trajectories by month", () => {
      const builder1 = new TrajectoryBuilder("claude-code", {
        goal: "Task 1",
        tags: [],
      });
      const traj1 = builder1.complete("success");

      const builder2 = new TrajectoryBuilder("claude-code", {
        goal: "Task 2",
        tags: [],
      });
      const traj2 = builder2.complete("success");

      storage.save(traj1);
      storage.save(traj2);

      // Verify monthly organization
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthDir = path.join(trajectoriesDir, yearMonth);

      expect(fs.existsSync(monthDir)).toBe(true);
      const files = fs.readdirSync(monthDir);
      expect(files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Trajectory Retrieval and Filtering", () => {
    beforeEach(() => {
      // Create sample trajectories
      const traj1 = new TrajectoryBuilder("claude-code", {
        goal: "Auth implementation",
        issue_id: "ISSUE-1",
        tags: ["auth"],
      })
        .addStep("read_file", { success: true })
        .complete("success", 90);

      const traj2 = new TrajectoryBuilder("claude-code", {
        goal: "Database setup",
        issue_id: "ISSUE-2",
        tags: ["database"],
      })
        .addStep("edit_file", { success: true })
        .complete("success", 75);

      const traj3 = new TrajectoryBuilder("claude-code", {
        goal: "API endpoint",
        issue_id: "ISSUE-3",
        tags: ["api"],
      })
        .addStep("edit_file", { success: false })
        .complete("failure", 30);

      storage.save(traj1);
      storage.save(traj2);
      storage.save(traj3);
    });

    it("should list all trajectories", () => {
      const trajectories = storage.list({});
      expect(trajectories.length).toBe(3);
    });

    it("should filter by issue_id", () => {
      const trajectories = storage.list({ issue_id: "ISSUE-1" });
      expect(trajectories.length).toBe(1);
      expect(trajectories[0].issue_id).toBe("ISSUE-1");
    });

    it("should filter by outcome", () => {
      const successful = storage.list({ outcome: "success" });
      expect(successful.length).toBe(2);
      successful.forEach(t => expect(t.outcome).toBe("success"));

      const failed = storage.list({ outcome: "failure" });
      expect(failed.length).toBe(1);
      expect(failed[0].outcome).toBe("failure");
    });

    it("should filter by minimum quality", () => {
      const highQuality = storage.list({ min_quality: 80 });
      expect(highQuality.length).toBe(1);
      expect(highQuality[0].quality_score).toBeGreaterThanOrEqual(80);

      const mediumQuality = storage.list({ min_quality: 70 });
      expect(mediumQuality.length).toBe(2);
    });

    it("should respect limit", () => {
      const limited = storage.list({ limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  describe("Trajectory Analysis", () => {
    it("should find similar trajectories", () => {
      // Create auth-related trajectories
      const authTraj1 = new TrajectoryBuilder("claude-code", {
        goal: "Implement JWT authentication",
        tags: ["auth", "security"],
      })
        .addStep("search_code", { success: true })
        .addStep("read_file", { files_affected: ["src/auth.ts"], success: true })
        .addStep("edit_file", { files_affected: ["src/auth.ts"], success: true })
        .complete("success", 85);

      const authTraj2 = new TrajectoryBuilder("claude-code", {
        goal: "Add OAuth support",
        tags: ["auth", "oauth"],
      })
        .addStep("search_code", { success: true })
        .addStep("edit_file", { files_affected: ["src/oauth.ts"], success: true })
        .complete("success", 80);

      const dbTraj = new TrajectoryBuilder("claude-code", {
        goal: "Setup database",
        tags: ["database"],
      })
        .addStep("edit_file", { files_affected: ["src/db.ts"], success: true })
        .complete("success", 75);

      storage.save(authTraj1);
      storage.save(authTraj2);
      storage.save(dbTraj);

      // Find trajectories similar to authTraj1
      const allTrajectories = [authTraj1, authTraj2, dbTraj];
      const similar = findSimilarTrajectories(authTraj1, allTrajectories, 0.1);

      // Should find authTraj2 as similar (both auth-related)
      const foundAuth2 = similar.find(s => s.trajectory.id === authTraj2.id);
      expect(foundAuth2).toBeDefined();
      expect(foundAuth2!.similarity).toBeGreaterThan(0);

      // authTraj2 should be more similar than dbTraj
      const foundDb = similar.find(s => s.trajectory.id === dbTraj.id);
      if (foundDb) {
        expect(foundAuth2!.similarity).toBeGreaterThan(foundDb.similarity);
      }
    });

    it("should extract action patterns", () => {
      // Create trajectories with common patterns
      const traj1 = new TrajectoryBuilder("claude-code", {
        goal: "Feature A",
        tags: ["feature"],
      })
        .addStep("search_code", { success: true })
        .addStep("read_file", { success: true })
        .addStep("edit_file", { success: true })
        .addStep("run_tests", { success: true })
        .complete("success", 90);

      const traj2 = new TrajectoryBuilder("claude-code", {
        goal: "Feature B",
        tags: ["feature"],
      })
        .addStep("search_code", { success: true })
        .addStep("read_file", { success: true })
        .addStep("edit_file", { success: true })
        .addStep("run_tests", { success: true })
        .complete("success", 85);

      const traj3 = new TrajectoryBuilder("claude-code", {
        goal: "Feature C",
        tags: ["feature"],
      })
        .addStep("search_code", { success: true })
        .addStep("edit_file", { success: true })
        .complete("success", 80);

      const trajectories = [traj1, traj2, traj3];
      const patterns = extractActionPatterns(trajectories, 2);

      // Should find "search_code -> read_file" pattern (appears in traj1 and traj2)
      const searchReadPattern = patterns.find(
        p =>
          p.actions.length === 2 &&
          p.actions[0] === "search_code" &&
          p.actions[1] === "read_file"
      );
      expect(searchReadPattern).toBeDefined();
      expect(searchReadPattern!.frequency).toBe(2);

      // Should find "search_code -> edit_file" or longer patterns
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("should build action values for Q-learning", () => {
      // Create successful and failed trajectories
      const successTraj1 = new TrajectoryBuilder("claude-code", {
        goal: "Implement feature",
        tags: ["feature"],
      })
        .addStep("search_code", { success: true })
        .addStep("edit_file", { success: true })
        .complete("success", 90);

      const successTraj2 = new TrajectoryBuilder("claude-code", {
        goal: "Implement feature",
        tags: ["feature"],
      })
        .addStep("search_code", { success: true })
        .addStep("edit_file", { success: true })
        .complete("success", 85);

      const failTraj = new TrajectoryBuilder("claude-code", {
        goal: "Implement feature",
        tags: ["feature"],
      })
        .addStep("edit_file", { success: true }) // Skip search
        .complete("failure", 30);

      const trajectories = [successTraj1, successTraj2, failTraj];
      const actionValues = buildActionValues(trajectories);

      // Should have higher value for "search_code" in feature context
      const searchValues = actionValues.filter(av =>
        av.action === "search_code"
      );
      expect(searchValues.length).toBeGreaterThan(0);

      // search_code should have high success rate (appeared in 2 successes)
      const featureSearchValue = searchValues.find(av =>
        av.context_hash.includes("feature")
      );
      if (featureSearchValue) {
        expect(featureSearchValue.success_rate).toBeGreaterThan(0.5);
      }
    });

    it("should recommend next actions based on context", () => {
      // Create historical trajectories
      const authTraj1 = new TrajectoryBuilder("claude-code", {
        goal: "Add authentication",
        tags: ["auth"],
      })
        .addStep("search_code", { success: true })
        .addStep("read_file", { success: true })
        .addStep("edit_file", { success: true })
        .complete("success", 90);

      const authTraj2 = new TrajectoryBuilder("claude-code", {
        goal: "Fix auth bug",
        tags: ["auth", "bugfix"],
      })
        .addStep("search_code", { success: true })
        .addStep("read_file", { success: true })
        .complete("success", 85);

      const trajectories = [authTraj1, authTraj2];
      const actionValues = buildActionValues(trajectories);

      // Get recommendations for new auth task
      const recommendations = recommendNextAction(
        {
          goal: "Implement OAuth",
          tags: ["auth", "oauth"],
          previousActions: [],
        },
        actionValues,
        3
      );

      expect(recommendations.length).toBeGreaterThan(0);

      // First recommendation should likely be search_code (common successful first step)
      const firstAction = recommendations[0];
      expect(firstAction.action).toBeDefined();
      expect(firstAction.confidence).toBeGreaterThan(0);
      expect(firstAction.rationale).toBeDefined();
    });
  });

  describe("Trajectory Recorder", () => {
    it("should manage recording sessions", () => {
      const recorder = new TrajectoryRecorder(storage);

      const sessionId = recorder.startRecording("claude-code", {
        goal: "Test recording",
        tags: ["test"],
      });

      expect(sessionId).toBeDefined();

      recorder.recordStep(sessionId, "read_file", { success: true });
      recorder.recordStep(sessionId, "edit_file", { success: true });

      const trajectory = recorder.completeRecording(sessionId, "success");

      expect(trajectory.steps).toHaveLength(2);
      expect(trajectory.outcome).toBe("success");

      // Verify it was auto-saved
      const loaded = storage.load(trajectory.id);
      expect(loaded).not.toBeNull();
    });

    it("should handle abandoned sessions", () => {
      const recorder = new TrajectoryRecorder(storage);

      const sessionId = recorder.startRecording("claude-code", {
        goal: "Test abandonment",
        tags: ["test"],
      });

      recorder.recordStep(sessionId, "read_file", { success: true });

      // Abandon without completing
      recorder.abandonRecording(sessionId);

      // Completing abandoned session should throw
      expect(() => {
        recorder.completeRecording(sessionId, "success");
      }).toThrow();
    });
  });

  describe("CLI Commands", () => {
    beforeEach(() => {
      // Create sample trajectories
      const traj1 = new TrajectoryBuilder("claude-code", {
        goal: "Feature A",
        issue_id: "ISSUE-1",
        tags: ["feature"],
      })
        .addStep("edit_file", { success: true })
        .complete("success", 85);

      const traj2 = new TrajectoryBuilder("claude-code", {
        goal: "Feature B",
        issue_id: "ISSUE-2",
        tags: ["feature"],
      })
        .addStep("edit_file", { success: true })
        .complete("success", 90);

      storage.save(traj1);
      storage.save(traj2);
    });

    it("should handle trajectory list command", async () => {
      await expect(
        handleTrajectoryList(ctx, {})
      ).resolves.not.toThrow();
    });

    it("should handle trajectory show command", async () => {
      const trajectories = storage.list({});
      const firstId = trajectories[0].id;

      await expect(
        handleTrajectoryShow(ctx, firstId)
      ).resolves.not.toThrow();
    });

    it("should handle trajectory analyze command", async () => {
      await expect(
        handleTrajectoryAnalyze(ctx, { minFrequency: 1 })
      ).resolves.not.toThrow();
    });

    it("should handle trajectory recommend command", async () => {
      await expect(
        handleTrajectoryRecommend(ctx, "Implement new feature", {})
      ).resolves.not.toThrow();
    });

    it("should handle trajectory stats command", async () => {
      await expect(
        handleTrajectoryStats(ctx)
      ).resolves.not.toThrow();
    });
  });

  describe("Statistics", () => {
    it("should calculate aggregate statistics", () => {
      const traj1 = new TrajectoryBuilder("claude-code", {
        goal: "Task 1",
        tags: [],
      })
        .addStep("edit_file", { success: true, duration_ms: 1000 })
        .complete("success", 90);
      traj1.duration_ms = 5000;

      const traj2 = new TrajectoryBuilder("claude-code", {
        goal: "Task 2",
        tags: [],
      })
        .addStep("edit_file", { success: true, duration_ms: 2000 })
        .complete("success", 80);
      traj2.duration_ms = 8000;

      const traj3 = new TrajectoryBuilder("claude-code", {
        goal: "Task 3",
        tags: [],
      })
        .addStep("edit_file", { success: false, duration_ms: 500 })
        .complete("failure", 30);
      traj3.duration_ms = 3000;

      storage.save(traj1);
      storage.save(traj2);
      storage.save(traj3);

      const stats = storage.getStats();

      expect(stats.total_trajectories).toBe(3);
      expect(stats.success_rate).toBeCloseTo(66.67, 0); // 2/3 = 66.67%
      expect(stats.avg_quality).toBeCloseTo(66.67, 0); // (90+80+30)/3
      expect(stats.avg_duration_ms).toBeCloseTo(5333.33, 0); // (5000+8000+3000)/3
    });
  });
});
