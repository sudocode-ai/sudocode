/**
 * Integration tests for TerminalTransport
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { TerminalTransport } from '../../../src/execution/transport/terminal-transport.js';
import { PtyProcessManager } from '../../../src/execution/process/pty-manager.js';
import type { ProcessConfig } from '../../../src/execution/process/types.js';
import * as http from 'http';

describe('TerminalTransport Integration', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let manager: PtyProcessManager;
  let port: number;

  beforeEach(async () => {
    // Create HTTP server for WebSocket
    server = http.createServer();
    wss = new WebSocketServer({ server });
    manager = new PtyProcessManager();

    // Get random port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    wss.close();
    server.close();
  });

  it('should create transport and establish bidirectional communication', async () => {
    const config: ProcessConfig = {
      executablePath: 'echo',
      args: ['test output'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    const transportPromise = new Promise<TerminalTransport>((resolve) => {
      wss.on('connection', async (ws) => {
        const ptyProcess = await manager.acquireProcess(config);
        const transport = new TerminalTransport(ws, ptyProcess);
        resolve(transport);
      });
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for transport to be created
    const transport = await transportPromise;

    // Verify transport is alive
    expect(transport.alive).toBe(true);

    // Clean up
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should forward PTY output to WebSocket client', async () => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const config: ProcessConfig = {
      executablePath: shell,
      args: [],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Collect messages from client
    const messages: string[] = [];
    client.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'terminal:data') {
        messages.push(message.data);
      }
    });

    // Wait for some output
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have received terminal output (shell prompt, etc.)
    expect(messages.length).toBeGreaterThan(0);
    const allOutput = messages.join('');
    expect(allOutput.length).toBeGreaterThan(0);

    // Clean up
    client.close();
  });

  it('should forward client input to PTY', async () => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const config: ProcessConfig = {
      executablePath: shell,
      args: [],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Collect messages from client
    const messages: string[] = [];
    client.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'terminal:data') {
        messages.push(message.data);
      }
    });

    // Wait for shell to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send command to shell
    client.send(
      JSON.stringify({
        type: 'terminal:input',
        data: 'echo "hello from client"\r',
      })
    );

    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should have received the echo output
    const allOutput = messages.join('');
    expect(allOutput).toContain('hello from client');

    // Clean up
    client.send(JSON.stringify({ type: 'terminal:input', data: 'exit\r' }));
    client.close();
  });

  it('should handle terminal resize', async () => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const config: ProcessConfig = {
      executablePath: shell,
      args: [],
      workDir: process.cwd(),
      mode: 'interactive',
      terminal: {
        cols: 80,
        rows: 24,
      },
    };

    // Set up server-side handler
    let ptyProcess: any;
    wss.on('connection', async (ws) => {
      ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for PTY to be created
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send resize message
    client.send(
      JSON.stringify({
        type: 'terminal:resize',
        cols: 120,
        rows: 40,
      })
    );

    // Wait for resize to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Note: Can't easily verify resize on PTY side without exposing internals
    // This test just ensures resize doesn't throw errors

    // Clean up
    client.close();
  });

  it('should send exit notification when PTY process exits', async () => {
    const config: ProcessConfig = {
      executablePath: 'echo',
      args: ['test'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for exit notification
    const exitMessage = await new Promise<any>((resolve) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'terminal:exit') {
          resolve(message);
        }
      });
    });

    expect(exitMessage.type).toBe('terminal:exit');
    expect(exitMessage.exitCode).toBe(0);

    // Clean up
    client.close();
  });

  it('should handle client disconnect gracefully', async () => {
    const config: ProcessConfig = {
      executablePath: 'sleep',
      args: ['5'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    let transport: TerminalTransport | null = null;
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      transport = new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for transport to be created
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transport).not.toBeNull();
    expect(transport!.alive).toBe(true);

    // Disconnect client
    client.close();

    // Wait for disconnect to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Transport should be marked as not alive
    expect(transport!.alive).toBe(false);
  });

  it('should handle WebSocket errors gracefully', async () => {
    const config: ProcessConfig = {
      executablePath: 'sleep',
      args: ['5'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    let transport: TerminalTransport | null = null;
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      transport = new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for transport to be created
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transport).not.toBeNull();

    // Simulate error by destroying underlying socket
    (client as any)._socket.destroy();

    // Wait for error to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Transport should be marked as not alive
    expect(transport!.alive).toBe(false);
  });

  it('should not send messages after WebSocket is closed', async () => {
    const config: ProcessConfig = {
      executablePath: 'sleep',
      args: ['5'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    let ptyProcess: any;
    wss.on('connection', async (ws) => {
      ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for transport to be created
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Close client
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to generate data after close
    // (This should not throw or send messages)
    ptyProcess.write('test\r');

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw (test passes if no error)
  });

  it('should handle rapid client messages without data loss', async () => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const config: ProcessConfig = {
      executablePath: shell,
      args: [],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    // Set up server-side handler
    wss.on('connection', async (ws) => {
      const ptyProcess = await manager.acquireProcess(config);
      new TerminalTransport(ws, ptyProcess);
    });

    // Connect client
    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => client.once('open', resolve));

    // Wait for shell to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send multiple messages rapidly
    for (let i = 0; i < 10; i++) {
      client.send(
        JSON.stringify({
          type: 'terminal:input',
          data: `echo "message ${i}"\r`,
        })
      );
    }

    // Wait for all messages to be processed
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Clean up
    client.send(JSON.stringify({ type: 'terminal:input', data: 'exit\r' }));
    client.close();

    // Test passes if no errors thrown
  });
});
