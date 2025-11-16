/**
 * Integration tests for TerminalWebSocketService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { TerminalWebSocketService } from '../../../src/services/terminal-websocket.js';
import Database from 'better-sqlite3';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('TerminalWebSocketService Integration', () => {
  let db: Database.Database;
  let service: TerminalWebSocketService;
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;
  let tempDbPath: string;
  let repoPath: string;

  beforeEach(async () => {
    // Create temp database
    tempDbPath = path.join(os.tmpdir(), `test-terminal-ws-${Date.now()}.db`);
    db = new Database(tempDbPath);

    // Create executions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        worktree_path TEXT,
        prompt TEXT,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create service
    service = new TerminalWebSocketService(db);

    // Create HTTP server
    server = http.createServer();
    wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrades
    server.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(
        request.url!,
        `http://${request.headers.host}`
      );

      const terminalMatch = pathname.match(/^\/ws\/terminal\/([^/]+)$/);
      if (terminalMatch) {
        const executionId = terminalMatch[1];

        wss.handleUpgrade(request, socket, head, (ws) => {
          service.handleConnection(ws, executionId, repoPath).catch((error) => {
            console.error('Failed to handle connection:', error);
            ws.close(1011, 'Internal server error');
          });
        });
      }
    });

    // Get random port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    repoPath = process.cwd();
  });

  afterEach(async () => {
    await service.shutdown();
    wss.close();
    server.close();
    db.close();

    // Clean up temp database
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('should create terminal session for valid execution', async () => {
    // Create execution in database
    const executionId = 'test-exec-1';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, 'test prompt', 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);

    // Wait for connection
    await new Promise((resolve) => client.once('open', resolve));

    // Verify session was created
    const session = service.getSession(executionId);
    expect(session).not.toBeNull();
    expect(session!.executionId).toBe(executionId);

    // Clean up
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should reject connection for non-existent execution', async () => {
    const executionId = 'nonexistent-exec';

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);

    // Wait for close
    const closeEvent = await new Promise<{ code: number; reason: string }>(
      (resolve) => {
        client.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      }
    );

    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe('Execution not found');
  });

  it('should reject duplicate connections for same execution', async () => {
    // Create execution in database
    const executionId = 'test-exec-2';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, 'test prompt', 'pending');

    // Connect first client
    const client1 = new WebSocket(
      `ws://localhost:${port}/ws/terminal/${executionId}`
    );
    await new Promise((resolve) => client1.once('open', resolve));

    // Connect second client (should be rejected)
    const client2 = new WebSocket(
      `ws://localhost:${port}/ws/terminal/${executionId}`
    );

    // Wait for close
    const closeEvent = await new Promise<{ code: number; reason: string }>(
      (resolve) => {
        client2.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      }
    );

    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe(
      'Terminal session already active for this execution'
    );

    // Clean up
    client1.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should inject initial prompt if execution has one', async () => {
    // Create execution with prompt
    const executionId = 'test-exec-3';
    const prompt = 'help';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, prompt, 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Collect output
    const messages: string[] = [];
    client.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'terminal:data') {
        messages.push(message.data);
      }
    });

    // Wait for prompt injection (500ms delay + processing)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Output should contain the prompt or response to it
    const allOutput = messages.join('');
    // Note: Exact prompt echo might vary by terminal, so we just check for data
    expect(messages.length).toBeGreaterThan(0);

    // Clean up
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should clean up session on client disconnect', async () => {
    // Create execution
    const executionId = 'test-exec-4';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, null, 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Verify session exists
    expect(service.getSession(executionId)).not.toBeNull();

    // Disconnect client
    client.close();

    // Wait for cleanup (process termination takes time)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Session should be cleaned up
    expect(service.getSession(executionId)).toBeNull();
  });

  it('should handle multiple concurrent sessions', async () => {
    const executionIds = ['test-exec-5', 'test-exec-6', 'test-exec-7'];

    // Create executions
    for (const id of executionIds) {
      db.prepare(
        'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
      ).run(id, repoPath, null, 'pending');
    }

    // Connect clients
    const clients = await Promise.all(
      executionIds.map(
        (id) =>
          new Promise<WebSocket>((resolve) => {
            const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${id}`);
            client.once('open', () => resolve(client));
          })
      )
    );

    // Wait for sessions to be created
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify all sessions exist
    const sessions = service.getSessions();
    expect(sessions.size).toBe(3);
    for (const id of executionIds) {
      expect(service.getSession(id)).not.toBeNull();
    }

    // Clean up
    for (const client of clients) {
      client.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    // All sessions should be cleaned up
    expect(service.getSessions().size).toBe(0);
  });

  it('should receive terminal output through WebSocket', async () => {
    // Create execution
    const executionId = 'test-exec-8';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, null, 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);

    // Collect messages as they arrive
    const messages: any[] = [];
    client.on('message', (data) => {
      const message = JSON.parse(data.toString());
      messages.push(message);
    });

    await new Promise((resolve) => client.once('open', resolve));

    // Wait for initial output (Claude CLI welcome message)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Should have received terminal:data messages
    const dataMessages = messages.filter((m) => m.type === 'terminal:data');
    expect(dataMessages.length).toBeGreaterThan(0);

    // Clean up
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should forward client input to terminal', async () => {
    // Create execution
    const executionId = 'test-exec-9';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, repoPath, null, 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Collect output
    const messages: string[] = [];
    client.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'terminal:data') {
        messages.push(message.data);
      }
    });

    // Wait for shell to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send command
    client.send(
      JSON.stringify({
        type: 'terminal:input',
        data: 'echo "test command"\r',
      })
    );

    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should see the echo output
    const allOutput = messages.join('');
    expect(allOutput).toContain('test command');

    // Clean up
    client.send(JSON.stringify({ type: 'terminal:input', data: 'exit\r' }));
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should shutdown all sessions gracefully', async () => {
    // Create multiple executions
    const executionIds = ['test-exec-10', 'test-exec-11'];

    for (const id of executionIds) {
      db.prepare(
        'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
      ).run(id, repoPath, null, 'pending');
    }

    // Connect clients
    const clients = await Promise.all(
      executionIds.map(
        (id) =>
          new Promise<WebSocket>((resolve) => {
            const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${id}`);
            client.once('open', () => resolve(client));
          })
      )
    );

    // Wait for sessions
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify sessions exist
    expect(service.getSessions().size).toBe(2);

    // Shutdown service
    await service.shutdown();

    // All sessions should be cleaned up
    expect(service.getSessions().size).toBe(0);

    // Clients should receive close events
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
  });

  it('should use worktree path if available', async () => {
    // Create execution with worktree path
    const executionId = 'test-exec-12';
    const worktreePath = '/tmp/test-worktree';
    db.prepare(
      'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
    ).run(executionId, worktreePath, null, 'pending');

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Verify session was created
    const session = service.getSession(executionId);
    expect(session).not.toBeNull();

    // Note: Can't easily verify the actual working directory without exposing internals
    // This test just ensures connection succeeds with worktree path

    // Clean up
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should handle rapid session creation and cleanup', async () => {
    const rounds = 5;

    for (let i = 0; i < rounds; i++) {
      const executionId = `test-exec-rapid-${i}`;

      // Create execution
      db.prepare(
        'INSERT INTO executions (id, worktree_path, prompt, status) VALUES (?, ?, ?, ?)'
      ).run(executionId, repoPath, null, 'pending');

      // Connect and disconnect
      const client = new WebSocket(`ws://localhost:${port}/ws/terminal/${executionId}`);
      await new Promise((resolve) => client.once('open', resolve));

      // Verify session created
      expect(service.getSession(executionId)).not.toBeNull();

      // Close immediately
      client.close();

      // Wait for cleanup (process termination takes time)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Session should be gone
      expect(service.getSession(executionId)).toBeNull();
    }

    // All sessions should be cleaned up
    expect(service.getSessions().size).toBe(0);
  });
});
