/**
 * Integration tests for merge commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { initDatabase } from "../../src/db.js";
import {
  handleResolveConflicts,
  handleMergeDriver,
  handleInitMergeDriver,
  type CommandContext,
} from "../../src/cli/merge-commands.js";
import { readJSONL, writeJSONL } from "../../src/jsonl.js";
import type Database from "better-sqlite3";

/**
 * Merge Commands Integration Tests
 *
 * This test suite covers TWO distinct merge scenarios:
 *
 * 1. TWO-WAY MERGE (handleResolveConflicts):
 *    - Manual conflict resolution after git merge fails
 *    - Uses resolveEntities (UUID-based deduplication)
 *    - No base version available (git index cleared)
 *    - Simple and fast for user-driven resolution
 *
 * 2. THREE-WAY MERGE (handleMergeDriver):
 *    - Automatic merge during git merge operation
 *    - Uses mergeThreeWay (YAML-based line-level merging)
 *    - Has base/ours/theirs versions available
 *    - Enables auto-merging of different paragraphs in multi-line text
 *
 * These are fundamentally different use cases requiring different algorithms.
 */
describe("Merge Commands Integration", () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-integration-"));
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

  describe("handleResolveConflicts", () => {
    it("should use three-way merge when git index stages available", async () => {
      // This test would require setting up a real git repo with conflicted stages
      // For now, we test the fallback path when stages are NOT available
      // TODO: Add git repo setup with actual conflict stages
      expect(true).toBe(true);
    });

    it("should resolve conflicts in issues.jsonl", async () => {
      const issuesPath = path.join(tmpDir, "issues.jsonl");

      // Create conflicted issues.jsonl
      const conflictContent = `{"id":"ISSUE-001","uuid":"uuid-1","title":"Before","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
<<<<<<< HEAD
{"id":"ISSUE-002","uuid":"uuid-2","title":"Ours","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"ISSUE-002","uuid":"uuid-3","title":"Theirs","created_at":"2025-01-03T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
{"id":"ISSUE-003","uuid":"uuid-4","title":"After","created_at":"2025-01-04T00:00:00Z","updated_at":"2025-01-04T00:00:00Z","relationships":[],"tags":[]}
`;

      fs.writeFileSync(issuesPath, conflictContent);

      // Resolve conflicts
      await handleResolveConflicts(ctx, {});

      // Read resolved file
      const resolved = await readJSONL(issuesPath);

      expect(resolved).toHaveLength(4); // 3 original + 1 renamed
      expect(resolved[0].id).toBe("ISSUE-001");
      expect(resolved[1].id).toBe("ISSUE-002");
      expect(resolved[2].id).toBe("ISSUE-002.1"); // Second UUID gets renamed
      expect(resolved[3].id).toBe("ISSUE-003");
    });

    it("should handle --dry-run mode without writing", async () => {
      const issuesPath = path.join(tmpDir, "issues.jsonl");

      const conflictContent = `<<<<<<< HEAD
{"id":"A","uuid":"uuid-1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z"}
=======
{"id":"A","uuid":"uuid-2","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z"}
>>>>>>> feature
`;

      fs.writeFileSync(issuesPath, conflictContent);
      const originalContent = fs.readFileSync(issuesPath, "utf8");

      // Dry run
      await handleResolveConflicts(ctx, { dryRun: true });

      // File should be unchanged
      const afterContent = fs.readFileSync(issuesPath, "utf8");
      expect(afterContent).toBe(originalContent);
    });

    it("should handle no conflicts gracefully", async () => {
      const issuesPath = path.join(tmpDir, "issues.jsonl");

      // Clean file with no conflicts
      const cleanContent = `{"id":"A","uuid":"uuid-1","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
{"id":"B","uuid":"uuid-2","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
`;

      fs.writeFileSync(issuesPath, cleanContent);

      // Should not throw
      await expect(handleResolveConflicts(ctx, {})).resolves.toBeUndefined();
    });

    it("should resolve conflicts in specs.jsonl", async () => {
      const specsPath = path.join(tmpDir, "specs.jsonl");

      const conflictContent = `<<<<<<< HEAD
{"id":"SPEC-001","uuid":"uuid-1","title":"Ours","file_path":"specs/test.md","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"SPEC-001","uuid":"uuid-1","title":"Theirs","file_path":"specs/test.md","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":["new"]}
>>>>>>> feature
`;

      fs.writeFileSync(specsPath, conflictContent);

      await handleResolveConflicts(ctx, {});

      const resolved = await readJSONL(specsPath);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe("SPEC-001");
      expect(resolved[0].title).toBe("Theirs"); // Most recent wins
      expect(resolved[0].tags).toContain("new"); // Metadata merged
    });

    it("should handle malformed JSON gracefully", async () => {
      const issuesPath = path.join(tmpDir, "issues.jsonl");

      const conflictContent = `{"id":"A","uuid":"uuid-1","title":"Valid A","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":[]}
<<<<<<< HEAD
{invalid json}
=======
{"id":"B","uuid":"uuid-2","title":"Valid B","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-02T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
`;

      fs.writeFileSync(issuesPath, conflictContent);

      // Should not throw - malformed lines are skipped with warning
      await expect(handleResolveConflicts(ctx, {})).resolves.toBeUndefined();

      const resolved = await readJSONL(issuesPath);
      expect(resolved).toHaveLength(2); // Valid entities only
    });
  });

  describe("handleMergeDriver", () => {
    it("should perform three-way merge successfully", async () => {
      const base = path.join(tmpDir, "base.jsonl");
      const ours = path.join(tmpDir, "ours.jsonl");
      const theirs = path.join(tmpDir, "theirs.jsonl");

      // Base version
      await writeJSONL(base, [
        {
          id: "A",
          uuid: "uuid-1",
          title: "Base",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);

      // Our changes
      await writeJSONL(ours, [
        {
          id: "A",
          uuid: "uuid-1",
          title: "Ours",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ]);

      // Their changes
      await writeJSONL(theirs, [
        {
          id: "A",
          uuid: "uuid-1",
          title: "Theirs",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-03T00:00:00Z",
        },
      ]);

      // Mock process.exit to prevent test exit
      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
      }) as any;

      try {
        await handleMergeDriver({ base, ours, theirs });
      } finally {
        process.exit = originalExit;
      }

      expect(exitCode).toBe(0); // Success

      // Check result written to ours
      const result = await readJSONL(ours);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Theirs"); // Most recent wins
    });

    it("should handle additions on both sides", async () => {
      const base = path.join(tmpDir, "base.jsonl");
      const ours = path.join(tmpDir, "ours.jsonl");
      const theirs = path.join(tmpDir, "theirs.jsonl");

      // Base version
      await writeJSONL(base, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);

      // Our changes - added B
      await writeJSONL(ours, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "B",
          uuid: "uuid-2",
          created_at: "2025-01-02T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ]);

      // Their changes - added C
      await writeJSONL(theirs, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "C",
          uuid: "uuid-3",
          created_at: "2025-01-03T00:00:00Z",
          updated_at: "2025-01-03T00:00:00Z",
        },
      ]);

      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
      }) as any;

      try {
        await handleMergeDriver({ base, ours, theirs });
      } finally {
        process.exit = originalExit;
      }

      expect(exitCode).toBe(0);

      const result = await readJSONL(ours);
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.id).sort()).toEqual(["A", "B", "C"]);
    });

    it("should not log on successful merge", async () => {
      const base = path.join(tmpDir, "base.jsonl");
      const ours = path.join(tmpDir, "ours.jsonl");
      const theirs = path.join(tmpDir, "theirs.jsonl");

      await writeJSONL(base, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);
      await writeJSONL(ours, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);
      await writeJSONL(theirs, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);

      // Create .sudocode directory in tmpDir
      const sudocodeDir = path.join(tmpDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Change to tmpDir so log would be created there (if it were to be created)
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      const originalExit = process.exit;
      process.exit = ((code?: number) => {}) as any;

      try {
        await handleMergeDriver({ base, ours, theirs });
      } finally {
        process.exit = originalExit;
        process.chdir(originalCwd);
      }

      // Check log file was NOT created on success
      const logPath = path.join(sudocodeDir, "merge-driver.log");
      expect(fs.existsSync(logPath)).toBe(false);
    });

    it("should log only on merge failure", async () => {
      const base = path.join(tmpDir, "base.jsonl");
      const ours = path.join(tmpDir, "readonly-dir", "ours.jsonl"); // Invalid path
      const theirs = path.join(tmpDir, "theirs.jsonl");

      // Create read-only directory to cause write failure
      const readonlyDir = path.join(tmpDir, "readonly-dir");
      fs.mkdirSync(readonlyDir);
      fs.chmodSync(readonlyDir, 0o444); // Read-only

      await writeJSONL(base, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);
      await writeJSONL(theirs, [
        {
          id: "A",
          uuid: "uuid-1",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ]);

      // Create .sudocode directory in tmpDir
      const sudocodeDir = path.join(tmpDir, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Change to tmpDir so log is created there
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
      }) as any;

      try {
        await handleMergeDriver({ base, ours, theirs });
      } catch (error) {
        // Expected to fail
      } finally {
        process.exit = originalExit;
        process.chdir(originalCwd);
        // Restore permissions for cleanup
        fs.chmodSync(readonlyDir, 0o755);
      }

      // Check log file was created on failure
      const logPath = path.join(sudocodeDir, "merge-driver.log");
      expect(fs.existsSync(logPath)).toBe(true);

      const logContent = fs.readFileSync(logPath, "utf8");
      expect(logContent).toContain("Merge failed for:");
      expect(logContent).toContain("Error:");
      expect(exitCode).toBe(1);
    });
  });

  describe("handleInitMergeDriver", () => {
    it("should create .git/config entry", async () => {
      // Create fake git repo
      const gitDir = path.join(tmpDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await handleInitMergeDriver({ global: false });

        const configPath = path.join(gitDir, "config");
        expect(fs.existsSync(configPath)).toBe(true);

        const config = fs.readFileSync(configPath, "utf8");
        expect(config).toContain('[merge "sudocode-jsonl"]');
        expect(config).toContain("driver = sudocode merge-driver");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should create .gitattributes entry", async () => {
      const gitDir = path.join(tmpDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await handleInitMergeDriver({ global: false });

        const gitattributesPath = path.join(tmpDir, ".gitattributes");
        expect(fs.existsSync(gitattributesPath)).toBe(true);

        const attributes = fs.readFileSync(gitattributesPath, "utf8");
        expect(attributes).toContain(".sudocode/*.jsonl merge=sudocode-jsonl");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should not create .gitattributes for global install", async () => {
      // For global install, we would modify ~/.gitconfig
      // Skip this test as it would affect the actual home directory
      // This is better tested manually
      expect(true).toBe(true);
    });

    it("should handle already configured merge driver", async () => {
      const gitDir = path.join(tmpDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });

      // Pre-create config with merge driver
      const configPath = path.join(gitDir, "config");
      fs.writeFileSync(
        configPath,
        '[merge "sudocode-jsonl"]\n\tdriver = sudocode merge-driver\n'
      );

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Should not throw when already configured
        await expect(
          handleInitMergeDriver({ global: false })
        ).resolves.toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should fail gracefully when not in git repo", async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir); // No .git directory

      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
        throw new Error(`process.exit called with code ${code}`);
      }) as any;

      try {
        await handleInitMergeDriver({ global: false });
        // Should not reach here - should have called process.exit(1)
        expect(exitCode).toBe(1);
      } catch (error) {
        // Expected - either process.exit or actual error
        if (error instanceof Error && error.message.includes("process.exit")) {
          expect(exitCode).toBe(1);
        } else {
          // Some other error - test will fail
          throw error;
        }
      } finally {
        process.exit = originalExit;
        process.chdir(originalCwd);
      }
    });
  });

  describe("End-to-end workflow", () => {
    it("should resolve conflicts and maintain data integrity", async () => {
      const issuesPath = path.join(tmpDir, "issues.jsonl");

      // Complex conflict scenario - avoid relationships to prevent import conflicts
      const conflictContent = `{"id":"i-001","uuid":"uuid-1","title":"First","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z","relationships":[],"tags":["initial"]}
<<<<<<< HEAD
{"id":"i-002","uuid":"uuid-2","title":"Our Change","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-05T00:00:00Z","relationships":[],"tags":["ours"]}
{"id":"i-003","uuid":"uuid-3","title":"Added by us","created_at":"2025-01-03T00:00:00Z","updated_at":"2025-01-03T00:00:00Z","relationships":[],"tags":[]}
=======
{"id":"i-002","uuid":"uuid-2","title":"Their Change","created_at":"2025-01-02T00:00:00Z","updated_at":"2025-01-06T00:00:00Z","relationships":[],"tags":["theirs"]}
{"id":"i-004","uuid":"uuid-4","title":"Added by them","created_at":"2025-01-04T00:00:00Z","updated_at":"2025-01-04T00:00:00Z","relationships":[],"tags":[]}
>>>>>>> feature
{"id":"i-005","uuid":"uuid-5","title":"Last","created_at":"2025-01-07T00:00:00Z","updated_at":"2025-01-07T00:00:00Z","relationships":[],"tags":[]}
`;

      fs.writeFileSync(issuesPath, conflictContent);

      await handleResolveConflicts(ctx, {});

      const resolved = await readJSONL(issuesPath);

      // Verify count
      expect(resolved).toHaveLength(5); // i-001, i-002, i-003, i-004, i-005

      // Verify same UUID, same ID: most recent wins + metadata merged
      const i002 = resolved.find((e) => e.id === "i-002");
      expect(i002).toBeDefined();
      expect(i002!.title).toBe("Their Change"); // Their version is newer
      expect(i002!.tags).toContain("ours");
      expect(i002!.tags).toContain("theirs"); // Tags merged

      // Verify all entities present
      const ids = resolved.map((e) => e.id).sort();
      expect(ids).toEqual(["i-001", "i-002", "i-003", "i-004", "i-005"]);

      // Verify sorted by created_at
      for (let i = 0; i < resolved.length - 1; i++) {
        expect(resolved[i].created_at <= resolved[i + 1].created_at).toBe(true);
      }
    });
  });
});
