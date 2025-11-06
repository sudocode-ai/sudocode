# Summary: Interactive CLI Execution Support

## What You Asked For

You wanted to:
1. Support actual CLI execution (not just JSON mode) for Claude Code
2. Enable interactivity and user visibility into command-line content
3. Make it extensible to other tools (Cursor CLI, OpenAI Codex CLI)

## What I Found

### Current Implementation
- Uses `claude --print --output-format stream-json --verbose`
- Spawns processes with stdio pipes (non-interactive)
- Parses structured JSON output line-by-line
- Displays results in AG-UI components (messages, tool calls, metrics)
- **Works great for automation, but no interactivity**

### Key Architecture
```
ExecutionService → SimpleProcessManager → spawn() → ClaudeCodeOutputProcessor → AG-UI
```

## What I Propose

### **Recommended: Option 1 - Dual-Mode Architecture**

Support three execution modes:

1. **Structured Mode** (current)
   - Automated workflows
   - JSON parsing
   - Metrics tracking
   - No user interaction

2. **Interactive Mode** (new)
   - Full terminal emulation (PTY)
   - User can type during execution
   - Real-time ANSI output
   - WebSocket + xterm.js

3. **Hybrid Mode** (future)
   - Both terminal and structured parsing
   - Best of both worlds
   - Split-view UI

### Architecture Overview

```
ExecutionService
     ↓
ProcessManagerFactory
     ↓
┌────────────────────┬──────────────────┐
│                    │                  │
SimpleProcessManager  PtyProcessManager
(Structured)          (Interactive)
     ↓                     ↓
JSON Output          Terminal Output
     ↓                     ↓
AG-UI Components     Xterm.js Terminal
```

## Implementation Plan

### Backend Changes
1. Add `node-pty` for PTY support
2. Create `PtyProcessManager` class
3. Add `TerminalTransport` for WebSocket bidirectional I/O
4. Create `ProcessManagerFactory` to choose mode
5. Add WebSocket route for terminal connections

### Frontend Changes
1. Add `xterm.js` for terminal emulation
2. Create `TerminalView` component
3. Add mode switcher to `ExecutionMonitor`
4. Update `ExecutionConfigDialog` for mode selection

### Estimated Timeline
- **Phase 1**: Backend PTY infrastructure (2-3 days)
- **Phase 2**: Frontend terminal UI (2-3 days)
- **Phase 3**: Integration (2-3 days)
- **Phase 4**: Testing & polish (2-3 days)
- **Phase 5**: Extensibility to other tools (1-2 days)
- **Total**: 9-14 days

## Key Benefits

### For Users
✅ **Interactivity**: Can type and interact with Claude during execution
✅ **Visibility**: See actual CLI output with colors and formatting
✅ **Flexibility**: Choose mode per execution
✅ **Familiar**: Terminal UX developers know and love

### For Developers
✅ **Backward Compatible**: Existing structured mode unchanged
✅ **Extensible**: Easy to add Cursor CLI, Codex, etc.
✅ **Clean Architecture**: Interface-based design
✅ **Testable**: Clear separation of concerns

## Extensibility to Other Tools

The design supports any CLI tool:

```typescript
// Claude Code
buildClaudeConfig({ mode: 'interactive' })

// Cursor CLI
buildCursorConfig({ mode: 'interactive' })

// OpenAI Codex
buildCodexConfig({ mode: 'interactive' })

// Generic tool
buildCustomConfig({ executablePath: './my-cli', mode: 'interactive' })
```

Each tool has its own config builder, but uses shared:
- `PtyProcessManager`
- `TerminalTransport`
- Frontend `TerminalView` component

## Documents Created

I've created three detailed documents:

1. **`DESIGN_PROPOSAL_CLI_EXECUTION.md`** (comprehensive design)
   - 3 architecture options with pros/cons
   - Complete implementation details
   - Code examples for all layers
   - Security considerations
   - Open questions

2. **`CLI_EXECUTION_COMPARISON.md`** (visual comparison)
   - Side-by-side comparison of modes
   - Feature matrix
   - Use case recommendations
   - Data flow diagrams
   - PTY vs Stdio explanation

3. **`IMPLEMENTATION_GUIDE.md`** (step-by-step guide)
   - Complete code for backend PTY manager
   - Complete code for frontend terminal
   - Testing examples
   - Configuration examples
   - Troubleshooting tips

## Example Usage

### Structured Mode (Current Behavior)
```typescript
await executionService.startExecution('issue-123', {
  mode: 'worktree',
  executionMode: 'structured', // Automated
});
```

### Interactive Mode (New)
```typescript
await executionService.startExecution('issue-123', {
  mode: 'local',
  executionMode: 'interactive', // User can interact
  enableTerminal: true,
});
```

### UI Experience

Users will see:
```
┌─────────────────────────────────────┐
│  [Structured View] [Terminal View]  │ ← Mode switcher
├─────────────────────────────────────┤
│                                     │
│  $ claude                           │ ← Live terminal
│  > Starting execution...            │
│  > Reading files...                 │
│  > [User can type here]             │
│                                     │
└─────────────────────────────────────┘
```

## Alternative Options Considered

### Option 2: Terminal-First with Optional Parsing
- Simpler but less reliable structured data
- Good if you prioritize interactivity over automation

### Option 3: Sidecar Terminal
- Minimal changes, two separate processes
- Good for gradual rollout but confusing UX

**Recommendation**: Option 1 (Dual-Mode) provides best balance.

## Next Actions

1. **Review** the design documents
2. **Decide** which option to implement (I recommend Option 1)
3. **Prioritize** which mode to implement first (interactive or hybrid)
4. **Start** with Phase 1 (backend PTY infrastructure)
5. **Test** with Claude Code, then extend to other tools

## Questions to Answer

1. Should terminal sessions persist across browser refreshes?
2. Should we record terminal output for playback?
3. What's the limit on concurrent terminal sessions?
4. Should we support collaborative terminals (multiple users)?
5. Should hybrid mode be implemented in Phase 1 or later?

## Files to Review

- **Start here**: `DESIGN_PROPOSAL_CLI_EXECUTION.md` - High-level design
- **Then**: `CLI_EXECUTION_COMPARISON.md` - Visual explanations
- **Finally**: `IMPLEMENTATION_GUIDE.md` - Code examples

All files are ready for implementation!
