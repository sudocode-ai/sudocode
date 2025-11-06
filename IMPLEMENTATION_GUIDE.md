# Implementation Guide: Interactive CLI Execution

This guide provides step-by-step instructions for implementing the Dual-Mode Architecture (Option 1) from the design proposal.

## Prerequisites

- Node.js 18+
- TypeScript 5+
- Existing sudocode codebase

## Phase 1: Backend Foundation

### Step 1.1: Install Dependencies

```bash
# Install node-pty for PTY support
cd server
npm install node-pty @types/node-pty

# Install ws for WebSocket support (likely already installed)
npm install ws @types/ws
```

### Step 1.2: Add Execution Mode Types

Create or update `server/src/execution/process/types.ts`:

```typescript
// Add to existing types.ts

/**
 * Execution mode for CLI tools
 */
export type ExecutionMode = 'structured' | 'interactive' | 'hybrid';

/**
 * Terminal configuration for PTY
 */
export interface TerminalConfig {
  /** Terminal width in columns */
  cols: number;
  /** Terminal height in rows */
  rows: number;
  /** Working directory */
  cwd?: string;
  /** Terminal type (default: xterm-256color) */
  name?: string;
  /** Use shell for execution */
  shell?: boolean;
}

/**
 * Enhanced ProcessConfig with execution mode
 */
export interface ProcessConfig {
  // Existing fields
  executablePath: string;
  args: string[];
  workDir: string;
  env?: Record<string, string>;
  timeout?: number;
  idleTimeout?: number;
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };

  // New fields for execution mode
  mode?: ExecutionMode;
  terminal?: TerminalConfig;
}

/**
 * PTY-specific process interface
 */
export interface ManagedPtyProcess extends Omit<ManagedProcess, 'process' | 'streams'> {
  /** PTY process instance */
  ptyProcess: import('node-pty').IPty;

  /** Write data to PTY */
  write: (data: string) => void;

  /** Resize terminal */
  resize: (cols: number, rows: number) => void;

  /** Listen to PTY output */
  onData: (callback: (data: string) => void) => void;

  /** Listen to PTY exit */
  onExit: (callback: (exitCode: number, signal?: number) => void) => void;
}
```

### Step 1.3: Implement PTY Process Manager

Create `server/src/execution/process/pty-manager.ts`:

