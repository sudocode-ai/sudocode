# Cross-Repository Federation: Multi-Agent Collaboration

## Overview

This document specifies a federated architecture that enables sudocode instances across different git repositories to communicate, share data, and coordinate work as a distributed multi-agent system. The design treats each repository as an autonomous agent with its own specs, issues, and decision-making capability, while enabling organic collaboration through standardized protocols.

### Vision

Enable git repositories to function as **autonomous agent clusters** that can:
- **Discover** capabilities and state of other repositories
- **Query** cross-repo specs and issues
- **Request** work from other repositories (create issues/specs)
- **Subscribe** to changes in remote repositories
- **Delegate** tasks that fall outside their domain

This creates a **multiagent ecosystem** where:
- Microservices communicate dependencies through specs/issues
- Teams coordinate across repo boundaries with full traceability
- AI agents negotiate task allocation autonomously
- Open source projects collaborate with formal, machine-readable commitments

### Core Principles

1. **Sovereignty**: Each repo maintains full control over its data and decisions
2. **Consent-Based**: Remote mutations require explicit approval (automated or manual)
3. **Git-Native**: Leverage git's distributed nature for persistence and sync
4. **Eventual Consistency**: Embrace async, distributed system patterns
5. **Organic Discovery**: No centralized registry required (but optionally supported)
6. **Backward Compatible**: Single-repo mode continues to work without federation

---

## Design Dimensions

### 1. Federation Topologies

Multiple network topologies are supported, chosen based on organizational needs:

#### Hub-and-Spoke (Centralized Coordination)
```
       ┌─────────┐
       │Platform │ ← Coordination repo
       │  Core   │
       └────┬────┘
     ┌──────┼──────┐
     │      │      │
  ┌──▼──┐ ┌▼──┐ ┌─▼───┐
  │Auth │ │API│ │UI   │ ← Service repos
  └─────┘ └───┘ └─────┘
```
- **Use case**: Enterprise with platform team coordinating microservices
- **Pros**: Simple mental model, clear ownership, easy audit
- **Cons**: Coordination repo becomes bottleneck

#### Peer-to-Peer (Fully Distributed)
```
  ┌─────┐     ┌─────┐
  │Auth │────▶│API  │
  └──┬──┘     └──┬──┘
     │           │
     ▼           ▼
  ┌─────┐     ┌─────┐
  │DB   │────▶│UI   │
  └─────┘     └─────┘
```
- **Use case**: Open source ecosystem, equal collaborators
- **Pros**: No single point of failure, maximum autonomy
- **Cons**: Harder to reason about, discovery complexity

#### Hierarchical (Parent-Child)
```
      ┌──────────┐
      │Monorepo  │ ← Parent
      └─────┬────┘
      ┌─────┼─────┐
      │     │     │
   ┌──▼─┐ ┌▼──┐ ┌▼───┐
   │Pkg1│ │Pkg2│ │Pkg3│ ← Children
   └────┘ └────┘ └────┘
```
- **Use case**: Monorepo with logical boundaries, team hierarchies
- **Pros**: Clear authority, inheritance of policies
- **Cons**: Less flexible for cross-cutting concerns

#### Mesh (Selective Peering)
```
  ┌─────┐     ┌─────┐
  │Auth │─┐ ┌─│API  │
  └─────┘ │ │ └──┬──┘
          ▼ ▼    │
       ┌─────┐   │
       │Shared│  │
       │Types │  │
       └──┬──┘   │
          │      │
       ┌──▼──────▼─┐
       │Frontend  │
       └──────────┘
```
- **Use case**: Large org with explicit dependencies between repos
- **Pros**: Flexible, scales well, explicit contracts
- **Cons**: Requires careful dependency management

**Recommendation**: Start with **mesh topology** as it's most flexible and maps naturally to existing code dependencies.

---

### 2. Communication Protocols

Two primary transport mechanisms, used in combination:

#### Option A: Git-Native (Async, Durable)
- Cross-repo references stored in git (notes, special refs, or regular commits)
- Sync via `git fetch` from trusted remote repos
- Changes tracked in JSONL files, pulled like regular git data
- Perfect for: Audit trails, offline work, durable commitments

**Example Flow**:
```bash
# Repo A creates remote reference
git notes --ref=refs/sudocode/remote add -m "refs:org/repo-b#ISSUE-042" <commit>

# Repo B discovers it
git fetch repo-a refs/sudocode/remote:refs/sudocode/remote/repo-a
git notes --ref=refs/sudocode/remote list
```

#### Option B: HTTP/WebSocket (Sync, Real-Time)
- RESTful API for queries and mutations
- WebSocket for subscriptions and live updates
- Uses existing Express server infrastructure
- Perfect for: Interactive UX, real-time status, agent negotiation

**Example Flow**:
```typescript
// Query remote repo
const response = await fetch('https://repo-b.dev/api/v1/issues?status=open');

// Subscribe to changes
const ws = new WebSocket('wss://repo-b.dev/api/v1/subscribe');
ws.send(JSON.stringify({ watch: { entity: 'issue', uuid: '...' }}));
```

#### Hybrid Approach (Recommended)
- Use **HTTP/WS for discovery and real-time ops**
- Use **git for persistence and history**
- Pattern: HTTP request → local mutation → git commit → git push
- Benefits: Fast UX + durable audit trail

---

### 3. Agent-to-Agent (A2A) Protocol Integration

