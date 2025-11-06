# CLI Execution Modes: Side-by-Side Comparison

## Current Implementation vs. Proposed Modes

### Current: Structured Mode Only

```
User Request
    ↓
ExecutionService
    ↓
buildClaudeConfig({
  print: true,
  outputFormat: 'stream-json',
  verbose: true
})
    ↓
SimpleProcessManager
    ↓
spawn('claude', [
  '--print',
  '--output-format', 'stream-json',
  '--verbose'
], {
  stdio: ['pipe', 'pipe', 'pipe']  ← Non-interactive
})
    ↓
┌─────────────────────────────────┐
│  Claude CLI Process             │
│                                 │
│  stdin  ← Prompt sent once      │
│  stdout → JSON lines            │
│  stderr → Error output          │
└─────────────────────────────────┘
    ↓
ClaudeCodeOutputProcessor
  - Parse line-by-line JSON
  - Extract tool calls
  - Track metrics
    ↓
AG-UI Components
  - Messages
  - Tool calls
  - Progress bars
  - Metrics
    ↓
User sees structured view
```

**Characteristics**:
- ✅ Structured, parseable output
- ✅ Automated workflow orchestration
- ✅ Rich metadata (tokens, costs)
- ❌ No user interaction during execution
- ❌ No visibility into actual CLI behavior
- ❌ Can't handle interactive prompts

---

### Proposed: Interactive Terminal Mode

```
User Request + Mode='interactive'
    ↓
ExecutionService
    ↓
buildClaudeConfig({
  mode: 'interactive'
  // No --print, --output-format flags
})
    ↓
PtyProcessManager
    ↓
pty.spawn('claude', [], {
  name: 'xterm-256color',
  rows: 24,
  cols: 80,
  cwd: workDir
})  ← PTY provides terminal emulation
    ↓
┌─────────────────────────────────┐
│  Claude CLI Process (PTY)       │
│                                 │
│  Terminal I/O                   │
│  - Full ANSI support            │
│  - Interactive prompts          │
│  - Real-time user input         │
└─────────────────────────────────┘
    ↓
WebSocket Transport
  - Bidirectional streaming
  - Terminal resize events
  - User input forwarding
    ↓
Xterm.js Terminal
  - Full terminal emulator
  - ANSI color support
  - Cursor positioning
  - User interaction
    ↓
User sees and interacts with terminal
```

**Characteristics**:
- ✅ Full interactivity
- ✅ User can type during execution
- ✅ Handles permission prompts
- ✅ See actual CLI behavior
- ✅ ANSI colors and formatting
- ❌ No structured parsing
- ❌ Harder to automate
- ❌ No automatic metrics

---

### Proposed: Hybrid Mode (Best of Both)

```
User Request + Mode='hybrid'
    ↓
ExecutionService
    ↓
PtyProcessManager
    ↓
pty.spawn('claude', [
  '--output-format', 'stream-json'  ← Still output JSON
], {
  name: 'xterm-256color',
  // PTY for interactivity
})
    ↓
┌─────────────────────────────────┐
│  Claude CLI Process (PTY)       │
│                                 │
│  Terminal I/O + JSON output     │
│  - Interactive prompts          │
│  - JSON messages on stdout      │
└─────────────────────────────────┘
    ↓        ↓
    │        └─→ TerminalOutputParser
    │              - Extract JSON from stream
    │              - Parse structured data
    │              ↓
    │           ClaudeCodeOutputProcessor
    │              ↓
    │           Structured data store
    │
    └─→ WebSocket Transport
        - Forward raw output
        - Bidirectional input
        ↓
    Xterm.js Terminal
        ↓
┌─────────────────────────────────┐
│  Split View UI                  │
│                                 │
│  ┌───────────┐  ┌────────────┐ │
│  │ Terminal  │  │ Structured │ │
│  │ View      │  │ View       │ │
│  │           │  │            │ │
│  │ Live CLI  │  │ • Messages │ │
│  │ output    │  │ • Tools    │ │
│  │ + input   │  │ • Metrics  │ │
│  └───────────┘  └────────────┘ │
└─────────────────────────────────┘
```

**Characteristics**:
- ✅ Full interactivity
- ✅ Structured parsing
- ✅ User can choose view
- ✅ Best of both worlds
- ⚠️ Most complex implementation
- ⚠️ Requires careful output parsing

---

## Feature Comparison Matrix

