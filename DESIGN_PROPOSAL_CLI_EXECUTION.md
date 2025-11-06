# Design Proposal: Interactive CLI Execution Support

## Executive Summary

This proposal outlines designs for adding **interactive CLI execution** support to sudocode, enabling real-time terminal interaction with Claude Code, Cursor CLI, OpenAI Codex CLI, and other AI coding tools. The designs maintain backward compatibility with the current structured JSON mode while adding a new interactive mode with terminal visibility.

## Current Architecture Analysis

### Current Implementation (Structured Mode)
- **Execution Method**: Claude CLI via `spawn()` with `--print --output-format stream-json --verbose`
- **Communication**: Non-interactive, prompt sent via stdin
- **Output Processing**: Line-by-line JSON parsing via `ClaudeCodeOutputProcessor`
- **UI Display**: AG-UI components (messages, tool calls, metrics)
- **Strengths**:
  - Structured, parseable output
  - Real-time streaming
  - Rich metadata (tokens, costs, tool calls)
  - Automated workflow orchestration

### Gaps for Interactive Mode
1. **No PTY/Terminal Emulation**: Current implementation uses `stdio: ['pipe', 'pipe', 'pipe']`
2. **No Terminal UI**: No frontend terminal emulator component
3. **No User Input During Execution**: Non-interactive mode only
4. **Limited Visibility**: Users can't see raw CLI output

---

## Design Options

### Option 1: Dual-Mode Architecture (Recommended)

**Overview**: Support both structured and interactive modes, configurable per execution.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Execution Service                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           ExecutionMode Configuration                │  │
│  │  - structured: Current JSON mode                     │  │
│  │  - interactive: New terminal mode                    │  │
│  │  - hybrid: Both (terminal + structured parsing)      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌──────────────────────────────────────┐
        │      Process Manager Factory         │
        └──────────────────────────────────────┘
                ↓                      ↓
    ┌──────────────────┐    ┌──────────────────────┐
    │  StdioProcess    │    │   PtyProcess         │
    │  Manager         │    │   Manager            │
    │  (Current)       │    │   (New)              │
    └──────────────────┘    └──────────────────────┘
            ↓                          ↓
    ┌──────────────────┐    ┌──────────────────────┐
    │  JSON Output     │    │   Terminal           │
    │  Processor       │    │   Stream             │
    └──────────────────┘    └──────────────────────┘
            ↓                          ↓
    ┌──────────────────┐    ┌──────────────────────┐
    │  AG-UI           │    │   Xterm.js           │
    │  Components      │    │   Terminal           │
    └──────────────────┘    └──────────────────────┘
```

#### Backend Implementation

**1. Execution Mode Configuration**

```typescript
// server/src/execution/process/types.ts

export type ExecutionMode = 'structured' | 'interactive' | 'hybrid';

export interface ProcessConfig {
  executablePath: string;
  args: string[];
  workDir: string;
  env?: Record<string, string>;
  timeout?: number;

  // New: Execution mode
  mode?: ExecutionMode;

  // New: Terminal configuration (for interactive mode)
  terminal?: {
    rows?: number;
    cols?: number;
    cwd?: string;
    shell?: boolean;
  };
}
```

**2. PTY Process Manager**

```typescript
// server/src/execution/process/pty-manager.ts

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { IProcessManager, ManagedProcess } from './types.js';

export class PtyProcessManager implements IProcessManager {
  private activeProcesses = new Map<string, ManagedPtyProcess>();

  async acquireProcess(config: ProcessConfig): Promise<ManagedPtyProcess> {
    const ptyProcess = pty.spawn(
      config.executablePath,
      config.args,
      {
        name: 'xterm-256color',
        cols: config.terminal?.cols || 80,
        rows: config.terminal?.rows || 24,
        cwd: config.workDir,
        env: { ...process.env, ...config.env },
      }
    );

    const managedProcess: ManagedPtyProcess = {
      id: generateId('pty'),
      pid: ptyProcess.pid,
      status: 'busy',
      spawnedAt: new Date(),
      lastActivity: new Date(),
      ptyProcess,
      // Expose terminal I/O methods
      write: (data: string) => ptyProcess.write(data),
      resize: (cols: number, rows: number) => ptyProcess.resize(cols, rows),
      onData: (callback: (data: string) => void) => {
        ptyProcess.onData(callback);
      },
      onExit: (callback: (code: number, signal?: number) => void) => {
        ptyProcess.onExit(callback);
      },
    };

    this.activeProcesses.set(managedProcess.id, managedProcess);
    return managedProcess;
  }