```typescript
/**
 * PTY Process Manager
 *
 * Manages processes with pseudo-terminal (PTY) for interactive execution.
 * Enables full terminal interactivity with ANSI support and real-time I/O.
 */

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { IProcessManager } from './manager.js';
import type { ProcessConfig, ManagedPtyProcess, ProcessMetrics } from './types.js';
import { generateId } from './utils.js';

export class PtyProcessManager implements IProcessManager {
  private activeProcesses = new Map<string, ManagedPtyProcess>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();
  private metrics: ProcessMetrics = {
    totalSpawned: 0,
    currentlyActive: 0,
    totalCompleted: 0,
    totalFailed: 0,
    averageDuration: 0,
  };

  async acquireProcess(config: ProcessConfig): Promise<ManagedPtyProcess> {
    const id = generateId('pty');

    // Default terminal config
    const terminalConfig = {
      cols: config.terminal?.cols || 80,
      rows: config.terminal?.rows || 24,
      name: config.terminal?.name || 'xterm-256color',
      cwd: config.workDir,
      env: {
        ...process.env,
        ...config.env,
      },
    };

    // Spawn PTY process
    const ptyProcess = pty.spawn(
      config.executablePath,
      config.args,
      terminalConfig
    );

    // Validate spawn
    if (!ptyProcess.pid) {
      throw new Error('Failed to spawn PTY process: no PID assigned');
    }

    // Create managed process
    const managedProcess: ManagedPtyProcess = {
      id,
      pid: ptyProcess.pid,
      status: 'busy',
      spawnedAt: new Date(),
      lastActivity: new Date(),
      exitCode: null,
      signal: null,
      ptyProcess,
      metrics: {
        totalDuration: 0,
        tasksCompleted: 0,
        successRate: 1.0,
      },

      // PTY-specific methods
      write: (data: string) => {
        ptyProcess.write(data);
        managedProcess.lastActivity = new Date();
      },

      resize: (cols: number, rows: number) => {
        ptyProcess.resize(cols, rows);
      },

      onData: (callback: (data: string) => void) => {
        ptyProcess.onData(callback);
      },

      onExit: (callback: (exitCode: number, signal?: number) => void) => {
        ptyProcess.onExit((e) => callback(e.exitCode, e.signal));
      },
    };

    // Track process
    this.activeProcesses.set(id, managedProcess);

    // Update metrics
    this.metrics.totalSpawned++;
    this.metrics.currentlyActive++;

    // Set up lifecycle handlers
    this.setupProcessHandlers(managedProcess, config);

    return managedProcess;
  }

  private setupProcessHandlers(
    managedProcess: ManagedPtyProcess,
    config: ProcessConfig
  ): void {
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Set up timeout if configured
    if (config.timeout) {
      timeoutHandle = setTimeout(() => {
        if (managedProcess.status === 'busy') {
          this.terminateProcess(managedProcess.id).catch(() => {
            // Ignore timeout termination errors
          });
        }
      }, config.timeout);
    }

    // Track data for activity
    managedProcess.ptyProcess.onData(() => {
      managedProcess.lastActivity = new Date();
    });

    // Handle exit
    managedProcess.ptyProcess.onExit((e) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      managedProcess.exitCode = e.exitCode;
      managedProcess.signal = e.signal;
      managedProcess.status = e.exitCode === 0 ? 'completed' : 'crashed';

      // Calculate duration
      const duration = Date.now() - managedProcess.spawnedAt.getTime();
      managedProcess.metrics.totalDuration = duration;

      // Update metrics
      this.metrics.currentlyActive--;
      if (e.exitCode === 0) {
        this.metrics.totalCompleted++;
      } else {
        this.metrics.totalFailed++;
      }

      // Calculate average duration
      const totalProcesses =
        this.metrics.totalCompleted + this.metrics.totalFailed;
      if (totalProcesses > 0) {
        const currentTotal =
          this.metrics.averageDuration * (totalProcesses - 1);
        this.metrics.averageDuration = (currentTotal + duration) / totalProcesses;
      }

      // Schedule cleanup
      const cleanupTimer = setTimeout(() => {
        this.activeProcesses.delete(managedProcess.id);
        this.cleanupTimers.delete(managedProcess.id);
      }, 5000);
      this.cleanupTimers.set(managedProcess.id, cleanupTimer);
    });
  }

  async releaseProcess(processId: string): Promise<void> {
    await this.terminateProcess(processId);
  }

  async terminateProcess(processId: string): Promise<void> {
    const managed = this.activeProcesses.get(processId);
    if (!managed || managed.exitCode !== null) {
      return;
    }

    managed.status = 'terminating';

    // PTY doesn't have graceful shutdown like regular processes
    // Just kill immediately
    managed.ptyProcess.kill();

    // Wait for exit with timeout
    await Promise.race([
      new Promise<void>((resolve) => {
        if (managed.exitCode !== null) {
          resolve();
        } else {
          managed.ptyProcess.onExit(() => resolve());
        }
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  // Note: PTY doesn't expose sendInput/closeInput like stdio
  // Input is sent via the write() method on ManagedPtyProcess

  async sendInput(processId: string, input: string): Promise<void> {
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }
    managed.write(input);
  }

  // No-op for PTY (can't close input separately)
  closeInput(processId: string): void {
    // PTY input is closed when process terminates
  }

  onOutput(processId: string, handler: (data: Buffer, stream: 'stdout' | 'stderr') => void): void {
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    // PTY combines stdout/stderr, so we only emit stdout
    managed.onData((data) => {
      handler(Buffer.from(data), 'stdout');
    });
  }

  onError(processId: string, handler: (error: Error) => void): void {
    // PTY doesn't have separate error events like ChildProcess
    // Errors are typically communicated through exit codes
    const managed = this.activeProcesses.get(processId);
    if (!managed) {
      throw new Error(`Process ${processId} not found`);
    }

    managed.onExit((exitCode) => {
      if (exitCode !== 0) {
        handler(new Error(`Process exited with code ${exitCode}`));
      }
    });
  }

  getProcess(processId: string): ManagedPtyProcess | null {
    return this.activeProcesses.get(processId) || null;
  }

  getActiveProcesses(): ManagedPtyProcess[] {
    return Array.from(this.activeProcesses.values());
  }

  getMetrics(): ProcessMetrics {
    return { ...this.metrics };
  }

  async shutdown(): Promise<void> {
    // Terminate all active processes
    const processIds = Array.from(this.activeProcesses.keys());
    await Promise.all(processIds.map((id) => this.terminateProcess(id)));

    // Clear all cleanup timers
    for (const [id, timer] of this.cleanupTimers.entries()) {
      clearTimeout(timer);
      this.cleanupTimers.delete(id);
    }
  }
}
```

