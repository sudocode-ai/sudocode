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

    it("returns false when no config exists (default)", async () => {
      const { DataplaneAdapter } = await import(
        "../../../src/services/dataplane-adapter.js"
      );
      const adapter = new DataplaneAdapter(testDir);

      expect(adapter.isEnabled).toBe(false);
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
});