  // ... other IProcessManager methods
}
```

**3. Process Manager Factory**

```typescript
// server/src/execution/process/factory.ts

export function createProcessManager(
  config: ProcessConfig
): IProcessManager {
  switch (config.mode) {
    case 'interactive':
    case 'hybrid':
      return new PtyProcessManager();
    case 'structured':
    default:
      return new SimpleProcessManager();
  }
}
```

**4. Terminal Transport (WebSocket)**

```typescript
// server/src/execution/transport/terminal-transport.ts

import type { WebSocket } from 'ws';
import type { ManagedPtyProcess } from '../process/pty-manager.js';

export class TerminalTransport {
  private ws: WebSocket;
  private process: ManagedPtyProcess;

  constructor(ws: WebSocket, process: ManagedPtyProcess) {
    this.ws = ws;
    this.process = process;
    this.setupHandlers();
  }

  private setupHandlers() {
    // Forward terminal output to WebSocket
    this.process.onData((data) => {
      this.ws.send(JSON.stringify({
        type: 'terminal:data',
        data,
      }));
    });

    // Handle terminal input from WebSocket
    this.ws.on('message', (message) => {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'terminal:input':
          this.process.write(msg.data);
          break;
        case 'terminal:resize':
          this.process.resize(msg.cols, msg.rows);
          break;
      }
    });

    // Handle process exit
    this.process.onExit((code, signal) => {
      this.ws.send(JSON.stringify({
        type: 'terminal:exit',
        exitCode: code,
        signal,
      }));
    });
  }
}
```

**5. Enhanced Execution Service**

```typescript
// server/src/services/execution-service.ts

export interface ExecutionConfig {
  // ... existing fields

  // New: Execution mode
  executionMode?: 'structured' | 'interactive' | 'hybrid';

  // New: Enable terminal UI
  enableTerminal?: boolean;
}

export class ExecutionService {
  async startExecution(
    executionId: string,
    config: ExecutionConfig
  ): Promise<void> {
    // Determine execution mode
    const mode = config.executionMode || 'structured';

    // Build process config based on mode
    const processConfig = this.buildProcessConfig(config, mode);

    // Create appropriate process manager
    const processManager = createProcessManager(processConfig);

    // Start execution
    const process = await processManager.acquireProcess(processConfig);

    // Set up transport based on mode
    if (mode === 'interactive' || config.enableTerminal) {
      // Create WebSocket transport for terminal
      const transport = new TerminalTransport(ws, process);
      this.terminalTransports.set(executionId, transport);
    }

    // ... rest of execution logic
  }

  private buildProcessConfig(
    config: ExecutionConfig,
    mode: ExecutionMode
  ): ProcessConfig {
    const baseConfig = buildClaudeConfig({
      workDir: config.workDir,
      // ... other config
    });

    // Adjust args based on mode
    if (mode === 'interactive') {
      // Remove --print, --output-format flags for interactive mode
      baseConfig.args = baseConfig.args.filter(
        arg => !['--print', '--output-format', 'stream-json'].includes(arg)
      );
    }

    return {
      ...baseConfig,
      mode,
      terminal: mode === 'interactive' ? {
        rows: 24,
        cols: 80,
      } : undefined,
    };
  }
}
```

#### Frontend Implementation

**1. Terminal Component**

```typescript
// frontend/src/components/executions/TerminalView.tsx

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

export interface TerminalViewProps {
  executionId: string;
  wsUrl: string;
  readonly?: boolean;
}

