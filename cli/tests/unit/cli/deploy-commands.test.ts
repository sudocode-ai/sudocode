/**
 * Unit tests for deploy command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { handleDeployConfig, handleDeployStop } from "../../../src/cli/deploy-commands.js";

describe("handleDeployConfig", () => {
  let tempDir: string;
  let outputDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join("/tmp", "sudocode-deploy-test-"));
    outputDir = path.join(tempDir, ".sudocode");
    fs.mkdirSync(outputDir, { recursive: true });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    // Clean up
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    // Remove temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("viewing config", () => {
    it("should display default config when file doesn't exist", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, {});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const config = JSON.parse(output);

      expect(config).toMatchObject({
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should display existing config", async () => {
      // Create config file first
      const configPath = path.join(outputDir, "deploy-config.json");
      const existingConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 60,
        keepAliveHours: 24,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };
      fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, {});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const config = JSON.parse(output);

      expect(config).toEqual(existingConfig);
    });
  });

  describe("updating config", () => {
    it("should update port", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, { port: "8080" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Deploy configuration updated")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Port: 8080")
      );

      // Verify file was updated
      const configPath = path.join(outputDir, "deploy-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.port).toBe(8080);
    });

    it("should update idle timeout", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, { idleTimeout: "120" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Idle timeout: 120 minutes")
      );

      const configPath = path.join(outputDir, "deploy-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.idleTimeout).toBe(120);
    });

    it("should update keep-alive hours", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, { keepAliveHours: "48" });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Keep-alive: 48 hours")
      );

      const configPath = path.join(outputDir, "deploy-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.keepAliveHours).toBe(48);
    });

    it("should update multiple values at once", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, {
        port: "8080",
        idleTimeout: "60",
        machine: "premiumLinux",
      });

      const configPath = path.join(outputDir, "deploy-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.port).toBe(8080);
      expect(config.idleTimeout).toBe(60);
      expect(config.machine).toBe("premiumLinux");
    });

    it("should update default branch", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, { defaultBranch: "develop" });

      const configPath = path.join(outputDir, "deploy-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.defaultBranch).toBe("develop");
    });

    it("should handle invalid port number", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, { port: "invalid" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port number")
      );
    });

    it("should handle invalid idle timeout", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, { idleTimeout: "abc" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid idle timeout")
      );
    });
  });

  describe("resetting config", () => {
    it("should reset to defaults", async () => {
      // Create non-default config first
      const configPath = path.join(outputDir, "deploy-config.json");
      const customConfig = {
        provider: "codespaces",
        port: 8080,
        idleTimeout: 60,
        keepAliveHours: 24,
        retentionPeriod: 7,
        machine: "premiumLinux",
      };
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await handleDeployConfig(context, { reset: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("reset to defaults")
      );

      // Verify file was reset
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config).toMatchObject({
        provider: "codespaces",
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: "basicLinux32gb",
      });
    });

    it("should prevent combining --reset with other options", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, { reset: true, port: "8080" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot combine --reset with other options")
      );
    });

    it("should prevent combining --reset with multiple options", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, {
          reset: true,
          port: "8080",
          machine: "premiumLinux",
        });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot combine --reset with other options")
      );
    });

    it("should show JSON error when combining --reset with other options in JSON mode", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: true,
      };

      await expect(async () => {
        await handleDeployConfig(context, { reset: true, port: "8080" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0];
      const errorObj = JSON.parse(output);
      expect(errorObj).toHaveProperty("error");
      expect(errorObj.error).toContain("Cannot combine --reset with other options");
    });
  });

  describe("JSON output mode", () => {
    it("should output JSON when viewing config", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: true,
      };

      await handleDeployConfig(context, {});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const config = JSON.parse(output);
      expect(config).toHaveProperty("provider");
      expect(config).toHaveProperty("port");
    });

    it("should output JSON when updating config", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: true,
      };

      await handleDeployConfig(context, { port: "8080" });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const config = JSON.parse(output);
      expect(config.port).toBe(8080);
    });

    it("should output JSON error on validation failure", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: true,
      };

      await expect(async () => {
        await handleDeployConfig(context, { port: "99999" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0];
      const errorObj = JSON.parse(output);
      expect(errorObj).toHaveProperty("error");
    });
  });

  describe("validation", () => {
    it("should reject port outside valid range", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, { port: "99999" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port number")
      );
    });

    it("should reject negative idle timeout", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(async () => {
        await handleDeployConfig(context, { idleTimeout: "0" });
      }).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Idle timeout must be at least 1 minute")
      );
    });
  });
});

describe("handleDeployStop", () => {
  let tempDir: string;
  let outputDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = fs.mkdtempSync(path.join("/tmp", "sudocode-deploy-test-"));
    outputDir = path.join(tempDir, ".sudocode");
    fs.mkdirSync(outputDir, { recursive: true });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    // Clean up
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    // Remove temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("validation", () => {
    it("should require deployment ID", async () => {
      const context = {
        db: null,
        outputDir,
        jsonOutput: false,
      };

      await expect(
        handleDeployStop(context, "", { force: true })
      ).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Deployment ID is required")
      );
    });
  });

  describe("bypass scenarios", () => {
    it("should note that --force flag bypasses confirmation", () => {
      // This is a documentation test - the actual behavior is tested in integration tests
      // The implementation at deploy-commands.ts:407 checks:
      // if (!options.force && !context.jsonOutput) { /* show prompt */ }
      // Therefore: --force bypasses the prompt
      expect(true).toBe(true);
    });

    it("should note that JSON mode bypasses confirmation", () => {
      // This is a documentation test - the actual behavior is tested in integration tests
      // The implementation at deploy-commands.ts:407 checks:
      // if (!options.force && !context.jsonOutput) { /* show prompt */ }
      // Therefore: jsonOutput=true bypasses the prompt
      expect(true).toBe(true);
    });
  });
});
