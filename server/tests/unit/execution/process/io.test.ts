/**
 * Tests for Process I/O Communication
 *
 * Tests sendInput, onOutput, and onError methods for process communication.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { SimpleProcessManager } from "../../../../src/execution/process/simple-manager.js";
import type { ProcessConfig } from "../../../../src/execution/process/types.js";

describe.sequential("Process I/O Communication", () => {
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

  describe.sequential("sendInput", () => {
    it("sends input to process stdin", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          process.stdin.on('data', (data) => {
            console.log('Received: ' + data.toString().trim());
            process.exit(0);
          });
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Set up output handler to capture response
      let output = "";
      managedProcess.streams.stdout.on("data", (data) => {
        output += data.toString();
      });

      // Send input to the process
      await manager.sendInput(managedProcess.id, "test input\n");

      // Wait for process to respond and exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      expect(output.includes("Received: test input")).toBeTruthy();
    });

    it("throws error for non-existent process", async () => {
      await expect(
        manager.sendInput("non-existent-id", "test")
      ).rejects.toThrow(/Process non-existent-id not found/);
    });

    it("handles write errors gracefully", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", "process.exit(0)"],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      // Try to write to closed stdin
      await expect(
        manager.sendInput(managedProcess.id, "test")
      ).rejects.toThrow();
    });

    it("supports multiple sendInput calls", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          let count = 0;
          process.stdin.on('data', (data) => {
            count++;
            console.log('Message ' + count + ': ' + data.toString().trim());
            if (count === 3) process.exit(0);
          });
          // Timeout safety
          setTimeout(() => process.exit(1), 5000);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = "";
      manager.onOutput(managedProcess.id, (data) => {
        output += data.toString();
      });

      // Wait for stdin to be ready before sending input
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send multiple inputs with small delays
      await manager.sendInput(managedProcess.id, "first\n");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await manager.sendInput(managedProcess.id, "second\n");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await manager.sendInput(managedProcess.id, "third\n");

      // Wait for process to exit with timeout
      await Promise.race([
        new Promise<void>((resolve) => {
          managedProcess.process.once("exit", () => {
            setTimeout(resolve, 100);
          });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 6000)), // Safety timeout
      ]);

      expect(output.includes("Message 1: first")).toBeTruthy();
      expect(output.includes("Message 2: second")).toBeTruthy();
      expect(output.includes("Message 3: third")).toBeTruthy();
    });
  });

  describe.sequential("onOutput", () => {
    it("captures stdout output", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", 'console.log("test stdout"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const outputs: Array<{ data: string; type: "stdout" | "stderr" }> = [];

      const managedProcess = await manager.acquireProcess(config);

      // Register output handler immediately after acquiring process to avoid race condition
      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output (increased timeout to reduce flakiness)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(outputs.length > 0).toBeTruthy();
      expect(
        outputs.some(
          (o) => o.type === "stdout" && o.data.includes("test stdout")
        )
      ).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("captures stderr output", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'console.error("test stderr"); setTimeout(() => {}, 100);',
        ],
        workDir: process.cwd(),
      };

      const outputs: Array<{ data: string; type: "stdout" | "stderr" }> = [];

      const managedProcess = await manager.acquireProcess(config);

      // Register output handler immediately after acquiring process to avoid race condition
      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output (increased timeout to reduce flakiness)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(outputs.length > 0).toBeTruthy();
      expect(
        outputs.some(
          (o) => o.type === "stderr" && o.data.includes("test stderr")
        )
      ).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("captures both stdout and stderr", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'console.log("stdout msg"); console.error("stderr msg"); setTimeout(() => {}, 200);',
        ],
        workDir: process.cwd(),
      };

      const outputs: Array<{ data: string; type: "stdout" | "stderr" }> = [];

      const managedProcess = await manager.acquireProcess(config);

      // Register output handler immediately after acquiring process to avoid race condition
      manager.onOutput(managedProcess.id, (data, type) => {
        outputs.push({ data: data.toString(), type });
      });

      // Wait for output with longer timeout for reliability under parallel test load
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        outputs.some(
          (o) => o.type === "stdout" && o.data.includes("stdout msg")
        ),
        `Expected stdout in outputs: ${JSON.stringify(outputs)}`
      ).toBeTruthy();
      expect(
        outputs.some(
          (o) => o.type === "stderr" && o.data.includes("stderr msg")
        ),
        `Expected stderr in outputs: ${JSON.stringify(outputs)}`
      ).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("throws error for non-existent process", () => {
      expect(() => manager.onOutput("non-existent-id", () => {})).toThrow(
        /Process non-existent-id not found/
      );
    });

    it("supports multiple output handlers", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", 'console.log("test"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let handler1Called = false;
      let handler2Called = false;

      manager.onOutput(managedProcess.id, () => {
        handler1Called = true;
      });

      manager.onOutput(managedProcess.id, () => {
        handler2Called = true;
      });

      // Wait for output (increased timeout to reduce flakiness)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);

      // Cleanup
      managedProcess.process.kill();
    });

    it("handles streaming output in real-time", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          for (let i = 1; i <= 3; i++) {
            console.log('Line ' + i);
          }
          setTimeout(() => {}, 100);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const lines: string[] = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === "stdout") {
          // Split by newlines to handle buffered chunks correctly
          const output = data.toString();
          const newLines = output.split("\n").filter((line) => line.trim());
          lines.push(...newLines);
        }
      });

      // Wait for all output
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(lines.length).toBe(3);
      expect(lines.includes("Line 1")).toBeTruthy();
      expect(lines.includes("Line 2")).toBeTruthy();
      expect(lines.includes("Line 3")).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });
  });

  describe.sequential("onError", () => {
    it("captures process errors", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", 'throw new Error("test error")'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Note: The 'error' event is emitted for spawn failures, not runtime errors
      // Runtime errors cause non-zero exit codes instead
      manager.onError(managedProcess.id, () => {
        // Error handler registered
      });

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      // Runtime errors don't trigger error event, they cause non-zero exit
      expect(managedProcess.exitCode !== 0).toBe(true);
    });

    it("throws error for non-existent process", () => {
      expect(() => manager.onError("non-existent-id", () => {})).toThrow(
        /Process non-existent-id not found/
      );
    });

    it("supports multiple error handlers", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", "setTimeout(() => {}, 100);"],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let handler1Registered = false;
      let handler2Registered = false;

      manager.onError(managedProcess.id, () => {
        handler1Registered = true;
      });

      manager.onError(managedProcess.id, () => {
        handler2Registered = true;
      });

      // Both handlers should be registered (we can't easily trigger them,
      // but we verify they don't throw)
      expect(handler1Registered).toBe(false); // Not triggered yet
      expect(handler2Registered).toBe(false); // Not triggered yet

      // Cleanup
      managedProcess.process.kill();
    });
  });

  describe.sequential("I/O Edge Cases", () => {
    it("handles empty sendInput", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", 'process.stdin.on("data", () => process.exit(0));'],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      // Send empty string
      await manager.sendInput(managedProcess.id, "");

      // Should not crash
      expect(managedProcess).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("handles large data chunks in onOutput", async () => {
      const largeString = "A".repeat(10000);
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `console.log('${largeString}'); setTimeout(() => {}, 100);`,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let receivedData = "";
      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === "stdout") {
          receivedData += data.toString();
        }
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(receivedData.includes(largeString)).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("handles rapid successive sendInput calls", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          const chunks = [];
          process.stdin.on('data', (data) => {
            chunks.push(data.toString());
          });
          setTimeout(() => {
            const allData = chunks.join('');
            const lines = allData.split('\\n').filter(l => l.length > 0);
            console.log('Lines received: ' + lines.length);
            process.exit(0);
          }, 300);
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      let output = "";
      managedProcess.streams.stdout.on("data", (data) => {
        output += data.toString();
      });

      // Send 10 inputs rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(manager.sendInput(managedProcess.id, `input${i}\n`));
      }
      await Promise.all(promises);

      // Wait for process to complete
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      // Should have received all 10 inputs
      expect(output.includes("Lines received: 10")).toBeTruthy();
    });

    it("onOutput handles data immediately after spawn", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: ["-e", 'console.log("immediate"); setTimeout(() => {}, 100);'],
        workDir: process.cwd(),
      };

      let capturedOutput = false;
      const managedProcess = await manager.acquireProcess(config);

      // Register handler immediately after spawn
      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === "stdout" && data.toString().includes("immediate")) {
          capturedOutput = true;
        }
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(capturedOutput).toBe(true);

      // Cleanup
      managedProcess.process.kill();
    });

    it("sendInput promise resolves after write completes", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          'process.stdin.on("data", () => {}); setTimeout(() => {}, 200);',
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const startTime = Date.now();
      await manager.sendInput(managedProcess.id, "test data\n");
      const duration = Date.now() - startTime;

      // Should resolve quickly (not wait for process to read)
      expect(
        duration < 100,
        `sendInput took ${duration}ms, expected < 100ms`
      ).toBeTruthy();

      // Cleanup
      managedProcess.process.kill();
    });

    it("handles binary data in I/O operations", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          process.stdin.on('data', (data) => {
            process.stdout.write(data);
            process.exit(0);
          });
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xff]);
      let receivedData: Buffer[] = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === "stdout") {
          receivedData.push(data);
        }
      });

      await manager.sendInput(managedProcess.id, binaryData.toString("binary"));

      // Wait for echo
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      expect(receivedData.length > 0).toBeTruthy();
      const totalLength = receivedData.reduce(
        (sum, buf) => sum + buf.length,
        0
      );
      expect(totalLength > 0).toBeTruthy();
    });
  });

  describe.sequential("Combined I/O Operations", () => {
    it("supports bidirectional communication", async () => {
      const config: ProcessConfig = {
        executablePath: "node",
        args: [
          "-e",
          `
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });

          rl.on('line', (line) => {
            console.log('Echo: ' + line);
            if (line === 'exit') process.exit(0);
          });
        `,
        ],
        workDir: process.cwd(),
      };

      const managedProcess = await manager.acquireProcess(config);

      const outputs: string[] = [];

      manager.onOutput(managedProcess.id, (data, type) => {
        if (type === "stdout") {
          const line = data.toString().trim();
          if (line && !line.includes("undefined")) {
            outputs.push(line);
          }
        }
      });

      // Send inputs and wait for responses
      await manager.sendInput(managedProcess.id, "hello\n");
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.sendInput(managedProcess.id, "world\n");
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.sendInput(managedProcess.id, "exit\n");

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        managedProcess.process.once("exit", () => {
          setTimeout(resolve, 50);
        });
      });

      expect(outputs.some((o) => o.includes("Echo: hello"))).toBeTruthy();
      expect(outputs.some((o) => o.includes("Echo: world"))).toBeTruthy();
    });
  });
});
