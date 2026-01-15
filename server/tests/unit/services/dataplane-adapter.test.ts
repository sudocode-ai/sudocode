/**
 * Unit tests for DataplaneAdapter
 *
 * Tests the integration layer between sudocode and the dataplane library.
 * Tests basic behavior without requiring the actual dataplane package.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { clearDataplaneConfigCache } from "../../../src/services/dataplane-config.js";

describe("DataplaneAdapter", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-dataplane-adapter-test-")
    );
    clearDataplaneConfigCache();
    vi.resetModules();
  });

  afterEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    clearDataplaneConfigCache();
    vi.resetModules();
  });

  describe("isEnabled property", () => {
    it("returns true when dataplane is enabled in config", async () => {
      // Create .sudocode directory with dataplane enabled
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: { enabled: true },
        })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      expect(adapter.isEnabled).toBe(true);
    });

    it("returns false when dataplane is disabled", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: { enabled: false },
        })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      expect(adapter.isEnabled).toBe(false);
    });

    it("returns true when no config exists (enabled by default)", async () => {
      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      // Dataplane is enabled by default
      expect(adapter.isEnabled).toBe(true);
    });
  });

  describe("isInitialized property", () => {
    it("returns false before initialize() is called", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      expect(adapter.isInitialized).toBe(false);
    });
  });

  describe("initialize", () => {
    it("throws when dataplane is disabled", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: false } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(adapter.initialize()).rejects.toThrow(
        "Dataplane is not enabled in configuration"
      );
    });

    it("initializes successfully when dataplane package is installed", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      // Need to initialize git repo for dataplane to work
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      // Should initialize successfully now that dataplane is installed
      await adapter.initialize();
      expect(adapter.isInitialized).toBe(true);

      adapter.close();
    });
  });

  describe("operations without initialization", () => {
    it("throws when calling ensureIssueStream without initialization", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(
        adapter.ensureIssueStream("i-abc123", "agent-1")
      ).rejects.toThrow("DataplaneAdapter not initialized");
    });

    it("throws when calling createExecutionStream without initialization", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(
        adapter.createExecutionStream({
          executionId: "exec-123",
          issueId: "i-abc",
          agentType: "claude-code",
          targetBranch: "main",
          mode: "worktree",
          agentId: "agent-1",
        })
      ).rejects.toThrow("DataplaneAdapter not initialized");
    });

    it("throws when calling getChanges without initialization", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(adapter.getChanges("stream-1")).rejects.toThrow(
        "DataplaneAdapter not initialized"
      );
    });

    it("throws when calling healthCheck without initialization", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(adapter.healthCheck()).rejects.toThrow(
        "DataplaneAdapter not initialized"
      );
    });
  });

  describe("close", () => {
    it("can be called safely when not initialized", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      // Should not throw
      expect(() => adapter.close()).not.toThrow();
    });
  });

  describe("configuration passthrough", () => {
    it("accepts custom config in constructor", async () => {
      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      const customConfig = {
        enabled: true,
        dbPath: "custom-path.db",
        conflictStrategy: {
          default: "ours" as const,
          code: "ours" as const,
          cascade: "skip_conflicting" as const,
        },
        autoReconcile: false,
        cascadeOnMerge: true,
        mergeQueue: {
          enabled: true,
          autoEnqueue: true,
          requireQueue: false,
        },
        streams: {
          branchPrefix: "custom",
          autoCleanupAbandoned: false,
          abandonedRetentionDays: 7,
        },
        recovery: {
          runOnStartup: false,
          enableCheckpoints: false,
        },
      };

      const adapter = new DataplaneAdapter(testDir, customConfig);

      expect(adapter.isEnabled).toBe(true);
    });
  });

  describe("external database support", () => {
    it("accepts optional db parameter in constructor", async () => {
      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const Database = (await import("better-sqlite3")).default;

      // Create an in-memory database
      const externalDb = new Database(":memory:");

      const customConfig = {
        enabled: true,
        dbPath: "ignored.db",
        tablePrefix: "test_",
        conflictStrategy: {
          default: "defer" as const,
          code: "defer" as const,
          cascade: "skip_conflicting" as const,
        },
        autoReconcile: true,
        cascadeOnMerge: false,
        mergeQueue: {
          enabled: false,
          autoEnqueue: false,
          requireQueue: false,
        },
        streams: {
          branchPrefix: "sudocode",
          autoCleanupAbandoned: true,
          abandonedRetentionDays: 30,
        },
        recovery: {
          runOnStartup: true,
          enableCheckpoints: true,
        },
      };

      // Constructor should accept db as third parameter
      const adapter = new DataplaneAdapter(testDir, customConfig, externalDb);

      expect(adapter.isEnabled).toBe(true);
      expect(adapter.isInitialized).toBe(false);

      externalDb.close();
    });

    it("uses tablePrefix from config when initializing with external db", async () => {
      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: {
            enabled: true,
            tablePrefix: "custom_prefix_",
          },
        })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const Database = (await import("better-sqlite3")).default;

      // Create an in-memory database
      const externalDb = new Database(":memory:");

      const adapter = new DataplaneAdapter(testDir, undefined, externalDb);

      // Initialize should use the external db with tablePrefix
      await adapter.initialize();
      expect(adapter.isInitialized).toBe(true);

      adapter.close();
      externalDb.close();
    });

    it("accepts optional db parameter in getDataplaneAdapter factory", async () => {
      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: { enabled: true, tablePrefix: "dp_" },
        })
      );

      const { getDataplaneAdapter, closeDataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const Database = (await import("better-sqlite3")).default;

      const externalDb = new Database(":memory:");

      // Factory should accept db parameter
      const adapter = await getDataplaneAdapter(testDir, externalDb);

      expect(adapter).not.toBeNull();
      expect(adapter!.isInitialized).toBe(true);

      closeDataplaneAdapter(testDir);
      externalDb.close();
    });

    it("falls back to legacy mode when no external db provided", async () => {
      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: {
            enabled: true,
            dbPath: "legacy-dataplane.db",
          },
        })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );

      // Constructor without db parameter - should use legacy mode
      const adapter = new DataplaneAdapter(testDir);

      await adapter.initialize();
      expect(adapter.isInitialized).toBe(true);

      // In legacy mode, a separate db file should be created
      const expectedDbPath = path.join(sudocodeDir, "legacy-dataplane.db");
      expect(fs.existsSync(expectedDbPath)).toBe(true);

      adapter.close();
    });
  });

  describe("syncIssueDependencies", () => {
    it("throws when not initialized", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      // Mock db - the method requires it for relationship queries
      const mockDb = {} as never;

      await expect(adapter.syncIssueDependencies("i-test", mockDb)).rejects.toThrow(
        "DataplaneAdapter not initialized"
      );
    });
  });

  describe("triggerCascade", () => {
    it("throws when not initialized", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(adapter.triggerCascade("stream-1")).rejects.toThrow(
        "DataplaneAdapter not initialized"
      );
    });

    it("returns empty report when cascade is disabled", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: {
            enabled: true,
            cascadeOnMerge: false,
          },
        })
      );

      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);
      await adapter.initialize();

      const report = await adapter.triggerCascade("stream-1");

      expect(report).toEqual({
        triggered_by: "stream-1",
        affected_streams: [],
        complete: true,
      });

      adapter.close();
    });

    it("returns empty report when no dependents exist", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({
          dataplane: {
            enabled: true,
            cascadeOnMerge: true,
          },
        })
      );

      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);
      await adapter.initialize();

      // Create a stream
      const stream = await adapter.createExecutionStream({
        executionId: "exec-1",
        issueId: "i-test",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-1",
      });

      // Trigger cascade - no dependents so empty report
      const report = await adapter.triggerCascade(stream.streamId);

      expect(report).toEqual({
        triggered_by: stream.streamId,
        affected_streams: [],
        complete: true,
      });

      adapter.close();
    });
  });

  describe("checkpointSync", () => {
    it("throws when not initialized", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      // Mock db
      const mockDb = {} as never;

      await expect(adapter.checkpointSync("exec-123", mockDb)).rejects.toThrow(
        "DataplaneAdapter not initialized"
      );
    });

    it("returns error when execution stream not found", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);
      await adapter.initialize();

      const Database = (await import("better-sqlite3")).default;
      const mockDb = new Database(":memory:");

      const result = await adapter.checkpointSync("nonexistent-exec", mockDb);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Execution stream not found");

      adapter.close();
      mockDb.close();
    });
  });

  describe("createFollowUpStream", () => {
    it("throws when not initialized", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      await expect(
        adapter.createFollowUpStream({
          parentExecutionId: "exec-parent",
          executionId: "exec-child",
          agentId: "agent-1",
        })
      ).rejects.toThrow("DataplaneAdapter not initialized");
    });

    it("creates follow-up stream with reuseWorktree=true", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);
      await adapter.initialize();

      // Create parent stream first
      const parentResult = await adapter.createExecutionStream({
        executionId: "exec-parent-001",
        issueId: "i-test",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-parent",
      });

      // Create follow-up with reuseWorktree=true (inherits stream)
      const followUpResult = await adapter.createFollowUpStream({
        parentExecutionId: "exec-parent-001",
        parentStreamId: parentResult.streamId,
        executionId: "exec-child-001",
        agentType: "claude-code",
        agentId: "agent-child",
        reuseWorktree: true,
      });

      expect(followUpResult).toBeDefined();
      expect(followUpResult.streamId).toBeDefined();
      // With reuseWorktree=true, should return same stream
      expect(followUpResult.streamId).toBe(parentResult.streamId);

      adapter.close();
    });

    it("creates new stream with reuseWorktree=false", async () => {
      const sudocodeDir = path.join(testDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(sudocodeDir, "config.json"),
        JSON.stringify({ dataplane: { enabled: true } })
      );

      // Initialize git repo
      const { execSync } = await import("child_process");
      execSync("git init", { cwd: testDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", {
        cwd: testDir,
        stdio: "pipe",
      });
      execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });
      fs.writeFileSync(path.join(testDir, "README.md"), "# Test");
      execSync("git add . && git commit -m 'init'", {
        cwd: testDir,
        stdio: "pipe",
      });

      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);
      await adapter.initialize();

      // Create parent stream first
      const parentResult = await adapter.createExecutionStream({
        executionId: "exec-parent-002",
        issueId: "i-test2",
        agentType: "claude-code",
        targetBranch: "main",
        mode: "worktree",
        agentId: "agent-parent-2",
      });

      // Create follow-up with reuseWorktree=false (creates new stream)
      const followUpResult = await adapter.createFollowUpStream({
        parentExecutionId: "exec-parent-002",
        parentStreamId: parentResult.streamId,
        executionId: "exec-child-002",
        agentType: "claude-code",
        agentId: "agent-child-2",
        reuseWorktree: false,
      });

      expect(followUpResult).toBeDefined();
      expect(followUpResult.streamId).toBeDefined();
      // With reuseWorktree=false, should create new stream
      expect(followUpResult.streamId).not.toBe(parentResult.streamId);

      adapter.close();
    });
  });
});