### Step 1.4: Create Process Manager Factory

Create `server/src/execution/process/factory.ts`:

```typescript
/**
 * Process Manager Factory
 *
 * Creates the appropriate process manager based on execution mode.
 */

import type { IProcessManager } from './manager.js';
import type { ProcessConfig } from './types.js';
import { SimpleProcessManager } from './simple-manager.js';
import { PtyProcessManager } from './pty-manager.js';

/**
 * Create a process manager based on execution mode
 *
 * @param config - Process configuration with mode
 * @returns Appropriate process manager instance
 */
export function createProcessManager(config: ProcessConfig): IProcessManager {
  const mode = config.mode || 'structured';

  switch (mode) {
    case 'interactive':
    case 'hybrid':
      return new PtyProcessManager();

    case 'structured':
    default:
      return new SimpleProcessManager();
  }
}
```

### Step 1.5: Create Terminal Transport

Create `server/src/execution/transport/terminal-transport.ts`:

```typescript
/**
 * Terminal Transport
 *
 * Manages bidirectional communication between WebSocket client and PTY process.
 */

import type { WebSocket } from 'ws';
import type { ManagedPtyProcess } from '../process/types.js';

export interface TerminalMessage {
  type: 'terminal:data' | 'terminal:exit' | 'terminal:input' | 'terminal:resize';
  data?: string;
  exitCode?: number;
  signal?: number;
  cols?: number;
  rows?: number;
}

export class TerminalTransport {
  private ws: WebSocket;
  private process: ManagedPtyProcess;
  private isAlive = true;

  constructor(ws: WebSocket, process: ManagedPtyProcess) {
    this.ws = ws;
    this.process = process;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Forward PTY output to WebSocket
    this.process.onData((data) => {
      if (this.isAlive) {
        this.send({
          type: 'terminal:data',
          data,
        });
      }
    });

    // Handle PTY exit
    this.process.onExit((exitCode, signal) => {
      if (this.isAlive) {
        this.send({
          type: 'terminal:exit',
          exitCode,
          signal,
        });
      }
    });

    // Handle WebSocket messages (input from client)
    this.ws.on('message', (rawMessage) => {
      try {
        const message: TerminalMessage = JSON.parse(rawMessage.toString());
        this.handleClientMessage(message);
      } catch (error) {
        console.error('Failed to parse terminal message:', error);
      }
    });

    // Handle WebSocket close
    this.ws.on('close', () => {
      this.isAlive = false;
      // Optionally: terminate process when client disconnects
      // this.process.ptyProcess.kill();
    });

    // Handle WebSocket error
    this.ws.on('error', (error) => {
      console.error('Terminal WebSocket error:', error);
      this.isAlive = false;
    });
  }

  private handleClientMessage(message: TerminalMessage): void {
    switch (message.type) {
      case 'terminal:input':
        if (message.data) {
          this.process.write(message.data);
        }
        break;

      case 'terminal:resize':
        if (message.cols && message.rows) {
          this.process.resize(message.cols, message.rows);
        }
        break;

      default:
        console.warn('Unknown terminal message type:', message.type);
    }
  }

  private send(message: TerminalMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Close the transport and clean up
   */
  close(): void {
    this.isAlive = false;
    this.ws.close();
  }
}
```

### Step 1.6: Add WebSocket Route

Add to your server's WebSocket router (e.g., `server/src/routes/websocket.ts`):

```typescript
import type { WebSocket } from 'ws';
import { TerminalTransport } from '../execution/transport/terminal-transport.js';
import { PtyProcessManager } from '../execution/process/pty-manager.js';
import { buildClaudeConfig } from '../execution/process/builders/claude.js';

/**
 * Handle terminal WebSocket connection
 */
export async function handleTerminalConnection(
  ws: WebSocket,
  executionId: string,
  db: Database.Database,
  repoPath: string
) {
  try {
    // Get execution details
    const execution = await getExecution(db, executionId);
    if (!execution) {
      ws.close(1008, 'Execution not found');
      return;
    }

    // Verify user owns execution (add your auth logic)
    // if (!verifyUserOwnsExecution(ws, execution)) {
    //   ws.close(1008, 'Unauthorized');
    //   return;
    // }

    // Build process config for interactive mode
    const processConfig = buildClaudeConfig({
      workDir: execution.worktree_path || repoPath,
      mode: 'interactive',
      terminal: {
        cols: 80,
        rows: 24,
      },
    });

    // Create PTY manager and spawn process
    const ptyManager = new PtyProcessManager();
    const ptyProcess = await ptyManager.acquireProcess({
      ...processConfig,
      mode: 'interactive',
    });

    // Create transport to bridge WebSocket and PTY
    const transport = new TerminalTransport(ws, ptyProcess);

    // Clean up on disconnect
    ws.on('close', () => {
      transport.close();
      ptyManager.terminateProcess(ptyProcess.id).catch(console.error);
    });
  } catch (error) {
    console.error('Failed to create terminal:', error);
    ws.close(1011, 'Internal server error');
  }
}

// Register route
// app.ws('/ws/terminal/:executionId', (ws, req) => {
//   const { executionId } = req.params;
//   handleTerminalConnection(ws, executionId, db, repoPath);
// });
```

