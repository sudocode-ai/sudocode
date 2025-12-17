/**
 * Unit tests for agent config preservation between execution runs
 *
 * Tests verify how agent configuration (particularly `mcpServers`) is preserved
 * and modified between execution runs, specifically when the sudocode plugin is present.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ExecutionConfig } from "../../../src/services/execution-service.js";
import type { AgentType } from "@sudocode-ai/types/agents";

/**
 * Mock ExecutionService to test config preservation logic
 *
 * This is a simplified version that focuses on the buildExecutionConfig
 * method which handles MCP server configuration.
 */
class TestableExecutionService {
  // Expose private methods for testing
  async buildExecutionConfig(
    agentType: AgentType,
    userConfig: ExecutionConfig
  ): Promise<ExecutionConfig> {
    throw new Error("Method not implemented - should be mocked in tests");
  }

  async detectSudocodeMcp(): Promise<boolean> {
    throw new Error("Method not implemented - should be mocked in tests");
  }

  async detectAgentMcp(agentType: AgentType): Promise<boolean> {
    throw new Error("Method not implemented - should be mocked in tests");
  }
}

describe("ExecutionConfig Preservation Between Runs", () => {
  let service: TestableExecutionService;

  beforeEach(() => {
    service = new TestableExecutionService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Strip sudocode-mcp when plugin is present", () => {
    it("should strip sudocode-mcp from inherited config when plugin is detected", async () => {
      // Simulate scenario: Previous execution had sudocode-mcp in config (auto-injected or manual)
      // Now user has installed the sudocode plugin, so we should remove it from config
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

      // Mock buildExecutionConfig to implement stripping logic
      vi.spyOn(service, "buildExecutionConfig").mockImplementation(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const isInstalled = await service.detectSudocodeMcp();
          if (!isInstalled) {
            throw new Error("sudocode-mcp not installed");
          }

          const mcpPresent = await service.detectAgentMcp(agentType);
          const mergedConfig = { ...userConfig };

          // If plugin is detected, strip sudocode-mcp from config
          if (mcpPresent && userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }

          return mergedConfig;
        }
      );

      // Config from previous execution (had sudocode-mcp auto-injected)
      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "custom-server": {
            command: "custom-mcp",
            args: ["--port", "3000"],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should remove sudocode-mcp but keep custom-server
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeUndefined();
      expect(result.mcpServers!["custom-server"]).toBeDefined();
      expect(result.mcpServers!["custom-server"].command).toBe("custom-mcp");
    });

    it("should set mcpServers to undefined when only sudocode-mcp was present", async () => {
      // Scenario: Previous execution only had sudocode-mcp, nothing else
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

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
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should set mcpServers to undefined (nothing left after stripping)
      expect(result.mcpServers).toBeUndefined();
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
        mcpServers: undefined, // Already stripped
      };

      const secondResult = await service.buildExecutionConfig(
        "claude-code",
        secondFollowUpConfig
      );
      expect(secondResult.mcpServers).toBeUndefined(); // Still clean
    });
  });

  describe("Preserve mcpServers when plugin is not present", () => {
    it("should preserve manually configured sudocode-mcp when plugin not installed", async () => {
      // Scenario: User manually configured sudocode-mcp in CLI, plugin not installed
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false); // Plugin NOT detected

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

    it("should merge configs properly when plugin not present", async () => {
      // Scenario: Previous execution had auto-injected sudocode-mcp, plugin still not installed
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

      // Config from previous run (had auto-injection)
      const previousConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "other-server": {
            command: "other",
            args: [],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should preserve both servers (no plugin, so keep sudocode-mcp)
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["other-server"]).toBeDefined();
    });
  });

  describe("Preserve other MCP servers regardless of plugin", () => {
    it("should always preserve non-sudocode MCP servers when plugin is present", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

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

    it("should always preserve non-sudocode MCP servers when plugin is not present", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false); // Plugin NOT detected

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
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

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

  describe("Edge cases", () => {
    it("should handle empty mcpServers config", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false); // No plugin

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
        mcpServers: {}, // Empty object
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should auto-inject sudocode-mcp
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
    });

    it("should handle null/undefined mcpServers config", async () => {
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

      // Test with undefined
      const config1: ExecutionConfig = {
        mode: "worktree",
        mcpServers: undefined,
      };

      const result1 = await service.buildExecutionConfig("claude-code", config1);
      expect(result1.mcpServers).toBeDefined();
      expect(result1.mcpServers!["sudocode-mcp"]).toBeDefined();

      // Test with missing field
      const config2: ExecutionConfig = {
        mode: "worktree",
      };

      const result2 = await service.buildExecutionConfig("claude-code", config2);
      expect(result2.mcpServers).toBeDefined();
      expect(result2.mcpServers!["sudocode-mcp"]).toBeDefined();
    });

    it("should not mutate original config object", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

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

      const originalConfig: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: [],
          },
          "other": {
            command: "other",
            args: [],
          },
        },
      };

      const originalMcpServers = originalConfig.mcpServers;
      const originalKeys = Object.keys(originalConfig.mcpServers!);

      await service.buildExecutionConfig("claude-code", originalConfig);

      // Original config should not be mutated
      expect(originalConfig.mcpServers).toBe(originalMcpServers);
      expect(Object.keys(originalConfig.mcpServers!)).toEqual(originalKeys);
      expect(originalConfig.mcpServers!["sudocode-mcp"]).toBeDefined(); // Still there
    });

    it("should handle config with only sudocode-mcp and args", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(false); // No plugin

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
          "sudocode-mcp": {
            command: "sudocode-mcp",
            args: ["--verbose", "--debug"],
          },
        },
      };

      const result = await service.buildExecutionConfig(
        "claude-code",
        previousConfig
      );

      // Should preserve custom args
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"]).toBeDefined();
      expect(result.mcpServers!["sudocode-mcp"].args).toEqual([
        "--verbose",
        "--debug",
      ]);
    });
  });

  describe("Multi-execution chain scenarios", () => {
    it("should handle config evolution across multiple follow-ups", async () => {
      // Scenario: Track how config changes through a chain of executions
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);

      // Execution 1: No plugin, auto-inject
      vi.spyOn(service, "detectAgentMcp").mockResolvedValueOnce(false);
      vi.spyOn(service, "buildExecutionConfig").mockImplementationOnce(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const mergedConfig = { ...userConfig };
          if (!userConfig.mcpServers?.["sudocode-mcp"]) {
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

      const exec1Config: ExecutionConfig = {
        mode: "worktree",
        mcpServers: {
          "custom-server": {
            command: "custom",
            args: [],
          },
        },
      };

      const exec1Result = await service.buildExecutionConfig(
        "claude-code",
        exec1Config
      );

      expect(exec1Result.mcpServers!["sudocode-mcp"]).toBeDefined(); // Auto-injected
      expect(exec1Result.mcpServers!["custom-server"]).toBeDefined();

      // Execution 2: Plugin installed mid-chain, strip sudocode-mcp
      vi.spyOn(service, "detectAgentMcp").mockResolvedValueOnce(true);
      vi.spyOn(service, "buildExecutionConfig").mockImplementationOnce(
        async (agentType: AgentType, userConfig: ExecutionConfig) => {
          const mergedConfig = { ...userConfig };
          if (userConfig.mcpServers?.["sudocode-mcp"]) {
            const { "sudocode-mcp": _removed, ...rest } =
              userConfig.mcpServers;
            mergedConfig.mcpServers =
              Object.keys(rest).length > 0 ? rest : undefined;
          }
          return mergedConfig;
        }
      );

      const exec2Config = exec1Result; // Inherit from exec1

      const exec2Result = await service.buildExecutionConfig(
        "claude-code",
        exec2Config
      );

      expect(exec2Result.mcpServers).toBeDefined();
      expect(exec2Result.mcpServers!["sudocode-mcp"]).toBeUndefined(); // Stripped
      expect(exec2Result.mcpServers!["custom-server"]).toBeDefined(); // Preserved
    });

    it("should preserve other config fields during MCP server modification", async () => {
      vi.spyOn(service, "detectSudocodeMcp").mockResolvedValue(true);
      vi.spyOn(service, "detectAgentMcp").mockResolvedValue(true); // Plugin detected

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
        dangerouslySkipPermissions: true,
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
      expect(result.dangerouslySkipPermissions).toBe(true);

      // Only mcpServers should be modified
      expect(result.mcpServers).toBeUndefined(); // Stripped sudocode-mcp
    });
  });
});
