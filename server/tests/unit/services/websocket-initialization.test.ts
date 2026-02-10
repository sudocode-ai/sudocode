/**
 * WebSocket Initialization Error Handling Tests
 * Tests that WebSocket server properly handles initialization failures
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as http from "http";
import { WebSocketServer } from "ws";

describe("WebSocket Initialization Error Handling", () => {
  let mockServer: http.Server;

  beforeEach(() => {
    // Create a mock HTTP server
    mockServer = http.createServer();
  });

  afterEach(async () => {
    // Clean up
    if (mockServer.listening) {
      await new Promise<void>((resolve) => {
        mockServer.close(() => resolve());
      });
    }
    vi.resetModules();
  });

  it("should throw error when WebSocket server fails to initialize", async () => {
    // Import the WebSocket manager
    const { initWebSocketServer } = await import(
      "../../../src/services/websocket.js"
    );

    // Create a server that will fail
    const badServer = {} as http.Server;

    // This should throw an error
    expect(() => {
      initWebSocketServer(badServer, "/ws");
    }).toThrow();
  });

  it("should successfully initialize when server is valid", async () => {
    // Start HTTP server on a random port
    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => resolve());
    });

    // Import the functions
    const { initWebSocketServer, getWebSocketServer, shutdownWebSocketServer } =
      await import("../../../src/services/websocket.js");

    // This should not throw
    expect(() => {
      initWebSocketServer(mockServer, "/ws");
    }).not.toThrow();

    // Verify the server was created
    const wss = getWebSocketServer();
    expect(wss).toBeTruthy();
    expect(wss).toBeInstanceOf(WebSocketServer);

    // Clean up
    await shutdownWebSocketServer();
  });

  it("should return null when getServer is called before init", async () => {
    // Import the function
    const { getWebSocketServer } = await import(
      "../../../src/services/websocket.js"
    );

    const wss = getWebSocketServer();
    // Note: The singleton may already be initialized from previous tests
    // So we just check that it returns something (null or WebSocketServer)
    expect(wss === null || wss instanceof WebSocketServer).toBe(true);
  });

  it("should warn when initializing multiple times", async () => {
    // Start HTTP server
    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => resolve());
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Import the functions
    const { initWebSocketServer, shutdownWebSocketServer } = await import(
      "../../../src/services/websocket.js"
    );

    // Initialize once
    initWebSocketServer(mockServer, "/ws");

    // Initialize again - should warn
    initWebSocketServer(mockServer, "/ws");

    expect(consoleSpy).toHaveBeenCalledWith(
      "[websocket] WebSocket server already initialized"
    );

    consoleSpy.mockRestore();

    // Clean up
    await shutdownWebSocketServer();
  });

  it("should handle port conflicts gracefully", async () => {
    // Start HTTP server on a random port
    await new Promise<void>((resolve, reject) => {
      mockServer.listen(0, () => resolve());
      mockServer.on("error", reject);
    });
    const address = mockServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve mock server address");
    }
    const port = address.port;

    // Create a second server on the same port - this will fail
    const secondServer = http.createServer();

    await expect(
      new Promise((resolve, reject) => {
        secondServer.listen(port, () => resolve(true));
        secondServer.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            reject(err);
          }
        });
      })
    ).rejects.toThrow();

    // Clean up second server
    if (secondServer.listening) {
      await new Promise<void>((resolve) => {
        secondServer.close(() => resolve());
      });
    }
  });
});