export function TerminalView({
  executionId,
  wsUrl,
  readonly = false
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
      convertEol: true,
      disableStdin: readonly,
    });

    // Add fit addon for responsive sizing
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Add web links addon for clickable URLs
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
      console.log('Terminal WebSocket connected');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'terminal:data':
          terminal.write(msg.data);
          break;
        case 'terminal:exit':
          terminal.write(`\r\n\r\n[Process exited with code ${msg.exitCode}]\r\n`);
          break;
      }
    };

    // Send user input to backend
    if (!readonly) {
      terminal.onData((data) => {
        ws.send(JSON.stringify({
          type: 'terminal:input',
          data,
        }));
      });
    }

    // Handle terminal resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      ws.send(JSON.stringify({
        type: 'terminal:resize',
        cols: terminal.cols,
        rows: terminal.rows,
      }));
    });
    resizeObserver.observe(terminalRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  }, [executionId, wsUrl, readonly]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#1e1e1e] p-2"
      style={{ minHeight: '400px' }}
    />
  );
}
```

**2. Enhanced Execution Monitor with Mode Switching**

```typescript
// frontend/src/components/executions/ExecutionMonitor.tsx (enhanced)

export function ExecutionMonitor({ executionId, execution }: Props) {
  const [viewMode, setViewMode] = useState<'structured' | 'terminal'>('structured');

  // Determine if terminal mode is available
  const hasTerminal = execution?.execution_mode === 'interactive'
    || execution?.execution_mode === 'hybrid'
    || execution?.enable_terminal;

  return (
    <Card>
      {/* Mode Switcher */}
      {hasTerminal && (
        <div className="flex gap-2 p-2 border-b">
          <Button
            variant={viewMode === 'structured' ? 'default' : 'outline'}
            onClick={() => setViewMode('structured')}
          >
            Structured View
          </Button>
          <Button
            variant={viewMode === 'terminal' ? 'default' : 'outline'}
            onClick={() => setViewMode('terminal')}
          >
            Terminal View
          </Button>
        </div>
      )}

      {/* Content */}
      {viewMode === 'terminal' && hasTerminal ? (
        <TerminalView
          executionId={executionId}
          wsUrl={`ws://localhost:3001/ws/terminal/${executionId}`}
        />
      ) : (
        <AgentTrajectory messages={messages} toolCalls={toolCalls} />
      )}
    </Card>
  );
}
```

**3. Updated Execution Config Dialog**

```typescript
// frontend/src/components/executions/ExecutionConfigDialog.tsx (enhanced)

export function ExecutionConfigDialog({ onSubmit }: Props) {
  const [executionMode, setExecutionMode] = useState<'structured' | 'interactive'>('structured');

  return (
    <Dialog>
      <form onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          // ... existing fields
          executionMode,
          enableTerminal: executionMode === 'interactive',
        });
      }}>
        {/* Execution Mode Selector */}
        <div className="space-y-2">
          <Label>Execution Mode</Label>
          <Select value={executionMode} onValueChange={setExecutionMode}>
            <SelectItem value="structured">
              Structured (JSON) - Automated workflows
            </SelectItem>
            <SelectItem value="interactive">
              Interactive (Terminal) - Manual control
            </SelectItem>
          </Select>
          <p className="text-sm text-muted-foreground">
            {executionMode === 'structured'
              ? 'Structured mode provides automated workflow orchestration with parsed output.'
              : 'Interactive mode provides terminal access for manual interaction with Claude Code.'}
          </p>
        </div>

        {/* ... rest of form */}
      </form>
    </Dialog>
  );
}
```

#### Dependencies

**Backend** (add to `server/package.json`):
```json
{
  "dependencies": {
    "node-pty": "^1.0.0"
  }
}
```

**Frontend** (add to `frontend/package.json`):
```json
{
  "dependencies": {
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0",
    "xterm-addon-web-links": "^0.9.0"
  }
}
```

#### Migration Path

1. **Phase 1**: Add PTY infrastructure (backend only)
2. **Phase 2**: Add terminal UI components (frontend)
3. **Phase 3**: Integrate with execution service
4. **Phase 4**: Add mode switching UI
5. **Phase 5**: User testing and refinement

#### Pros & Cons

**Pros**:
- ✅ Preserves existing functionality
- ✅ Users can choose mode per execution
- ✅ Full terminal interactivity
- ✅ Backward compatible
- ✅ Clear separation of concerns

**Cons**:
- ⚠️ More complex architecture
- ⚠️ Requires maintaining two code paths
- ⚠️ Additional dependencies (node-pty, xterm.js)

---

### Option 2: Terminal-First with Optional Parsing

**Overview**: Default to terminal mode, optionally parse output in background.

#### Key Differences from Option 1

- **Default Mode**: Terminal/interactive by default
- **Parsing**: Optional background parsing of terminal output
- **UI**: Terminal is primary view, structured view is secondary

#### Architecture

```
┌────────────────────────────────────────┐
│     PTY Process (Primary)              │
│     ┌──────────────────────┐           │
│     │  Terminal Stream     │           │
│     └──────────────────────┘           │
│              ↓          ↓               │
│     ┌────────────┐   ┌──────────────┐  │
│     │  WebSocket │   │  Optional    │  │
│     │  (Terminal)│   │  Parser      │  │
│     └────────────┘   └──────────────┘  │
└────────────────────────────────────────┘
         ↓                    ↓
    ┌─────────┐        ┌──────────────┐
    │ Xterm.js│        │ Structured   │
    │         │        │ Data Extract │
    └─────────┘        └──────────────┘