The **A2A protocol** provides a standardized vocabulary for agent communication. Sudocode maps A2A primitives to its domain model:

#### A2A Message Types

##### 1. **Discover** (Capability Exchange)
```json
{
  "type": "discover",
  "from": "github.com/org/repo-a",
  "to": "github.com/org/repo-b",
  "timestamp": "2025-11-06T12:00:00Z"
}
```

**Response**:
```json
{
  "type": "discover_response",
  "capabilities": {
    "protocols": ["rest", "websocket", "git"],
    "operations": ["query_specs", "query_issues", "create_issues", "subscribe"],
    "schemas_version": "1.0",
    "trust_level": "verified",
    "endpoints": {
      "rest": "https://repo-b.dev/api/v1",
      "ws": "wss://repo-b.dev/api/v1/ws",
      "git": "https://github.com/org/repo-b.git"
    }
  }
}
```

##### 2. **Query** (Information Request)
```json
{
  "type": "query",
  "from": "github.com/org/frontend",
  "to": "github.com/org/api-service",
  "query": {
    "entity": "issue",
    "filters": {
      "labels": ["api", "auth"],
      "status": "open",
      "priority": [0, 1]
    },
    "include": ["relationships", "spec_refs"]
  }
}
```

**Response**:
```json
{
  "type": "query_response",
  "results": [
    {
      "id": "issue-042",
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Add OAuth token endpoint",
      "status": "open",
      "priority": 1,
      "spec_refs": ["spec-015"],
      "canonical_ref": "org/api-service#issue-042"
    }
  ],
  "metadata": {
    "total": 1,
    "cached_at": "2025-11-06T12:05:00Z"
  }
}
```

##### 3. **Mutate** (Remote State Change Request)
```json
{
  "type": "mutate",
  "from": "github.com/org/frontend",
  "to": "github.com/org/api-service",
  "operation": "create_issue",
  "data": {
    "title": "Add user profile endpoint",
    "description": "Frontend needs GET /api/v1/users/:id endpoint...",
    "priority": 1,
    "labels": ["api", "frontend-request"],
    "relationships": [
      {
        "type": "discovered-from",
        "remote_ref": "org/frontend#issue-100"
      }
    ]
  },
  "metadata": {
    "request_id": "req-abc123",
    "requester": "claude-code-agent",
    "auto_approve": false
  }
}
```

**Response** (Pending Approval):
```json
{
  "type": "mutate_response",
  "status": "pending_approval",
  "request_id": "req-abc123",
  "approval_url": "https://repo-b.dev/approvals/req-abc123",
  "message": "Request queued for review by api-service maintainers"
}
```

**Response** (Auto-Approved):
```json
{
  "type": "mutate_response",
  "status": "completed",
  "request_id": "req-abc123",
  "created": {
    "id": "issue-084",
    "uuid": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "canonical_ref": "org/api-service#issue-084",
    "url": "https://repo-b.dev/issues/issue-084"
  }
}
```

##### 4. **Subscribe** (Change Notification)
```json
{
  "type": "subscribe",
  "from": "github.com/org/frontend",
  "to": "github.com/org/api-service",
  "watch": {
    "entity_type": "issue",
    "filters": {
      "labels": ["frontend-blocking"]
    }
  },
  "callback": {
    "url": "https://frontend.dev/api/v1/webhooks/cross-repo",
    "auth": {
      "type": "bearer",
      "token": "..."
    }
  }
}
```

**Event Notification**:
```json
{
  "type": "event",
  "from": "github.com/org/api-service",
  "to": "github.com/org/frontend",
  "event": {
    "type": "issue_updated",
    "entity": {
      "id": "issue-084",
      "uuid": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "canonical_ref": "org/api-service#issue-084"
    },
    "changes": {
      "status": {"from": "open", "to": "closed"}
    },
    "timestamp": "2025-11-06T14:30:00Z"
  }
}
```

##### 5. **Delegate** (Task Handoff)
```json
{
  "type": "delegate",
  "from": "github.com/org/app",
  "to": "github.com/org/infra",
  "task": {
    "type": "spec",
    "title": "Deploy auth-service to production",
    "description": "Need k8s deployment for auth-service with...",
    "requirements": {
      "replicas": 3,
      "resources": {"cpu": "1", "memory": "2Gi"},
      "ingress": "auth.example.com"
    },
    "context": {
      "triggered_by": "org/app#spec-025",
      "urgency": "high"
    }
  }
}
```

**Response**:
```json
{
  "type": "delegate_response",
  "status": "accepted",
  "created": {
    "type": "spec",
    "id": "spec-042",
    "canonical_ref": "org/infra#spec-042"
  },
  "estimated_completion": "2025-11-08T12:00:00Z",
  "assignee": "claude-infra-agent"
}
```

#### A2A Agent Behavior

Agents can be configured to autonomously handle certain A2A messages:

```typescript
// .sudocode/federation.config.json
{
  "a2a_policies": {
    "query": {
      "auto_respond": true,
      "allowed_filters": ["status", "labels", "priority"]
    },
    "mutate": {
      "auto_approve": [
        {
          "condition": "from_trusted_repo && labels.includes('auto-approve')",
          "max_priority": 2
        }
      ],
      "require_human": [
        {
          "condition": "priority <= 1 || labels.includes('breaking-change')"
        }
      ]
    },
    "delegate": {
      "auto_accept": false,
      "notify": ["@team-leads"]
    }
  }
}
```