| Feature | Current (Structured) | Interactive | Hybrid |
|---------|---------------------|-------------|--------|
| **Automated workflows** | ✅ Yes | ❌ No | ✅ Yes |
| **User interaction** | ❌ No | ✅ Yes | ✅ Yes |
| **Structured parsing** | ✅ Yes | ❌ No | ✅ Yes |
| **Terminal visibility** | ❌ No | ✅ Yes | ✅ Yes |
| **Tool call tracking** | ✅ Yes | ❌ No | ✅ Yes |
| **Token metrics** | ✅ Yes | ❌ No | ✅ Yes |
| **Permission prompts** | ⚠️ Auto-skip | ✅ Interactive | ✅ Interactive |
| **ANSI colors** | ❌ No | ✅ Yes | ✅ Yes |
| **Concurrent sessions** | ✅ Easy | ⚠️ Resource-heavy | ⚠️ Resource-heavy |
| **Browser refresh** | ✅ Can recover | ⚠️ Loses session | ⚠️ Loses session |
| **Implementation complexity** | Simple | Medium | Complex |

---

## Use Cases by Mode

### When to Use Structured Mode (Current)

**Best for**:
- Automated issue resolution workflows
- Batch processing multiple issues
- Integration with other systems (CI/CD)
- When you need metrics and cost tracking
- When you don't need to intervene

**Example scenarios**:
```typescript
// Automated bug fix workflow
await executionService.startExecution(issueId, {
  mode: 'worktree',
  executionMode: 'structured',
  template: 'fix-bug',
  captureMetrics: true,
});

// Batch process 10 issues
for (const issue of issues) {
  await executionService.startExecution(issue.id, {
    executionMode: 'structured',
  });
}
```

### When to Use Interactive Mode

**Best for**:
- Exploratory coding sessions
- Complex tasks requiring human judgment
- Learning/understanding how Claude works
- Debugging unexpected behavior
- When permissions need manual approval

**Example scenarios**:
```typescript
// Explore a complex refactoring
await executionService.startExecution(issueId, {
  mode: 'local',
  executionMode: 'interactive',
  enableTerminal: true,
});

// User can interact with Claude in real-time:
// - Answer permission prompts
// - Provide additional context
// - Interrupt and redirect
// - See detailed progress
```

### When to Use Hybrid Mode

**Best for**:
- Teaching/demos (show both views)
- Debugging automated workflows
- Complex tasks with optional intervention
- When you need both metrics and interaction

**Example scenarios**:
```typescript
// Run workflow with monitoring and intervention option
await executionService.startExecution(issueId, {
  mode: 'worktree',
  executionMode: 'hybrid',
  enableTerminal: true,
  captureMetrics: true,
});

// User can:
// - Watch terminal output
// - Switch to structured view for metrics
// - Intervene if Claude gets stuck
// - Review tool calls and costs
```

---

## Architecture Comparison: Stdio vs PTY

### Current: Stdio Pipes

```
┌─────────────────────────────────┐
│   Node.js Process               │
│                                 │
│   ┌─────────────────────────┐   │
│   │ Parent Process          │   │
│   │                         │   │
│   │  stdin  ────────┐       │   │
│   │  stdout ←───────┤       │   │
│   │  stderr ←───────┤       │   │
│   └─────────────────┼───────┘   │
│                     │           │
│   ┌─────────────────▼───────┐   │
│   │ Child Process           │   │
│   │ (Claude CLI)            │   │
│   │                         │   │
│   │ - No TTY                │   │
│   │ - No terminal features  │   │
│   │ - Buffered I/O          │   │
│   └─────────────────────────┘   │
└─────────────────────────────────┘
```

**How it works**:
1. Parent spawns child with `stdio: ['pipe', 'pipe', 'pipe']`
2. Child's stdin/stdout/stderr are Node.js Streams
3. Parent can read/write to these streams
4. **No TTY**: Child doesn't have terminal capabilities
5. **No interactivity**: Child can't detect if it's interactive

**Limitations**:
- Programs detect non-interactive mode and change behavior
- No ANSI colors/cursor control
- Can't handle password prompts properly
- Buffering can cause unexpected delays

### Proposed: PTY (Pseudo-Terminal)

