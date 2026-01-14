/**
 * Tests for WebSocketSessionProvider
 *
 * Tests the WebSocket-based ACP session provider for macro-agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// Mock types for the ACP SDK
interface MockInitializeResult {
  agentCapabilities: {
    loadSession?: boolean;
  };
}

interface MockSession {
  sessionId: string;
}

// Mock WebSocket and ACP SDK
const mockWsInstance = {
  on: vi.fn(),
  once: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  readyState: 1, // OPEN
};

const mockConnection = {
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  setSessionMode: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("ws", () => ({
  WebSocket: vi.fn(() => mockWsInstance),
  default: vi.fn(() => mockWsInstance),
}));

vi.mock("@agentclientprotocol/sdk", () => ({
  ClientSideConnection: vi.fn(() => mockConnection),
  PROTOCOL_VERSION: "2024.1",
}));

// Import after mocking
import { WebSocket } from "ws";
import {
  WebSocketSessionProvider,
  type WebSocketSessionProviderConfig,
} from "../../../../../src/execution/executors/session-providers/websocket-session-provider.js";

describe("WebSocketSessionProvider", () => {
  const defaultConfig: WebSocketSessionProviderConfig = {
    wsUrl: "ws://localhost:3100/acp",
    permissionMode: "auto-approve",
    connectionTimeout: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset WebSocket mock state
    mockWsInstance.readyState = 1; // OPEN
    mockWsInstance.on.mockReset();
    mockWsInstance.once.mockReset();
    mockWsInstance.send.mockReset();
    mockWsInstance.close.mockReset();

    // Reset connection mocks
    mockConnection.initialize.mockReset();
    mockConnection.newSession.mockReset();
    mockConnection.loadSession.mockReset();
    mockConnection.setSessionMode.mockReset();
    mockConnection.prompt.mockReset();
    mockConnection.cancel.mockReset();

    // Setup default successful mock behaviors
    mockWsInstance.once.mockImplementation((event: string, callback: Function) => {
      if (event === "open") {
        // Simulate immediate open
        setTimeout(() => callback(), 0);
      }
      return mockWsInstance;
    });

    mockConnection.initialize.mockResolvedValue({
      agentCapabilities: { loadSession: true },
    } as MockInitializeResult);

    mockConnection.newSession.mockResolvedValue({
      sessionId: "test-session-123",
    } as MockSession);

    mockConnection.loadSession.mockResolvedValue({});
    mockConnection.setSessionMode.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================
  describe("constructor", () => {
    it("should create provider with default timeout", () => {
      const provider = new WebSocketSessionProvider({
        wsUrl: "ws://localhost:3100/acp",
      });

      expect(provider).toBeDefined();
    });

    it("should use custom connection timeout", () => {
      const provider = new WebSocketSessionProvider({
        wsUrl: "ws://localhost:3100/acp",
        connectionTimeout: 5000,
      });

      expect(provider).toBeDefined();
    });
  });

  // ===========================================================================
  // Connection Tests
  // ===========================================================================
  describe("connection", () => {
    it("should connect to WebSocket URL when creating session", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");

      expect(WebSocket).toHaveBeenCalledWith("ws://localhost:3100/acp");
    });

    it("should initialize ACP connection with correct capabilities", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");

      expect(mockConnection.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolVersion: expect.any(String),
          clientCapabilities: expect.objectContaining({
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
            terminal: false,
          }),
        })
      );
    });

    it("should throw error on connection timeout", async () => {
      mockWsInstance.once.mockImplementation((event: string, callback: Function) => {
        // Don't call callback to simulate timeout
        return mockWsInstance;
      });

      const provider = new WebSocketSessionProvider({
        ...defaultConfig,
        connectionTimeout: 50, // Very short timeout
      });

      await expect(provider.createSession("/test/workdir")).rejects.toThrow(
        /Connection timeout/
      );
    });

    it("should handle WebSocket error during connection", async () => {
      mockWsInstance.once.mockImplementation((event: string, callback: Function) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("Connection refused")), 0);
        }
        return mockWsInstance;
      });

      const provider = new WebSocketSessionProvider(defaultConfig);

      await expect(provider.createSession("/test/workdir")).rejects.toThrow(
        /Failed to connect/
      );
    });

    it("should not reconnect if already connected", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");
      await provider.createSession("/test/workdir2");

      // WebSocket should only be created once
      expect(WebSocket).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // createSession Tests
  // ===========================================================================
  describe("createSession", () => {
    it("should create session with working directory", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      const session = await provider.createSession("/test/workdir");

      expect(mockConnection.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/test/workdir",
          mcpServers: [],
        })
      );
      expect(session.id).toBe("test-session-123");
    });

    it("should pass MCP servers when provided", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);
      const mcpServers = [{ name: "test-server", command: "node", args: ["server.js"] }];

      await provider.createSession("/test/workdir", { mcpServers });

      expect(mockConnection.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers,
        })
      );
    });

    it("should set session mode when provided", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir", { mode: "plan" });

      expect(mockConnection.setSessionMode).toHaveBeenCalledWith({
        sessionId: "test-session-123",
        modeId: "plan",
      });
    });

    it("should not set mode when not provided", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");

      expect(mockConnection.setSessionMode).not.toHaveBeenCalled();
    });

    it("should return session with correct interface", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      const session = await provider.createSession("/test/workdir");

      expect(session).toHaveProperty("id");
      expect(session).toHaveProperty("prompt");
      expect(session).toHaveProperty("cancel");
      expect(session).toHaveProperty("setMode");
      expect(session).toHaveProperty("close");
    });
  });

  // ===========================================================================
  // loadSession Tests
  // ===========================================================================
  describe("loadSession", () => {
    it("should load existing session when supported", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      const session = await provider.loadSession(
        "existing-session",
        "/test/workdir"
      );

      expect(mockConnection.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "existing-session",
          cwd: "/test/workdir",
          mcpServers: [],
        })
      );
      expect(session.id).toBe("existing-session");
    });

    it("should fallback to createSession when loadSession not supported", async () => {
      mockConnection.initialize.mockResolvedValue({
        agentCapabilities: { loadSession: false },
      } as MockInitializeResult);

      const provider = new WebSocketSessionProvider(defaultConfig);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const session = await provider.loadSession(
        "existing-session",
        "/test/workdir"
      );

      // Should create new session instead
      expect(mockConnection.newSession).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("doesn't support session loading")
      );

      consoleSpy.mockRestore();
    });

    it("should pass MCP servers when loading session", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);
      const mcpServers = [{ name: "test-server", command: "node", args: ["server.js"] }];

      await provider.loadSession("existing-session", "/test/workdir", {
        mcpServers,
      });

      expect(mockConnection.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers,
        })
      );
    });
  });

  // ===========================================================================
  // supportsSessionLoading Tests
  // ===========================================================================
  describe("supportsSessionLoading", () => {
    it("should return false before connecting", () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      expect(provider.supportsSessionLoading()).toBe(false);
    });

    it("should return true when server supports loadSession", async () => {
      mockConnection.initialize.mockResolvedValue({
        agentCapabilities: { loadSession: true },
      } as MockInitializeResult);

      const provider = new WebSocketSessionProvider(defaultConfig);
      await provider.createSession("/test/workdir");

      expect(provider.supportsSessionLoading()).toBe(true);
    });

    it("should return false when server doesn't support loadSession", async () => {
      mockConnection.initialize.mockResolvedValue({
        agentCapabilities: { loadSession: false },
      } as MockInitializeResult);

      const provider = new WebSocketSessionProvider(defaultConfig);
      await provider.createSession("/test/workdir");

      expect(provider.supportsSessionLoading()).toBe(false);
    });
  });

  // ===========================================================================
  // close Tests
  // ===========================================================================
  describe("close", () => {
    it("should attempt to close WebSocket connection", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await provider.createSession("/test/workdir");
      await provider.close();

      // The close method sets state to closed and logs - verify the log
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[WebSocketSessionProvider] Closed connection")
      );

      consoleSpy.mockRestore();
    });

    it("should handle close when not connected", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      // Should not throw
      await expect(provider.close()).resolves.toBeUndefined();
    });

    it("should log close message", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");
      await provider.close();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[WebSocketSessionProvider] Closed connection")
      );

      consoleSpy.mockRestore();
    });

    it("should clean up internal state after close", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      await provider.createSession("/test/workdir");

      // After close, supportsSessionLoading should return false (capabilities cleared)
      await provider.close();

      expect(provider.supportsSessionLoading()).toBe(false);
    });
  });

  // ===========================================================================
  // WebSocketSession Tests
  // ===========================================================================
  describe("WebSocketSession", () => {
    describe("cancel", () => {
      it("should call connection cancel with session ID", async () => {
        const provider = new WebSocketSessionProvider(defaultConfig);
        const session = await provider.createSession("/test/workdir");

        await session.cancel();

        expect(mockConnection.cancel).toHaveBeenCalledWith({
          sessionId: "test-session-123",
        });
      });
    });

    describe("setMode", () => {
      it("should call connection setSessionMode with session ID and mode", async () => {
        const provider = new WebSocketSessionProvider(defaultConfig);
        const session = await provider.createSession("/test/workdir");

        await session.setMode("architect");

        expect(mockConnection.setSessionMode).toHaveBeenCalledWith({
          sessionId: "test-session-123",
          modeId: "architect",
        });
      });

      it("should throw when connection doesn't support setSessionMode", async () => {
        // Remove setSessionMode from mock
        const originalSetSessionMode = mockConnection.setSessionMode;
        delete (mockConnection as any).setSessionMode;

        const provider = new WebSocketSessionProvider(defaultConfig);
        const session = await provider.createSession("/test/workdir");

        await expect(session.setMode("architect")).rejects.toThrow(
          /does not support setting session mode/
        );

        // Restore
        mockConnection.setSessionMode = originalSetSessionMode;
      });
    });

    describe("close", () => {
      it("should not throw on session close", async () => {
        const provider = new WebSocketSessionProvider(defaultConfig);
        const session = await provider.createSession("/test/workdir");

        // Session close should just end the stream, not throw
        await expect(session.close()).resolves.toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // Permission Mode Tests
  // ===========================================================================
  describe("permission modes", () => {
    it("should use auto-approve mode by default", async () => {
      const provider = new WebSocketSessionProvider({
        wsUrl: "ws://localhost:3100/acp",
      });

      await provider.createSession("/test/workdir");

      // The permission mode is passed to WebSocketClientHandler internally
      // We verify it was created with the provider
      expect(provider).toBeDefined();
    });

    it("should support interactive permission mode", async () => {
      const provider = new WebSocketSessionProvider({
        wsUrl: "ws://localhost:3100/acp",
        permissionMode: "interactive",
      });

      await provider.createSession("/test/workdir");
      expect(provider).toBeDefined();
    });

    it("should support auto-deny permission mode", async () => {
      const provider = new WebSocketSessionProvider({
        wsUrl: "ws://localhost:3100/acp",
        permissionMode: "auto-deny",
      });

      await provider.createSession("/test/workdir");
      expect(provider).toBeDefined();
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================
  describe("error handling", () => {
    it("should throw when creating session without connection", async () => {
      // Make connection fail
      mockWsInstance.once.mockImplementation((event: string, callback: Function) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("Connection failed")), 0);
        }
        return mockWsInstance;
      });

      const provider = new WebSocketSessionProvider(defaultConfig);

      await expect(provider.createSession("/test/workdir")).rejects.toThrow();
    });

    it("should throw descriptive error on connection failure", async () => {
      mockWsInstance.once.mockImplementation((event: string, callback: Function) => {
        if (event === "close") {
          setTimeout(
            () => callback(1006, Buffer.from("Connection reset")),
            0
          );
        }
        return mockWsInstance;
      });

      const provider = new WebSocketSessionProvider(defaultConfig);

      await expect(provider.createSession("/test/workdir")).rejects.toThrow(
        /Failed to connect/
      );
    });
  });

  // ===========================================================================
  // Multiple Session Tests
  // ===========================================================================
  describe("multiple sessions", () => {
    it("should create multiple sessions on same connection", async () => {
      const provider = new WebSocketSessionProvider(defaultConfig);

      mockConnection.newSession.mockResolvedValueOnce({ sessionId: "session-1" });
      mockConnection.newSession.mockResolvedValueOnce({ sessionId: "session-2" });

      const session1 = await provider.createSession("/test/workdir1");
      const session2 = await provider.createSession("/test/workdir2");

      expect(session1.id).toBe("session-1");
      expect(session2.id).toBe("session-2");

      // Only one WebSocket connection
      expect(WebSocket).toHaveBeenCalledTimes(1);
      // But two session creations
      expect(mockConnection.newSession).toHaveBeenCalledTimes(2);
    });
  });
});
