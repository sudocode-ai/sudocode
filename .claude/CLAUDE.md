# sudocode Repository Guide for AI Coding Agents

## Project Overview

**sudocode** is a git-native context management system for AI-assisted software development. It provides a 4-tiered abstraction structure to organize human-AI collaboration:

1. **Spec** - User intent and requirements (WHAT you want)
2. **Issue** - Agent-scoped work items (Tasks within agent scope)
3. **Execution** - Agent run trajectory (HOW it was executed)
4. **Artifact** - Code diffs and output (Results)

### Core Value Proposition
Treats context as code: git-tracked, distributed, mergeable, with AI handling merge conflicts.

---

## Technology Stack

- **Language**: TypeScript (all packages)
- **Runtime**: Node.js >=20.0.0
- **Testing**: Vitest (all packages)
- **Frontend**: React 18 + Vite + TanStack Query + Zustand + Tiptap
- **Backend**: Express + WebSocket + SQLite (better-sqlite3)
- **Storage**: JSONL source of truth (git-tracked) + SQLite (local cache)

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

## Build & Test Commands

### Build System
```bash
npm run build              # Build all packages in order
npm run build:cli          # Build CLI only
npm run build:mcp          # Build MCP only
npm run build:server       # Build server + frontend bundled
```

**Build Order:** types → cli → mcp/server → frontend → sudocode

### Testing
```bash
# Run all tests
npm run test

# Package-specific tests
npm --prefix frontend test -- --run     # Frontend
npm --prefix cli test -- --run          # CLI
npm --prefix mcp test -- --run          # MCP
npm --prefix server test -- --run       # Server

# Run specific test file
npm --prefix frontend test -- --run tests/components/issues/IssuePanel.test.tsx

# Run tests matching name
npm --prefix frontend test -- --run -t "auto-save"
```

**Test Organization:**
- Frontend: `tests/components/`, `tests/pages/`, `tests/hooks/`, `tests/contexts/`
- Backend: `tests/unit/`, `tests/integration/`
- Naming: `*.test.ts` (unit), `*.test.tsx` (React components)

---

## Core Architecture Concepts

### Storage Architecture: Distributed Git Database

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

**Spec** (Specification)
- ID: Hash-based (e.g., `s-14sh`)
- Purpose: Capture user intent, requirements, design, acts as a shared blackboard between users and agents
- Storage: Markdown + JSONL

**Issue** (Work Item)
- ID: Hash-based (e.g., `i-x7k9`)
- Purpose: Actionable work for agents
- Storage: JSONL (markdown optional)
- Status: blocked/open → in_progress → needs_review/closed

**Execution** (Agent Run)
- Purpose: Track agent execution on an issue
- Agent Types: claude-code, codex
- Status: preparing → pending → running → paused/completed/failed/cancelled
- Captures: Git commits, logs, exit code, files changed
- Modes: worktree (isolated), local (in-place)

**IssueFeedback** (Implementation → Requirements Loop)
- Purpose: Issues provide anchored feedback on specs
- Types: comment, suggestion, request
- Anchoring: Line-based with smart relocation
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

---

## Key Files & Modules

### Critical Files to Understand

1. **`types/src/index.d.ts`** - All data model interfaces
2. **`types/src/schema.ts`** - SQLite schema definitions
3. **`cli/src/operations/*.ts`** - Core CRUD operations
4. **`cli/src/jsonl.ts`** - JSONL read/write with atomic operations
5. **`cli/src/markdown.ts`** - Markdown parsing, frontmatter, cross-references
6. **`cli/src/watcher.ts`** - File system watcher (auto-sync)
7. **`server/src/services/execution-service.ts`** - Execution orchestration
8. **`server/src/execution/`** - Execution engine, worktree management, output processing
9. **`mcp/src/server.ts`** - MCP tool definitions (wraps CLI)

### CLI Commands (from `cli/src/cli.ts`)

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
- `list_issues`, `show_issue`, `upsert_issue` - Issue operations
- `list_specs`, `show_spec`, `upsert_spec` - Spec operations
- `link` - Create relationships
- `add_reference` - Insert cross-references in markdown
- `add_feedback` - Provide anchored feedback on specs

### Server API Endpoints (from `server/src/index.ts`)

```
GET/POST /api/issues, /api/specs, /api/relationships, /api/feedback
POST /api/issues/:id/executions       # Start execution
GET /api/executions/:id                # Get execution status
GET /api/executions/:id/stream         # SSE stream
POST /api/executions/:id/follow-up     # Send follow-up prompt
POST /api/executions/:id/stop          # Cancel execution
WS /ws                                 # WebSocket for real-time updates
```

---

## Development Workflow

### Typical Change Flow

**Example: User creates a spec**

1. CLI: `sudocode spec create auth-system`
2. Creates:
   - Markdown file: `.sudocode/specs/auth-system.md`
   - SQLite row in `specs` table
   - Queues JSONL export (debounced 5s)
3. After debounce:
   - Exports to `.sudocode/specs/specs.jsonl`
   - Updates file mtime to match `updated_at`