```
┌─────────────────────────────────┐
│   Node.js Process               │
│                                 │
│   ┌─────────────────────────┐   │
│   │ Parent Process          │   │
│   │                         │   │
│   │  PTY Master ────────┐   │   │
│   │    ↕                 │   │   │
│   │  Read/Write          │   │   │
│   └─────────────────┼────┘   │
│                     │           │
│   ┌─────────────────▼───────┐   │
│   │ PTY Slave               │   │
│   │                         │   │
│   │ Child Process           │   │
│   │ (Claude CLI)            │   │
│   │                         │   │
│   │ - Has TTY               │   │
│   │ - Full terminal support │   │
│   │ - ANSI colors work      │   │
│   │ - Interactive mode      │   │
│   └─────────────────────────┘   │
└─────────────────────────────────┘
```

**How it works**:
1. Parent creates PTY master/slave pair
2. Slave becomes child's terminal
3. Master connected to parent for I/O
4. **Has TTY**: Child thinks it's in a real terminal
5. **Full interactivity**: Can use all terminal features

**Benefits**:
- Programs run in interactive mode
- ANSI colors and formatting work
- Can handle password prompts
- Real-time, unbuffered I/O
- Cursor positioning works

---

## Data Flow Comparison

### Structured Mode: Request-Response

```
┌─────────┐
│ User    │
└────┬────┘
     │ 1. Submit issue
     ▼
┌─────────────┐
│ Frontend    │
└──────┬──────┘
       │ 2. POST /api/executions
       ▼
┌──────────────┐
│ Backend      │
│ - Queue task │
└──────┬───────┘
       │ 3. Start execution
       ▼
┌────────────────────┐
│ Claude CLI         │
│ (--print --json)   │
└─────────┬──────────┘
          │ 4. Stream JSON lines
          ▼
┌─────────────────────┐
│ Output Processor    │
│ - Parse JSON        │
│ - Extract events    │
└─────────┬───────────┘
          │ 5. Store events
          ▼
┌─────────────────────┐
│ Database            │
└─────────┬───────────┘
          │ 6. SSE stream
          ▼
┌─────────────────────┐
│ Frontend (AG-UI)    │
│ - Render events     │
└─────────────────────┘
          │
          ▼
┌─────────┐
│ User    │
│ (Watch) │
└─────────┘
```

**Flow**: One-way, automated

### Interactive Mode: Bidirectional

```
┌─────────┐
│ User    │ ←────────────────┐
└────┬────┘                  │
     │ 1. Open terminal      │
     ▼                       │
┌─────────────┐              │
│ Frontend    │              │
│ (Xterm.js)  │              │
└──────┬──────┘              │
       │ 2. WebSocket connect│
       ▼                     │
┌──────────────────┐         │
│ Backend          │         │
│ - Create PTY     │         │
└──────┬───────────┘         │
       │ 3. Spawn Claude     │
       ▼                     │
┌────────────────────┐       │
│ Claude CLI (PTY)   │       │
└─────┬────────┬─────┘       │
      │        │             │
      │ Output │ Input       │
      │        │             │
      ▼        │             │
┌─────────────┐│             │
│ PTY Master  ││             │
└──────┬──────┘│             │
       │       │             │
       │ 4. WebSocket        │
       │       │             │
       ▼       ▼             │
┌─────────────────────┐      │
│ Frontend (Xterm.js) │      │
│ - Render output     │      │
│ - Capture input     │ ─────┘
└─────────────────────┘   5. User types
```

**Flow**: Bidirectional, interactive

---

## Technical Implementation Details

### PTY Creation (node-pty)

```typescript
import * as pty from 'node-pty';

// Option 1: Spawn with PTY
const ptyProcess = pty.spawn('claude', [], {
  name: 'xterm-256color',  // Terminal type
  cols: 80,                 // Width
  rows: 24,                 // Height
  cwd: process.cwd(),       // Working directory
  env: process.env,         // Environment
});

// Option 2: Fork current process with PTY
const ptyProcess = pty.fork('./script.js', [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
});

// Listen to output
ptyProcess.onData((data: string) => {
  console.log('Output:', data);
});

// Listen to exit
ptyProcess.onExit(({ exitCode, signal }) => {
  console.log('Exit:', exitCode, signal);
});

// Send input
ptyProcess.write('help\n');

// Resize terminal
ptyProcess.resize(100, 30);

// Kill process
ptyProcess.kill();
```

### WebSocket Terminal Protocol

