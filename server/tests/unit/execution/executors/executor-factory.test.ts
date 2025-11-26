/**
 * Unit tests for Executor Factory
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createExecutorForAgent,
  validateAgentConfig,
  AgentConfigValidationError,
} from "../../../../src/execution/executors/executor-factory.js";
import {
  AgentNotFoundError,
  AgentNotImplementedError,
} from "../../../../src/services/agent-registry.js";
import { AgentExecutorWrapper } from "../../../../src/execution/executors/agent-executor-wrapper.js";
import type { AgentType } from "@sudocode-ai/types/agents";
import type { ExecutorFactoryConfig } from "../../../../src/execution/executors/executor-factory.js";

// Mock dependencies
const mockDb = {} as any;
const mockLifecycleService = {} as any;
const mockLogsStore = {} as any;
const mockTransportManager = {} as any;

const factoryConfig: ExecutorFactoryConfig = {
  workDir: "/tmp/test",
  lifecycleService: mockLifecycleService,
  logsStore: mockLogsStore,
  projectId: "test-project",
  db: mockDb,
  transportManager: mockTransportManager,
};

describe("ExecutorFactory", () => {
  describe("createExecutorForAgent", () => {
    it("should create AgentExecutorWrapper for claude-code agent", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
    });

    it("should create AgentExecutorWrapper for codex agent", () => {
      const executor = createExecutorForAgent(
        "codex",
        { workDir: "/tmp/test" },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
    });

    it("should throw AgentNotFoundError for unknown agent type", () => {
      expect(() => {
        createExecutorForAgent(
          "unknown-agent" as AgentType,
          { workDir: "/tmp/test" },
          factoryConfig
        );
      }).toThrow(AgentNotFoundError);
    });

    it("should create AgentExecutorWrapper for copilot", () => {
      const wrapper = createExecutorForAgent(
        "copilot",
        { workDir: "/tmp/test", allowAllTools: true },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("AgentExecutorWrapper");
    });

    it("should create AgentExecutorWrapper for cursor", () => {
      const wrapper = createExecutorForAgent(
        "cursor",
        { workDir: "/tmp/test", force: true },
        factoryConfig
      );

      expect(wrapper).toBeDefined();
      expect(wrapper.constructor.name).toBe("AgentExecutorWrapper");
    });

    it("should validate config before creating executor", () => {
      // Invalid config: missing workDir
      expect(() => {
        createExecutorForAgent(
          "claude-code",
          { workDir: "" }, // Empty workDir is invalid
          factoryConfig
        );
      }).toThrow(AgentConfigValidationError);
    });

    it("should throw AgentConfigValidationError with validation errors", () => {
      try {
        createExecutorForAgent(
          "claude-code",
          {
            workDir: "",
            print: false,
            outputFormat: "stream-json", // Invalid: stream-json requires print mode
          },
          factoryConfig
        );
        expect.fail("Should have thrown AgentConfigValidationError");
      } catch (error) {
        expect(error).toBeInstanceOf(AgentConfigValidationError);
        const validationError = error as AgentConfigValidationError;
        expect(validationError.agentType).toBe("claude-code");
        expect(validationError.validationErrors.length).toBeGreaterThan(0);
      }
    });

    it("should create executor with valid config", () => {
      const executor = createExecutorForAgent(
        "claude-code",
        {
          workDir: "/tmp/test",
          print: true,
          outputFormat: "stream-json",
        },
        factoryConfig
      );

      // All agents now use unified AgentExecutorWrapper
      expect(executor).toBeInstanceOf(AgentExecutorWrapper);
    });
  });

  describe("validateAgentConfig", () => {
    it("should return empty array for valid config", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "/tmp/test",
        print: true,
        outputFormat: "stream-json",
      });

      expect(errors).toEqual([]);
    });

    it("should return validation errors for invalid config", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "", // Invalid: empty workDir
        print: false,
        outputFormat: "stream-json", // Invalid: requires print mode
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain("workDir is required");
      expect(errors).toContain(
        "stream-json output format requires print mode to be enabled"
      );
    });

    it("should throw AgentNotFoundError for unknown agent", () => {
      expect(() => {
        validateAgentConfig("unknown-agent" as AgentType, {
          workDir: "/tmp/test",
        });
      }).toThrow(AgentNotFoundError);
    });

    it("should validate workDir is required", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "",
      });

      expect(errors).toContain("workDir is required");
    });

    it("should validate stream-json requires print mode", () => {
      const errors = validateAgentConfig("claude-code", {
        workDir: "/tmp/test",
        print: false,
        outputFormat: "stream-json",
      });

      expect(errors).toContain(
        "stream-json output format requires print mode to be enabled"
      );
    });
  });

  describe("AgentConfigValidationError", () => {
    it("should create error with agent type and validation errors", () => {
      const error = new AgentConfigValidationError("claude-code", [
        "workDir is required",
        "invalid config",
      ]);

      expect(error.name).toBe("AgentConfigValidationError");
      expect(error.agentType).toBe("claude-code");
      expect(error.validationErrors).toEqual([
        "workDir is required",
        "invalid config",
      ]);
      expect(error.message).toContain("claude-code");
      expect(error.message).toContain("workDir is required");
      expect(error.message).toContain("invalid config");
    });
  });
});
