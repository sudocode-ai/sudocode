# sudocode Repository Guide for AI Coding Agents

## Project Overview

**sudocode** is a git-native context management system for AI-assisted software development. It provides a 4-tiered abstraction structure:

1. **Spec** - User intent and requirements (WHAT you want)
2. **Issue** - Agent-scoped work items (Tasks within agent scope)
3. **Execution** - Agent run trajectory (HOW it was executed)
4. **Artifact** - Code diffs and output (Results)

**Core Value Proposition:** Treats context as code: git-tracked, distributed, mergeable.

---

## Monorepo Structure

```
sudocode/
├── types/          # Shared TypeScript definitions (build first)
├── cli/            # CLI (@sudocode-ai/cli) - core operations
├── mcp/            # MCP server (@sudocode-ai/mcp) - wraps CLI
├── server/         # Local backend (@sudocode-ai/local-server) - executions + API
├── frontend/       # React UI (@sudocode-ai/local-ui) - web interface
├── sudocode/       # Meta-package (bundles all)
└── .sudocode/      # Example project data (self-hosting)
```

**Package Dependencies:**
- `types` → standalone (no deps)
- `cli` → depends on `types`
- `mcp` → depends on `cli` (wraps via child_process)
- `server` → depends on `cli`
- `frontend` → independent (talks to server via REST/WS)

---

## Build & Test

```bash
npm run build                    # Build all packages
npm run test                     # Run all tests
npm --prefix <pkg> test -- --run # Package-specific tests
npm --prefix <pkg> test -- --run tests/path/to/file.test.ts
```

**Test Organization:**
- Frontend: `tests/components/`, `tests/pages/`, `tests/hooks/`, `tests/contexts/`
- Backend: `tests/unit/`, `tests/integration/`
- Naming: `*.test.ts` (unit), `*.test.tsx` (React components)

---

## Core Architecture

### Storage: Distributed Git Database

```
Markdown Files (.sudocode/specs/*.md)
    ↕ (syncs via watcher)
JSONL Files (specs.jsonl, issues.jsonl) ← SOURCE OF TRUTH (git-tracked)
    ↕ (import/export)
SQLite Cache (cache.db) ← QUERY ENGINE (gitignored, rebuilt from JSONL)
```

**Key Principles:**
1. **JSONL is source of truth** - One JSON object per line, git-tracked
2. **SQLite is query cache** - Gitignored, rebuilt after `git pull`
3. **Markdown is human interface** - Optional, synced bidirectionally
4. **Git handles distribution** - AI handles merge conflicts

### Data Model

| Entity | ID Format | Purpose | Key File |
|--------|-----------|---------|----------|
| **Spec** | `s-xxxx` | User intent, requirements | `types/src/index.d.ts` |
| **Issue** | `i-xxxx` | Actionable work for agents
- Storage: JSONL (markdown optional)
- Status: blocked/open → in_progress → needs_review/closed

**Execution** (Agent Run)
- Purpose: Track agent execution on an issue
- Agent Types: claude-code, codex, copilot, cursor
- Status: preparing → pending → running → paused/completed/failed/cancelled/stopped
- Captures: Git commits, logs, exit code, files changed, session_id
- Modes: worktree (isolated), local (in-place)
- Workflow Support: `workflow_execution_id`, `step_type`, `step_index`, `step_config` for multi-step chains
- Follow-ups: `parent_execution_id` links execution chains together

**IssueFeedback** (Implementation → Requirements Loop)
- Purpose: Issues provide anchored feedback on specs **or other issues**
- Types: comment, suggestion, request
- Anchoring: Line-based with smart relocation (LocationAnchor → FeedbackAnchor)
- Polymorphic: `from_id` (issue) → `to_id` (spec or issue)
- Bidirectional: Closes loop from implementation back to requirements

**Relationship** (Graph Edges)
- Types: `blocks`, `implements`, `depends-on`, `references`, `discovered-from`, `related`
- Polymorphic: Can link any entity types (spec→spec, issue→issue, issue→spec)
- Bidirectional: Tracked in both directions

### ID Generation

- **Hash-based IDs**: `s-xxxx` (specs), `i-xxxx` (issues)
  - Generated from: `${entityType}-${title}-${timestamp}`
  - 4-8 characters, collision-resistant, git-merge friendly
- **UUIDs**: Each entity has both `id` (hash) and `uuid` (UUID v4)
  - `uuid` used for distributed sync/deduplication
  - `id` used for user-facing references

