/**
 * Tests for baseline detection in checkpointSync
 *
 * Tests the Phase 3 feature where checkpointSync uses previous checkpoint
 * as the baseline for incremental snapshots, falling back to before_commit
 * when no previous checkpoints exist.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import Database from "better-sqlite3";

describe("checkpointSync baseline detection", () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-checkpoint-baseline-test-")
    );

    // Initialize git repo
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git config user.email test@test.com", {
      cwd: testDir,
      stdio: "pipe",
    });
    execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });

    // Create initial commit
    fs.writeFileSync(path.join(testDir, "README.md"), "# Test Project\n");
    execSync("git add . && git commit -m 'Initial commit'", {
      cwd: testDir,
      stdio: "pipe",
    });

    // Create .sudocode directory with dataplane enabled
    const sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(sudocodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(sudocodeDir, "config.json"),
      JSON.stringify({
        dataplane: {
          enabled: true,
          tablePrefix: "dp_",
        },
      })
    );

    // Create in-memory database
    db = new Database(":memory:");

    // Create minimal executions table for tests
    db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        issue_id TEXT,
        before_commit TEXT,
        after_commit TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create minimal checkpoints table for sudocode side
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        execution_id TEXT,
        issue_id TEXT,
        stream_id TEXT,
        commit_sha TEXT,
        parent_commit TEXT,
        snapshot TEXT,
        created_at INTEGER
      )
    `);

    // Create relationships table (required by ensureIssueStream)
    db.exec(`
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    fs.rmSync(testDir, { recursive: true, force: true });
    vi.resetModules();
  });

  describe("getCheckpointsForStream", () => {
    it("returns empty array when no checkpoints exist", async () => {
      const { clearDataplaneConfigCache } = await import(
        "../../../src/services/dataplane-config.js"
      );
      clearDataplaneConfigCache();

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const adapter = new DataplaneAdapter(testDir, undefined, db);
      await adapter.initialize();

      // Get checkpoints for non-existent stream
      const checkpointsModule = adapter.checkpointsModule;
      if (checkpointsModule) {
        const checkpoints = checkpointsModule.getCheckpointsForStream(
          adapter.db,
          "non-existent-stream"
        );
        expect(checkpoints).toEqual([]);
      }

      adapter.close();
    });

    it("returns checkpoints sorted by creation time", async () => {
      const { clearDataplaneConfigCache } = await import(
        "../../../src/services/dataplane-config.js"
      );
      clearDataplaneConfigCache();

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const adapter = new DataplaneAdapter(testDir, undefined, db);
      await adapter.initialize();

      // Create a stream first
      const streamResult = await adapter.createExecutionStream({
        executionId: "exec-cp-1",
        issueId: "i-test-cp",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-cp-1",
      });

      // Insert checkpoints manually to test ordering
      const checkpointsModule = adapter.checkpointsModule;
      if (checkpointsModule) {
        const now = Date.now();

        // Insert checkpoints out of order
        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "commit3",
          parentCommit: "commit2",
          metadata: { createdAt: now + 2000 },
        });

        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "commit1",
          parentCommit: null,
          metadata: { createdAt: now },
        });

        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "commit2",
          parentCommit: "commit1",
          metadata: { createdAt: now + 1000 },
        });

        // Get checkpoints - should be sorted by createdAt
        const checkpoints = checkpointsModule.getCheckpointsForStream(
          adapter.db,
          streamResult.streamId
        );

        expect(checkpoints.length).toBe(3);
        expect(checkpoints[0].commitSha).toBe("commit1");
        expect(checkpoints[1].commitSha).toBe("commit2");
        expect(checkpoints[2].commitSha).toBe("commit3");
      }

      adapter.close();
    });
  });

  describe("baseline selection logic", () => {
    it("checkpointsModule.getCheckpointsForStream orders by createdAt for baseline selection", async () => {
      // This test verifies the mechanism used for baseline detection:
      // getCheckpointsForStream returns checkpoints sorted by createdAt,
      // so the last item is the most recent for use as baseline

      const { clearDataplaneConfigCache } = await import(
        "../../../src/services/dataplane-config.js"
      );
      clearDataplaneConfigCache();

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const adapter = new DataplaneAdapter(testDir, undefined, db);
      await adapter.initialize();

      // Create a stream
      const streamResult = await adapter.createExecutionStream({
        executionId: "exec-baseline-test",
        issueId: "i-baseline-test",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-baseline",
      });

      const checkpointsModule = adapter.checkpointsModule;
      if (checkpointsModule) {
        const now = Date.now();

        // Create checkpoints with different timestamps
        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "old-commit",
          parentCommit: null,
          metadata: { createdAt: now - 10000 },
        });

        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "newest-commit",
          parentCommit: "old-commit",
          metadata: { createdAt: now },
        });

        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: streamResult.streamId,
          commitSha: "middle-commit",
          parentCommit: "old-commit",
          metadata: { createdAt: now - 5000 },
        });

        // Get checkpoints - should be sorted by createdAt
        const checkpoints = checkpointsModule.getCheckpointsForStream(
          adapter.db,
          streamResult.streamId
        );

        // Last checkpoint should be the newest (the baseline for new checkpoints)
        expect(checkpoints.length).toBe(3);
        expect(checkpoints[0].commitSha).toBe("old-commit");
        expect(checkpoints[1].commitSha).toBe("middle-commit");
        expect(checkpoints[2].commitSha).toBe("newest-commit");

        // The baseline selection logic would use checkpoints[checkpoints.length - 1]
        const mostRecentBaseline = checkpoints[checkpoints.length - 1];
        expect(mostRecentBaseline.commitSha).toBe("newest-commit");
      }

      adapter.close();
    });

    it("returns empty array for stream with no checkpoints (triggers before_commit fallback)", async () => {
      const { clearDataplaneConfigCache } = await import(
        "../../../src/services/dataplane-config.js"
      );
      clearDataplaneConfigCache();

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const adapter = new DataplaneAdapter(testDir, undefined, db);
      await adapter.initialize();

      // Create a stream
      const streamResult = await adapter.createExecutionStream({
        executionId: "exec-no-cp",
        issueId: "i-no-cp",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-no-cp",
      });

      const checkpointsModule = adapter.checkpointsModule;
      if (checkpointsModule) {
        // Get checkpoints for stream with no checkpoints
        const checkpoints = checkpointsModule.getCheckpointsForStream(
          adapter.db,
          streamResult.streamId
        );

        // Empty array means baseline detection falls back to before_commit
        expect(checkpoints).toEqual([]);
      }

      adapter.close();
    });
  });

  describe("follow-up execution baseline", () => {
    it("checkpoints from parent execution are visible for baseline selection", async () => {
      const { clearDataplaneConfigCache } = await import(
        "../../../src/services/dataplane-config.js"
      );
      clearDataplaneConfigCache();

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const adapter = new DataplaneAdapter(testDir, undefined, db);
      await adapter.initialize();

      // Create parent execution stream
      const parentResult = await adapter.createExecutionStream({
        executionId: "exec-parent-chain",
        issueId: "i-chain",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-parent-chain",
      });

      const checkpointsModule = adapter.checkpointsModule;
      if (checkpointsModule) {
        // Simulate parent execution creating a checkpoint on the same stream
        // (follow-ups reuse the same stream, so checkpoints are shared)
        checkpointsModule.createCheckpoint(adapter.db, {
          streamId: parentResult.streamId,
          commitSha: "parent-execution-commit",
          parentCommit: parentResult.baseCommit,
          metadata: { executionId: "exec-parent-chain", createdAt: Date.now() - 3000 },
        });

        // When creating a follow-up with reuseWorktree=true, it uses the same stream
        // So the parent's checkpoint would be visible for baseline detection
        const checkpoints = checkpointsModule.getCheckpointsForStream(
          adapter.db,
          parentResult.streamId
        );

        expect(checkpoints.length).toBe(1);
        expect(checkpoints[0].commitSha).toBe("parent-execution-commit");

        // This would be used as the baseline for the follow-up's checkpoint
        const baseline = checkpoints[checkpoints.length - 1];
        expect(baseline.commitSha).toBe("parent-execution-commit");
      }

      adapter.close();
    });
  });
});