---

## Data Model Extensions

### 1. Federated Identity

Extend existing entities to support cross-repo references:

#### Current Schema
```typescript
interface Issue {
  id: string;              // "issue-042"
  uuid: string;            // "550e8400-..."
  title: string;
  // ... existing fields
}
```

#### Extended Schema
```typescript
interface FederatedIssue extends Issue {
  // New fields
  origin_repo?: string;           // "github.com/org/repo-a"
  canonical_ref: string;          // "org/repo-a#issue-042"

  // Indicates this is cached from remote
  federation_status?: {
    is_remote: boolean;
    source_repo: string;
    last_synced_at: string;
    sync_status: 'synced' | 'stale' | 'unreachable';
  };

  // Cross-repo relationships
  remote_relationships: RemoteRelationship[];
}

interface RemoteRelationship {
  type: 'blocks' | 'related' | 'implements' | 'discovered-from';
  remote_repo: string;            // "github.com/org/repo-b"
  remote_entity_type: 'issue' | 'spec';
  remote_id: string;              // "issue-084"
  remote_uuid: string;            // UUID for canonical identity
  canonical_ref: string;          // "org/repo-b#issue-084"

  // Cached snapshot
  cached_data?: {
    title: string;
    status: string;
    updated_at: string;
  };

  last_fetched_at: string;
}
```

### 2. New Database Tables

Extend SQLite schema to support federation:

```sql
-- Track known remote repositories
CREATE TABLE remote_repos (
  url TEXT PRIMARY KEY,              -- "github.com/org/repo-b"
  display_name TEXT NOT NULL,        -- "API Service"
  description TEXT,

  -- Trust and capabilities
  trust_level TEXT NOT NULL          -- "trusted" | "verified" | "untrusted"
    CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
  capabilities JSON,                 -- A2A capabilities from discover response

  -- Endpoints
  rest_endpoint TEXT,                -- "https://api-service.dev/api/v1"
  ws_endpoint TEXT,                  -- "wss://api-service.dev/api/v1/ws"
  git_url TEXT,                      -- "https://github.com/org/repo-b.git"

  -- Sync metadata
  last_synced_at TEXT,
  sync_status TEXT DEFAULT 'unknown' -- "synced" | "stale" | "unreachable"
    CHECK(sync_status IN ('synced', 'stale', 'unreachable', 'unknown')),

  -- Audit
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL,            -- Who added this remote

  -- Configuration
  auto_sync BOOLEAN DEFAULT 0,       -- Auto-fetch remote data?
  sync_interval_minutes INTEGER DEFAULT 60
);

-- Track cross-repo references (for caching and queries)
CREATE TABLE cross_repo_references (
  -- Local entity
  local_uuid TEXT NOT NULL,
  local_entity_type TEXT NOT NULL    -- "issue" | "spec"
    CHECK(local_entity_type IN ('issue', 'spec')),

  -- Remote entity
  remote_repo_url TEXT NOT NULL,
  remote_entity_type TEXT NOT NULL   -- "issue" | "spec"
    CHECK(remote_entity_type IN ('issue', 'spec')),
  remote_id TEXT NOT NULL,           -- "issue-084"
  remote_uuid TEXT,                  -- Canonical UUID
  canonical_ref TEXT NOT NULL,       -- "org/repo-b#issue-084"

  -- Relationship
  relationship_type TEXT NOT NULL    -- "blocks" | "related" | "implements" | etc.
    CHECK(relationship_type IN (
      'blocks', 'blocked-by', 'related', 'implements',
      'depends-on', 'parent-child', 'discovered-from'
    )),

  -- Cached data (JSON snapshot)
  cached_data JSON,                  -- {title, status, priority, updated_at, ...}

  -- Metadata
  last_fetched_at TEXT,
  fetch_status TEXT DEFAULT 'pending' -- "success" | "failed" | "pending"
    CHECK(fetch_status IN ('success', 'failed', 'pending')),

  -- Audit
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  FOREIGN KEY(remote_repo_url) REFERENCES remote_repos(url),
  PRIMARY KEY(local_uuid, remote_repo_url, remote_uuid, relationship_type)
);

-- Track pending cross-repo requests (mutations)
CREATE TABLE cross_repo_requests (
  request_id TEXT PRIMARY KEY,       -- "req-abc123"

  -- Direction
  direction TEXT NOT NULL            -- "outgoing" | "incoming"
    CHECK(direction IN ('outgoing', 'incoming')),
  from_repo TEXT NOT NULL,
  to_repo TEXT NOT NULL,

  -- Request details
  request_type TEXT NOT NULL         -- "create_issue" | "create_spec" | "update_issue"
    CHECK(request_type IN ('create_issue', 'create_spec', 'update_issue', 'query')),
  payload JSON NOT NULL,             -- Full A2A message

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'completed', 'failed')),

  -- Approval workflow
  requires_approval BOOLEAN DEFAULT 1,
  approved_by TEXT,                  -- Username who approved
  approved_at TEXT,
  rejection_reason TEXT,

  -- Result (for completed requests)
  result JSON,                       -- Created entity details, etc.

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,

  FOREIGN KEY(from_repo) REFERENCES remote_repos(url),
  FOREIGN KEY(to_repo) REFERENCES remote_repos(url)
);

-- Track subscriptions (both outgoing and incoming)
CREATE TABLE cross_repo_subscriptions (
  subscription_id TEXT PRIMARY KEY,

  -- Direction
  direction TEXT NOT NULL            -- "outgoing" | "incoming"
    CHECK(direction IN ('outgoing', 'incoming')),
  from_repo TEXT NOT NULL,
  to_repo TEXT NOT NULL,

  -- What to watch
  watch_config JSON NOT NULL,        -- {entity_type, filters}

  -- Callback (for outgoing) or subscriber info (for incoming)
  callback_url TEXT,
  callback_auth JSON,                -- {type: "bearer", token: "..."}

  -- Status
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'paused', 'cancelled')),

  -- Metadata
  created_at TEXT NOT NULL,
  last_event_at TEXT,
  event_count INTEGER DEFAULT 0,

  FOREIGN KEY(from_repo) REFERENCES remote_repos(url),
  FOREIGN KEY(to_repo) REFERENCES remote_repos(url)
);

-- Audit log for all cross-repo operations
CREATE TABLE cross_repo_audit_log (
  log_id TEXT PRIMARY KEY,

  -- What happened
  operation_type TEXT NOT NULL,      -- "query" | "mutate" | "sync" | "subscribe"
  direction TEXT NOT NULL            -- "outgoing" | "incoming"
    CHECK(direction IN ('outgoing', 'incoming')),

  -- Who was involved
  local_repo TEXT NOT NULL,
  remote_repo TEXT NOT NULL,

  -- Details
  request_id TEXT,                   -- Link to cross_repo_requests if applicable
  payload JSON,                      -- Full message or summary
  result JSON,                       -- Response or result

  -- Status
  status TEXT NOT NULL               -- "success" | "failed" | "pending"
    CHECK(status IN ('success', 'failed', 'pending')),
  error_message TEXT,

  -- Timing
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,

  FOREIGN KEY(request_id) REFERENCES cross_repo_requests(request_id)
);

-- Indexes for performance
CREATE INDEX idx_cross_repo_refs_local ON cross_repo_references(local_uuid);
CREATE INDEX idx_cross_repo_refs_remote ON cross_repo_references(remote_repo_url, remote_uuid);
CREATE INDEX idx_cross_repo_requests_status ON cross_repo_requests(status, direction);
CREATE INDEX idx_cross_repo_audit_timestamp ON cross_repo_audit_log(timestamp);
```

