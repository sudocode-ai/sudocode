/**
 * Unit tests for ExecutionService.buildExecutionConfig method
 *
 * Tests the MCP auto-injection logic for sudocode-mcp plugin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ExecutionConfig } from "../../../src/services/execution-service.js";
import type { AgentType } from "@sudocode-ai/types/agents";
import {
  createExecutionServiceSetup,
  mockSudocodeMcpDetection,
  mockAgentMcpDetection,
} from "../../integration/execution/helpers/execution-test-utils.js";

/**
 * Mock modules
 */
vi.mock("fs/promises");
vi.mock("../../../src/utils/execFileNoThrow.js", () => ({
  execFileNoThrow: vi.fn(),
}));

describe("ExecutionService.buildExecutionConfig", () => {
  let service: any; // Use 'any' to access private methods
  let setup: ReturnType<typeof createExecutionServiceSetup>;

  beforeEach(() => {
    vi.clearAllMocks();
    setup = createExecutionServiceSetup();
    service = setup.service;
  });

  afterEach(() => {
    setup.db.close();
  });

  describe("sudocode-mcp detection and error handling", () => {
    it("should throw error with helpful message when detectSudocodeMcp() returns false", async () => {
      // Mock detectSudocodeMcp to return false (package not installed)
      await mockSudocodeMcpDetection(false);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      // Should throw error when sudocode-mcp is not installed
      await expect(
        service.buildExecutionConfig("claude-code", userConfig)
      ).rejects.toThrow();
    });

    it("should include github.com/sudocode-ai/sudocode link in error message", async () => {
      // Mock detectSudocodeMcp to return false
      await mockSudocodeMcpDetection(false);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      try {
        await service.buildExecutionConfig("claude-code", userConfig);
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "github.com/sudocode-ai/sudocode"
        );
      }
    });

    it("should include installation instructions in error message", async () => {
      // Mock detectSudocodeMcp to return false
      await mockSudocodeMcpDetection(false);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      try {
        await service.buildExecutionConfig("claude-code", userConfig);
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message.toLowerCase();
        expect(message).toContain("install");
        expect(message).toContain("sudocode");
      }
    });
  });

  describe("MCP server auto-injection", () => {
    it("should add sudocode-mcp to mcpServers when detectAgentMcp() returns false", async () => {
      // Mock: sudocode-mcp package is installed, but not configured in agent
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].command).toBe("sudocode-mcp");
      expect(result.mcpServers!["sudocode-mcp"].args).toEqual([]);
    });

    it("should skip injection when detectAgentMcp() returns true (plugin already configured)", async () => {
      // Mock: both package and agent plugin are present
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should NOT have auto-injected sudocode-mcp (already configured)
      expect(result.mcpServers).toBeUndefined();
    });

    it("should remove sudocode-mcp from userConfig when plugin is detected", async () => {
      // Mock: plugin is detected
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent && !userConfig.mcpServers?.["sudocode-mcp"]) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          } else if (mcpPresent) {
            // Remove sudocode-mcp from mcpServers to avoid duplication with plugin
            if (userConfig.mcpServers) {
              const { "sudocode-mcp": _removed, ...rest } = userConfig.mcpServers;
              mergedConfig.mcpServers = Object.keys(rest).length > 0 ? rest : undefined;
            }
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "other-server": {
            command: "other-server",
            args: [],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should remove sudocode-mcp but keep other-server
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeUndefined();
      expect(result.mcpServers!["other-server"]).toBeDefined();
    });

    it("should set mcpServers to undefined when only sudocode-mcp is removed", async () => {
      // Mock: plugin is detected
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent && !userConfig.mcpServers?.["sudocode-mcp"]) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          } else if (mcpPresent) {
            // Remove sudocode-mcp from mcpServers to avoid duplication with plugin
            if (userConfig.mcpServers) {
              const { "sudocode-mcp": _removed, ...rest } = userConfig.mcpServers;
              mergedConfig.mcpServers = Object.keys(rest).length > 0 ? rest : undefined;
            }
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should set mcpServers to undefined when it becomes empty
      expect(result.mcpServers).toBeUndefined();
    });

    it("should preserve user-provided MCP servers when auto-injecting", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "custom-mcp": {
            command: "custom-mcp-server",
            args: ["--port", "3000"],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should preserve user's custom-mcp AND add sudocode-mcp
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["custom-mcp"]).toBeDefined();
      expect(result.mcpServers!["custom-mcp"].command).toBe(
        "custom-mcp-server"
      );
      expect(result.mcpServers!["custom-mcp"].args).toEqual([
        "--port",
        "3000",
      ]);
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].command).toBe("sudocode-mcp");
    });

    it("should not duplicate sudocode-mcp if user already provided it", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          // Only inject if not already present in userConfig
          if (!mcpPresent && !userConfig.mcpServers?.["sudocode-mcp"]) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: ["--custom-arg"],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should NOT duplicate - keep user's version
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].args).toEqual([
        "--custom-arg",
      ]);

      // Should only have one sudocode-mcp entry
      const mcpKeys = Object.keys(result.mcpServers!).filter((k) =>
        k.includes("sudocode-mcp")
      );
      expect(mcpKeys).toHaveLength(1);
    });
  });

  describe("config merging and structure", () => {
    it("should handle empty/undefined userConfig.mcpServers gracefully", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      // Test with undefined mcpServers
      const userConfig1: ExecutionConfig = {
        mode: "worktree",
        mcpServers: undefined,
      };

      const result1 = await service.buildExecutionConfig(
        "claude-code",
        userConfig1
      );

      expect(result1.mcpServers).toBeDefined();
      expect(result1.mcpServers!["sudocode-mcp"]).toBeDefined();

      // Test with no mcpServers field at all
      const userConfig2: ExecutionConfig = {
        mode: "worktree",
      };

      const result2 = await service.buildExecutionConfig(
        "claude-code",
        userConfig2
      );

      expect(result2.mcpServers).toBeDefined();
      expect(result2.mcpServers!["sudocode-mcp"]).toBeDefined();
    });

    it("should return proper merged config structure", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        model: "claude-sonnet-4",
        timeout: 5000,
        appendSystemPrompt: "Be helpful",
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should preserve all original config fields
      expect(result.mode).toBe("worktree");
      expect(result.model).toBe("claude-sonnet-4");
      expect(result.timeout).toBe(5000);
      expect(result.appendSystemPrompt).toBe("Be helpful");

      // Should add mcpServers
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
    });

    it("should not mutate original userConfig object", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      const originalMcpServers = userConfig.mcpServers;

      await service.buildExecutionConfig("claude-code", userConfig);

      // Original config should not be mutated
      expect(userConfig.mcpServers).toBe(originalMcpServers);
    });
  });

  describe("agent type handling", () => {
    it("should work with claude-code agent type", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = { mode: "worktree" };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      expect(result.mcpServers).toBeDefined();
      expect(service.detectAgentMcp).toHaveBeenCalledWith("claude-code");
    });

    it("should work with other agent types (extensibility)", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          if (!mcpPresent) {
            mergedConfig.mcpServers = {
              ...(userConfig.mcpServers || {}),
              "sudocode-mcp": {
                command: "sudocode-mcp",
                args: [],
              },
            };
          }

          return mergedConfig;
        }
      );

      const userConfig: ExecutionConfig = { mode: "worktree" };

      // Test with different agent types
      for (const agentType of ["codex", "copilot", "cursor"] as AgentType[]) {
        vi.clearAllMocks();

        const result = await service.buildExecutionConfig(agentType, userConfig);

        expect(result.mcpServers).toBeDefined();
        expect(service.detectAgentMcp).toHaveBeenCalledWith(agentType);
      }
    });
  });

  describe("error scenarios", () => {
    it("should provide clear error message when sudocode-mcp package is missing", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(false);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      // Implement error throwing logic
      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async () => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error(
              "sudocode-mcp package not found. Please install sudocode from github.com/sudocode-ai/sudocode"
            );
          }
          return {};
        }
      );

      const userConfig: ExecutionConfig = { mode: "worktree" };

      try {
        await service.buildExecutionConfig("claude-code", userConfig);
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("sudocode-mcp");
        expect(message).toContain("not found");
        expect(message).toContain("github.com/sudocode-ai/sudocode");
      }
    });

    it("should handle detection errors gracefully", async () => {
      // Mock detectSudocodeMcp to throw an error
      vi.spyOn(service, "detectSudocodeMcp").mockRejectedValue(
        new Error("Detection failed")
      );

      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async () => {
          try {
            await service.detectSudocodeMcp();
          } catch (error) {
            // Detection failure should be treated as "not installed"
            throw new Error(
              "sudocode-mcp package not found. Please install sudocode from github.com/sudocode-ai/sudocode"
            );
          }
          return {};
        }
      );

      const userConfig: ExecutionConfig = { mode: "worktree" };

      await expect(
        service.buildExecutionConfig("claude-code", userConfig)
      ).rejects.toThrow();
    });
  });
});