### Cross-References in Markdown

```markdown
[[s-abc123]]              # Spec reference
[[@i-xyz]]               # Issue reference
[[s-abc123|Display]]     # With display text
[[i-xyz]]{ blocks }      # With relationship type
```

Extracted via regex, creates bidirectional relationships automatically.

### Key Concepts

- **Execution Chains:** Root execution + follow-ups via `parent_execution_id`
- **Worktree Isolation:** Each execution gets isolated git worktree
- **Multi-Agent:** Supports claude-code, codex, copilot, cursor (see `types/src/agents.d.ts`)
- **Polymorphic Feedback:** Issues can provide feedback on specs OR other issues

## Key Files by Package

### types/
- `src/index.d.ts` - Core entity interfaces (Spec, Issue, Execution, Feedback)
- `src/schema.ts` - SQLite schema definitions
- `src/agents.d.ts` - Agent configuration types
- `src/artifacts.d.ts` - Execution change tracking types
- `src/migrations.ts` - Database migrations

### cli/
- `src/operations/*.ts` - Core CRUD operations (specs, issues, relationships, feedback)
- `src/jsonl.ts` - JSONL read/write with atomic operations
- `src/markdown.ts` - Markdown parsing, frontmatter, cross-references
- `src/watcher.ts` - File system watcher for auto-sync

### server/
- `src/services/execution-service.ts` - Execution orchestration
- `src/services/execution-changes-service.ts` - Code change tracking
- `src/services/worktree-sync-service.ts` - Worktree sync (squash/preserve/stage)
- `src/services/agent-registry.ts` - Multi-agent discovery
- `src/adapters/` - Agent adapters (claude, codex, copilot, cursor)
- `src/execution/` - Execution engine, worktree management

### mcp/
- `src/server.ts` - MCP tool definitions (wraps CLI)

### frontend/
- `src/pages/` - ExecutionsPage, WorktreesPage, IssuesPage, SpecsPage
- `src/components/executions/` - ExecutionView, AgentTrajectory, CodeChangesPanel
- `src/hooks/` - useExecutions, useExecutionChanges, useExecutionSync, useAgents

---

## API Reference

### CLI Commands
```bash
sudocode init                           # Initialize .sudocode directory
sudocode spec create|list|show|update   # Spec management
sudocode issue create|list|show|update  # Issue management
sudocode link <from> <to> --type=<type> # Create relationship
sudocode ready                          # Show ready work (no blockers)
sudocode sync [--watch]                 # Sync JSONL ↔ SQLite
sudocode feedback add                   # Add anchored feedback
sudocode server start                   # Start local server
```

### MCP Tools (from `mcp/src/server.ts`)

- `ready` - Get project status and ready work
- `list_issues`, `show_issue`, `upsert_issue` - Issue operations (upsert supports `parent` for hierarchy)
- `list_specs`, `show_spec`, `upsert_spec` - Spec operations
- `link` - Create relationships (blocks, implements, depends-on, references, discovered-from, related)
- `add_reference` - Insert cross-references in markdown
- `add_feedback` - Provide anchored feedback on specs **or issues** (polymorphic `to_id`)

### Server API Endpoints (from `server/src/index.ts`)

```
# Entity CRUD
GET/POST /api/issues, /api/specs, /api/relationships, /api/feedback

# Execution Lifecycle
POST /api/issues/:id/executions      # Start execution
GET  /api/executions/:id/chain       # Get execution chain
GET  /api/executions/:id/stream      # SSE stream
POST /api/executions/:id/follow-up   # Create follow-up
POST /api/executions/:id/stop        # Cancel

# Code Changes
GET  /api/executions/:id/changes     # File change stats
GET  /api/executions/:id/changes/file # Individual file diff

# Worktree Sync
GET  /api/executions/:id/sync/preview  # Preview (conflicts, diff)
POST /api/executions/:id/sync/squash   # Squash commits
POST /api/executions/:id/sync/preserve # Preserve history
POST /api/executions/:id/sync/stage    # Stage without commit

# Other
GET  /api/agents                     # Available agents
WS   /ws                             # Real-time updates
```

---

## Implementation Patterns

### Pattern 1: JSONL Source of Truth
- One JSON object per line
- Sorted by `created_at` (minimizes merge conflicts)
- Atomic writes via temp file + rename
- File mtime set to newest `updated_at`