### 3. JSONL Extensions

Extend JSONL format to include federation metadata:

```jsonl
{"id":"issue-042","uuid":"550e8400-...","title":"Add OAuth endpoint","origin_repo":"github.com/org/api-service","canonical_ref":"org/api-service#issue-042","remote_relationships":[{"type":"discovered-from","remote_repo":"github.com/org/frontend","remote_entity_type":"issue","remote_id":"issue-100","remote_uuid":"7c9e6679-...","canonical_ref":"org/frontend#issue-100","cached_data":{"title":"Need user auth in UI","status":"open"},"last_fetched_at":"2025-11-06T12:00:00Z"}]}
```

### 4. Markdown Frontmatter Extensions

Support cross-repo references in markdown:

```markdown
---
id: issue-042
title: Add OAuth token endpoint
# ... existing fields ...

# New federation fields
origin_repo: github.com/org/api-service
canonical_ref: org/api-service#issue-042
remote_relationships:
  - type: discovered-from
    ref: org/frontend#issue-100
    cached_title: "Need user auth in UI"
---

## Description

This issue was created by request from [[org/frontend#issue-100]].

## Dependencies

Blocks: [[org/frontend#issue-100]] (external)
Related: [[issue-050]] (local)
```

---

## Trust and Security Model

### 1. Trust Levels

Three levels of trust for remote repositories:

#### Untrusted (Default)
- Can query public data only
- Cannot create issues/specs
- Cannot subscribe to changes
- Manual approval required for any mutation

#### Verified
- Can query public + internal data
- Can create issues with approval
- Can subscribe to public events
- Auto-approval for low-priority, non-breaking changes

#### Trusted
- Full query access
- Can create issues/specs with auto-approval (within policy limits)
- Can subscribe to all events
- Minimal human intervention required

### 2. Permission Model

Fine-grained permissions per remote repo:

```typescript
// .sudocode/federation.config.json
{
  "remote_repos": [
    {
      "url": "github.com/org/api-service",
      "display_name": "API Service",
      "trust_level": "trusted",
      "permissions": {
        "query": {
          "allowed": true,
          "entities": ["issue", "spec"],
          "filters": ["status", "labels", "priority"],
          "exclude_fields": []         // Can see all fields
        },
        "mutate": {
          "allowed": true,
          "operations": ["create_issue"],
          "auto_approve_conditions": [
            "priority >= 2",
            "!labels.includes('breaking-change')",
            "!labels.includes('security')"
          ],
          "max_creates_per_day": 20
        },
        "subscribe": {
          "allowed": true,
          "max_subscriptions": 10
        }
      }
    },
    {
      "url": "github.com/external/partner-repo",
      "display_name": "Partner Project",
      "trust_level": "verified",
      "permissions": {
        "query": {
          "allowed": true,
          "entities": ["issue"],
          "filters": ["status"],
          "exclude_fields": ["assignee", "estimated_minutes"]
        },
        "mutate": {
          "allowed": false
        },
        "subscribe": {
          "allowed": false
        }
      }
    }
  ]
}
```

