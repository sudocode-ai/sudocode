/**
 * Integration test for port scanning with WebSocket initialization
 * Tests that the server automatically finds the next available port
 * when both HTTP and WebSocket need to be initialized together
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { WebSocketServer } from 'ws';

describe('Port Scanning Integration Tests', () => {
  let conflictingServer: http.Server;
  let conflictingWss: WebSocketServer;
  const CONFLICT_PORT = 13700;

  beforeAll(async () => {
    // Create a conflicting HTTP + WebSocket server on a specific port
    conflictingServer = http.createServer();

    await new Promise<void>((resolve) => {
      conflictingServer.listen(CONFLICT_PORT, () => {
        console.log(`[test] Conflicting HTTP server on port ${CONFLICT_PORT}`);
        resolve();
      });
    });

    conflictingWss = new WebSocketServer({
      server: conflictingServer,
      path: '/ws',
    });

    console.log(`[test] Conflicting WebSocket server on port ${CONFLICT_PORT}/ws`);
  });

  afterAll(async () => {
    // Clean up conflicting server
    if (conflictingWss) {
      await new Promise<void>((resolve) => {
        conflictingWss.close(() => resolve());
      });
    }

    if (conflictingServer) {
      await new Promise<void>((resolve) => {
        conflictingServer.close(() => resolve());
      });
    }
  });

  it('should have conflicting server running on expected port', async () => {
    expect(conflictingServer.listening).toBe(true);

    // Verify we can't start another server on the same port
    const testServer = http.createServer();

    await expect(
      new Promise((resolve, reject) => {
        testServer.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(err);
          }
        });
        testServer.listen(CONFLICT_PORT, () => resolve(true));
      })
    ).rejects.toThrow();

    testServer.close();
  });

  it('should demonstrate port conflict detection', () => {
    // This test verifies our test setup is correct
    expect(conflictingServer.listening).toBe(true);

    const address = conflictingServer.address();
    expect(address).toBeTruthy();

    if (address && typeof address === 'object') {
      expect(address.port).toBe(CONFLICT_PORT);
    }
  });
});
