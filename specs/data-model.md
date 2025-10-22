# Data Model Specification

This document defines the core data schemas for Specs and Issues in the sudocode system. Agent, Artifact, and Execution entities will be defined incrementally as the design evolves.

## Design Principles

1. **Dual Representation**: Each entity has both a human-editable format (Markdown + YAML frontmatter) and a machine-optimized format (JSONL + SQLite)
2. **Bidirectional Links**: Relationships are tracked in both directions for efficient querying
3. **Immutable IDs**: Once assigned, IDs never change (even on renaming)
4. **Audit Trail**: All changes tracked with timestamps and actors
5. **Git-Friendly**: Primary storage (JSONL + Markdown) optimized for version control
6. **Flexible Content**: Spec and issue markdown content is free-form to adapt to user needs

---

## Core Entity Definitions

### 1. Spec (Specification)

**Purpose**: Captures user intent, requirements, and design decisions at various levels of detail.

#### Markdown File Format

**Location**: `.sudocode/specs/{name}.md`

**Structure**:

```markdown
---
id: spec-001
title: Authentication System Design
type: architecture
status: draft
priority: 1
created_at: 2025-10-16T10:00:00Z
updated_at: 2025-10-16T15:30:00Z
created_by: alice
updated_by: alice
parent: spec-000
blocks: [spec-002]
related: [spec-010, spec-015]
tags: [auth, security, backend]
---

# Authentication System Design

The content below is flexible markdown. Users can structure it however they want.

## Example Section
Content here...

## Requirements
1. Support OAuth 2.0 [[@issue-001]]
2. Multi-factor authentication [[@issue-002]]

## Cross-References
See also [[spec-010]] for API design patterns.
```

**Frontmatter Schema**:

```yaml
id: string                    # Unique identifier (spec-NNN)
title: string                 # Human-readable title (max 500 chars)
type: enum                    # architecture | api | database | feature | research
status: enum                  # draft | review | approved | deprecated
priority: int                 # 0-4 (0=highest, 2=default)
created_at: timestamp         # ISO 8601 format
updated_at: timestamp         # ISO 8601 format
created_by: string            # Username or agent ID
updated_by: string            # Username or agent ID
parent: string?               # Optional parent spec ID
blocks: [string]              # Array of spec IDs this blocks
related: [string]             # Array of related spec IDs
tags: [string]                # Free-form tags for organization
```

**Content Guidelines**:

- Markdown content is **completely flexible** - no enforced structure
- Users can organize sections however they want
- System extracts references but doesn't enforce format
- Issue references: `[[@issue-001]]` - Links to specific issue
- Spec references: `[[spec-002]]` - Links to another spec
- Backlinks automatically tracked in relationship graph

#### JSONL Format

**Location**: `.sudocode/specs/specs.jsonl`

**Structure** (one JSON object per line):

```json
{
  "id": "spec-001",
  "title": "Authentication System Design",
  "file_path": ".sudocode/specs/auth-system.md",
  "content": "# Authentication System Design\n\n...",
  "type": "architecture",
  "status": "draft",
  "priority": 1,
  "created_at": "2025-10-16T10:00:00Z",
  "updated_at": "2025-10-16T15:30:00Z",
  "created_by": "alice",
  "updated_by": "alice",
  "parent": "spec-000",
  "relationships": [
    {"from": "spec-001", "to": "spec-002", "type": "blocks"},
    {"from": "spec-001", "to": "spec-010", "type": "related"}
  ],
  "issue_refs": ["issue-001", "issue-002", "issue-003"],
  "tags": ["auth", "security", "backend"]
}
```

**Field Definitions**:

- `id`: Immutable unique identifier
- `title`: Display name (editable)
- `file_path`: Relative path to markdown file
- `content`: Full markdown content (without frontmatter)
- `type`: Category of spec
- `status`: Current state in lifecycle
- `priority`: Urgency (0=critical, 4=low)
- `relationships`: Embedded relationship array
- `issue_refs`: Extracted from `[[@issue-NNN]]` in content
- `tags`: Free-form tags for filtering and search

---

### 2. Issue

**Purpose**: Captures actionable work items derived from specs, assigned to agents or humans.

#### Markdown File Format

**Location**: `.sudocode/issues/{id}.md`

**Structure**:

```markdown
---
id: issue-001
title: Implement OAuth 2.0 token endpoint
description: Create REST endpoint for OAuth token exchange
status: open
priority: 1
issue_type: task
assignee: agent-backend-dev
estimated_minutes: 120
created_at: 2025-10-16T10:00:00Z
updated_at: 2025-10-16T15:30:00Z
closed_at: null
created_by: agent-planner
spec_refs: [spec-001]
parent: null
blocks: [issue-002]
blocked_by: []
related: [issue-010]
tags: [auth, backend, api]
---

# Implement OAuth 2.0 token endpoint

Content here is flexible markdown. Common sections might include:

## Description
Create REST endpoint for OAuth token exchange following RFC 6749.

## Design Notes
- Endpoint: POST /oauth/token
- Support grant types: authorization_code, refresh_token
- Return JWT tokens with 1hr expiry

## Acceptance Criteria
- [ ] Endpoint accepts valid authorization codes
- [ ] Returns valid JWT tokens
- [ ] Handles invalid requests with proper error codes
- [ ] Unit tests with >90% coverage

## Notes
Links back to [[spec-001]] requirements section.
```

**Frontmatter Schema**:

```yaml
id: string                    # Unique identifier (issue-NNN)
title: string                 # Short description (max 500 chars)
description: string           # Detailed problem statement
status: enum                  # open | in_progress | blocked | needs_review | closed
priority: int                 # 0-4 (0=highest, 2=default)
issue_type: enum              # bug | feature | task | epic | chore
assignee: string?             # Agent ID or username
estimated_minutes: int?       # Estimated effort
created_at: timestamp         # ISO 8601 format
updated_at: timestamp         # ISO 8601 format
closed_at: timestamp?         # When closed (null if open)
created_by: string            # Who created (user or agent)
spec_refs: [string]           # Specs this issue relates to
parent: string?               # Parent issue (for epics)
blocks: [string]              # Issues this blocks
blocked_by: [string]          # Issues blocking this (computed)
related: [string]             # Related issues
tags: [string]                # Free-form labels for organization
```

**Status Lifecycle**:

- `open` → `in_progress` → `closed`
- `open` → `blocked` → `in_progress` → `closed`
- Can reopen: `closed` → `open`

**Content Guidelines**:

- Markdown content is **flexible** - users/agents can structure as needed
- Common sections (Description, Design, Acceptance Criteria, Notes) are conventions, not requirements
- Issue templates may be added later, but not enforced

#### JSONL Format

**Location**: `.sudocode/issues/issues.jsonl`

**Structure**:

```json
{
  "id": "issue-001",
  "title": "Implement OAuth 2.0 token endpoint",
  "description": "Create REST endpoint for OAuth token exchange",
  "content": "Full markdown content here...",
  "status": "open",
  "priority": 1,
  "issue_type": "task",
  "assignee": "agent-backend-dev",
  "estimated_minutes": 120,
  "created_at": "2025-10-16T10:00:00Z",
  "updated_at": "2025-10-16T15:30:00Z",
  "closed_at": null,
  "created_by": "agent-planner",
  "spec_refs": ["spec-001"],
  "relationships": [
    {"from": "issue-001", "to": "issue-002", "type": "blocks"},
    {"from": "issue-001", "to": "issue-010", "type": "related"}
  ],
  "tags": ["auth", "backend", "api"]
}
```

**Field Definitions**:

- `content`: Full markdown content (without frontmatter) - may include design, acceptance criteria, notes
- `spec_refs`: Bidirectional links to specs
- `blocked_by`: Computed from relationship graph (not stored directly in JSONL)

---

## Relationship Structure

**Purpose**: Captures edges in the dependency graph between specs and issues.

**Location**: Relationships can be stored in two ways:

1. **Embedded in entity JSONL** (as shown above in `relationships` array)
2. **Separate relationships file** (optional, for easier graph operations)

**Relationship Types**:

| Type | Description | Valid Pairs |
|------|-------------|-------------|
| `blocks` | Hard dependency blocker | issue→issue, spec→spec |
| `related` | Soft contextual link | any→any |
| `parent-child` | Hierarchical relationship | spec→spec, issue→issue |
| `discovered-from` | Found during execution | issue→issue |
| `implements` | Implementation link | issue→spec |

**Note**: More detailed relationship schema will be defined when designing the storage layer.

---

## ID Assignment Strategy

### Format

- Specs: `spec-NNN` (e.g., `spec-001`, `spec-042`)
- Issues: `issue-NNN` (e.g., `issue-001`, `issue-123`)

### ID Generation

- Sequential numbering per type
- IDs never reused
- IDs assigned at creation, immutable
- Counter stored in `.sudocode/meta.json`:

```json
{
  "next_spec_id": 43,
  "next_issue_id": 157
}
```

### Collision Handling

On import/merge conflicts:

1. Detect ID collision (same ID, different content)
2. Score by reference count (how many places reference this ID)
3. Renumber entity with fewer references
4. Update all references in text fields and relationships
5. Record mapping in conflict log

---

## Example: Complete Data Flow

### Scenario: User creates spec, plans issues

**1. User creates spec**

```bash
sg spec create auth-system
```

Creates:

- `.sudocode/specs/auth-system.md` (with frontmatter)
- Entry in `.sudocode/specs/specs.jsonl`
- Row in SQLite `specs` table

**2. User invokes planning**

```bash
sg plan spec-001
```

Creates:

- `issue-001`, `issue-002`, `issue-003` (markdown + JSONL + SQLite)
- Relationships: `issue-001 implements spec-001`
- Relationships: `issue-002 blocks issue-003`
- Updates `spec-001.md` with issue references: `[[@issue-001]]`

**3. User or agent updates issue status**

```bash
sg issue update issue-001 --status in_progress
```

Updates:

- Frontmatter in `.sudocode/issues/issue-001.md`
- Entry in `.sudocode/issues/issues.jsonl`
- Row in SQLite `issues` table

---

## Future Entity Definitions (TODO)

The following entities will be defined as the design evolves:

### 3. Agent (TODO)

**Purpose**: Defines agent configurations, capabilities, and execution parameters.

**Placeholder**: Will include agent type (claude-code, etc.), capabilities, config (MCP servers, hooks, plugins), and scheduling parameters.

### 4. Artifact (TODO)

**Purpose**: Represents outputs from agent executions (code changes, reports, documentation).

**Placeholder**: Will track execution ID, issue ID, artifact type, file path, status (pending-review, approved, applied), and metadata.

### 5. Execution (TODO)

**Purpose**: Tracks individual agent runs against issues.

**Placeholder**: Will include issue ID, agent ID, start/end timestamps, exit code, log path, produced artifacts, and feedback (discovered issues, spec updates).

---

## Next Steps

After validating the Spec and Issue schemas:

1. Design SQLite database schema for specs and issues (storage.md)
2. Define JSONL ↔ SQLite sync mechanism
3. Implement ID generation and collision resolution
4. Define CLI commands for spec and issue CRUD operations
5. Prototype planning agent workflow (spec → issues)
6. Incrementally add Agent/Artifact/Execution schemas as needed