### 3. Authentication Methods

#### For Outgoing Requests (Sudocode → Remote Repo)
1. **Bearer Token**: Store in `.sudocode/secrets.env` (gitignored)
2. **OAuth 2.0**: Support GitHub/GitLab OAuth flows
3. **SSH Keys**: For git-native transport
4. **Mutual TLS**: For high-security environments

#### For Incoming Requests (Remote Repo → Sudocode)
1. **API Keys**: Generated per remote repo, scoped permissions
2. **JWT Tokens**: Signed by trusted repos, short-lived
3. **GitHub App**: Leverage GitHub's identity and permissions
4. **Cryptographic Signatures**: Sign A2A messages with repo's private key

### 4. Rate Limiting and Quotas

Protect against abuse:

```typescript
{
  "rate_limits": {
    "per_repo": {
      "queries_per_minute": 60,
      "mutations_per_hour": 10,
      "subscriptions_max": 20
    },
    "global": {
      "cross_repo_bandwidth_mb_per_day": 1000,
      "max_remote_repos": 50
    }
  }
}
```

### 5. Audit Trail

All cross-repo operations logged:

```sql
-- Example audit log entry
INSERT INTO cross_repo_audit_log VALUES (
  'log-xyz789',
  'mutate',
  'incoming',
  'github.com/org/api-service',
  'github.com/org/frontend',
  'req-abc123',
  '{"type":"mutate","operation":"create_issue","data":{...}}',
  '{"status":"completed","created":{"id":"issue-084"}}',
  'success',
  NULL,
  '2025-11-06T12:30:00Z',
  234  -- ms
);
```

---

## API Design

### 1. REST API Endpoints

Extend existing Express server with federation endpoints:

#### Discovery
```
GET /api/v1/federation/info
→ Returns capabilities, endpoints, schemas version
```

#### Queries
```
POST /api/v1/federation/query
Body: {
  "entity": "issue",
  "filters": { "status": "open", "labels": ["api"] },
  "include": ["relationships"]
}
→ Returns matching entities with metadata
```

#### Mutations
```
POST /api/v1/federation/mutate
Body: {
  "operation": "create_issue",
  "data": { ... },
  "auto_approve": false
}
→ Returns request_id and status
```

```
GET /api/v1/federation/requests/:request_id
→ Returns request status, approval URL if pending
```

```
POST /api/v1/federation/requests/:request_id/approve
→ Approves pending request
```

#### Subscriptions
```
POST /api/v1/federation/subscribe
Body: {
  "watch": { "entity_type": "issue", "filters": {...} },
  "callback_url": "...",
  "callback_auth": {...}
}
→ Returns subscription_id
```

```
DELETE /api/v1/federation/subscribe/:subscription_id
→ Cancels subscription
```

#### Management
```
GET /api/v1/federation/remotes
→ Lists configured remote repos

POST /api/v1/federation/remotes
Body: { "url": "...", "trust_level": "verified", ... }
→ Adds remote repo

PUT /api/v1/federation/remotes/:repo_url
→ Updates remote repo config

DELETE /api/v1/federation/remotes/:repo_url
→ Removes remote repo
```

### 2. WebSocket Protocol

For real-time subscriptions:

```typescript
// Client connects
ws = new WebSocket('wss://repo.dev/api/v1/ws');

// Client subscribes
ws.send(JSON.stringify({
  type: 'subscribe',
  watch: {
    entity_type: 'issue',
    filters: { labels: ['frontend-blocking'] }
  }
}));

// Server sends events
ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  // {
  //   type: 'event',
  //   event: {
  //     type: 'issue_updated',
  //     entity: { id: 'issue-084', ... },
  //     changes: { status: { from: 'open', to: 'closed' } }
  //   }
  // }
};
```

### 3. MCP Server Extensions

Extend MCP with federation tools:

```typescript
// New MCP tools
{
  "name": "cross_repo_query",
  "description": "Query issues/specs from remote repos",
  "inputSchema": {
    "repo_url": "string",
    "entity": "issue | spec",
    "filters": "object"
  }
}

{
  "name": "cross_repo_create_issue",
  "description": "Request issue creation in remote repo",
  "inputSchema": {
    "repo_url": "string",
    "title": "string",
    "description": "string",
    "auto_approve": "boolean"
  }
}

{
  "name": "cross_repo_watch",
  "description": "Subscribe to changes in remote repo",
  "inputSchema": {
    "repo_url": "string",
    "watch_config": "object"
  }
}
```

Agents can now use these tools:

```typescript
// Claude Code agent using MCP
const remoteIssues = await mcp.tools.cross_repo_query({
  repo_url: 'github.com/org/api-service',
  entity: 'issue',
  filters: { status: 'open', labels: ['frontend-blocking'] }
});

if (remoteIssues.some(issue => issue.status === 'open')) {
  console.log('Waiting on API service issues before proceeding');
}
```

---

## Implementation Phases

### Phase 1: Read-Only Federation (Low Risk, High Value)
**Goal**: Enable cross-repo visibility without mutations

**Features**:
- Parse and render cross-repo refs: `[[org/repo#issue-123]]`
- CLI: `sudocode remote add <url>` to register remote repos
- CLI: `sudocode remote query <repo> issue --status=open` to query remote data
- UI: Display cross-repo dependencies in issue/spec views
- Cache remote data locally in `cross_repo_references` table
- Manual sync: `sudocode remote sync <repo>` to refresh cache

