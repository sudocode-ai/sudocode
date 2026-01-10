/**
 * Unit tests for TerminalHandler
 *
 * Tests the terminal handler's command parsing and execution logic,
 * ensuring proper shell invocation for various command scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TerminalHandler } from "../../../../src/execution/handlers/terminal-handler.js";
import type { CreateTerminalRequest } from "acp-factory";
import { spawn } from "child_process";

// Mock child_process spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("TerminalHandler", () => {
  let handler: TerminalHandler;
  const workDir = "/test/work/dir";

  // Mock process object
  const createMockProcess = () => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === "data") {
            // Simulate output
            setTimeout(() => handler(Buffer.from("test output")), 0);
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, handler) => {
        if (event === "exit") {
          // Simulate successful exit
          setTimeout(() => handler(0), 0);
        }
      }),
      kill: vi.fn(),
    };
    return mockProcess;
  };

  beforeEach(() => {
    handler = new TerminalHandler(workDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    handler.cleanup();
  });

  describe("onCreate - command parsing", () => {
    it("should use shell to execute basic commands", async () => {
      const params: CreateTerminalRequest = {
        command: "echo hello world",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      // Verify spawn was called with shell
      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "echo hello world"],
        expect.objectContaining({
          cwd: workDir,
          shell: false,
        })
      );
    });

    it("should handle commands with additional args", async () => {
      const params: CreateTerminalRequest = {
        command: "git",
        args: ["status", "--short"],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      // Verify args are joined with command
      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "git status --short"],
        expect.objectContaining({
          cwd: workDir,
        })
      );
    });

    it("should handle commands with pipes", async () => {
      const params: CreateTerminalRequest = {
        command: "ls -la | head -5",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      // Shell should receive the full pipe expression
      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "ls -la | head -5"],
        expect.any(Object)
      );
    });

    it("should handle commands with shell features (&&, ||, redirects)", async () => {
      const params: CreateTerminalRequest = {
        command: "test -f file.txt && echo 'Found' || echo 'Not found'",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "test -f file.txt && echo 'Found' || echo 'Not found'"],
        expect.any(Object)
      );
    });

    it("should handle commands with environment variables", async () => {
      const params: CreateTerminalRequest = {
        command: "echo $PATH",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "echo $PATH"],
        expect.any(Object)
      );
    });

    it("should handle commands with command substitution", async () => {
      const params: CreateTerminalRequest = {
        command: "echo Hello from $(whoami)",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "echo Hello from $(whoami)"],
        expect.any(Object)
      );
    });

    it("should handle commands with quotes", async () => {
      const params: CreateTerminalRequest = {
        command: "echo \"Test with 'quotes' and \\\"double quotes\\\"\"",
        args: [],
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "echo \"Test with 'quotes' and \\\"double quotes\\\"\""],
        expect.any(Object)
      );
    });

    it("should spawn interactive shell when no command provided", async () => {
      const params: CreateTerminalRequest = {
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      // Should spawn shell with no args
      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        [],
        expect.objectContaining({
          cwd: workDir,
        })
      );
    });

    it("should use custom cwd if provided", async () => {
      const customCwd = "/custom/path";
      const params: CreateTerminalRequest = {
        command: "pwd",
        cwd: customCwd,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "pwd"],
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });

    it("should default to workDir if no cwd provided", async () => {
      const params: CreateTerminalRequest = {
        command: "pwd",
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "pwd"],
        expect.objectContaining({
          cwd: workDir,
        })
      );
    });

    it("should merge environment variables", async () => {
      const params: CreateTerminalRequest = {
        command: "echo $CUSTOM_VAR",
        env: {
          CUSTOM_VAR: "test_value",
          ANOTHER_VAR: "another_value",
        },
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const spawnEnv = spawnCall[2].env;

      expect(spawnEnv).toHaveProperty("CUSTOM_VAR", "test_value");
      expect(spawnEnv).toHaveProperty("ANOTHER_VAR", "another_value");
      // Should also include process.env
      expect(spawnEnv).toHaveProperty("PATH");
    });

    it("should filter out non-string environment values", async () => {
      const params: CreateTerminalRequest = {
        command: "echo test",
        env: {
          STRING_VAR: "valid",
          // @ts-expect-error - Testing runtime filtering
          NUMBER_VAR: 123,
          // @ts-expect-error - Testing runtime filtering
          OBJECT_VAR: { key: "value" },
        },
        cwd: workDir,
      };

      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate(params);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const spawnEnv = spawnCall[2].env;

      expect(spawnEnv).toHaveProperty("STRING_VAR", "valid");
      expect(spawnEnv).not.toHaveProperty("NUMBER_VAR");
      expect(spawnEnv).not.toHaveProperty("OBJECT_VAR");
    });

    it("should return unique terminal ID", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const result1 = await handler.onCreate({ command: "echo 1", cwd: workDir });
      const result2 = await handler.onCreate({ command: "echo 2", cwd: workDir });

      expect(result1.terminalId).toBeDefined();
      expect(result2.terminalId).toBeDefined();
      expect(result1.terminalId).not.toBe(result2.terminalId);
    });
  });

  describe("onOutput", () => {
    it("should return buffered output", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      // Wait for output to be buffered
      await new Promise((resolve) => setTimeout(resolve, 10));

      const output = await handler.onOutput(terminalId);
      expect(output).toBe("test output");
    });

    it("should drain buffer after reading", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const output1 = await handler.onOutput(terminalId);
      expect(output1).toBe("test output");

      // Second read should be empty
      const output2 = await handler.onOutput(terminalId);
      expect(output2).toBe("");
    });

    it("should return empty string for non-existent terminal", async () => {
      const output = await handler.onOutput("non-existent");
      expect(output).toBe("");
    });
  });

  describe("onKill", () => {
    it("should kill the terminal process", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "sleep 100",
        cwd: workDir,
      });

      await handler.onKill(terminalId);

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should remove terminal from tracking", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      await handler.onKill(terminalId);

      // Subsequent calls should not fail
      const output = await handler.onOutput(terminalId);
      expect(output).toBe("");
    });

    it("should not throw for non-existent terminal", async () => {
      await expect(handler.onKill("non-existent")).resolves.not.toThrow();
    });
  });

  describe("onRelease", () => {
    it("should remove terminal from tracking without killing", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      await handler.onRelease(terminalId);

      expect(mockProcess.kill).not.toHaveBeenCalled();

      // Terminal should be removed from tracking
      const output = await handler.onOutput(terminalId);
      expect(output).toBe("");
    });
  });

  describe("onWaitForExit", () => {
    it("should return exit code when process exits", async () => {
      const mockProcess = {
        ...createMockProcess(),
        on: vi.fn((event, handler) => {
          if (event === "exit") {
            setTimeout(() => handler(0), 10);
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      const exitCode = await handler.onWaitForExit(terminalId);
      expect(exitCode).toBe(0);
    });

    it("should return exit code immediately if already exited", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      // Wait for exit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const exitCode = await handler.onWaitForExit(terminalId);
      expect(exitCode).toBe(0);
    });

    it("should return 1 for non-existent terminal", async () => {
      const exitCode = await handler.onWaitForExit("non-existent");
      expect(exitCode).toBe(1);
    });
  });

  describe("cleanup", () => {
    it("should kill all tracked terminals", async () => {
      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();

      vi.mocked(spawn)
        .mockReturnValueOnce(mockProcess1 as any)
        .mockReturnValueOnce(mockProcess2 as any);

      await handler.onCreate({ command: "sleep 100", cwd: workDir });
      await handler.onCreate({ command: "sleep 200", cwd: workDir });

      handler.cleanup();

      expect(mockProcess1.kill).toHaveBeenCalledWith("SIGTERM");
      expect(mockProcess2.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should clear all terminals from tracking", async () => {
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const { terminalId } = await handler.onCreate({
        command: "echo test",
        cwd: workDir,
      });

      handler.cleanup();

      const output = await handler.onOutput(terminalId);
      expect(output).toBe("");
    });
  });

  describe("platform-specific behavior", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      // Restore original platform
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
      });
    });

    it("should use cmd.exe on Windows", async () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });

      const handler = new TerminalHandler(workDir);
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate({
        command: "echo hello",
        cwd: workDir,
      });

      expect(spawn).toHaveBeenCalledWith(
        "cmd.exe",
        ["/c", "echo hello"],
        expect.any(Object)
      );

      handler.cleanup();
    });

    it("should use /bin/sh on Unix", async () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
      });

      const handler = new TerminalHandler(workDir);
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await handler.onCreate({
        command: "echo hello",
        cwd: workDir,
      });

      expect(spawn).toHaveBeenCalledWith(
        "/bin/sh",
        ["-c", "echo hello"],
        expect.any(Object)
      );

      handler.cleanup();
    });
  });
});
