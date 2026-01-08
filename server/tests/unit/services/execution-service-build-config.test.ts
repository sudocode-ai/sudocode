/**
 * Unit tests for ExecutionService.buildExecutionConfig method
 *
 * Tests the MCP auto-injection logic for sudocode-mcp plugin,
 * config preservation between execution runs, and multi-execution chain scenarios.
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

  describe("config preservation across execution runs", () => {
    it("should preserve manually configured sudocode-mcp when plugin not installed", async () => {
      // Scenario: User manually configured sudocode-mcp in CLI, plugin not installed
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

          // Don't inject if user already provided it
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

      const previousConfig: ExecutionConfig = {
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
        previousConfig
      );

      // Should preserve the user's manual config (with custom args)
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].args).toEqual([
        "--custom-arg",
      ]);
    });

    it("should handle multiple follow-up runs with plugin installed", async () => {
      // Scenario: Multi-execution chain where plugin gets installed mid-chain
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

          if (mcpPresent && userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }

          return mergedConfig;
        }
      );

      // First follow-up: config still has sudocode-mcp from initial run
      const firstFollowUpConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
        },
      };

      const firstResult = await service.buildExecutionConfig(
        "claude-code",
        firstFollowUpConfig
      );
      expect(firstResult.mcpServers).toBeUndefined(); // Stripped

      // Second follow-up: config is now clean (no sudocode-mcp)
      const secondFollowUpConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: undefined,
      };

      const secondResult = await service.buildExecutionConfig(
        "claude-code",
        secondFollowUpConfig
      );
      expect(secondResult.mcpServers).toBeUndefined(); // Still clean
    });

    it("should preserve other config fields during MCP server modification", async () => {
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

          if (mcpPresent && userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }

          return mergedConfig;
        }
      );

      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        model: "claude-sonnet-4",
        timeout: 5000,
        appendSystemPrompt: "Be helpful and concise",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // All non-MCP config should be preserved
      expect(result.mode).toBe("worktree");
      expect(result.model).toBe("claude-sonnet-4");
      expect(result.timeout).toBe(5000);
      expect(result.appendSystemPrompt).toBe("Be helpful and concise");

      // Only mcpServers should be modified
      expect(result.mcpServers).toBeUndefined(); // Stripped sudocode-mcp
    });
  });

  describe("complex MCP server configurations", () => {
    it("should preserve non-sudocode MCP servers when plugin is present", async () => {
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

          if (mcpPresent && userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }

          return mergedConfig;
        }
      );

      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "filesystem-mcp": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
          },
          "postgres-mcp": {
            command: "uvx",
            args: ["mcp-server-postgres"],
            env: {
              DATABASE_URL: "postgresql://localhost/mydb",
            },
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should remove sudocode-mcp but keep all others
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeUndefined();
      expect(result.mcpServers!["filesystem-mcp"]).toBeDefined();
      expect(result.mcpServers!["postgres-mcp"]).toBeDefined();
      expect(result.mcpServers!["postgres-mcp"].env).toEqual({
        DATABASE_URL: "postgresql://localhost/mydb",
      });
    });

    it("should preserve non-sudocode MCP servers when plugin is not present", async () => {
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

      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "custom-api": {
            command: "node",
            args: ["/path/to/custom-api.js"],
          },
          "external-service": {
            command: "python",
            args: ["-m", "external_mcp"],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should preserve all custom servers AND auto-inject sudocode-mcp
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["custom-api"]).toBeDefined();
      expect(result.mcpServers!["external-service"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined(); // Auto-injected
    });

    it("should handle complex MCP server configurations with env and args", async () => {
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

          if (mcpPresent && userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }

          return mergedConfig;
        }
      );

      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "complex-server": {
            command: "/usr/local/bin/complex-mcp",
            args: ["--verbose", "--config", "/etc/config.json"],
            env: {
              API_KEY: "secret",
              DEBUG: "true",
              TIMEOUT: "30000",
            },
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should preserve complex server config exactly
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["complex-server"]).toBeDefined();
      expect(result.mcpServers!["complex-server"].command).toBe(
        "/usr/local/bin/complex-mcp"
      );
      expect(result.mcpServers!["complex-server"].args).toEqual([
        "--verbose",
        "--config",
        "/etc/config.json",
      ]);
      expect(result.mcpServers!["complex-server"].env).toEqual({
        API_KEY: "secret",
        DEBUG: "true",
        TIMEOUT: "30000",
      });
    });
  });

  describe("config passthrough behavior", () => {
    it("should pass through user config without modification (no agent defaults merged)", async () => {
      // Mock: sudocode-mcp package installed, agent plugin configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        model: "opus", // User-provided value
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // buildExecutionConfig doesn't merge agent defaults - it only handles MCP injection
      // Agent defaults are merged later by the adapter
      expect(result.model).toBe("opus");

      // Should NOT have defaults merged in buildExecutionConfig
      expect(result.disallowedTools).toBeUndefined();
      expect(result.print).toBeUndefined();
      expect(result.outputFormat).toBeUndefined();
    });

    it("should preserve all user-provided config values", async () => {
      // Mock: sudocode-mcp package installed, agent plugin configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        disallowedTools: ["Bash"],
        dangerouslySkipPermissions: false,
        model: "opus",
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // All user config should be preserved exactly as-is
      expect(result.disallowedTools).toEqual(["Bash"]);
      expect(result.dangerouslySkipPermissions).toBe(false);
      expect(result.model).toBe("opus");
    });

    it("should pass through undefined values in user config", async () => {
      // Mock: sudocode-mcp package installed, agent plugin configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        model: undefined,
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // buildExecutionConfig is not responsible for filtering undefined values
      // or merging defaults - that happens in the adapter
      expect(result).toHaveProperty("model");
      expect(result.model).toBeUndefined();
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

  describe("voice scope injection based on narration config", () => {
    it("should add voice scope when narration is enabled", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Set server URL - required for voice scope injection
      service.setServerUrl("http://localhost:3000");

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        narrationConfig: {
          enabled: true,
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp with voice scope
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].args).toBeDefined();
      const args = result.mcpServers!["sudocode-mcp"].args!;
      expect(args).toContain("--scope");
      // Find the scope value
      const scopeIndex = args.indexOf("--scope");
      expect(scopeIndex).toBeGreaterThanOrEqual(0);
      const scopeValue = args[scopeIndex + 1];
      expect(scopeValue).toContain("voice");
    });

    it("should not add voice scope when narration is disabled", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Set server URL - but voice scope should NOT be added when narration is disabled
      service.setServerUrl("http://localhost:3000");

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        narrationConfig: {
          enabled: false,
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp without voice scope
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();

      const args = result.mcpServers!["sudocode-mcp"].args;
      if (args && args.includes("--scope")) {
        const scopeIndex = args.indexOf("--scope");
        const scopeValue = args[scopeIndex + 1];
        expect(scopeValue).not.toContain("voice");
      }
    });

    it("should not add voice scope when narrationConfig is undefined", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Set server URL - but voice scope should NOT be added when narrationConfig is undefined
      service.setServerUrl("http://localhost:3000");

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        // No narrationConfig
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp without voice scope
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();

      const args = result.mcpServers!["sudocode-mcp"].args;
      if (args && args.includes("--scope")) {
        const scopeIndex = args.indexOf("--scope");
        const scopeValue = args[scopeIndex + 1];
        expect(scopeValue).not.toContain("voice");
      }
    });

    it("should add voice scope with project-assistant tag when narration is enabled", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Set server URL - required for voice scope injection
      service.setServerUrl("http://localhost:3000");

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        tags: ["project-assistant"],
        narrationConfig: {
          enabled: true,
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp with all,voice scopes
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      const args = result.mcpServers!["sudocode-mcp"].args!;
      expect(args).toContain("--scope");
      const scopeIndex = args.indexOf("--scope");
      const scopeValue = args[scopeIndex + 1];
      expect(scopeValue).toContain("all");
      expect(scopeValue).toContain("voice");
    });

    it("should use default,voice scopes when narration enabled without project-assistant tag", async () => {
      // Mock: sudocode-mcp package installed, agent plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Set server URL - required for voice scope injection
      service.setServerUrl("http://localhost:3000");

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        narrationConfig: {
          enabled: true,
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        userConfig
      );

      // Should have auto-injected sudocode-mcp with default,voice scopes
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      const args = result.mcpServers!["sudocode-mcp"].args!;
      expect(args).toContain("--scope");
      const scopeIndex = args.indexOf("--scope");
      const scopeValue = args[scopeIndex + 1];
      expect(scopeValue).toContain("default");
      expect(scopeValue).toContain("voice");
    });
  });

  describe("cursor warning handling", () => {
    it("should warn (not throw) when cursor agent has no MCP config", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return false for cursor (no .cursor/mcp.json)
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      // Should not throw - just warn and return config
      const result = await service.buildExecutionConfig("cursor", userConfig);
      expect(result).toBeDefined();

      // Should have logged a warning
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain(".cursor/mcp.json");

      warnSpy.mockRestore();
    });

    it("should include example config in warning message for cursor", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return false for cursor
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      // Should not throw - just warn
      const result = await service.buildExecutionConfig("cursor", userConfig);
      expect(result).toBeDefined();

      // Warning should include example config
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain("mcpServers");
      expect(warnMessage).toContain("sudocode-mcp");

      warnSpy.mockRestore();
    });

    it("should not throw when cursor agent has MCP config", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return true for cursor (has .cursor/mcp.json)
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      // Should not throw
      const result = await service.buildExecutionConfig("cursor", userConfig);
      expect(result).toBeDefined();
    });

    it("should set approveMcps=true when cursor agent has sudocode-mcp configured", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return true for cursor (has .cursor/mcp.json with sudocode-mcp)
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true);

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      const result = await service.buildExecutionConfig("cursor", userConfig);

      // Should have approveMcps set to true for headless mode
      expect((result as any).approveMcps).toBe(true);
    });

    it("should not set approveMcps for cursor when sudocode-mcp is not detected", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return false for cursor (no .cursor/mcp.json)
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const userConfig: ExecutionConfig = {
        mode: "worktree",
      };

      const result = await service.buildExecutionConfig("cursor", userConfig);

      // approveMcps should not be set when MCP is not detected
      expect((result as any).approveMcps).toBeUndefined();

      warnSpy.mockRestore();
    });

    it("should warn even if user provides mcpServers in config for cursor", async () => {
      // Mock detectSudocodeMcp to return true (package installed)
      await mockSudocodeMcpDetection(true);

      // Mock detectAgentMcp to return false for cursor (no .cursor/mcp.json)
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const userConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
        },
      };

      // Should warn but not throw - Cursor can't accept CLI-injected MCP config
      const result = await service.buildExecutionConfig("cursor", userConfig);
      expect(result).toBeDefined();

      // Should have warned about missing .cursor/mcp.json
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain(".cursor/mcp.json");

      warnSpy.mockRestore();
    });
  });
});