**Schema Changes**:
- Add `remote_repos` table
- Add `cross_repo_references` table
- Extend markdown parser to recognize cross-repo refs

**No Mutations**: Remote repos are read-only, no risk of unwanted changes

**Timeline**: 2-3 weeks

---

### Phase 2: Request/Approval Workflow (Medium Risk)
**Goal**: Enable manual cross-repo mutations with human approval

**Features**:
- CLI: `sudocode remote create-issue <repo>` with interactive prompts
- Web UI: "Request Issue in Remote Repo" button
- Approval queue: Pending requests visible in UI
- CLI: `sudocode requests pending` and `sudocode request approve <id>`
- Email/Slack notifications for pending approvals
- Track request lifecycle in `cross_repo_requests` table

**Schema Changes**:
- Add `cross_repo_requests` table
- Add `cross_repo_audit_log` table

**Human in Loop**: All mutations require explicit approval, safe for production use

**Timeline**: 3-4 weeks

---

### Phase 3: A2A Protocol Integration (High Value)
**Goal**: Standardized agent communication with policy-based auto-approval

**Features**:
- Implement A2A message types: discover, query, mutate, subscribe, delegate
- REST API: `/api/v1/federation/*` endpoints
- WebSocket: Real-time subscriptions
- Policy engine: Auto-approve based on rules in `federation.config.json`
- MCP integration: Agents can use cross-repo tools
- Metrics dashboard: Track cross-repo traffic, latency, approval rates

**Schema Changes**:
- Add `cross_repo_subscriptions` table
- Add `capabilities` field to `remote_repos` table

**Agent Autonomy**: Agents can collaborate with minimal human oversight (within policy limits)

**Timeline**: 4-6 weeks

---

### Phase 4: Advanced Patterns (Research & Optimization)
**Goal**: Enable sophisticated multi-repo orchestration

**Features**:
- Distributed task scheduling: Agents negotiate who does what
- Federated search: `sudocode search "authentication bug" --all-repos`
- Conflict resolution: Handle duplicate IDs across repos elegantly
- Performance optimization: GraphQL API for complex queries, CDN for cached data
- Network effects: Public registry of sudocode repos (opt-in)
- Cross-repo CI/CD: Block deployments if remote dependencies not ready

**Timeline**: Ongoing research

---

## Use Cases and Examples

### Use Case 1: Microservices Dependency Tracking

**Scenario**: Frontend needs new API endpoint

```bash
# Frontend repo
$ cd frontend
$ sudocode issue create "Add user profile page" --id issue-100

# During implementation, agent discovers API missing
$ sudocode remote create-issue github.com/org/api-service \
    --title "Add user profile endpoint" \
    --description "Frontend needs GET /api/v1/users/:id" \
    --labels "api,frontend-request" \
    --discovered-from "issue-100"

→ Request ID: req-abc123
→ Status: Pending approval from api-service maintainers
→ Approval URL: https://api-service.dev/approvals/req-abc123

# API service repo
$ cd api-service
$ sudocode requests pending

→ [req-abc123] Frontend requests: "Add user profile endpoint"
  From: github.com/org/frontend
  Requested by: claude-code-agent
  Priority: 2
  Labels: api, frontend-request

$ sudocode request approve req-abc123

→ Created: issue-084 in api-service
→ Relationships: Blocks org/frontend#issue-100

# Frontend repo (auto-updated via webhook or sync)
$ sudocode issue show issue-100

→ Issue: issue-100 - Add user profile page
  Status: blocked
  Blocked by:
    - org/api-service#issue-084 (open) - "Add user profile endpoint"

# Later, when API issue is closed
$ sudocode issue show issue-100

→ Issue: issue-100 - Add user profile page
  Status: open
  Blocked by: (none - ready to proceed!)
```

---

### Use Case 2: Open Source Ecosystem Coordination

**Scenario**: Framework delegates plugin development to community

```bash
# Framework repo
$ cd framework
$ sudocode spec create plugin-system --type architecture

# Framework identifies need for plugins
$ sudocode remote add github.com/community/auth-plugin --trust verified
$ sudocode remote add github.com/community/storage-plugin --trust verified

# Framework delegates tasks
$ sudocode remote delegate github.com/community/auth-plugin \
    --type spec \
    --title "Auth plugin for v2.0" \
    --description "Implement new auth API..." \
    --context '{"api_version": "2.0", "breaking_changes": false}'

→ Delegation sent to community/auth-plugin
→ Status: Pending acceptance

# Plugin repo
$ cd auth-plugin
$ sudocode delegates pending

→ [del-xyz789] Framework requests: "Auth plugin for v2.0"
  From: github.com/org/framework
  Type: spec
  Context: {"api_version": "2.0", ...}

$ sudocode delegate accept del-xyz789

→ Created: spec-015 in auth-plugin
→ Bidirectional link established

# Framework can now track progress
$ cd framework
$ sudocode remote query github.com/community/auth-plugin issue \
    --filters '{"spec_refs": ["spec-015"]}'

→ [issue-042] Implement auth interface (in_progress)
→ [issue-043] Add tests for auth flow (open)
```

---

### Use Case 3: Multi-Team Enterprise Coordination

**Scenario**: Platform team coordinates across 10 service teams