## Phase 2: Frontend Terminal

### Step 2.1: Install Dependencies

```bash
cd frontend
npm install xterm xterm-addon-fit xterm-addon-web-links
```

### Step 2.2: Create Terminal View Component

Create `frontend/src/components/executions/TerminalView.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';

export interface TerminalViewProps {
  /** Execution ID */
  executionId: string;

  /** WebSocket URL (optional, will be constructed from executionId if not provided) */
  wsUrl?: string;

  /** Read-only mode (no user input) */
  readonly?: boolean;

  /** Custom class name */
  className?: string;
}

export function TerminalView({
  executionId,
  wsUrl: wsUrlProp,
  readonly = false,
  className = '',
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Construct WebSocket URL
    const wsUrl = wsUrlProp || `ws://${window.location.host}/ws/terminal/${executionId}`;

    // Initialize xterm.js
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      convertEol: true,
      disableStdin: readonly,
    });

    // Add addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal
    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Connect to WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      setError(null);
      terminal.write('\r\n\x1b[1;32m[Connected to terminal]\x1b[0m\r\n\r\n');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'terminal:data':
            terminal.write(msg.data);
            break;

          case 'terminal:exit':
            terminal.write(`\r\n\r\n\x1b[1;33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
            setStatus('disconnected');
            break;

          default:
            console.warn('Unknown terminal message type:', msg.type);
        }
      } catch (err) {
        console.error('Failed to parse terminal message:', err);
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      setStatus('error');
      setError('Connection error occurred');
    };

    ws.onclose = () => {
      if (status !== 'disconnected') {
        setStatus('disconnected');
        terminal.write('\r\n\r\n\x1b[1;31m[Connection closed]\x1b[0m\r\n');
      }
    };

    // Send user input to server
    if (!readonly) {
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal:input',
            data,
          }));
        }
      });
    }

    // Handle terminal resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminal:resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }));
      }
    });
    resizeObserver.observe(terminalRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  }, [executionId, wsUrlProp, readonly, status]);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Status indicator */}
      {status === 'connecting' && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>Connecting to terminal...</AlertDescription>
        </Alert>
      )}

      {status === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Failed to connect to terminal'}</AlertDescription>
        </Alert>
      )}

      {/* Terminal */}
      <Card className="p-0 overflow-hidden">
        <div
          ref={terminalRef}
          className="h-full w-full bg-[#1e1e1e] p-2"
          style={{ minHeight: '400px' }}
        />
      </Card>
    </div>
  );
}
```

### Step 2.3: Update Execution Monitor

Enhance `frontend/src/components/executions/ExecutionMonitor.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TerminalView } from './TerminalView';
import { AgentTrajectory } from './AgentTrajectory';
import { Monitor, Terminal } from 'lucide-react';

export function ExecutionMonitor({ executionId, execution }: Props) {
  const [viewMode, setViewMode] = useState<'structured' | 'terminal'>('structured');

  // Determine if terminal is available
  const hasTerminal =
    execution?.execution_mode === 'interactive' ||
    execution?.execution_mode === 'hybrid' ||
    execution?.enable_terminal;

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      {hasTerminal && (
        <Card className="p-2">
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'structured' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('structured')}
            >
              <Monitor className="mr-2 h-4 w-4" />
              Structured View
            </Button>
            <Button
              variant={viewMode === 'terminal' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('terminal')}
            >
              <Terminal className="mr-2 h-4 w-4" />
              Terminal View
            </Button>
          </div>
        </Card>
      )}

      {/* Content */}
      {viewMode === 'terminal' && hasTerminal ? (
        <TerminalView executionId={executionId} />
      ) : (
        <AgentTrajectory
          messages={messages}
          toolCalls={toolCalls}
          state={state}
        />
      )}
    </div>
  );
}
```

## Testing

### Backend Tests

Create `server/tests/execution/process/pty-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PtyProcessManager } from '../../../src/execution/process/pty-manager.js';
import type { ProcessConfig } from '../../../src/execution/process/types.js';

describe('PtyProcessManager', () => {
  let manager: PtyProcessManager;

  beforeEach(() => {
    manager = new PtyProcessManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it('should spawn a PTY process', async () => {
    const config: ProcessConfig = {
      executablePath: 'echo',
      args: ['Hello, World!'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    const process = await manager.acquireProcess(config);

    expect(process).toBeDefined();
    expect(process.pid).toBeGreaterThan(0);
    expect(process.status).toBe('busy');
  });

  it('should receive output from PTY', async () => {
    const config: ProcessConfig = {
      executablePath: 'echo',
      args: ['test'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    const process = await manager.acquireProcess(config);

    const output: string[] = [];
    process.onData((data) => {
      output.push(data);
    });

    // Wait for output
    await new Promise((resolve) => {
      process.onExit(() => resolve(undefined));
    });

    expect(output.join('')).toContain('test');
  });

  it('should handle process termination', async () => {
    const config: ProcessConfig = {
      executablePath: 'sleep',
      args: ['10'],
      workDir: process.cwd(),
      mode: 'interactive',
    };

    const process = await manager.acquireProcess(config);

    // Terminate process
    await manager.terminateProcess(process.id);

    expect(process.exitCode).not.toBeNull();
    expect(process.status).toBe('terminating');
  });
});
```

### Frontend Tests

Create `frontend/tests/components/executions/TerminalView.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TerminalView } from '../../../src/components/executions/TerminalView';

// Mock xterm
vi.mock('xterm', () => ({
  Terminal: vi.fn(() => ({
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24,
    element: document.createElement('div'),
  })),
}));

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('xterm-addon-web-links', () => ({
  WebLinksAddon: vi.fn(),
}));

describe('TerminalView', () => {
  beforeEach(() => {
    // Mock WebSocket
    global.WebSocket = vi.fn(() => ({
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
    })) as any;
  });

  it('should render terminal component', () => {
    render(<TerminalView executionId="test-123" />);

    // Terminal container should be present
    const terminal = screen.getByRole('generic');
    expect(terminal).toBeInTheDocument();
  });

  it('should show connecting status initially', () => {
    render(<TerminalView executionId="test-123" />);

    expect(screen.getByText('Connecting to terminal...')).toBeInTheDocument();
  });
});
```

## Configuration Examples

### Example 1: Start Structured Execution

```typescript
// Current behavior (unchanged)
const execution = await executionService.startExecution('issue-123', {
  mode: 'worktree',
  model: 'claude-sonnet-4',
  timeout: 300000,
  executionMode: 'structured', // explicitly structured
});
```

### Example 2: Start Interactive Execution

```typescript
// New: Interactive mode with terminal
const execution = await executionService.startExecution('issue-123', {
  mode: 'local', // or 'worktree'
  model: 'claude-sonnet-4',
  executionMode: 'interactive',
  enableTerminal: true,
});
```

### Example 3: Start Hybrid Execution

```typescript
// New: Hybrid mode (both structured and terminal)
const execution = await executionService.startExecution('issue-123', {
  mode: 'worktree',
  model: 'claude-sonnet-4',
  executionMode: 'hybrid',
  enableTerminal: true,
  captureMetrics: true,
  captureToolCalls: true,
});
```

## Troubleshooting

### Issue: PTY not spawning

**Symptom**: Error "Failed to spawn PTY process: no PID assigned"

**Solution**:
- Verify `node-pty` is installed correctly
- Check that the executable path is valid
- Ensure working directory exists

### Issue: WebSocket connection fails

**Symptom**: "Connection error occurred" in terminal view

**Solution**:
- Verify WebSocket route is registered
- Check firewall/proxy settings
- Ensure execution exists and user has access

### Issue: Terminal not rendering

**Symptom**: Blank terminal component

**Solution**:
- Import `xterm/css/xterm.css` in component
- Check browser console for errors
- Verify xterm.js is properly installed

## Next Steps

1. **Phase 3**: Integrate with execution service
2. **Phase 4**: Add execution config dialog enhancements
3. **Phase 5**: Implement hybrid mode with output parsing
4. **Phase 6**: Add support for Cursor CLI and other tools

See `DESIGN_PROPOSAL_CLI_EXECUTION.md` for full roadmap.