### Pattern 2: Dual Representation (Markdown + JSONL)
1. User edits .md → watcher → parse → update JSONL → update SQLite
2. CLI updates SQLite → debounced export → update JSONL
3. Git pull → JSONL changed → import → rebuild SQLite

### Pattern 3: Feedback Anchoring
- Captures: line number, section heading, text snippet, context (3 lines before/after)
- Auto-relocation algorithm when spec changes:
  1. Try exact line match
  2. Try text snippet match
  3. Try section heading match
  4. Mark as stale if all fail
- Status: `valid` | `relocated` | `stale`

### Pattern 4: Git Worktree Isolation
- Each execution gets isolated worktree
- Auto-creates branch: `sudocode/exec-<id>`
- Parallel execution without conflicts
- Auto-cleanup on completion (configurable)
- Orphaned worktree cleanup on server startup

### Pattern 5: Multi-Agent Architecture
- Agent adapters abstract different AI coding agents (Claude, Codex, Copilot, Cursor)
- Agent registry discovers and verifies executables (24-hour cache)
- Each adapter handles agent-specific CLI args and output parsing
- Normalized entry format standardizes output across agents
- Agent configs are type-safe per agent type (ClaudeCodeConfig, CodexConfig, etc.)

### Pattern 6: Worktree Sync Modes
Four sync strategies to merge worktree changes back to main:
1. **Preview**: Non-destructive preview showing conflicts, diffs, commits
2. **Squash**: Combines all worktree commits into single commit on target
3. **Preserve**: Merges preserving full commit history
4. **Stage**: Applies changes to working directory without committing

Features:
- JSONL conflict auto-resolution via three-way merge
- Safety snapshots via git tags for rollback
- Uncommitted change tracking and optional inclusion
- Handles deleted worktrees gracefully

### Pattern 7: Execution Chains
- Root execution linked to follow-up executions via `parent_execution_id`
- Execution chains track cumulative code changes
- Follow-up shares worktree with root (continues from same state)
- Change calculation traverses chain to find root `before_commit`

---

## Agent Configuration

### Claude Code (claude-code)
Most full-featured agent with extensive configuration options:
```typescript
{
  type: "claude-code",
  model?: string,              // e.g., "claude-sonnet-4-20250514"
  systemPrompt?: string,       // Custom system prompt
  appendSystemPrompt?: string, // Append to default system prompt
  allowedTools?: string[],     // ["Read", "Write", "Bash", "Glob", "Grep", "Edit"]
  disallowedTools?: string[],  // Tools to disable
  mcpServers?: object,         // MCP server configuration
  permissions?: {
    allowedDirectories?: string[],
    disallowedDirectories?: string[]
  }
}
```

### Codex (codex)
OpenAI Codex CLI integration:
```typescript
{
  type: "codex",
  model?: string,        // e.g., "gpt-4"
  fullAuto?: boolean,    // Auto-approve all operations (default: true)
  sandbox?: string       // Sandbox mode
}
```

### Copilot (copilot)
GitHub Copilot CLI integration:
```typescript
{
  type: "copilot",
  model?: string         // Model selection
}
```

### Cursor (cursor)
Cursor IDE agent:
```typescript
{
  type: "cursor",
  model?: string,        // Model selection
  forceMode?: boolean    // Force mode for automated execution
}
```

---

## Project Configuration

### Configuration File (`.sudocode/config.json`)

Local configuration file (gitignored). Created during `sudocode init`.

```json
{
  "version": "0.1.0",
  "worktree": {
    "worktreeStoragePath": ".sudocode/worktrees",
    "autoCreateBranches": true,
    "autoDeleteBranches": false,
    "enableSparseCheckout": false,
    "branchPrefix": "sudocode",
    "cleanupOrphanedWorktreesOnStartup": true
  },
  "editor": {
    "editorType": "vs-code"
  }
}
```

---

## Database Schema

### Core Tables

```
specs              # Spec metadata and content
issues             # Issue metadata, status, assignee
relationships      # Entity relationships (polymorphic)
issue_feedback     # Anchored feedback (from_id → to_id, supports issue→spec and issue→issue)
```

### Execution Tables