```typescript
// Server → Client messages
{
  type: 'terminal:data',
  data: 'Hello World\r\n'  // Terminal output
}

{
  type: 'terminal:exit',
  exitCode: 0,
  signal: null
}

// Client → Server messages
{
  type: 'terminal:input',
  data: 'ls -la\n'  // User typed command
}

{
  type: 'terminal:resize',
  cols: 120,
  rows: 40
}

{
  type: 'terminal:signal',
  signal: 'SIGINT'  // Ctrl+C
}
```

### Xterm.js Integration

```typescript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// Create terminal
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
  },
});

// Add fit addon (responsive sizing)
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

// Open in DOM
terminal.open(document.getElementById('terminal'));
fitAddon.fit();

// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3001/terminal');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'terminal:data') {
    terminal.write(msg.data);
  }
};

// Send user input to server
terminal.onData((data) => {
  ws.send(JSON.stringify({
    type: 'terminal:input',
    data,
  }));
});

// Handle resize
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  ws.send(JSON.stringify({
    type: 'terminal:resize',
    cols: terminal.cols,
    rows: terminal.rows,
  }));
});
resizeObserver.observe(terminal.element);
```

---

## Performance Considerations

### Resource Usage

| Mode | Memory | CPU | Network |
|------|--------|-----|---------|
| Structured | Low (streaming) | Low (JSON parsing) | Low (SSE) |
| Interactive | Medium (PTY + terminal) | Medium (rendering) | Medium (WebSocket) |
| Hybrid | High (both) | High (both) | High (both) |

### Scalability

**Structured Mode**:
- ✅ Can run many concurrent executions
- ✅ Low memory per execution
- ✅ Can resume after disconnect

**Interactive Mode**:
- ⚠️ Each terminal is resource-heavy
- ⚠️ Limited by server resources
- ❌ Lost on disconnect (unless recorded)

**Recommendations**:
1. Limit concurrent interactive sessions per user
2. Add session timeout (auto-close after idle)
3. Consider terminal recording for playback
4. Use structured mode for automation

---

## Migration Strategy

### Phase 1: Add Interactive Mode (Week 1-2)
- [ ] Backend: Implement PTY manager
- [ ] Backend: Add WebSocket transport
- [ ] Frontend: Add xterm.js terminal
- [ ] Frontend: Basic terminal view
- ✅ Result: Users can open terminal mode

### Phase 2: Mode Selection (Week 3)
- [ ] Backend: Add mode configuration
- [ ] Frontend: Add mode selector in config dialog
- [ ] Frontend: Mode switching UI
- ✅ Result: Users can choose mode per execution

### Phase 3: Hybrid Mode (Week 4-5)
- [ ] Backend: Terminal output parser
- [ ] Backend: Hybrid transport
- [ ] Frontend: Split-view UI
- ✅ Result: Users get best of both worlds

### Phase 4: Extensibility (Week 6)
- [ ] Abstract CLI tool configuration
- [ ] Add Cursor CLI support
- [ ] Add generic tool support
- ✅ Result: Works with multiple tools

### Phase 5: Polish & Production (Week 7-8)
- [ ] Testing (unit, integration, E2E)
- [ ] Performance optimization
- [ ] Documentation
- [ ] Security audit
- ✅ Result: Production-ready

---

## Security Considerations

### Structured Mode
- ✅ No user input during execution (safer)
- ✅ Output is parsed and validated
- ✅ Easier to sandbox

### Interactive Mode
- ⚠️ User can type arbitrary commands
- ⚠️ WebSocket authentication needed
- ⚠️ Need rate limiting on input
- ⚠️ Terminal escape sequence injection risk

### Mitigations
1. **Authentication**: Verify user owns execution
2. **Authorization**: Check permissions before opening terminal
3. **Input Validation**: Sanitize input before sending to PTY
4. **Rate Limiting**: Limit keystrokes per second
5. **Session Timeout**: Auto-close idle terminals
6. **Audit Logging**: Log all terminal I/O
7. **Escape Filtering**: Strip dangerous escape sequences

```typescript
// Example: Authentication middleware
function authenticateTerminalWS(ws: WebSocket, executionId: string) {
  const user = extractUserFromWS(ws);
  const execution = getExecution(executionId);

  if (execution.created_by !== user.id) {
    ws.close(1008, 'Unauthorized');
    return false;
  }

  return true;
}

// Example: Input sanitization
function sanitizeTerminalInput(data: string): string {
  // Strip potentially dangerous escape sequences
  return data.replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
}
```
