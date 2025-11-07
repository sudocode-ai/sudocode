/**
 * Tests for hooks system
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  loadHooksConfig,
  saveHooksConfig,
  getHooksForEvent,
  executeHook,
  executeHooksForEvent,
  addHook,
  removeHook,
  updateHook,
  listHooks,
  validateHook,
  type HookExecutionContext,
} from "../../src/operations/hooks.js";
import { initializeAgentsDirectory } from "../../src/operations/agents.js";
import type { HookConfig, HookEvent } from "@sudocode-ai/types";

describe("Hooks System", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join("/tmp", `hooks-test-${Date.now()}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadHooksConfig / saveHooksConfig", () => {
    it("should load default config", () => {
      const config = loadHooksConfig(sudocodeDir);
      expect(config.version).toBe("1.0.0");
      expect(config.hooks).toEqual([]);
      expect(config.global_env).toBeDefined();
    });

    it("should save and load config", () => {
      const config = loadHooksConfig(sudocodeDir);
      config.hooks.push({
        id: "test-hook",
        event: "before_execution",
        type: "command",
        command: "test.sh",
      });

      saveHooksConfig(sudocodeDir, config);

      const loaded = loadHooksConfig(sudocodeDir);
      expect(loaded.hooks.length).toBe(1);
      expect(loaded.hooks[0].id).toBe("test-hook");
    });
  });

  describe("getHooksForEvent", () => {
    beforeEach(() => {
      const config = loadHooksConfig(sudocodeDir);
      config.hooks = [
        {
          id: "before-hook",
          event: "before_execution",
          type: "command",
          command: "before.sh",
        },
        {
          id: "after-hook",
          event: "after_execution",
          type: "command",
          command: "after.sh",
        },
        {
          id: "matcher-hook",
          event: "before_execution",
          type: "command",
          command: "matcher.sh",
          matcher: {
            type: "exact",
            pattern: "code-reviewer",
          },
        },
      ];
      saveHooksConfig(sudocodeDir, config);
    });

    it("should get hooks for specific event", () => {
      const config = loadHooksConfig(sudocodeDir);
      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
      };

      const hooks = getHooksForEvent(config, "before_execution", context);
      expect(hooks.length).toBe(2);
      expect(hooks.map((h) => h.id).sort()).toEqual([
        "before-hook",
        "matcher-hook",
      ]);
    });

    it("should filter by matcher pattern - exact", () => {
      const config = loadHooksConfig(sudocodeDir);
      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
        presetId: "code-reviewer",
      };

      const hooks = getHooksForEvent(config, "before_execution", context);
      expect(hooks.length).toBe(2);
      expect(hooks.some((h) => h.id === "matcher-hook")).toBe(true);
    });

    it("should filter by matcher pattern - wildcard", () => {
      const config = loadHooksConfig(sudocodeDir);
      config.hooks.push({
        id: "wildcard-hook",
        event: "before_execution",
        type: "command",
        command: "wildcard.sh",
        matcher: {
          type: "wildcard",
          pattern: "test-*",
        },
      });
      saveHooksConfig(sudocodeDir, config);

      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
        presetId: "test-writer",
      };

      const hooks = getHooksForEvent(config, "before_execution", context);
      expect(hooks.some((h) => h.id === "wildcard-hook")).toBe(true);
    });

    it("should filter by matcher pattern - regex", () => {
      const config = loadHooksConfig(sudocodeDir);
      config.hooks.push({
        id: "regex-hook",
        event: "before_execution",
        type: "command",
        command: "regex.sh",
        matcher: {
          type: "regex",
          pattern: "^test-.*",
        },
      });
      saveHooksConfig(sudocodeDir, config);

      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
        presetId: "test-writer",
      };

      const hooks = getHooksForEvent(config, "before_execution", context);
      expect(hooks.some((h) => h.id === "regex-hook")).toBe(true);
    });
  });

  describe("executeHook", () => {
    it("should execute command hook successfully", async () => {
      // Create a test script
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const scriptPath = path.join(hooksDir, "test-success.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\necho "Success"\nexit 0',
        { mode: 0o755 }
      );

      const hook: HookConfig = {
        id: "test-hook",
        event: "before_execution",
        type: "command",
        command: "test-success.sh",
      };

      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
      };

      const result = await executeHook(hook, context);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Success");
    }, 10000);

    it("should handle command hook failure", async () => {
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const scriptPath = path.join(hooksDir, "test-failure.sh");
      fs.writeFileSync(
        scriptPath,
        '#!/bin/bash\necho "Failed" >&2\nexit 1',
        { mode: 0o755 }
      );

      const hook: HookConfig = {
        id: "test-hook",
        event: "before_execution",
        type: "command",
        command: "test-failure.sh",
      };

      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
      };

      const result = await executeHook(hook, context);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Failed");
    }, 10000);

    it("should handle non-existent command", async () => {
      const hook: HookConfig = {
        id: "test-hook",
        event: "before_execution",
        type: "command",
        command: "nonexistent.sh",
      };

      const context: HookExecutionContext = {
        event: "before_execution",
        sudocodeDir,
      };

      const result = await executeHook(hook, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("executeHooksForEvent", () => {
    it("should execute all hooks for event", async () => {
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const script1Path = path.join(hooksDir, "hook1.sh");
      const script2Path = path.join(hooksDir, "hook2.sh");

      fs.writeFileSync(script1Path, '#!/bin/bash\necho "Hook 1"\nexit 0', {
        mode: 0o755,
      });
      fs.writeFileSync(script2Path, '#!/bin/bash\necho "Hook 2"\nexit 0', {
        mode: 0o755,
      });

      const config = loadHooksConfig(sudocodeDir);
      config.hooks = [
        {
          id: "hook1",
          event: "before_execution",
          type: "command",
          command: "hook1.sh",
        },
        {
          id: "hook2",
          event: "before_execution",
          type: "command",
          command: "hook2.sh",
        },
      ];
      saveHooksConfig(sudocodeDir, config);

      const results = await executeHooksForEvent(
        sudocodeDir,
        "before_execution",
        {}
      );

      expect(results.length).toBe(2);
      expect(results.every((r) => r.success)).toBe(true);
    }, 10000);

    it("should stop on required hook failure with block behavior", async () => {
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const script1Path = path.join(hooksDir, "fail.sh");
      const script2Path = path.join(hooksDir, "success.sh");

      fs.writeFileSync(script1Path, "#!/bin/bash\nexit 1", { mode: 0o755 });
      fs.writeFileSync(script2Path, "#!/bin/bash\nexit 0", { mode: 0o755 });

      const config = loadHooksConfig(sudocodeDir);
      config.hooks = [
        {
          id: "fail-hook",
          event: "before_execution",
          type: "command",
          command: "fail.sh",
          required: true,
          on_failure: "block",
        },
        {
          id: "success-hook",
          event: "before_execution",
          type: "command",
          command: "success.sh",
        },
      ];
      saveHooksConfig(sudocodeDir, config);

      await expect(
        executeHooksForEvent(sudocodeDir, "before_execution", {})
      ).rejects.toThrow();
    }, 10000);
  });

  describe("hook CRUD operations", () => {
    it("should add hook", () => {
      const hook: HookConfig = {
        id: "new-hook",
        event: "before_execution",
        type: "command",
        command: "test.sh",
      };

      addHook(sudocodeDir, hook);

      const hooks = listHooks(sudocodeDir);
      expect(hooks.length).toBe(1);
      expect(hooks[0].id).toBe("new-hook");
    });

    it("should not allow duplicate hook IDs", () => {
      const hook: HookConfig = {
        id: "duplicate",
        event: "before_execution",
        type: "command",
        command: "test.sh",
      };

      addHook(sudocodeDir, hook);

      expect(() => addHook(sudocodeDir, hook)).toThrow(
        "Hook with ID duplicate already exists"
      );
    });

    it("should remove hook", () => {
      const hook: HookConfig = {
        id: "to-remove",
        event: "before_execution",
        type: "command",
        command: "test.sh",
      };

      addHook(sudocodeDir, hook);
      expect(listHooks(sudocodeDir).length).toBe(1);

      const removed = removeHook(sudocodeDir, "to-remove");
      expect(removed).toBe(true);
      expect(listHooks(sudocodeDir).length).toBe(0);
    });

    it("should return false when removing non-existent hook", () => {
      const removed = removeHook(sudocodeDir, "nonexistent");
      expect(removed).toBe(false);
    });

    it("should update hook", () => {
      const hook: HookConfig = {
        id: "to-update",
        event: "before_execution",
        type: "command",
        command: "old.sh",
      };

      addHook(sudocodeDir, hook);

      const updated = updateHook(sudocodeDir, "to-update", {
        command: "new.sh",
      });

      expect(updated).toBe(true);

      const hooks = listHooks(sudocodeDir);
      expect(hooks[0].command).toBe("new.sh");
    });

    it("should filter hooks by event", () => {
      addHook(sudocodeDir, {
        id: "before",
        event: "before_execution",
        type: "command",
        command: "test.sh",
      });

      addHook(sudocodeDir, {
        id: "after",
        event: "after_execution",
        type: "command",
        command: "test.sh",
      });

      const beforeHooks = listHooks(sudocodeDir, {
        event: "before_execution",
      });

      expect(beforeHooks.length).toBe(1);
      expect(beforeHooks[0].id).toBe("before");
    });
  });

  describe("validateHook", () => {
    it("should validate valid hook", () => {
      // Create a test script first
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const scriptPath = path.join(hooksDir, "valid.sh");
      fs.writeFileSync(scriptPath, "#!/bin/bash\nexit 0", { mode: 0o755 });

      const hook: HookConfig = {
        id: "valid",
        event: "before_execution",
        type: "command",
        command: "valid.sh",
      };

      const errors = validateHook(sudocodeDir, hook);
      expect(errors.length).toBe(0);
    });

    it("should detect missing required fields", () => {
      const hook: any = {
        id: "incomplete",
      };

      const errors = validateHook(sudocodeDir, hook);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain("Missing required field: event");
      expect(errors).toContain("Missing required field: type");
      expect(errors).toContain("Missing required field: command");
    });

    it("should validate event type", () => {
      const hook: any = {
        id: "invalid-event",
        event: "invalid_event",
        type: "command",
        command: "test.sh",
      };

      const errors = validateHook(sudocodeDir, hook);
      expect(errors.some((e) => e.includes("Invalid event"))).toBe(true);
    });

    it("should detect non-existent command", () => {
      const hook: HookConfig = {
        id: "missing-command",
        event: "before_execution",
        type: "command",
        command: "nonexistent.sh",
      };

      const errors = validateHook(sudocodeDir, hook);
      expect(errors.some((e) => e.includes("Command not found"))).toBe(true);
    });

    it("should detect non-executable command", () => {
      // Create a non-executable file
      const hooksDir = path.join(sudocodeDir, "agents", "hooks");
      const scriptPath = path.join(hooksDir, "not-executable.sh");
      fs.writeFileSync(scriptPath, "#!/bin/bash\nexit 0", { mode: 0o644 });

      const hook: HookConfig = {
        id: "not-executable",
        event: "before_execution",
        type: "command",
        command: "not-executable.sh",
      };

      const errors = validateHook(sudocodeDir, hook);
      expect(
        errors.some((e) => e.includes("Command is not executable"))
      ).toBe(true);
    });
  });
});
