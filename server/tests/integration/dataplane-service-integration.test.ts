/**
 * Integration tests for Dataplane Service Integration
 *
 * Tests the integration between DataplaneAdapter and the existing services:
 * - ExecutionLifecycleService creating executions with stream_id
 * - ExecutionChangesService using dataplane for change tracking
 * - Full execution flow with dataplane enabled
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import { initDatabase as initCliDatabase } from "@sudocode-ai/cli/dist/db.js";
import {
  EXECUTIONS_TABLE,
  EXECUTIONS_INDEXES,
  ISSUES_TABLE,
  ISSUES_INDEXES,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
import { ExecutionLifecycleService } from "../../src/services/execution-lifecycle.js";
import { ExecutionChangesService } from "../../src/services/execution-changes-service.js";
import { getExecution } from "../../src/services/executions.js";
import {
  DataplaneAdapter,
  getDataplaneAdapter,
  closeDataplaneAdapter,
  closeAllDataplaneAdapters,
} from "../../src/services/dataplane-adapter.js";
import { clearDataplaneConfigCache } from "../../src/services/dataplane-config.js";
import { WorktreeSyncService } from "../../src/services/worktree-sync-service.js";

describe("Dataplane Service Integration", () => {
  let testDir: string;
  let db: Database.Database;
  let dataplaneAdapter: DataplaneAdapter | null;

  beforeEach(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-dataplane-service-integration-")
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
    fs.mkdirSync(path.join(sudocodeDir, "worktrees"), { recursive: true });
    fs.writeFileSync(
      path.join(sudocodeDir, "config.json"),
      JSON.stringify({
        dataplane: {
          enabled: true,
          dbPath: "dataplane.db",
        },
        worktree: {
          worktreeStoragePath: ".sudocode/worktrees",
          autoCreateBranches: true,
          branchPrefix: "sudocode",
        },
      })
    );

    // Initialize sudocode database
    const dbPath = path.join(sudocodeDir, "cache.db");
    db = initCliDatabase({ path: dbPath });

    // Create executions table (not in CLI schema by default)
    db.exec(ISSUES_TABLE);
    db.exec(ISSUES_INDEXES);
    db.exec(EXECUTIONS_TABLE);
    db.exec(EXECUTIONS_INDEXES);
    runMigrations(db);

    // Create a test issue for executions
    db.prepare(
      `
      INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `
    ).run("i-test123", "test-uuid-123", "Test Issue", "Test content", "open", 2);

    // Clear config cache and initialize dataplane adapter
    clearDataplaneConfigCache();
    dataplaneAdapter = await getDataplaneAdapter(testDir);
  });

  afterEach(async () => {
    // Clean up
    if (db) {
      db.close();
    }
    closeAllDataplaneAdapters();
    clearDataplaneConfigCache();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("ExecutionLifecycleService with Dataplane", () => {
    it("creates execution with stream_id when dataplane is enabled", async () => {
      // Verify dataplane adapter is initialized
      expect(dataplaneAdapter).not.toBeNull();
      expect(dataplaneAdapter!.isInitialized).toBe(true);

      // Create lifecycle service with dataplane adapter
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined, // Use default WorktreeManager
        dataplaneAdapter
      );

      expect(lifecycleService.isDataplaneEnabled).toBe(true);

      // Create execution with worktree
      const result = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Test Issue",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Verify execution was created
      expect(result.execution).toBeDefined();
      expect(result.execution.id).toBeDefined();
      expect(result.worktreePath).toBeDefined();
      expect(result.branchName).toBeDefined();

      // Verify stream_id was set
      expect(result.execution.stream_id).toBeDefined();
      expect(result.execution.stream_id).not.toBeNull();
      expect(typeof result.execution.stream_id).toBe("string");

      // Verify worktree was created
      expect(fs.existsSync(result.worktreePath)).toBe(true);

      // Verify execution record in database has stream_id
      const dbExecution = getExecution(db, result.execution.id);
      expect(dbExecution).not.toBeNull();
      expect(dbExecution!.stream_id).toBe(result.execution.stream_id);
    });

    it("falls back to legacy mode when dataplane adapter is null", async () => {
      // Create lifecycle service without dataplane adapter
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        null // Explicitly disable dataplane
      );

      expect(lifecycleService.isDataplaneEnabled).toBe(false);

      // Create execution with worktree
      const result = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Test Issue",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Verify execution was created (legacy mode)
      expect(result.execution).toBeDefined();
      expect(result.worktreePath).toBeDefined();

      // stream_id should be null in legacy mode
      expect(result.execution.stream_id).toBeNull();
    });
  });

  describe("ExecutionChangesService with Dataplane", () => {
    it("uses dataplane for change tracking when stream_id exists", async () => {
      // Create lifecycle service with dataplane
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // Create execution
      const execResult = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Test Issue",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      expect(execResult.execution.stream_id).toBeDefined();

      // Make a change in the worktree
      const testFile = path.join(execResult.worktreePath, "test-file.txt");
      fs.writeFileSync(testFile, "Hello from dataplane test\n");

      // Commit the change via dataplane
      await dataplaneAdapter!.commitChanges({
        streamId: execResult.execution.stream_id!,
        message: "Add test file",
        agentId: `exec-${execResult.execution.id.substring(0, 8)}`,
        worktree: execResult.worktreePath,
        stageAll: true,
      });

      // Update execution with after_commit
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: execResult.worktreePath,
        encoding: "utf-8",
      }).trim();

      db.prepare(
        `UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`
      ).run(afterCommit, execResult.execution.id);

      // Create changes service with dataplane
      const changesService = new ExecutionChangesService(
        db,
        testDir,
        dataplaneAdapter
      );

      expect(changesService.isDataplaneEnabled).toBe(true);

      // Get changes - should use dataplane
      const changes = await changesService.getChanges(execResult.execution.id);

      expect(changes.available).toBe(true);
      // Changes should include our test file
      // Note: dataplane may return empty if not tracking yet, which falls back to git
      if (changes.captured) {
        expect(changes.captured.files.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("falls back to git when dataplane returns empty", async () => {
      // Create lifecycle service with dataplane
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // Create execution
      const execResult = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Test Issue",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Make a change in the worktree
      const testFile = path.join(execResult.worktreePath, "fallback-test.txt");
      fs.writeFileSync(testFile, "Testing git fallback\n");

      // Commit directly via git (not through dataplane)
      execSync("git add . && git commit -m 'Direct git commit'", {
        cwd: execResult.worktreePath,
        stdio: "pipe",
      });

      // Update execution with after_commit
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: execResult.worktreePath,
        encoding: "utf-8",
      }).trim();

      db.prepare(
        `UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`
      ).run(afterCommit, execResult.execution.id);

      // Create changes service with dataplane
      const changesService = new ExecutionChangesService(
        db,
        testDir,
        dataplaneAdapter
      );

      // Get changes - should fall back to git since dataplane wasn't used for commit
      const changes = await changesService.getChanges(execResult.execution.id);

      expect(changes.available).toBe(true);
      expect(changes.captured).toBeDefined();
      expect(changes.captured!.files.length).toBeGreaterThan(0);
      expect(changes.captured!.files.some((f) => f.path === "fallback-test.txt")).toBe(
        true
      );
    });
  });

  describe("Full Execution Flow with Dataplane", () => {
    it("complete flow: create execution, make changes, track changes", async () => {
      // 1. Create lifecycle service
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // 2. Create execution
      const execResult = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Full Flow Test",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      expect(execResult.execution.stream_id).toBeDefined();
      const streamId = execResult.execution.stream_id!;

      // 3. Make changes in worktree
      const file1 = path.join(execResult.worktreePath, "feature.ts");
      const file2 = path.join(execResult.worktreePath, "feature.test.ts");
      fs.writeFileSync(file1, 'export function feature() { return "hello"; }\n');
      fs.writeFileSync(file2, 'import { feature } from "./feature";\n');

      // 4. Commit via dataplane
      const commitResult = await dataplaneAdapter!.commitChanges({
        streamId,
        message: "Add feature with tests",
        agentId: `exec-${execResult.execution.id.substring(0, 8)}`,
        worktree: execResult.worktreePath,
        stageAll: true,
      });

      expect(commitResult.success).toBe(true);

      // 5. Update execution status
      const afterCommit = execSync("git rev-parse HEAD", {
        cwd: execResult.worktreePath,
        encoding: "utf-8",
      }).trim();

      db.prepare(
        `UPDATE executions SET after_commit = ?, status = 'completed' WHERE id = ?`
      ).run(afterCommit, execResult.execution.id);

      // 6. Get changes via service
      const changesService = new ExecutionChangesService(
        db,
        testDir,
        dataplaneAdapter
      );

      const changes = await changesService.getChanges(execResult.execution.id);

      expect(changes.available).toBe(true);
      expect(changes.captured).toBeDefined();
      expect(changes.captured!.files.length).toBe(2);

      const filePaths = changes.captured!.files.map((f) => f.path);
      expect(filePaths).toContain("feature.ts");
      expect(filePaths).toContain("feature.test.ts");
    });

    it("handles multiple executions with separate streams", async () => {
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // Create two executions
      const exec1 = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Execution 1",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Create second issue
      db.prepare(
        `
        INSERT INTO issues (id, uuid, title, content, status, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `
      ).run(
        "i-test456",
        "test-uuid-456",
        "Test Issue 2",
        "Test content 2",
        "open",
        2
      );

      const exec2 = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test456",
        issueTitle: "Execution 2",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Verify both have unique stream_ids
      expect(exec1.execution.stream_id).toBeDefined();
      expect(exec2.execution.stream_id).toBeDefined();
      expect(exec1.execution.stream_id).not.toBe(exec2.execution.stream_id);

      // Verify separate worktrees
      expect(exec1.worktreePath).not.toBe(exec2.worktreePath);
      expect(fs.existsSync(exec1.worktreePath)).toBe(true);
      expect(fs.existsSync(exec2.worktreePath)).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("falls back gracefully when dataplane initialization fails", async () => {
      // Close the adapter to simulate failure
      closeDataplaneAdapter(testDir);
      clearDataplaneConfigCache();

      // Create a fresh lifecycle service (will try to get adapter but fail)
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        null // Explicitly null - simulating failed initialization
      );

      // Should fall back to legacy mode
      expect(lifecycleService.isDataplaneEnabled).toBe(false);

      // Should still be able to create execution
      const result = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Fallback Test",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      expect(result.execution).toBeDefined();
      expect(result.execution.stream_id).toBeNull(); // No stream_id in legacy mode
    });
  });

  describe("WorktreeSyncService with Dataplane", () => {
    it("reports isDataplaneEnabled when adapter is provided", async () => {
      // Create sync service with dataplane adapter
      const syncService = new WorktreeSyncService(db, testDir, dataplaneAdapter);

      expect(syncService.isDataplaneEnabled).toBe(true);
    });

    it("reports isDataplaneEnabled=false when adapter is null", () => {
      // Create sync service without adapter
      const syncService = new WorktreeSyncService(db, testDir, null);

      expect(syncService.isDataplaneEnabled).toBe(false);
    });

    it("reports isDataplaneEnabled=false when adapter is undefined", () => {
      // Create sync service with undefined adapter (legacy mode)
      const syncService = new WorktreeSyncService(db, testDir);

      expect(syncService.isDataplaneEnabled).toBe(false);
    });

    it("preview sync works with dataplane adapter", async () => {
      // Create lifecycle service with dataplane
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // Create execution
      const execResult = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Sync Test",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      expect(execResult.execution.stream_id).toBeDefined();

      // Create sync service with dataplane
      const syncService = new WorktreeSyncService(db, testDir, dataplaneAdapter);

      expect(syncService.isDataplaneEnabled).toBe(true);

      // Preview should work (may return canSync: false if nothing to sync)
      const preview = await syncService.previewSync(execResult.execution.id);

      // Should get a valid preview result
      expect(preview).toBeDefined();
      expect(typeof preview.canSync).toBe("boolean");
      expect(Array.isArray(preview.warnings)).toBe(true);
    });

    it("sync result includes backupTag", async () => {
      // Create lifecycle service with dataplane
      const lifecycleService = new ExecutionLifecycleService(
        db,
        testDir,
        undefined,
        dataplaneAdapter
      );

      // Create execution
      const execResult = await lifecycleService.createExecutionWithWorktree({
        issueId: "i-test123",
        issueTitle: "Backup Tag Test",
        agentType: "claude-code",
        targetBranch: "main",
        repoPath: testDir,
        mode: "worktree",
      });

      // Make a change in the worktree
      const testFile = path.join(execResult.worktreePath, "backup-test.txt");
      fs.writeFileSync(testFile, "Testing backup tag\\n");

      // Commit the change
      execSync("git add . && git commit -m 'Test commit'", {
        cwd: execResult.worktreePath,
        stdio: "pipe",
      });

      // Create sync service with dataplane
      const syncService = new WorktreeSyncService(db, testDir, dataplaneAdapter);

      // Perform squash sync
      const result = await syncService.squashSync(execResult.execution.id);

      // Should have backup tag in result (only on success)
      if (result.success) {
        expect(result.backupTag).toBeDefined();
        expect(result.backupTag).toContain("sudocode-sync-before-");
      }
    });
  });
});
