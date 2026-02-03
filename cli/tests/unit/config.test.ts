/**
 * Tests for config split functionality (config.json + config.local.json)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getConfig,
  getProjectConfig,
  getLocalConfig,
  updateProjectConfig,
  updateLocalConfig,
  updateConfig,
  migrateConfigIfNeeded,
  isMarkdownFirst,
  PROJECT_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "../../src/config.js";

describe("Config Split", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getConfig", () => {
    it("should return empty config when no files exist", () => {
      const config = getConfig(tempDir);
      expect(config).toEqual({});
    });

    it("should read project config from config.json", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ sourceOfTruth: "markdown" }),
        "utf8"
      );

      const config = getConfig(tempDir);
      expect(config.sourceOfTruth).toBe("markdown");
    });

    it("should read local config from config.local.json", () => {
      fs.writeFileSync(
        path.join(tempDir, LOCAL_CONFIG_FILE),
        JSON.stringify({
          worktree: { worktreeStoragePath: "/custom/path" },
        }),
        "utf8"
      );

      const config = getConfig(tempDir);
      expect(config.worktree?.worktreeStoragePath).toBe("/custom/path");
    });

    it("should merge project and local configs", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ sourceOfTruth: "markdown" }),
        "utf8"
      );
      fs.writeFileSync(
        path.join(tempDir, LOCAL_CONFIG_FILE),
        JSON.stringify({
          editor: { editorType: "cursor" },
        }),
        "utf8"
      );

      const config = getConfig(tempDir);
      expect(config.sourceOfTruth).toBe("markdown");
      expect(config.editor?.editorType).toBe("cursor");
    });
  });

  describe("getProjectConfig", () => {
    it("should return only project config fields", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ sourceOfTruth: "jsonl" }),
        "utf8"
      );

      const config = getProjectConfig(tempDir);
      expect(config.sourceOfTruth).toBe("jsonl");
    });
  });

  describe("getLocalConfig", () => {
    it("should return only local config fields", () => {
      fs.writeFileSync(
        path.join(tempDir, LOCAL_CONFIG_FILE),
        JSON.stringify({
          worktree: { worktreeStoragePath: "/local/path" },
        }),
        "utf8"
      );

      const config = getLocalConfig(tempDir);
      expect(config.worktree?.worktreeStoragePath).toBe("/local/path");
    });
  });

  describe("updateProjectConfig", () => {
    it("should write to config.json", () => {
      updateProjectConfig(tempDir, { sourceOfTruth: "markdown" });

      const content = fs.readFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        "utf8"
      );
      expect(JSON.parse(content)).toEqual({ sourceOfTruth: "markdown" });
    });

    it("should merge with existing project config", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ integrations: { linear: {} } }),
        "utf8"
      );

      updateProjectConfig(tempDir, { sourceOfTruth: "markdown" });

      const content = fs.readFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        "utf8"
      );
      const config = JSON.parse(content);
      expect(config.sourceOfTruth).toBe("markdown");
      expect(config.integrations).toEqual({ linear: {} });
    });
  });

  describe("updateLocalConfig", () => {
    it("should write to config.local.json", () => {
      updateLocalConfig(tempDir, {
        editor: { editorType: "zed" },
      });

      const content = fs.readFileSync(
        path.join(tempDir, LOCAL_CONFIG_FILE),
        "utf8"
      );
      expect(JSON.parse(content)).toEqual({ editor: { editorType: "zed" } });
    });
  });

  describe("updateConfig (deprecated)", () => {
    it("should route sourceOfTruth to project config", () => {
      updateConfig(tempDir, { sourceOfTruth: "markdown" });

      const projectConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, PROJECT_CONFIG_FILE), "utf8")
      );
      expect(projectConfig.sourceOfTruth).toBe("markdown");
    });

    it("should route worktree to local config", () => {
      updateConfig(tempDir, {
        worktree: { worktreeStoragePath: "/test" } as any,
      });

      const localConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, LOCAL_CONFIG_FILE), "utf8")
      );
      expect(localConfig.worktree.worktreeStoragePath).toBe("/test");
    });

    it("should route fields to correct files in single call", () => {
      updateConfig(tempDir, {
        sourceOfTruth: "markdown",
        editor: { editorType: "cursor" },
      });

      const projectConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, PROJECT_CONFIG_FILE), "utf8")
      );
      const localConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, LOCAL_CONFIG_FILE), "utf8")
      );

      expect(projectConfig.sourceOfTruth).toBe("markdown");
      expect(localConfig.editor.editorType).toBe("cursor");
    });
  });

  describe("migrateConfigIfNeeded", () => {
    it("should not migrate if local config already exists", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ version: "0.1.0", worktree: {} }),
        "utf8"
      );
      fs.writeFileSync(
        path.join(tempDir, LOCAL_CONFIG_FILE),
        JSON.stringify({}),
        "utf8"
      );

      const migrated = migrateConfigIfNeeded(tempDir);
      expect(migrated).toBe(false);
    });

    it("should not migrate if no local fields present", () => {
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({ sourceOfTruth: "jsonl" }),
        "utf8"
      );

      const migrated = migrateConfigIfNeeded(tempDir);
      expect(migrated).toBe(false);
    });

    it("should migrate old config with local fields", () => {
      // Old format: everything in config.json
      fs.writeFileSync(
        path.join(tempDir, PROJECT_CONFIG_FILE),
        JSON.stringify({
          version: "0.1.0",
          worktree: { worktreeStoragePath: "/old/path" },
          editor: { editorType: "vs-code" },
          integrations: { linear: {} },
        }),
        "utf8"
      );

      const migrated = migrateConfigIfNeeded(tempDir);
      expect(migrated).toBe(true);

      // Check project config (should have integrations, no worktree/editor/version)
      const projectConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, PROJECT_CONFIG_FILE), "utf8")
      );
      expect(projectConfig.integrations).toEqual({ linear: {} });
      expect(projectConfig.worktree).toBeUndefined();
      expect(projectConfig.editor).toBeUndefined();
      expect(projectConfig.version).toBeUndefined();

      // Check local config (should have worktree and editor)
      const localConfig = JSON.parse(
        fs.readFileSync(path.join(tempDir, LOCAL_CONFIG_FILE), "utf8")
      );
      expect(localConfig.worktree).toEqual({ worktreeStoragePath: "/old/path" });
      expect(localConfig.editor).toEqual({ editorType: "vs-code" });
    });
  });

  describe("isMarkdownFirst", () => {
    it("should return false when sourceOfTruth is undefined", () => {
      expect(isMarkdownFirst({})).toBe(false);
    });

    it("should return false when sourceOfTruth is jsonl", () => {
      expect(isMarkdownFirst({ sourceOfTruth: "jsonl" })).toBe(false);
    });

    it("should return true when sourceOfTruth is markdown", () => {
      expect(isMarkdownFirst({ sourceOfTruth: "markdown" })).toBe(true);
    });
  });
});
