/**
 * Tests for Agent Configuration Handlers
 *
 * Tests the agent-specific configuration logic for ACP executors.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  claudeCodeHandler,
  geminiHandler,
  codexHandler,
  defaultHandler,
  getAgentConfigHandler,
  processAgentConfig,
  getSessionPermissionMode,
  type RawAgentConfig,
  type ProcessedAgentConfig,
  type AgentConfigContext,
} from "../../../../src/execution/executors/agent-config-handlers.js";
import { AgentFactory } from "acp-factory";

// Mock AgentFactory.register to avoid side effects
vi.mock("acp-factory", async () => {
  const actual = await vi.importActual("acp-factory");
  return {
    ...actual,
    AgentFactory: {
      register: vi.fn(),
    },
  };
});

describe("Agent Config Handlers", () => {
  const defaultContext: AgentConfigContext = {
    isResume: false,
    workDir: "/test/workdir",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Claude Code Handler Tests
  // ===========================================================================
  describe("claudeCodeHandler", () => {
    describe("processConfig", () => {
      it("should set ANTHROPIC_MODEL env var when model is provided", () => {
        const rawConfig: RawAgentConfig = {
          model: "claude-sonnet-4-20250514",
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ ANTHROPIC_MODEL: "claude-sonnet-4-20250514" });
      });

      it("should read model from nested agentConfig", () => {
        const rawConfig: RawAgentConfig = {
          agentConfig: {
            model: "claude-opus-4",
          },
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ ANTHROPIC_MODEL: "claude-opus-4" });
      });

      it("should prefer top-level model over nested", () => {
        const rawConfig: RawAgentConfig = {
          model: "claude-sonnet",
          agentConfig: {
            model: "claude-opus",
          },
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ ANTHROPIC_MODEL: "claude-sonnet" });
      });

      it("should merge existing env vars with model", () => {
        const rawConfig: RawAgentConfig = {
          model: "claude-sonnet",
          env: { CUSTOM_VAR: "value" },
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({
          ANTHROPIC_MODEL: "claude-sonnet",
          CUSTOM_VAR: "value",
        });
      });

      it("should set interactive permission mode by default", () => {
        const rawConfig: RawAgentConfig = {};

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("interactive");
        expect(result.skipPermissions).toBe(false);
      });

      it("should set auto-approve when dangerouslySkipPermissions is true", () => {
        const rawConfig: RawAgentConfig = {
          dangerouslySkipPermissions: true,
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
      });

      it("should set auto-approve when nested dangerouslySkipPermissions is true", () => {
        const rawConfig: RawAgentConfig = {
          agentConfig: {
            dangerouslySkipPermissions: true,
          },
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
      });

      it("should set auto-approve when permissionMode is bypassPermissions", () => {
        const rawConfig: RawAgentConfig = {
          permissionMode: "bypassPermissions",
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
        expect(result.agentPermissionMode).toBe("bypassPermissions");
      });

      it("should preserve permissionMode in agentPermissionMode", () => {
        const rawConfig: RawAgentConfig = {
          permissionMode: "plan",
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.agentPermissionMode).toBe("plan");
        expect(result.skipPermissions).toBe(false); // plan mode doesn't skip permissions
      });

      it("should read permissionMode from nested agentConfig", () => {
        const rawConfig: RawAgentConfig = {
          agentConfig: {
            permissionMode: "acceptEdits",
          },
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.agentPermissionMode).toBe("acceptEdits");
      });

      it("should set sessionMode from mode field", () => {
        const rawConfig: RawAgentConfig = {
          mode: "architect",
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.sessionMode).toBe("architect");
      });

      it("should preserve mcpServers configuration", () => {
        const mcpServers = {
          "test-server": { command: "node", args: ["server.js"] },
        };
        const rawConfig: RawAgentConfig = {
          mcpServers,
        };

        const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

        expect(result.mcpServers).toEqual(mcpServers);
      });

      // Compaction configuration tests
      describe("compaction configuration", () => {
        it("should not include compaction when not configured", () => {
          const rawConfig: RawAgentConfig = {};

          const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

          expect(result.compaction).toBeUndefined();
        });

        it("should not include compaction when disabled", () => {
          const rawConfig: RawAgentConfig = {
            agentConfig: {
              compaction: {
                enabled: false,
              },
            },
          };

          const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

          expect(result.compaction).toBeUndefined();
        });

        it("should extract compaction config when enabled", () => {
          const rawConfig: RawAgentConfig = {
            agentConfig: {
              compaction: {
                enabled: true,
                contextTokenThreshold: 50000,
              },
            },
          };

          const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

          expect(result.compaction).toEqual({
            enabled: true,
            contextTokenThreshold: 50000,
            customInstructions: undefined,
          });
        });

        it("should include customInstructions when provided", () => {
          const rawConfig: RawAgentConfig = {
            agentConfig: {
              compaction: {
                enabled: true,
                contextTokenThreshold: 100000,
                customInstructions: "Focus on code changes",
              },
            },
          };

          const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

          expect(result.compaction).toEqual({
            enabled: true,
            contextTokenThreshold: 100000,
            customInstructions: "Focus on code changes",
          });
        });

        it("should extract compaction from top-level config", () => {
          const rawConfig: RawAgentConfig = {
            compaction: {
              enabled: true,
              contextTokenThreshold: 75000,
            },
          } as RawAgentConfig;

          const result = claudeCodeHandler.processConfig(rawConfig, defaultContext);

          expect(result.compaction).toEqual({
            enabled: true,
            contextTokenThreshold: 75000,
            customInstructions: undefined,
          });
        });
      });
    });

    describe("getSessionPermissionMode", () => {
      it("should return explicit agentPermissionMode when set to default", () => {
        const config: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
          agentPermissionMode: "default",
        };

        const result = claudeCodeHandler.getSessionPermissionMode!(config);

        // Now we return the explicit value even if it's "default"
        expect(result).toBe("default");
      });

      it("should return agentPermissionMode when explicitly set (not default)", () => {
        const config: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
          agentPermissionMode: "plan",
        };

        const result = claudeCodeHandler.getSessionPermissionMode!(config);

        expect(result).toBe("plan");
      });

      it("should return bypassPermissions when agentPermissionMode is bypassPermissions", () => {
        const config: ProcessedAgentConfig = {
          acpPermissionMode: "auto-approve",
          skipPermissions: true,
          agentPermissionMode: "bypassPermissions",
        };

        const result = claudeCodeHandler.getSessionPermissionMode!(config);

        expect(result).toBe("bypassPermissions");
      });

      it("should return bypassPermissions when skipPermissions is true and no agentPermissionMode", () => {
        const config: ProcessedAgentConfig = {
          acpPermissionMode: "auto-approve",
          skipPermissions: true,
        };

        const result = claudeCodeHandler.getSessionPermissionMode!(config);

        expect(result).toBe("bypassPermissions");
      });

      it("should return 'default' when skipPermissions is false and no agentPermissionMode", () => {
        const config: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };

        const result = claudeCodeHandler.getSessionPermissionMode!(config);

        // Explicitly set "default" to ensure interactive permissions
        expect(result).toBe("default");
      });
    });
  });

  // ===========================================================================
  // Gemini Handler Tests
  // ===========================================================================
  describe("geminiHandler", () => {
    describe("processConfig", () => {
      it("should not set model env var (Gemini uses default)", () => {
        const rawConfig: RawAgentConfig = {
          model: "gemini-pro",
        };

        const result = geminiHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toBeUndefined();
      });

      it("should preserve existing env vars", () => {
        const rawConfig: RawAgentConfig = {
          env: { GOOGLE_API_KEY: "test-key" },
        };

        const result = geminiHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ GOOGLE_API_KEY: "test-key" });
      });

      it("should set auto-approve when dangerouslySkipPermissions is true", () => {
        const rawConfig: RawAgentConfig = {
          dangerouslySkipPermissions: true,
        };

        const result = geminiHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
      });

      it("should set interactive by default", () => {
        const rawConfig: RawAgentConfig = {};

        const result = geminiHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("interactive");
        expect(result.skipPermissions).toBe(false);
      });
    });

    describe("applySetup", () => {
      it("should register Gemini with default approval mode", () => {
        const rawConfig: RawAgentConfig = {};
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };

        geminiHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("gemini", {
          command: "npx",
          args: [
            "@google/gemini-cli",
            "--experimental-acp",
            "--approval-mode",
            "default",
          ],
          env: {},
        });
      });

      it("should register Gemini with yolo approval mode when skipPermissions", () => {
        const rawConfig: RawAgentConfig = {};
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "auto-approve",
          skipPermissions: true,
        };

        geminiHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("gemini", {
          command: "npx",
          args: [
            "@google/gemini-cli",
            "--experimental-acp",
            "--approval-mode",
            "yolo",
          ],
          env: {},
        });
      });

      it("should add --resume flag for follow-up executions", () => {
        const rawConfig: RawAgentConfig = {};
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };
        const resumeContext: AgentConfigContext = {
          isResume: true,
          workDir: "/test/workdir",
        };

        geminiHandler.applySetup!(rawConfig, processedConfig, resumeContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("gemini", {
          command: "npx",
          args: [
            "@google/gemini-cli",
            "--experimental-acp",
            "--approval-mode",
            "default",
            "--resume",
            "latest",
          ],
          env: {},
        });
      });

      it("should combine yolo mode and resume flag", () => {
        const rawConfig: RawAgentConfig = {};
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "auto-approve",
          skipPermissions: true,
        };
        const resumeContext: AgentConfigContext = {
          isResume: true,
          workDir: "/test/workdir",
        };

        geminiHandler.applySetup!(rawConfig, processedConfig, resumeContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("gemini", {
          command: "npx",
          args: [
            "@google/gemini-cli",
            "--experimental-acp",
            "--approval-mode",
            "yolo",
            "--resume",
            "latest",
          ],
          env: {},
        });
      });
    });
  });

  // ===========================================================================
  // Codex Handler Tests
  // ===========================================================================
  describe("codexHandler", () => {
    describe("processConfig", () => {
      it("should set OPENAI_MODEL env var when model is provided", () => {
        const rawConfig: RawAgentConfig = {
          model: "gpt-4",
        };

        const result = codexHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ OPENAI_MODEL: "gpt-4" });
      });

      it("should read model from nested agentConfig", () => {
        const rawConfig: RawAgentConfig = {
          agentConfig: {
            model: "gpt-4-turbo",
          },
        };

        const result = codexHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ OPENAI_MODEL: "gpt-4-turbo" });
      });

      it("should merge existing env vars with model", () => {
        const rawConfig: RawAgentConfig = {
          model: "gpt-4",
          env: { OPENAI_API_KEY: "test-key" },
        };

        const result = codexHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({
          OPENAI_MODEL: "gpt-4",
          OPENAI_API_KEY: "test-key",
        });
      });

      it("should set interactive by default", () => {
        const rawConfig: RawAgentConfig = {};

        const result = codexHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("interactive");
        expect(result.skipPermissions).toBe(false);
      });

      it("should set auto-approve when dangerouslySkipPermissions is true", () => {
        const rawConfig: RawAgentConfig = {
          dangerouslySkipPermissions: true,
        };

        const result = codexHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
      });
    });

    describe("applySetup", () => {
      it("should register Codex with ask_for_approval=untrusted for interactive mode (default)", () => {
        const rawConfig: RawAgentConfig = {};
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };

        codexHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("codex", {
          command: "npx",
          args: ["@zed-industries/codex-acp", "-c", "ask_for_approval=untrusted"],
          env: {},
        });
      });

      it("should register Codex with fullAuto settings (on-request + workspace-write)", () => {
        const rawConfig = { fullAuto: true } as RawAgentConfig;
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };

        codexHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("codex", {
          command: "npx",
          args: [
            "@zed-industries/codex-acp",
            "-c", "ask_for_approval=on-request",
            "-c", "sandbox=workspace-write",
          ],
          env: {},
        });
      });

      it("should register Codex with custom approval and sandbox settings", () => {
        const rawConfig = {
          askForApproval: "never",
          sandbox: "danger-full-access",
        } as unknown as RawAgentConfig;
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "interactive",
          skipPermissions: false,
        };

        codexHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("codex", {
          command: "npx",
          args: [
            "@zed-industries/codex-acp",
            "-c", "ask_for_approval=never",
            "-c", "sandbox=danger-full-access",
          ],
          env: {},
        });
      });

      it("should register Codex with dangerouslySkipPermissions (highest priority)", () => {
        const rawConfig = {
          dangerouslySkipPermissions: true,
          fullAuto: false, // Should be ignored
        } as unknown as RawAgentConfig;
        const processedConfig: ProcessedAgentConfig = {
          acpPermissionMode: "auto-approve",
          skipPermissions: true,
        };

        codexHandler.applySetup!(rawConfig, processedConfig, defaultContext);

        expect(AgentFactory.register).toHaveBeenCalledWith("codex", {
          command: "npx",
          args: [
            "@zed-industries/codex-acp",
            "-c", "ask_for_approval=never",
            "-c", "sandbox=danger-full-access",
          ],
          env: {},
        });
      });
    });
  });

  // ===========================================================================
  // Default Handler Tests
  // ===========================================================================
  describe("defaultHandler", () => {
    describe("processConfig", () => {
      it("should preserve existing env vars", () => {
        const rawConfig: RawAgentConfig = {
          env: { CUSTOM_VAR: "value" },
        };

        const result = defaultHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toEqual({ CUSTOM_VAR: "value" });
      });

      it("should not set env for model (no mapping)", () => {
        const rawConfig: RawAgentConfig = {
          model: "some-model",
        };

        const result = defaultHandler.processConfig(rawConfig, defaultContext);

        expect(result.env).toBeUndefined();
      });

      it("should set interactive by default", () => {
        const rawConfig: RawAgentConfig = {};

        const result = defaultHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("interactive");
        expect(result.skipPermissions).toBe(false);
      });

      it("should set auto-approve when dangerouslySkipPermissions is true", () => {
        const rawConfig: RawAgentConfig = {
          dangerouslySkipPermissions: true,
        };

        const result = defaultHandler.processConfig(rawConfig, defaultContext);

        expect(result.acpPermissionMode).toBe("auto-approve");
        expect(result.skipPermissions).toBe(true);
      });

      it("should set sessionMode from mode field", () => {
        const rawConfig: RawAgentConfig = {
          mode: "plan",
        };

        const result = defaultHandler.processConfig(rawConfig, defaultContext);

        expect(result.sessionMode).toBe("plan");
      });
    });
  });

  // ===========================================================================
  // Handler Registry Tests
  // ===========================================================================
  describe("getAgentConfigHandler", () => {
    it("should return claudeCodeHandler for claude-code", () => {
      const handler = getAgentConfigHandler("claude-code");
      expect(handler).toBe(claudeCodeHandler);
    });

    it("should return geminiHandler for gemini", () => {
      const handler = getAgentConfigHandler("gemini");
      expect(handler).toBe(geminiHandler);
    });

    it("should return codexHandler for codex", () => {
      const handler = getAgentConfigHandler("codex");
      expect(handler).toBe(codexHandler);
    });

    it("should return defaultHandler for unknown agent types", () => {
      const handler = getAgentConfigHandler("unknown-agent");
      expect(handler).toBe(defaultHandler);
    });

    it("should return defaultHandler for opencode (not explicitly registered)", () => {
      const handler = getAgentConfigHandler("opencode");
      expect(handler).toBe(defaultHandler);
    });
  });

  // ===========================================================================
  // processAgentConfig Integration Tests
  // ===========================================================================
  describe("processAgentConfig", () => {
    it("should process claude-code config correctly", () => {
      const rawConfig: RawAgentConfig = {
        model: "claude-sonnet",
        permissionMode: "plan",
        mode: "code",
      };

      const result = processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(result.env).toEqual({ ANTHROPIC_MODEL: "claude-sonnet" });
      expect(result.agentPermissionMode).toBe("plan");
      expect(result.sessionMode).toBe("code");
      expect(result.acpPermissionMode).toBe("interactive");
    });

    it("should process gemini config and call applySetup", () => {
      const rawConfig: RawAgentConfig = {
        dangerouslySkipPermissions: true,
      };

      const result = processAgentConfig("gemini", rawConfig, {
        isResume: true,
        workDir: "/test",
      });

      expect(result.skipPermissions).toBe(true);
      expect(AgentFactory.register).toHaveBeenCalledWith("gemini", expect.objectContaining({
        args: expect.arrayContaining(["--approval-mode", "yolo", "--resume", "latest"]),
      }));
    });

    it("should log processed config", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const rawConfig: RawAgentConfig = {};

      processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[AgentConfigHandler] Processed config"),
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // getSessionPermissionMode Integration Tests
  // ===========================================================================
  describe("getSessionPermissionMode (top-level function)", () => {
    it("should use claude-code handler for claude-code agent", () => {
      const config: ProcessedAgentConfig = {
        acpPermissionMode: "interactive",
        skipPermissions: false,
        agentPermissionMode: "plan",
      };

      const result = getSessionPermissionMode("claude-code", config);

      expect(result).toBe("plan");
    });

    it("should return undefined for agents without getSessionPermissionMode", () => {
      const config: ProcessedAgentConfig = {
        acpPermissionMode: "auto-approve",
        skipPermissions: true,
        agentPermissionMode: "bypassPermissions",
      };

      // Gemini doesn't have getSessionPermissionMode
      const result = getSessionPermissionMode("gemini", config);

      expect(result).toBeUndefined();
    });

    it("should return undefined for unknown agents", () => {
      const config: ProcessedAgentConfig = {
        acpPermissionMode: "interactive",
        skipPermissions: false,
      };

      const result = getSessionPermissionMode("unknown-agent", config);

      expect(result).toBeUndefined();
    });
  });

  // ===========================================================================
  // Edge Cases and Complex Scenarios
  // ===========================================================================
  describe("Edge Cases", () => {
    it("should handle empty config", () => {
      const rawConfig: RawAgentConfig = {};

      const result = processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(result.env).toBeUndefined();
      expect(result.acpPermissionMode).toBe("interactive");
      expect(result.skipPermissions).toBe(false);
      expect(result.agentPermissionMode).toBeUndefined();
      expect(result.sessionMode).toBeUndefined();
    });

    it("should handle config with only nested agentConfig", () => {
      const rawConfig: RawAgentConfig = {
        agentConfig: {
          model: "claude-sonnet",
          dangerouslySkipPermissions: true,
          permissionMode: "bypassPermissions",
          mode: "architect",
        },
      };

      const result = processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(result.env).toEqual({ ANTHROPIC_MODEL: "claude-sonnet" });
      expect(result.skipPermissions).toBe(true);
      expect(result.agentPermissionMode).toBe("bypassPermissions");
    });

    it("should prefer top-level config over nested for all fields", () => {
      const rawConfig: RawAgentConfig = {
        model: "top-level-model",
        dangerouslySkipPermissions: false,
        permissionMode: "default",
        mode: "code",
        agentConfig: {
          model: "nested-model",
          dangerouslySkipPermissions: true,
          permissionMode: "bypassPermissions",
          mode: "plan",
        },
      };

      const result = processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(result.env).toEqual({ ANTHROPIC_MODEL: "top-level-model" });
      // Note: OR logic for dangerouslySkipPermissions means nested true wins
      expect(result.skipPermissions).toBe(true);
      expect(result.agentPermissionMode).toBe("default"); // top-level wins for permissionMode
      expect(result.sessionMode).toBe("code");
    });

    it("should handle MCP servers configuration", () => {
      const mcpServers = {
        "context-server": {
          command: "node",
          args: ["context.js"],
          env: { PORT: "3000" },
        },
      };
      const rawConfig: RawAgentConfig = {
        mcpServers,
      };

      const result = processAgentConfig("claude-code", rawConfig, defaultContext);

      expect(result.mcpServers).toEqual(mcpServers);
    });
  });
});