4. User commits: `git commit .sudocode/specs/`
5. Teammate pulls: `git pull`
6. Auto-sync: `sudocode sync` rebuilds their SQLite cache

**Example: Agent execution flow**

1. Server API: `POST /api/issues/i-xyz/executions`
2. Execution service spawns agent (Claude Code/Codex)
3. Creates git worktree (if configured)
4. Streams stdout/stderr, parses to JSONL
5. Stores raw logs in `execution_logs` table
6. Broadcasts via SSE to frontend
7. On completion: updates status, captures commits, stores summary

### Git Workflow

- **Main branch**: `main` (stable, for PRs)
- **Development**: `local-server` (current dev branch)
- **Feature branches**: Created as needed

**Commit Message Format:**
```
<summary>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Version & Publishing

- `scripts/version.sh` - Updates all package.json versions in sync
- `scripts/publish.sh` - Builds and publishes to npm (@sudocode-ai scope)

---

## Best Practices for AI Agents

### Session Start Protocol

1. Check `.sudocode/` exists: `ls .sudocode/cache.db`
2. Check ready work: `sudocode ready`
3. Review project status: `sudocode status`

### Creating Specs

```bash
# Create spec
sudocode spec create "OAuth Authentication System"

# Edit markdown file at .sudocode/specs/oauth-authentication-system.md
# Add requirements, design decisions, acceptance criteria

# Set metadata
sudocode spec update s-abc123 --priority=0 --tags=auth,security
```

### Planning Issues from Specs

```bash
# Create issues
sudocode issue create "Implement OAuth token endpoint" --priority=1
sudocode issue create "Add token validation" --priority=0

# Link to spec
sudocode link i-xyz s-abc123 --type=implements

# Set dependencies
sudocode link i-abc i-xyz --type=blocks

# Add references in spec markdown
sudocode add-reference s-abc123 i-xyz --line=42 --format=newline
```

### Executing Issues

```bash
# Claim issue
sudocode issue update i-xyz --status=in_progress --assignee=agent-name

# Start execution (via server API)
curl -X POST http://localhost:3000/api/issues/i-xyz/executions \
  -H "Content-Type: application/json" \
  -d '{"agentType": "claude-code", "prompt": "Implement OAuth token endpoint"}'

# Provide feedback when complete
sudocode feedback add i-xyz s-abc123 \
  --type=comment \
  --content="Implemented OAuth token endpoint. All tests passing." \
  --line=42

# Close issue
sudocode issue close i-xyz
```

### Feedback Best Practices

**When to provide feedback:**
- Spec unclear or incomplete
- Implementation differs from spec
- Additional context discovered
- Issue completed successfully

**Anchoring strategy:**
- Use `--line` for specific line anchoring
- Use `--text` for text-based anchoring (more stable across edits)
- Omit both for general spec feedback

**Feedback types:**
- `comment`: Informational (e.g., "Implemented successfully")
- `suggestion`: Spec needs updating
- `request`: Need clarification from user

### Relationship Management

**Common patterns:**
- Issue implements spec: `implements` type
- Issue blocks issue: `blocks` type (affects ready status)
- Issue depends on issue: `depends-on` type (softer than blocks)
- Issue discovered during work: `discovered-from` type
- Related entities: `related` type

---

## Important Implementation Patterns

### Pattern 1: JSONL as Source of Truth
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

---

## Project Configuration

### Configuration File (`.sudocode/config.json`)

Use this to capture persistent configs.

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
  }
}
```
---

## Quick Reference

### Data Flow
```
Spec → Issue → Execution → Artifact
  ↑                  ↓
  └─── Feedback ─────┘
```

### Storage Layout
```
.sudocode/
├── specs/           # Markdown + specs.jsonl (git-tracked)
├── issues/          # issues.jsonl (git-tracked)
├── config.json      # Configuration (git-tracked)
├── cache.db         # SQLite cache (gitignored)
└── worktrees/       # Execution isolation (gitignored)
```

### Relationship Types
- `blocks` - Hard blocker (affects ready status)
- `implements` - Issue implements spec
- `depends-on` - General dependency
- `references` - Soft reference
- `discovered-from` - Found during work
- `related` - General relationship

### Status Lifecycles
- **Spec**: draft → review → approved → deprecated
- **Issue**: open → in_progress → blocked/needs_review → closed
- **Execution**: preparing → pending → running → paused/completed/failed/cancelled

---

## Working with sudocode

This project uses sudocode for its own spec and issue management. When working on issues:

1. **Update issue status** when starting work: `sudocode issue update <id> --status=in_progress`
2. **Create references** to link issues/specs to other issues and specs for discoverability and to create a dependency structure
3. **Check spec/issue content** for context using `sudocode spec show <id>` or `sudocode issue show <id>`
4. **Close issues** when done: `sudocode issue close <id>`
5. **Use MCP tools** or edit markdown files directly in `.sudocode/specs/` and `.sudocode/issues/` when modifying content