```

#### Implementation Highlights

**1. Terminal Output Parser**

```typescript
// server/src/execution/output/terminal-parser.ts

export class TerminalOutputParser {
  private buffer = '';
  private ansiRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;

  /**
   * Extract structured data from terminal output
   * Looks for JSON messages in terminal stream
   */
  parseOutput(data: string): {
    rawOutput: string;
    structuredData?: any;
  } {
    this.buffer += data;

    // Try to extract JSON from output
    // Claude Code may still emit JSON alongside terminal output
    const jsonMatch = this.buffer.match(/\{.*"type".*\}/);

    if (jsonMatch) {
      try {
        const structuredData = JSON.parse(jsonMatch[0]);
        // Remove JSON from buffer
        this.buffer = this.buffer.replace(jsonMatch[0], '');

        return {
          rawOutput: data,
          structuredData,
        };
      } catch {
        // Not valid JSON, just raw output
      }
    }

    return { rawOutput: data };
  }

  /**
   * Strip ANSI escape codes for structured analysis
   */
  stripAnsi(text: string): string {
    return text.replace(this.ansiRegex, '');
  }
}
```

**2. Hybrid Transport**

```typescript
// server/src/execution/transport/hybrid-transport.ts

export class HybridTransport {
  private terminalTransport: TerminalTransport;
  private parser: TerminalOutputParser;
  private structuredListeners: ((data: any) => void)[] = [];

  constructor(ws: WebSocket, process: ManagedPtyProcess) {
    this.parser = new TerminalOutputParser();

    // Wrap terminal transport to intercept output
    this.terminalTransport = new TerminalTransport(ws, process);

    // Parse terminal output for structured data
    process.onData((data) => {
      const { rawOutput, structuredData } = this.parser.parseOutput(data);

      if (structuredData) {
        // Emit structured data to listeners
        this.structuredListeners.forEach(listener => {
          listener(structuredData);
        });
      }
    });
  }

  onStructuredData(listener: (data: any) => void) {
    this.structuredListeners.push(listener);
  }
}
```

#### Pros & Cons

**Pros**:
- ✅ Simpler architecture (one primary code path)
- ✅ Terminal-first matches user expectation
- ✅ Can still extract structured data
- ✅ Less maintenance overhead

**Cons**:
- ⚠️ Structured data extraction less reliable
- ⚠️ May miss some metadata
- ⚠️ Harder to automate workflows

---

### Option 3: Sidecar Terminal (Minimal Change)

**Overview**: Keep current structured execution, add optional terminal sidecar.

#### Architecture

```
┌─────────────────────────────────────────┐
│   Primary: Structured Execution         │
│   (Current Implementation)              │
│                                         │
│   StdioProcess → JSON Parser → AG-UI   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   Optional: Terminal Sidecar            │
│   (Separate PTY process)                │
│                                         │
│   PtyProcess → WebSocket → Xterm.js    │
└─────────────────────────────────────────┘
```

#### Key Features

- **Two Separate Processes**: Main execution uses structured mode, optional terminal provides interactive access
- **User Control**: Users can open terminal when needed
- **Shared Context**: Both processes work in same worktree
- **Minimal Changes**: Adds feature without modifying existing system

#### Implementation

**1. Terminal Sidecar Service**

```typescript
// server/src/services/terminal-sidecar-service.ts