```bash
# Platform repo (hub)
$ cd platform
$ sudocode spec create "Q4 Migration to v2 API" --type epic

# Auto-discover all services
$ sudocode remote discover github.com/org/* --auto-add

→ Found 10 services
→ Added: api-gateway, auth-service, billing-service, ...

# Create issues in all services
$ for service in $(sudocode remote list --format=url); do
    sudocode remote create-issue $service \
      --title "Migrate to platform v2 API" \
      --labels "platform-migration,q4" \
      --priority 1 \
      --auto-approve
  done

→ Created 10 issues across services

# Track progress
$ sudocode remote query-all issue --filters '{"labels": ["platform-migration"]}'

→ Total: 10 issues
→ Open: 3
→ In Progress: 5
→ Closed: 2
→ Blocked: 0

# View blocking dependencies
$ sudocode deps graph --cross-repo --format ascii

          Platform (spec-042)
          /      |      \
         /       |       \
   Auth(✓)   API(→)   Billing(✗)
               |
           Gateway(⧗)

Legend: ✓=closed, →=in-progress, ✗=blocked, ⧗=open

# Get blocker details
$ sudocode issue why-blocked org/billing#issue-084

→ org/billing#issue-084 is blocked by:
  - org/database#issue-123 (open) - "Add billing schema v2"
    Estimated completion: 2025-11-10
```

---

## Technical Requirements

### 1. Network and Transport

