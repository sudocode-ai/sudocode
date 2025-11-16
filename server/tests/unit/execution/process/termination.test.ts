/**
 * Tests for Process Termination
 *
 * Tests terminateProcess, releaseProcess, and shutdown methods
 * with graceful shutdown and SIGKILL fallback.
 */

import { describe, it, afterEach, beforeEach, expect } from "vitest";
import { SimpleProcessManager } from "../../../../src/execution/process/simple-manager.js";
import type { ProcessConfig } from "../../../../src/execution/process/types.js";

describe.sequential("Process Termination", () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  afterEach(async () => {
    // Clean up all processes to prevent resource leaks
    try {
      await manager.shutdown();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("terminateProcess", () => {
    it("terminates a running process with SIGTERM", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ], // Exit immediately on SIGTERM
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);
      const processId = managedProcess.id;

      // Terminate the process
      await manager.terminateProcess(processId);

      // Process should be terminated
      expect(managedProcess.process.killed).toBe(true);
      // Status will be 'crashed' after process exits during grace period
      expect(managedProcess.status).toBe("crashed");
    });

    it("sets status to terminating then crashed", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Capture status before termination starts
      const beforeStatus = managedProcess.status;
      expect(beforeStatus).toBe("busy");

      await manager.terminateProcess(managedProcess.id);

      // After termination completes, process has exited so status is crashed
      expect(managedProcess.status).toBe("crashed");
    });

    it("waits up to 2 seconds for graceful shutdown", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Exit gracefully after receiving SIGTERM
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 50);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const start = Date.now();
      await manager.terminateProcess(managedProcess.id);
      const duration = Date.now() - start;

      // Process should exit faster than the 2-second grace period
      // (includes Node.js startup overhead and signal handling)
      expect(duration < 1800).toBeTruthy(); // Much less than 2 seconds
    });

    it("sends SIGKILL if process does not exit gracefully", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Ignore SIGTERM
          process.on('SIGTERM', () => {});
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.terminateProcess(managedProcess.id);

      // Process should eventually be killed
      expect(managedProcess.process.killed).toBe(true);
    });

    it("accepts custom signal parameter", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGINT", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Use SIGINT instead of SIGTERM
      await manager.terminateProcess(managedProcess.id, "SIGINT");

      expect(managedProcess.process.killed).toBe(true);
    });

    it("is idempotent - safe to call multiple times", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Call terminate multiple times (only first call actually terminates)
      await manager.terminateProcess(managedProcess.id);
      await manager.terminateProcess(managedProcess.id); // Already terminated - returns immediately
      await manager.terminateProcess(managedProcess.id); // Already terminated - returns immediately

      // Should not throw errors
      expect(managedProcess.process.killed).toBe(true);
    });

    it("returns immediately for non-existent process", async () => {
      // Should not throw error
      await manager.terminateProcess("non-existent-id");
    });

    it("returns immediately for already terminated process", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", "process.exit(0)"],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit naturally
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      const start = Date.now();
      await manager.terminateProcess(managedProcess.id);
      const duration = Date.now() - start;

      // Should return immediately without waiting 2 seconds
      expect(duration < 500).toBeTruthy();
    });
  });

  describe("releaseProcess", () => {
    it("terminates the process", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.releaseProcess(managedProcess.id);

      expect(managedProcess.process.killed).toBe(true);
    });

    it("is equivalent to terminateProcess with default signal", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      await manager.releaseProcess(managedProcess.id);

      // After completion, process has exited so status is crashed
      expect(managedProcess.status).toBe("crashed");
      expect(managedProcess.process.killed).toBe(true);
    });

    it("does not throw for non-existent process", async () => {
      // Should not throw error
      await manager.releaseProcess("non-existent-id");
    });
  });

  describe("shutdown", () => {
    it("terminates all active processes", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      // Spawn multiple processes
      const process1 = await manager.acquireProcess(config);
      const process2 = await manager.acquireProcess(config);
      const process3 = await manager.acquireProcess(config);

      // Shutdown all processes
      await manager.shutdown();

      // All processes should be killed
      expect(process1.process.killed).toBe(true);
      expect(process2.process.killed).toBe(true);
      expect(process3.process.killed).toBe(true);
    });

    it("terminates processes in parallel", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Exit gracefully after receiving SIGTERM
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 50);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      // Spawn 3 processes
      await manager.acquireProcess(config);
      await manager.acquireProcess(config);
      await manager.acquireProcess(config);

      const start = Date.now();
      await manager.shutdown();
      const duration = Date.now() - start;

      // If sequential, would take 3 * ~1000ms = 3000ms
      // If parallel, should take ~1000ms (much less than sequential)
      expect(duration < 2000).toBeTruthy(); // Much less than sequential (3000ms)
    });

    it("handles empty process list", async () => {
      // Should not throw error when no processes are running
      await manager.shutdown();
    });

    it("is idempotent - safe to call multiple times", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      await manager.acquireProcess(config);

      // Call shutdown multiple times (first call terminates, rest are no-ops)
      await manager.shutdown();
      await manager.shutdown(); // No processes left - returns immediately
      await manager.shutdown(); // No processes left - returns immediately

      // Should not throw errors
    });

    it("handles mix of running and terminated processes", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)',
        ],
        workDir: process.cwd(),
      };

      const configExit: ProcessConfig = {
        executablePath: "node",
        args: ["-e", "process.exit(0)"],
        workDir: process.cwd(),
      };

      // Spawn running and exiting processes
      const running = await manager.acquireProcess(config);
      const exiting = await manager.acquireProcess(configExit);

      // Wait for exiting process to finish
      await new Promise<void>((resolve) => {
        exiting.process.once("exit", () => setTimeout(resolve, 50));
      });

      // Shutdown should handle both
      await manager.shutdown();

      expect(running.process.killed).toBe(true);
    });
  });

  describe("Termination Timing and Signals", () => {
    it("verifies 2-second grace period before SIGKILL", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Ignore SIGTERM to force SIGKILL
          process.on('SIGTERM', () => {
            // Log but don't exit
          });
          // Keep running
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const start = Date.now();
      await manager.terminateProcess(managedProcess.id);
      const duration = Date.now() - start;

      // Should wait at least close to 2 seconds before SIGKILL
      // The actual duration may vary due to process scheduling and Node.js overhead
      expect(
        duration >= 1000,
        `Duration ${duration}ms should be >= 1000ms`
      ).toBeTruthy();
      expect(
        duration <= 3500,
        `Duration ${duration}ms should be <= 3500ms`
      ).toBeTruthy();
      expect(managedProcess.process.killed).toBe(true);
      // Verify process was killed (not exited gracefully)
      expect(
        managedProcess.signal,
        "Process should have been killed by signal"
      ).toBeTruthy();
    });

    it("captures terminating status during termination", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          process.on('SIGTERM', () => {
            setTimeout(() => process.exit(0), 100);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      expect(managedProcess.status).toBe("busy");

      // Start termination in background
      const terminationPromise = manager.terminateProcess(managedProcess.id);

      // Poll status immediately
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duringTerminationStatus = managedProcess.status as string;

      await terminationPromise;

      // Should have been 'terminating' at some point, or already 'crashed' if fast
      expect(
        duringTerminationStatus === "terminating" ||
          duringTerminationStatus === "crashed",
        `Expected terminating or crashed, got ${duringTerminationStatus}`
      ).toBeTruthy();
    });

    it("shutdown uses SIGTERM signal", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Only respond to SIGTERM, not SIGKILL or others
          process.on('SIGTERM', () => {
            console.log('SIGTERM received');
            process.exit(0);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = "";
      managedProcess.streams.stdout.on("data", (data) => {
        output += data.toString();
      });

      // Wait for process to be ready and listener to be set up
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.shutdown();

      // Wait for shutdown to complete and output to be captured
      await new Promise((resolve) => setTimeout(resolve, 200));

      // If shutdown used SIGTERM, process should have printed message
      expect(output.includes("SIGTERM received")).toBeTruthy();
    });
  });

  describe("Graceful Shutdown Scenarios", () => {
    it("allows process to clean up during grace period", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          let cleaned = false;
          process.on('SIGTERM', () => {
            cleaned = true;
            console.log('cleaned');
            process.exit(0);
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = "";
      manager.onOutput(managedProcess.id, (data) => {
        output += data.toString();
      });

      // Wait for process to be ready and listener to be set up
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.terminateProcess(managedProcess.id);

      // Wait for termination to complete and output to be captured
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Process should have had time to clean up
      expect(output.includes("cleaned")).toBeTruthy();
    });

    it("force kills process that ignores SIGTERM", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          // Ignore SIGTERM completely
          process.on('SIGTERM', () => {
            console.log('ignored');
            // Don't exit
          });
          setInterval(() => {}, 1000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = "";
      managedProcess.streams.stdout.on("data", (data) => {
        output += data.toString();
      });

      // Wait for process to be ready and listener to be set up
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.terminateProcess(managedProcess.id);

      // Wait for force kill to complete and output to be captured
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Process should be killed despite ignoring SIGTERM
      expect(managedProcess.process.killed).toBe(true);
      expect(output.includes("ignored")).toBeTruthy();
    });
  });
});