export class TerminalSidecarService {
  private sidecars = new Map<string, PtyProcess>();

  /**
   * Open a terminal sidecar for an execution
   * Runs in the same worktree as the execution
   */
  async openSidecar(executionId: string): Promise<{
    terminalId: string;
    wsUrl: string;
  }> {
    const execution = await this.getExecution(executionId);

    // Spawn Claude Code in interactive mode in the execution's worktree
    const ptyProcess = pty.spawn('claude', [], {
      cwd: execution.worktree_path || this.repoPath,
      env: process.env,
      rows: 24,
      cols: 80,
    });

    const terminalId = generateId('terminal');
    this.sidecars.set(terminalId, ptyProcess);

    return {
      terminalId,
      wsUrl: `/ws/terminal/${terminalId}`,
    };
  }

  /**
   * Close a terminal sidecar
   */
  async closeSidecar(terminalId: string): Promise<void> {
    const ptyProcess = this.sidecars.get(terminalId);
    if (ptyProcess) {
      ptyProcess.kill();
      this.sidecars.delete(terminalId);
    }
  }
}
```

**2. UI: Terminal Sidecar Button**

```typescript
// frontend/src/components/executions/ExecutionView.tsx (enhanced)

export function ExecutionView({ executionId }: Props) {
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalUrl, setTerminalUrl] = useState<string | null>(null);

  const handleOpenTerminal = async () => {
    try {
      const response = await executionsApi.openTerminalSidecar(executionId);
      setTerminalUrl(response.wsUrl);
      setShowTerminal(true);
    } catch (err) {
      console.error('Failed to open terminal:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Execution header with terminal button */}
      <Card className="p-6">
        <div className="flex justify-between">
          <h2>Execution {executionId}</h2>
          <Button onClick={handleOpenTerminal}>
            <Terminal className="mr-2 h-4 w-4" />
            Open Terminal
          </Button>
        </div>
      </Card>

      {/* Main execution monitor (structured view) */}
      <ExecutionMonitor executionId={executionId} />

      {/* Terminal sidecar (resizable panel) */}
      {showTerminal && terminalUrl && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b p-2">
            <span className="font-medium">Interactive Terminal</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTerminal(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <TerminalView wsUrl={terminalUrl} />
        </Card>
      )}
    </div>
  );
}
```

#### Pros & Cons

**Pros**:
- ✅ Minimal changes to existing system
- ✅ Both modes available simultaneously
- ✅ Users choose when to use terminal
- ✅ Low risk

**Cons**:
- ⚠️ Two separate processes (more resource usage)
- ⚠️ Context not shared between processes
- ⚠️ Confusing UX (two "executions")

---

## Extensibility to Other CLI Tools

### Generic CLI Tool Configuration

```typescript
// server/src/execution/process/builders/generic-cli.ts

export interface CLIToolConfig {
  /** Tool identifier (claude, cursor, codex, etc.) */
  tool: 'claude' | 'cursor' | 'codex' | 'custom';

  /** Custom executable path (for 'custom' tool) */
  customPath?: string;

  /** Working directory */
  workDir: string;

  /** Execution mode */
  mode: 'structured' | 'interactive';

  /** Tool-specific args */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;
}

export function buildCLIConfig(config: CLIToolConfig): ProcessConfig {
  switch (config.tool) {
    case 'claude':
      return buildClaudeConfig(config);
    case 'cursor':
      return buildCursorConfig(config);
    case 'codex':
      return buildCodexConfig(config);
    case 'custom':
      return buildCustomConfig(config);
  }
}

function buildCursorConfig(config: CLIToolConfig): ProcessConfig {
  const args: string[] = [];

  if (config.mode === 'structured') {
    // Cursor CLI might have different flags
    args.push('--json-output');
  }

  return {
    executablePath: 'cursor-cli',
    args: [...args, ...(config.args || [])],
    workDir: config.workDir,
    env: config.env,
    mode: config.mode,
  };
}

function buildCodexConfig(config: CLIToolConfig): ProcessConfig {
  const args: string[] = [];

  if (config.mode === 'structured') {
    // OpenAI Codex CLI flags
    args.push('--format', 'json');
  }

  return {
    executablePath: 'codex',
    args: [...args, ...(config.args || [])],
    workDir: config.workDir,
    env: config.env,
    mode: config.mode,
  };
}
```

### Tool-Specific Output Processors

```typescript
// server/src/execution/output/processor-factory.ts

export function createOutputProcessor(
  tool: string,
  mode: ExecutionMode
): IOutputProcessor {
  if (mode === 'interactive') {
    // Terminal mode doesn't need specific parser
    return new TerminalOutputProcessor();
  }

  // Structured mode: tool-specific parsers
  switch (tool) {
    case 'claude':
      return new ClaudeCodeOutputProcessor();
    case 'cursor':
      return new CursorOutputProcessor();
    case 'codex':
      return new CodexOutputProcessor();
    default:
      return new GenericJSONProcessor();
  }
}
```

---

## Recommendation

**Option 1 (Dual-Mode Architecture)** is recommended because it:

1. **Preserves Current Value**: Keeps structured mode for automation
2. **Adds Flexibility**: Enables interactive use cases
3. **Extensible**: Clean abstraction for other tools
4. **User Choice**: Users pick mode per execution
5. **Future-Proof**: Can add hybrid mode later

### Implementation Roadmap

#### Phase 1: Backend Foundation (2-3 days)
- [ ] Add `node-pty` dependency
- [ ] Implement `PtyProcessManager`
- [ ] Add execution mode configuration
- [ ] Create process manager factory
- [ ] Add WebSocket transport for terminal

#### Phase 2: Frontend Terminal (2-3 days)
- [ ] Add `xterm.js` dependencies
- [ ] Implement `TerminalView` component
- [ ] Add WebSocket connection logic
- [ ] Add terminal resize handling
- [ ] Style terminal component

#### Phase 3: Integration (2-3 days)
- [ ] Integrate with `ExecutionService`
- [ ] Add mode selection to `ExecutionConfigDialog`
- [ ] Enhance `ExecutionMonitor` with mode switching
- [ ] Add REST/WebSocket routes
- [ ] Update types and interfaces

#### Phase 4: Testing & Polish (2-3 days)
- [ ] Write tests for PTY manager
- [ ] Write tests for terminal transport
- [ ] Add frontend tests for terminal component
- [ ] Manual testing with Claude Code
- [ ] Performance testing
- [ ] Documentation

#### Phase 5: Extensibility (1-2 days)
- [ ] Abstract CLI tool configuration
- [ ] Add Cursor CLI support
- [ ] Add generic tool support
- [ ] Update documentation

**Total Estimate**: 9-14 days for full implementation

---

## Open Questions

1. **Terminal Recording**: Should we record terminal sessions for playback?
2. **Terminal Sharing**: Should multiple users see same terminal in collaborative mode?
3. **Hybrid Mode**: Should we support both terminal and structured simultaneously?
4. **Authentication**: How do we secure WebSocket connections?
5. **Resource Limits**: Should we limit number of concurrent terminal sessions?
6. **Persistence**: Should terminal sessions persist across browser refreshes?

---

## References

- **node-pty**: https://github.com/microsoft/node-pty
- **xterm.js**: https://xtermjs.org/
- **Claude Code CLI Docs**: https://docs.claude.com/en/docs/claude-code/
- **PTY Fundamentals**: https://en.wikipedia.org/wiki/Pseudoterminal