- [ ] HTTP/1.1 and HTTP/2 support
- [ ] TLS 1.2+ required for all external communication
- [ ] WebSocket support (RFC 6455)
- [ ] Git protocol support (https, ssh, git://)
- [ ] Graceful handling of network failures (retries, exponential backoff)
- [ ] Timeout configuration per operation type
- [ ] Connection pooling for HTTP requests

### 2. Data Consistency

- [ ] Eventual consistency model for cached remote data
- [ ] Conflict detection on sync (compare timestamps, hashes)
- [ ] Conflict resolution strategies:
  - Last-write-wins (default)
  - Manual merge (for critical conflicts)
  - AI-assisted merge (use Claude to resolve)
- [ ] Atomic operations for local writes
- [ ] Optimistic locking for concurrent updates
- [ ] Idempotent A2A message handling (deduplicate by request_id)

### 3. Performance

- [ ] Cache remote data locally (TTL: 5 minutes default, configurable)
- [ ] Lazy loading: Only fetch remote data when viewed
- [ ] Batch queries: Single request for multiple entities
- [ ] Pagination: Limit query results (default: 50, max: 500)
- [ ] GraphQL support for complex queries (optional, future)
- [ ] CDN integration for public data (optional, future)

### 4. Security

- [ ] Input validation on all A2A messages (JSON schema)
- [ ] Output sanitization (prevent XSS in cached remote data)
- [ ] SQL injection prevention (use parameterized queries)
- [ ] Rate limiting per remote repo
- [ ] Secrets management (use .sudocode/secrets.env, gitignored)
- [ ] Audit logging for all cross-repo operations
- [ ] CORS configuration for API endpoints
- [ ] CSRF protection for mutation endpoints

### 5. Monitoring and Observability

- [ ] Metrics:
  - Cross-repo request count, latency (p50, p95, p99)
  - Error rate by operation type
  - Cache hit rate for remote data
  - Approval queue depth and wait time
- [ ] Logging:
  - Structured logs (JSON format)
  - Correlation IDs for tracing requests across repos
  - Debug mode for verbose A2A message logs
- [ ] Alerts:
  - Remote repo unreachable for > 10 minutes
  - Approval queue backlog > 20 items
  - Error rate > 5% for any remote repo

### 6. Scalability

- [ ] Horizontal scaling: Stateless API servers (session in JWT)
- [ ] Database sharding: Partition by local_uuid hash (future, if needed)
- [ ] Message queue: Async processing for mutations (optional, use Redis/RabbitMQ)
- [ ] Worker pool: Background sync jobs for remote repos
- [ ] Circuit breaker: Pause requests to failing remotes

### 7. Developer Experience

- [ ] CLI commands intuitive and discoverable (`sudocode remote --help`)
- [ ] Web UI for approvals and monitoring
- [ ] Clear error messages with actionable suggestions
- [ ] Documentation with examples for each A2A message type
- [ ] Onboarding guide: "Your first cross-repo integration"
- [ ] VS Code extension: Inline visualization of cross-repo deps

---

## Configuration Reference

### `.sudocode/federation.config.json`

```json
{
  "enabled": true,
  "local_identity": {
    "url": "github.com/org/my-repo",
    "display_name": "My Service",
    "description": "User authentication service"
  },

  "endpoints": {
    "rest": "https://my-service.dev/api/v1",
    "websocket": "wss://my-service.dev/api/v1/ws",
    "git": "https://github.com/org/my-repo.git"
  },

  "remote_repos": [
    {
      "url": "github.com/org/api-gateway",
      "display_name": "API Gateway",
      "trust_level": "trusted",
      "permissions": {
        "query": { "allowed": true },
        "mutate": {
          "allowed": true,
          "auto_approve_conditions": ["priority >= 2"]
        },
        "subscribe": { "allowed": true }
      },
      "sync": {
        "auto_sync": true,
        "interval_minutes": 15
      }
    }
  ],

  "policies": {
    "incoming_requests": {
      "query": {
        "allowed": true,
        "rate_limit": { "requests_per_minute": 60 }
      },
      "mutate": {
        "allowed": true,
        "auto_approve": [
          {
            "condition": "trust_level === 'trusted' && priority >= 2",
            "notify": []
          }
        ],
        "require_approval": [
          {
            "condition": "priority <= 1 || labels.includes('breaking-change')",
            "notify": ["@team-leads", "@oncall"]
          }
        ]
      }
    }
  },

  "cache": {
    "ttl_seconds": 300,
    "max_size_mb": 100,
    "eviction_policy": "lru"
  },

  "notifications": {
    "channels": [
      {
        "type": "slack",
        "webhook_url": "https://hooks.slack.com/...",
        "events": ["request_pending_approval", "remote_repo_unreachable"]
      }
    ]
  }
}
```

### `.sudocode/secrets.env`

```bash
# Gitignored - store sensitive credentials

# Outgoing auth (for calling remote repos)
REMOTE_REPO_TOKEN_API_GATEWAY=ghp_xxxxxxxxxxxx
REMOTE_REPO_TOKEN_AUTH_SERVICE=ghp_yyyyyyyyyyyy

# Incoming auth (for validating incoming requests)
FEDERATION_API_KEY=secret-key-for-incoming-requests

# Webhook signing secret
WEBHOOK_SIGNING_SECRET=secret-for-verifying-webhook-signatures
```

---

## Open Questions and Future Work

### Research Topics

1. **Global ID Registry**: Should there be an optional centralized UUID registry to prevent collisions across the ecosystem?

2. **Blockchain Integration**: Could a blockchain provide immutable audit trail and decentralized trust for high-stakes environments?

3. **Federated Analytics**: How to aggregate metrics across repos while preserving privacy?

4. **Cross-Repo AI Agents**: Can agents autonomously negotiate task allocation across repos? What safety mechanisms are needed?

5. **Conflict Resolution**: When two repos claim conflicting requirements, how should the system mediate?

6. **Versioning**: How to handle schema evolution? (e.g., repo A uses sudocode v1.0, repo B uses v2.0)

7. **Offline Mode**: How to handle cross-repo refs when network is unavailable? Graceful degradation?

8. **Large Scale**: At 1000+ repos in an enterprise, does the mesh topology scale? Need hierarchy?

### Known Limitations

- **No Transactions**: Cross-repo operations are not atomic (one repo might succeed, another fail)
- **No Global Ordering**: Events in different repos may have different timestamps (clock skew)
- **Trust Required**: Malicious repo could spam requests or provide false data
- **Network Dependency**: Real-time features require reliable network

### Migration Path

For existing sudocode installations:

1. **Opt-In**: Federation disabled by default (`enabled: false`)
2. **Backward Compatible**: Existing repos work without changes
3. **Gradual Adoption**: Start with read-only, then add mutations
4. **Feature Flags**: Enable/disable federation per repo

---

## Comparison to Existing Systems

| Feature | Sudocode Federation | GitHub Issues | Jira | Linear | Phabricator |
|---------|---------------------|---------------|------|--------|-------------|
| Cross-repo refs | ✅ Fully supported | ⚠️ Mentions only | ⚠️ Jira links | ⚠️ Manual | ✅ Differential deps |
| Distributed | ✅ Git-native | ❌ Centralized | ❌ Centralized | ❌ Centralized | ❌ Centralized |
| A2A protocol | ✅ Standardized | ❌ No | ❌ No | ❌ No | ❌ No |
| Agent-first | ✅ Built-in | ⚠️ Via bots | ⚠️ Via API | ⚠️ Via API | ⚠️ Via Conduit |
| Offline-capable | ✅ Git + cache | ❌ No | ❌ No | ❌ No | ⚠️ Partial |
| Auto-approval | ✅ Policy-based | ❌ No | ⚠️ Workflows | ❌ No | ❌ No |
| Audit trail | ✅ Git + SQL | ⚠️ Events API | ✅ Activity log | ✅ Audit log | ✅ Herald logs |

**Unique Value Prop**: Only system that combines git-native storage, A2A protocol, and agent-first design for truly distributed, autonomous collaboration.

---

## Conclusion

Cross-repository federation transforms sudocode from a single-repo tool into a **distributed operating system for software development**. By treating repositories as autonomous agents that communicate through standardized protocols, we enable:

- **Organic collaboration** across team and organizational boundaries
- **Explicit dependencies** that machines can reason about
- **Autonomous coordination** with appropriate human oversight
- **Scalable architecture** that grows with organizational complexity

The phased implementation plan provides a **low-risk path** from read-only visibility to full agent autonomy, allowing early adopters to validate the concept before committing to advanced features.

This design positions sudocode as **infrastructure for the multiagent future** of software development, where AI agents and humans collaborate seamlessly across repository boundaries, with full traceability and version control.

---

## References

- [A2A Protocol Specification](https://github.com/anthropics/agent-protocol) (hypothetical - replace with actual link)
- [sudocode Overview](./overview.md)
- [sudocode Data Model](./data-model.md)
- [sudocode Storage Layer](./storage.md)
- [Git Notes Documentation](https://git-scm.com/docs/git-notes)
- [WebSocket RFC 6455](https://tools.ietf.org/html/rfc6455)

---

**Document Status**: Draft for review
**Last Updated**: 2025-11-06
**Authors**: Claude Code (with human guidance)
**Version**: 0.1.0