```
executions         # Execution lifecycle, git info, workflow fields
                   # Key fields: issue_id, agent_type, status, mode,
                   #   parent_execution_id (chains), workflow_execution_id,
                   #   step_type, step_index, step_config,
                   #   before_commit, after_commit, worktree_path

execution_logs     # Raw and normalized execution output
                   # raw_logs: Legacy JSONL format
                   # normalized_entry: Structured NormalizedEntry objects
```

### Supporting Tables

```
prompt_templates   # Reusable execution prompts (issue|spec|custom types)
events             # Event log for auditing
```

### Key Indexes

```
idx_executions_issue        (issue_id)
idx_executions_status       (status)
idx_executions_workflow     (workflow_execution_id)
idx_executions_workflow_step (workflow_execution_id, step_index)
idx_feedback_from           (from_id)
idx_feedback_to             (to_id)
```

---

## Frontend Architecture

### Key Pages

- **ExecutionsPage** - Multi-execution grid view with filtering and pagination
- **ExecutionDetailPage** - Execution chain view with follow-ups inline
- **WorktreesPage** - Worktree management with sync dialogs
- **IssuesPage**, **SpecsPage** - Entity list and detail views
- **ArchivedIssuesPage** - View archived issues with feedback

### Key Components

**Execution Management:**
- `ExecutionChainTile` - Compact tile for grid view
- `ExecutionsGrid` - CSS Grid container for multiple chains
- `ExecutionsSidebar` - Filtering, visibility, status display
- `ExecutionView` - Full detail view with follow-up chain
- `ExecutionMonitor` - Real-time status monitoring
- `FollowUpDialog` - Create follow-up executions
- `AgentTrajectory` - Visualize agent tool calls and actions

**Code Changes:**
- `CodeChangesPanel` - File list with change stats (A/M/D/R)
- `DiffViewer` - Unified diff rendering via @git-diff-view/react
- `CommitChangesDialog` - Commit worktree changes
- `SyncPreviewDialog` - Preview sync before execution

**Agent Configuration:**
- `AgentConfigPanel` - Agent selection and configuration
- `AgentSelector` - Dropdown for agent types
- `ClaudeCodeConfigForm`, `CodexConfigForm`, etc. - Agent-specific forms

**Worktree Management:**
- `WorktreeList` - List all worktrees with search/filter
- `WorktreeCard` - Individual worktree display
- `WorktreeDetailPanel` - Detail panel with sync options

### Key Hooks

**Execution:**
- `useExecutions` - Fetch root executions with React Query + WebSocket
- `useExecutionChanges` - Get file changes (committed + uncommitted)
- `useExecutionSync` - Manage sync operations (preview, squash, preserve, stage)
- `useExecutionLogs` - Stream execution logs in real-time
- `useAgUiStream` - Parse ag-ui output stream

**Agent:**
- `useAgents` - Fetch available agents
- `useAgentActions` - Compute contextual actions based on execution state

**Worktree:**
- `useWorktrees` - Fetch and manage worktrees
- `useWorktreeMutations` - Create, update, delete worktrees

**Entity:**
- `useFeedback`, `useFeedbackPositions` - Feedback management
- `useIssueHoverData`, `useSpecHoverData` - Hover card data

### Contexts

- **WebSocketContext** - Real-time message subscription with project-aware handling

---

## Quick Reference

### Storage Layout
```
.sudocode/
├── specs/           # Markdown + specs.jsonl (git-tracked)
├── issues/          # issues.jsonl (git-tracked)
├── config.json      # Configuration (gitignored)
├── cache.db         # SQLite cache (gitignored)
└── worktrees/       # Execution isolation (gitignored)
```

### Relationship Types
`blocks` | `implements` | `depends-on` | `references` | `discovered-from` | `related`

### Status Lifecycles
- **Issue:** open → in_progress → blocked/needs_review → closed
- **Execution:** preparing → pending → running → paused/completed/failed/cancelled/stopped

### Agent Types
`claude-code` | `codex` | `copilot` | `cursor` (configs in `types/src/agents.d.ts`)

### Sync Modes
`preview` | `squash` | `preserve` | `stage`

---

## Working with sudocode

This project uses sudocode for its own management. When working on issues:

1. **Check ready work:** `sudocode ready`
2. **Claim issue:** `sudocode issue update <id> --status=in_progress`
3. **Check context:** `sudocode spec show <id>` or `sudocode issue show <id>`
4. **Provide feedback:** Use `add_feedback` MCP tool when closing issues that implement specs
5. **Close issue:** `sudocode issue close <id>`
