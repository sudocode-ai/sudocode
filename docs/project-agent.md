# Project Agent System

**Status:** Specification
**Version:** 1.0
**Last Updated:** 2025-11-06

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Objectives](#goals--objectives)
3. [Architecture Summary](#architecture-summary)
4. [UX Requirements](#ux-requirements)
5. [Technical Architecture](#technical-architecture)
6. [API Specifications](#api-specifications)
7. [Database Schema](#database-schema)
8. [Implementation Phases](#implementation-phases)
9. [Configuration](#configuration)
10. [Testing Strategy](#testing-strategy)
11. [Success Metrics](#success-metrics)

---

## Overview

The **Project Agent** is a higher-level autonomous agent that operates at the project scope, providing orchestration, monitoring, and coordination capabilities across all specs, issues, and executions. Unlike issue-scoped agents that work in isolated worktrees on individual tasks, the project agent maintains a holistic view of the entire project state and helps manage the development workflow.

### Key Capabilities

- **Planning & Coordination**: Break down specs into issues, manage dependencies
- **Execution Orchestration**: Start and monitor issue executions based on priorities
- **Intelligent Monitoring**: Detect stalled executions, identify patterns
- **Spec Refinement**: Review specs for completeness, suggest improvements
- **Progress Reporting**: Generate project status and health metrics

---

## Goals & Objectives

### Primary Goals

1. **Reduce Manual Overhead**: Automate routine project management tasks (triaging, planning, starting executions)
2. **Improve Project Velocity**: Identify and execute ready issues faster, minimize idle time
3. **Enhance Quality**: Catch issues early through monitoring and spec review
4. **Maintain User Control**: Provide transparency and approval mechanisms for all actions

### Non-Goals

- Replace human judgment in architectural decisions
- Fully autonomous operation without user oversight (at least initially)
- Cross-repository coordination (future enhancement)

---

## Architecture Summary

### Selected Architecture: Hybrid Agent Pool Manager

```
┌────────────────────────────────────────────────────────────┐
│  Agent Pool Manager (in server process)                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Issue Agents Pool                                   │ │
│  │  - Max 3 concurrent (existing)                       │ │
│  │  - Each runs in isolated worktree                    │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Project Agent (singleton)                           │ │
│  │  - Runs in special worktree OR main repo             │ │
│  │  - Monitors pool and project state                   │ │
│  │  - Proposes and executes approved actions            │ │
│  │  - Subscribes to event bus                           │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Event Bus                                           │ │
│  │  - Filesystem watcher events                         │ │
│  │  - Execution lifecycle events                        │ │
│  │  - Entity CRUD events                                │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Architecture** | Hybrid Agent Pool Manager | Leverages existing execution infrastructure, single process |
| **Worktree Strategy** | Special worktree with main repo option | Allows experimental changes with option for read-only monitoring |
| **Approval Model** | Configurable (default: require approval for destructive actions) | Balances autonomy and user control |
| **Communication** | Event bus with filesystem watcher | Real-time reactivity to changes |
| **AI Model** | Same as issue agents (user-configurable) | Consistency in behavior |
| **Execution Visibility** | Live stream access + worktree inspection | Deep monitoring and debugging capabilities |

---

## UX Requirements

### User Interaction Model: Hybrid with Notifications

The project agent operates as a **background process with explicit approval for actions**. Users are notified of suggestions and can approve/reject them through the UI.

### Core User Flows

#### Flow 1: Starting the Project Agent

```
User Action: Click "Start Project Agent" in UI
              ↓
System: Creates project agent execution (agent_type: "project-coordinator")
              ↓
Project Agent: Initializes, analyzes project state
              ↓
UI: Shows "Project Agent Active" badge with status
```

**UI Components:**
- **Project Agent Control Panel**: Start/stop button, status indicator, activity log
- **Location**: New tab in main navigation OR floating widget

#### Flow 2: Spec → Issues (Assisted Planning)

```
1. User creates SPEC-042: "Add user authentication system"
2. Project Agent (automatic via event):
   - Detects new spec (filesystem watcher)
   - Analyzes spec content
   - Identifies ambiguity: "Which auth method?"
   - Adds feedback with anchor to spec

3. User responds in feedback: "OAuth + JWT"

4. Project Agent (triggered by feedback update):
   - Breaks down into issues:
     * ISS-150: Setup OAuth provider integration (P0)
     * ISS-151: Implement JWT token generation (P0)
     * ISS-152: Add auth middleware (P1)
     * ISS-153: Write auth tests (P1)
   - Links: ISS-150 blocks ISS-152, ISS-151 blocks ISS-152
   - Creates Action: "create_issues_from_spec"
   - Status: "proposed"

5. UI: Notification badge appears
   "Project Agent: 1 suggestion"

6. User clicks notification:
   Modal shows:
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Action: Create 4 issues from SPEC-042

   Proposed Issues:
   ✓ ISS-150: Setup OAuth provider integration (P0)
   ✓ ISS-151: Implement JWT token generation (P0)
   ✓ ISS-152: Add auth middleware (P1)
     [Blocked by: ISS-150, ISS-151]
   ✓ ISS-153: Write auth tests (P1)

   [Approve] [Modify] [Reject]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

7. User clicks "Approve"
8. Project Agent creates issues and relationships
9. UI: Notification updates to "ISS-150 ready - execute?"
```

**UI Components:**
- **Notification Center**: Badge with count, panel with action list
- **Action Review Modal**: Detailed view of proposed action with approve/reject buttons
- **Spec Feedback Panel**: Shows agent feedback inline with spec content

#### Flow 3: Automated Execution Start

```
1. ISS-42 becomes ready (no blockers)
2. Project Agent (monitoring via event bus):
   - Detects issue status change
   - Checks execution priority heuristics
   - Proposes action: "start_execution"

3. UI: Notification appears
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Action: Start execution for ISS-42

   Issue: ISS-42 - Setup OAuth provider
   Priority: P0
   Estimated Duration: ~30 minutes

   Justification: Issue is ready, no active executions,
   high priority, blocks 2 other issues.

   [Start Now] [Schedule] [Skip]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. User clicks "Start Now"
5. Project Agent calls execution.start(issue_id: "ISS-42")
6. UI: Redirects to execution detail page
```

**UI Components:**
- **Execution Action Card**: Shows issue details, justification, quick actions
- **Schedule Picker**: Optional scheduling for later execution

#### Flow 4: Execution Monitoring & Intervention

```
1. ISS-99 execution running for 45 minutes
2. Project Agent (monitoring via SSE + worktree inspection):
   - Subscribes to execution SSE stream
   - Detects: No new events in 30 minutes
   - Inspects worktree: Process running but no file changes
   - Last tool call: `npm install` (likely hung)
   - Proposes action: "pause_execution"

3. UI: Alert notification (red badge)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚠️ Action: Pause stalled execution

   Execution: ISS-99 (running 45min)
   Status: Possible stall detected
   Last Activity: 30 minutes ago
   Last Tool: npm install

   Analysis: Process appears hung on dependency
   installation. Recommend pause and restart.

   [Pause & Restart] [View Details] [Ignore]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. User clicks "View Details"
5. UI: Opens execution detail with highlighted stall point
6. User clicks "Pause & Restart"
7. Project Agent:
   - Pauses execution (graceful SIGTERM)
   - Creates follow-up execution with modified config:
     * Adds prompt context: "Previous attempt stalled on npm install"
     * Suggests using --force or different registry
   - Starts follow-up execution
```

**UI Components:**
- **Execution Health Dashboard**: Shows all running executions with health indicators
- **Stall Detection Alert**: Red badge, detailed analysis modal
- **Recovery Actions**: Quick actions for common interventions

#### Flow 5: Project Status Report

```
1. User clicks "Generate Status Report" (manual trigger)
   OR
   Project Agent runs on schedule (daily/weekly)

2. Project Agent:
   - Queries project.analyze()
   - Aggregates metrics
   - Identifies trends and blockers
   - Generates markdown report

3. UI: Shows report in modal
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📊 Project Status Report
   Generated: 2025-11-06 14:30

   ## Summary
   - 12 specs (8 active, 4 archived)
   - 35 issues (5 ready, 8 in progress, 2 blocked, 20 closed)
   - 3 executions running
   - 85% success rate (last 7 days)

   ## Progress
   This Week: 12 issues completed, 3 new specs added

   ## Blockers
   ⚠️ ISS-77 blocked by ISS-65 (in progress, ETA 2 days)
   ⚠️ SPEC-9 needs clarification (missing auth requirements)

   ## Recommendations
   1. Start execution for ISS-42 (ready, high priority)
   2. Review SPEC-9 feedback (added by agent)
   3. Archive 8 closed issues from last month

   [Export PDF] [Close]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**UI Components:**
- **Status Report Modal**: Formatted report with charts
- **Report History**: Archive of previous reports
- **Export Options**: PDF, Markdown, JSON

### Notification System Requirements

#### Notification Types

| Type | Icon | Color | Priority |
|------|------|-------|----------|
| Suggestion | 💡 | Blue | Normal |
| Action Ready | ✅ | Green | Normal |
| Warning | ⚠️ | Yellow | High |
| Error | ❌ | Red | Critical |
| Info | ℹ️ | Gray | Low |

#### Notification Behaviors

- **Badge Count**: Shows number of pending actions
- **Grouping**: Group similar notifications (e.g., "3 issues ready to execute")
- **Persistence**: Notifications persist until user dismisses or action is taken
- **Sound**: Optional sound for high-priority notifications (user-configurable)

### Approval Configuration UI

```
┌─────────────────────────────────────────────────┐
│ Project Agent Settings                          │
├─────────────────────────────────────────────────┤
│                                                 │
│ Approval Mode:                                  │
│ ◉ Require approval for destructive actions     │
│ ○ Always require approval                      │
│ ○ Fully autonomous (approve all)               │
│                                                 │
│ Auto-Approve Actions:                           │
│ ☑ Add feedback to specs                        │
│ ☑ Create issues from specs                     │
│ ☐ Start executions                             │
│ ☐ Pause executions                             │
│ ☐ Modify specs                                 │
│                                                 │
│ Monitoring:                                     │
│ ☑ Watch for stalled executions                 │
│ ☑ Analyze spec completeness                    │
│ ☑ Suggest ready issues                         │
│                                                 │
│ Schedule:                                       │
│ Status Report: ▼ Daily at 9:00 AM              │
│                                                 │
│                              [Save] [Cancel]    │
└─────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Component Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Server Process                             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Agent Pool Manager (execution/engine/agent-pool-manager.ts)│ │
│  │                                                             │ │
│  │  Issue Agent Pool:                                          │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐               │ │
│  │  │ Agent 1   │ │ Agent 2   │ │ Agent 3   │               │ │
│  │  │ ISS-42    │ │ ISS-43    │ │ ISS-44    │               │ │
│  │  │ Worktree  │ │ Worktree  │ │ Worktree  │               │ │
│  │  └───────────┘ └───────────┘ └───────────┘               │ │
│  │                                                             │ │
│  │  Project Agent:                                             │ │
│  │  ┌─────────────────────────────────────────────────┐      │ │
│  │  │ Project Agent                                   │      │ │
│  │  │ - Worktree: .sudocode/worktrees/project-agent  │      │ │
│  │  │   OR main repo (configurable)                   │      │ │
│  │  │ - Status: observing/planning/acting             │      │ │
│  │  │ - Action queue: proposed/approved/executing     │      │ │
│  │  └─────────────────────────────────────────────────┘      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Event Bus (server/services/event-bus.ts)                   │ │
│  │                                                             │ │
│  │  Filesystem Watcher:                                        │ │
│  │  - .sudocode/specs/*.md                                    │ │
│  │  - .sudocode/issues/*.md                                   │ │
│  │                                                             │ │
│  │  Execution Events:                                          │ │
│  │  - execution:created                                        │ │
│  │  - execution:started                                        │ │
│  │  - execution:completed                                      │ │
│  │  - execution:failed                                         │ │
│  │                                                             │ │
│  │  Entity Events:                                             │ │
│  │  - spec:created, spec:updated                              │ │
│  │  - issue:created, issue:updated, issue:status_changed      │ │
│  │  - relationship:created                                     │ │
│  │  - feedback:created                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Action Manager (server/services/project-agent-actions.ts)  │ │
│  │ - Action queue management                                   │ │
│  │ - Approval workflow                                         │ │
│  │ - Action execution                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### New Components

#### 1. Agent Pool Manager
**Location:** `server/src/execution/engine/agent-pool-manager.ts`

**Responsibilities:**
- Manage issue agent pool (existing functionality)
- Manage project agent lifecycle (start/stop)
- Coordinate between project agent and issue agents
- Enforce concurrency limits

**Key Methods:**
```typescript
class AgentPoolManager extends SimpleEngine {
  private projectAgent: ProjectAgentExecution | null = null;

  async startProjectAgent(config: ProjectAgentConfig): Promise<Execution>
  async stopProjectAgent(): Promise<void>
  async getProjectAgentStatus(): Promise<ProjectAgentStatus>

  // Override to reserve slot for project agent
  async submitTask(task: ExecutionTask): Promise<string>
}
```

#### 2. Event Bus
**Location:** `server/src/services/event-bus.ts`

**Responsibilities:**
- Watch filesystem for changes
- Emit events on entity CRUD operations
- Manage event subscriptions
- Buffer events for replay

**Key Methods:**
```typescript
class EventBus extends EventEmitter {
  async initialize(): Promise<void>
  subscribe(eventType: string, handler: EventHandler): Subscription
  emit(eventType: string, payload: any): void

  private watchFilesystem(): void
  private emitExecutionEvent(execution: Execution): void
}
```

**Event Types:**
```typescript
type EventType =
  | 'filesystem:spec_created'
  | 'filesystem:spec_updated'
  | 'filesystem:issue_created'
  | 'filesystem:issue_updated'
  | 'execution:created'
  | 'execution:started'
  | 'execution:updated'
  | 'execution:completed'
  | 'execution:failed'
  | 'execution:paused'
  | 'issue:status_changed'
  | 'relationship:created'
  | 'feedback:created';
```

#### 3. Project Agent Execution
**Location:** `server/src/execution/process/project-agent-executor.ts`

**Responsibilities:**
- Spawn and manage project agent process
- Subscribe to event bus
- Handle action proposals
- Monitor issue agent executions

**Key Methods:**
```typescript
class ProjectAgentExecutor {
  private eventBus: EventBus;
  private actionManager: ActionManager;
  private sseSubscriptions: Map<string, SSETransport> = new Map();

  async start(config: ProjectAgentConfig): Promise<void>
  async stop(): Promise<void>

  private handleEvent(event: Event): Promise<void>
  private subscribeToExecution(executionId: string): void
  private inspectWorktree(worktreePath: string): Promise<WorktreeInspection>
}
```

#### 4. Action Manager
**Location:** `server/src/services/project-agent-actions.ts`

**Responsibilities:**
- Store proposed actions
- Manage approval workflow
- Execute approved actions
- Handle auto-approval based on config

**Key Methods:**
```typescript
class ActionManager {
  async proposeAction(action: ProposedAction): Promise<string>
  async approveAction(actionId: string, userId?: string): Promise<void>
  async rejectAction(actionId: string, reason?: string): Promise<void>
  async executeAction(actionId: string): Promise<ActionResult>

  private shouldAutoApprove(action: ProposedAction): boolean
  private broadcastActionUpdate(action: ProjectAgentAction): void
}
```

#### 5. Worktree Inspector
**Location:** `server/src/execution/worktree/inspector.ts`

**Responsibilities:**
- Inspect worktree state (files, git status, process info)
- Detect anomalies (hung processes, infinite loops)
- Extract diagnostic information

**Key Methods:**
```typescript
class WorktreeInspector {
  async inspect(worktreePath: string): Promise<WorktreeInspection>
  async detectStall(execution: Execution): Promise<StallDetection | null>
  async getProcessInfo(pid: number): Promise<ProcessInfo>
}

interface WorktreeInspection {
  gitStatus: GitStatus;
  fileChanges: FileChange[];
  processInfo: ProcessInfo;
  recentActivity: ActivityLog[];
  healthScore: number; // 0-100
}
```

### New MCP Tools

#### Execution Management Tools
**Location:** `mcp/src/tools/executions.ts`

```typescript
/**
 * List all executions with optional filters
 */
export async function listExecutions(
  client: SudocodeClient,
  params: {
    status?: ExecutionStatus;
    issue_id?: string;
    agent_type?: 'claude-code' | 'codex' | 'project-coordinator';
    limit?: number;
  }
): Promise<Execution[]>

/**
 * Show detailed execution information including logs and metrics
 */
export async function showExecution(
  client: SudocodeClient,
  params: { execution_id: string }
): Promise<ExecutionDetail>

/**
 * Start an execution for an issue
 */
export async function startExecution(
  client: SudocodeClient,
  params: {
    issue_id: string;
    config?: Partial<ExecutionConfig>;
    reason?: string; // Why this execution is being started
  }
): Promise<Execution>

/**
 * Pause a running execution
 */
export async function pauseExecution(
  client: SudocodeClient,
  params: {
    execution_id: string;
    reason: string;
  }
): Promise<void>

/**
 * Resume a paused execution
 */
export async function resumeExecution(
  client: SudocodeClient,
  params: {
    execution_id: string;
    additional_context?: string;
  }
): Promise<Execution>

/**
 * Get execution health status
 */
export async function getExecutionHealth(
  client: SudocodeClient,
  params: { execution_id: string }
): Promise<ExecutionHealth>
```

#### Project Analysis Tools
**Location:** `mcp/src/tools/project.ts`

```typescript
/**
 * Analyze overall project state and health
 */
export async function analyzeProject(
  client: SudocodeClient
): Promise<ProjectAnalysis>

interface ProjectAnalysis {
  specs: {
    total: number;
    needs_clarification: Array<{
      spec_id: string;
      title: string;
      issues: string[];
    }>;
    ready_to_implement: Spec[];
    blocked: Spec[];
  };
  issues: {
    ready: Issue[];
    blocked: Array<{
      issue: Issue;
      blocked_by: Issue[];
    }>;
    in_progress: Issue[];
    stale: Array<{
      issue: Issue;
      days_inactive: number;
    }>;
  };
  executions: {
    running: Execution[];
    completed_today: number;
    failed_today: number;
    stalled: Array<{
      execution: Execution;
      stall_duration_minutes: number;
      last_activity: string;
    }>;
  };
  recommendations: Array<{
    type: 'start_execution' | 'review_spec' | 'resolve_blocker';
    priority: 'high' | 'medium' | 'low';
    description: string;
    target_id: string;
  }>;
}

/**
 * Plan implementation for a spec
 */
export async function planSpec(
  client: SudocodeClient,
  params: {
    spec_id: string;
    include_existing?: boolean; // Include existing related issues
  }
): Promise<SpecPlan>

interface SpecPlan {
  spec: Spec;
  proposed_issues: Array<{
    title: string;
    description: string;
    priority: number;
    dependencies: string[]; // Issue titles that block this one
    estimated_complexity: 'small' | 'medium' | 'large';
  }>;
  existing_issues: Issue[];
  timeline_estimate: string;
  risks: string[];
}
```

#### Action Management Tools
**Location:** `mcp/src/tools/actions.ts`

```typescript
/**
 * Propose an action for user approval
 */
export async function proposeAction(
  client: SudocodeClient,
  params: {
    action_type: ActionType;
    target_id?: string;
    payload: any;
    justification: string;
    priority?: 'high' | 'medium' | 'low';
  }
): Promise<string> // Returns action_id

type ActionType =
  | 'create_issues_from_spec'
  | 'start_execution'
  | 'pause_execution'
  | 'add_feedback'
  | 'modify_spec'
  | 'create_relationship'
  | 'update_issue_status';

/**
 * List proposed actions
 */
export async function listActions(
  client: SudocodeClient,
  params: {
    status?: 'proposed' | 'approved' | 'rejected' | 'completed';
    limit?: number;
  }
): Promise<ProjectAgentAction[]>
```

### Worktree Configuration

The project agent supports two worktree modes:

#### Mode 1: Special Worktree (Default)
- Location: `.sudocode/worktrees/project-agent`
- Branch: `project-agent` (persistent, never deleted)
- Use Case: Experimental spec editing, issue creation with review

**Benefits:**
- Isolation: Changes don't affect main repo until committed
- Safety: Can experiment with spec modifications
- Git History: All agent actions tracked in commits

#### Mode 2: Main Repo (Optional)
- Location: Current working directory
- Branch: Current branch (read-only git access)
- Use Case: Read-only monitoring and analysis

**Benefits:**
- No worktree overhead
- Faster startup
- Simpler for pure monitoring mode

**Configuration:**
```typescript
interface ProjectAgentConfig {
  useWorktree: boolean; // Default: true
  worktreePath?: string; // Default: .sudocode/worktrees/project-agent
  mode: 'monitoring' | 'planning' | 'full'; // Default: full
  autoApprove: AutoApprovalConfig;
  monitoring: MonitoringConfig;
}
```

---

## API Specifications

### REST Endpoints

#### Project Agent Management

```
POST   /api/project-agent/start
GET    /api/project-agent/status
POST   /api/project-agent/stop
GET    /api/project-agent/config
PATCH  /api/project-agent/config
```

**Start Project Agent**
```http
POST /api/project-agent/start
Content-Type: application/json

{
  "config": {
    "useWorktree": true,
    "mode": "full",
    "autoApprove": {
      "enabled": true,
      "allowedActions": ["add_feedback", "create_issues_from_spec"]
    },
    "monitoring": {
      "stallThresholdMinutes": 30,
      "checkIntervalSeconds": 60
    }
  }
}

Response 200:
{
  "execution_id": "exec_proj_123",
  "status": "starting",
  "worktree_path": ".sudocode/worktrees/project-agent",
  "created_at": "2025-11-06T14:30:00Z"
}
```

**Get Project Agent Status**
```http
GET /api/project-agent/status

Response 200:
{
  "status": "running", // running | stopped | starting | error
  "execution_id": "exec_proj_123",
  "uptime_seconds": 3600,
  "mode": "full",
  "worktree_path": ".sudocode/worktrees/project-agent",
  "activity": {
    "last_event_processed": "2025-11-06T14:35:00Z",
    "events_processed": 42,
    "actions_proposed": 5,
    "actions_approved": 3
  },
  "monitoring": {
    "watching_executions": ["exec_123", "exec_456"],
    "next_check": "2025-11-06T14:36:00Z"
  }
}
```

#### Action Management

```
GET    /api/project-agent/actions
GET    /api/project-agent/actions/:id
POST   /api/project-agent/actions/:id/approve
POST   /api/project-agent/actions/:id/reject
```

**List Actions**
```http
GET /api/project-agent/actions?status=proposed&limit=10

Response 200:
{
  "actions": [
    {
      "id": "action_123",
      "action_type": "create_issues_from_spec",
      "status": "proposed",
      "target_id": "SPEC-042",
      "payload": {
        "issues": [
          {
            "title": "Setup OAuth provider integration",
            "description": "...",
            "priority": 0
          }
        ],
        "relationships": [
          { "from": "ISS-150", "to": "ISS-152", "type": "blocks" }
        ]
      },
      "justification": "Spec is complete and ready to implement...",
      "priority": "high",
      "created_at": "2025-11-06T14:30:00Z"
    }
  ],
  "total": 1
}
```

**Approve Action**
```http
POST /api/project-agent/actions/action_123/approve

Response 200:
{
  "action_id": "action_123",
  "status": "approved",
  "approved_at": "2025-11-06T14:31:00Z",
  "execution_started": true
}
```

#### Execution Extensions

```
GET    /api/executions/:id/health
POST   /api/executions/:id/pause
POST   /api/executions/:id/resume
GET    /api/executions/:id/inspect
```

**Get Execution Health**
```http
GET /api/executions/exec_123/health

Response 200:
{
  "execution_id": "exec_123",
  "health_score": 75, // 0-100
  "status": "running",
  "issues": [
    {
      "type": "slow_progress",
      "severity": "warning",
      "description": "No file changes in 15 minutes",
      "detected_at": "2025-11-06T14:30:00Z"
    }
  ],
  "metrics": {
    "duration_minutes": 25,
    "last_activity_minutes_ago": 15,
    "tool_calls_count": 42,
    "files_changed": 5
  },
  "recommendation": "continue" // continue | pause | restart | cancel
}
```

**Inspect Worktree**
```http
GET /api/executions/exec_123/inspect

Response 200:
{
  "execution_id": "exec_123",
  "worktree_path": ".sudocode/worktrees/exec_123",
  "git_status": {
    "branch": "sudocode/ISS-42",
    "ahead": 2,
    "behind": 0,
    "modified": ["src/auth.ts", "src/utils.ts"],
    "untracked": ["test.log"]
  },
  "process_info": {
    "pid": 12345,
    "cpu_percent": 5.2,
    "memory_mb": 512,
    "status": "running"
  },
  "recent_files": [
    {
      "path": "src/auth.ts",
      "last_modified": "2025-11-06T14:35:00Z",
      "size_bytes": 4096
    }
  ]
}
```

### Server-Sent Events (SSE)

#### Project Agent Stream

```http
GET /api/project-agent/stream
Accept: text/event-stream

Event Types:
- status_update: Agent status changed
- action_proposed: New action proposed
- action_approved: Action was approved
- action_completed: Action execution finished
- event_processed: Agent processed an event
- health_alert: Execution health issue detected
```

**Example Events:**
```
event: action_proposed
data: {"action_id":"action_123","type":"start_execution","target":"ISS-42"}

event: health_alert
data: {"execution_id":"exec_123","severity":"warning","message":"Possible stall"}

event: action_completed
data: {"action_id":"action_123","result":"success","details":"Execution started"}
```

---

## Database Schema

### New Tables

#### `project_agent_executions`
Special tracking for project agent executions.

```sql
CREATE TABLE project_agent_executions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, -- running | stopped | error
  mode TEXT NOT NULL, -- monitoring | planning | full
  use_worktree BOOLEAN NOT NULL DEFAULT 1,
  worktree_path TEXT,
  config_json TEXT NOT NULL, -- JSON serialized config

  -- Metrics
  events_processed INTEGER DEFAULT 0,
  actions_proposed INTEGER DEFAULT 0,
  actions_approved INTEGER DEFAULT 0,
  actions_rejected INTEGER DEFAULT 0,

  started_at TEXT NOT NULL,
  stopped_at TEXT,
  last_activity_at TEXT,

  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
```

#### `project_agent_actions`
Store proposed actions and their lifecycle.

```sql
CREATE TABLE project_agent_actions (
  id TEXT PRIMARY KEY,
  project_agent_execution_id TEXT NOT NULL,

  action_type TEXT NOT NULL, -- create_issues_from_spec | start_execution | etc.
  status TEXT NOT NULL, -- proposed | approved | rejected | executing | completed | failed
  priority TEXT, -- high | medium | low

  -- Action details
  target_id TEXT, -- Spec/Issue ID if applicable
  target_type TEXT, -- spec | issue | execution
  payload_json TEXT NOT NULL, -- JSON serialized action payload
  justification TEXT NOT NULL, -- AI explanation

  -- Lifecycle
  created_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  executed_at TEXT,
  completed_at TEXT,

  -- Result
  result_json TEXT, -- JSON serialized result
  error_message TEXT,

  FOREIGN KEY (project_agent_execution_id) REFERENCES project_agent_executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_project_agent_actions_status ON project_agent_actions(status);
CREATE INDEX idx_project_agent_actions_created ON project_agent_actions(created_at);
```

#### `project_agent_events`
Log of events processed by project agent.

```sql
CREATE TABLE project_agent_events (
  id TEXT PRIMARY KEY,
  project_agent_execution_id TEXT NOT NULL,

  event_type TEXT NOT NULL,
  event_payload_json TEXT NOT NULL,

  processed_at TEXT NOT NULL,
  processing_duration_ms INTEGER,

  -- Action taken (if any)
  action_id TEXT,

  FOREIGN KEY (project_agent_execution_id) REFERENCES project_agent_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES project_agent_actions(id) ON DELETE SET NULL
);

CREATE INDEX idx_project_agent_events_type ON project_agent_events(event_type);
CREATE INDEX idx_project_agent_events_processed ON project_agent_events(processed_at);
```

### Updated Tables

#### `executions`
Add support for project agent execution type.

```sql
-- Add new enum value to agent_type
-- agent_type: "claude-code" | "codex" | "project-coordinator"

-- No schema migration needed, just add validation in application layer
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Core infrastructure for project agent

#### Tasks
1. **Event Bus Implementation**
   - Create `EventBus` class with filesystem watcher
   - Integrate with existing entity CRUD operations
   - Add event emission to execution lifecycle
   - Test event propagation

2. **Database Schema**
   - Create migration for new tables
   - Add indexes
   - Update types in `types/src/index.d.ts`

3. **Agent Pool Manager**
   - Extend `SimpleEngine` to support project agent
   - Add project agent lifecycle management
   - Reserve execution slot for project agent

4. **Basic MCP Tools**
   - Implement `execution.list()`, `execution.show()`
   - Implement `project.analyze()` (basic version)
   - Test with manual MCP client

5. **Project Agent Prompt**
   - Create initial prompt template
   - Focus on monitoring and suggestions
   - No actions, just analysis

**Deliverable:** Project agent can start, subscribe to events, and produce analysis

**Testing:**
- Unit tests for EventBus
- Integration test: Start project agent, create spec, verify event received
- Manual test: Start agent, observe suggestions in logs

---

### Phase 2: UI & Approval System (Weeks 3-4)

**Goal:** User can see and approve project agent suggestions

#### Tasks
1. **Action Manager**
   - Implement `ActionManager` service
   - Create API endpoints for actions
   - Add approval workflow logic
   - Auto-approval configuration

2. **REST API**
   - Implement `/api/project-agent/*` endpoints
   - Add SSE stream endpoint
   - Update OpenAPI spec

3. **Frontend Components**
   - **Project Agent Control Panel**
     - Start/stop button
     - Status indicator
     - Activity log
   - **Notification Center**
     - Badge with count
     - Notification list panel
     - Click to view action details
   - **Action Review Modal**
     - Show proposed action with details
     - Approve/reject buttons
     - Modify option (future)

4. **MCP Action Tools**
   - Implement `actions.propose()`
   - Implement `actions.list()`
   - Update project agent prompt to propose actions

5. **WebSocket Integration**
   - Broadcast action events to frontend
   - Real-time notification updates

**Deliverable:** User can start project agent, see notifications, approve actions

**Testing:**
- API integration tests for all endpoints
- Frontend component tests
- E2E test: Start agent → Create spec → See notification → Approve action

---

### Phase 3: Orchestration (Weeks 5-6)

**Goal:** Project agent can start executions

#### Tasks
1. **Execution MCP Tools**
   - Implement `execution.start()`
   - Implement `execution.pause()`
   - Implement `execution.resume()`
   - Add safety checks (no duplicate executions)

2. **Action Executors**
   - Implement `StartExecutionExecutor`
   - Integrate with existing `ExecutionService`
   - Handle errors and rollback

3. **Project Agent Planning**
   - Enhance prompt for execution orchestration
   - Add heuristics for priority (ready, priority, blocks count)
   - Implement `project.planSpec()` for issue breakdown

4. **Frontend Updates**
   - **Execution Action Card** with justification
   - Redirect to execution detail after approval
   - Show execution link in action history

5. **Spec → Issues Flow**
   - Implement action: `create_issues_from_spec`
   - Parse agent's proposed issues
   - Create issues + relationships
   - Add feedback loop

**Deliverable:** Project agent proposes and starts executions with user approval

**Testing:**
- Integration test: Agent proposes execution → User approves → Execution starts
- Test spec breakdown: Agent creates issues with relationships
- Test priority heuristics: Agent picks highest priority ready issue

---

### Phase 4: Advanced Monitoring (Weeks 7-8)

**Goal:** Project agent detects and responds to execution problems

#### Tasks
1. **Execution Monitoring**
   - Subscribe project agent to execution SSE streams
   - Implement stall detection algorithm
   - Add health scoring logic

2. **Worktree Inspector**
   - Implement `WorktreeInspector` class
   - Git status, file changes, process info
   - Anomaly detection (no activity, hung process)

3. **Health API**
   - Implement `/api/executions/:id/health`
   - Implement `/api/executions/:id/inspect`
   - Add health metrics to execution detail page

4. **Intervention Actions**
   - Implement action: `pause_execution`
   - Add recovery suggestions
   - Follow-up execution creation

5. **Frontend Dashboard**
   - **Execution Health Dashboard**
     - List running executions with health scores
     - Visual indicators (green/yellow/red)
   - **Stall Detection Alert**
     - Modal with analysis and recovery options
   - **Recovery Actions**
     - Quick action buttons

**Deliverable:** Project agent monitors executions and suggests interventions

**Testing:**
- Simulate stalled execution, verify detection
- Test worktree inspection on real execution
- Test pause/resume flow with user approval

---

### Phase 5: Spec Refinement (Weeks 9-10)

**Goal:** Project agent helps improve spec quality

#### Tasks
1. **Spec Analysis**
   - Add spec quality heuristics
     - Missing sections (acceptance criteria, context)
     - Ambiguous language detection
     - Consistency with other specs
   - Implement feedback generation

2. **MCP Feedback Tools Enhancement**
   - Support bulk feedback creation
   - Add feedback categories (question, suggestion, blocker)

3. **Project Agent Spec Review Mode**
   - New mode: "spec_review"
   - Prompt for reviewing specs
   - Generate structured feedback

4. **Frontend Spec Workshop**
   - New view: Spec workshop
   - Shows spec with agent feedback inline
   - Accept/reject feedback
   - Regenerate after changes

5. **Action: Modify Spec**
   - Allow agent to propose spec edits
   - Show diff in approval modal
   - Apply approved changes

**Deliverable:** Project agent reviews specs and suggests improvements

**Testing:**
- Test spec analysis with incomplete spec
- Test feedback generation and anchoring
- Test spec modification approval flow

---

### Phase 6: Autonomous Mode & Polish (Weeks 11-12)

**Goal:** Project agent can operate with minimal supervision

#### Tasks
1. **Auto-Approval Enhancement**
   - Fine-tune auto-approval rules
   - Add confidence scores to actions
   - Risk assessment for actions

2. **Progress Reporting**
   - Implement scheduled reports (daily/weekly)
   - Generate markdown reports with charts
   - Export options (PDF, JSON)

3. **Performance Optimization**
   - Optimize event processing
   - Cache project analysis results
   - Reduce MCP tool call overhead

4. **Configuration Presets**
   - Predefined config modes:
     - "Conservative": Approve nothing automatically
     - "Balanced": Current defaults
     - "Aggressive": Auto-approve most actions
   - One-click preset selection

5. **Documentation**
   - User guide for project agent
   - Configuration reference
   - Troubleshooting guide
   - Example workflows

6. **Monitoring & Metrics**
   - Dashboard for project agent health
   - Action success rates
   - Time saved metrics
   - User satisfaction survey integration

**Deliverable:** Production-ready project agent with comprehensive docs

**Testing:**
- Load testing with many events
- E2E tests for all major workflows
- User acceptance testing
- Performance benchmarks

---

### Summary Timeline

| Phase | Duration | Key Deliverable |
|-------|----------|-----------------|
| Phase 1: Foundation | Weeks 1-2 | Project agent can monitor and analyze |
| Phase 2: UI & Approval | Weeks 3-4 | User can see and approve suggestions |
| Phase 3: Orchestration | Weeks 5-6 | Agent can start executions |
| Phase 4: Monitoring | Weeks 7-8 | Agent detects and responds to problems |
| Phase 5: Spec Refinement | Weeks 9-10 | Agent improves spec quality |
| Phase 6: Autonomous & Polish | Weeks 11-12 | Production-ready with full features |

**Total Duration:** ~12 weeks (3 months)

---

## Configuration

### Project Agent Configuration File

**Location:** `.sudocode/project-agent.json`

```json
{
  "enabled": true,
  "autoStart": false,
  "mode": "full",

  "worktree": {
    "enabled": true,
    "path": ".sudocode/worktrees/project-agent",
    "branch": "project-agent",
    "cleanupOnStop": false
  },

  "approval": {
    "mode": "selective",
    "autoApprove": {
      "add_feedback": true,
      "create_issues_from_spec": true,
      "start_execution": false,
      "pause_execution": false,
      "modify_spec": false
    },
    "requireApprovalForPriority": ["high"]
  },

  "monitoring": {
    "enabled": true,
    "stallThresholdMinutes": 30,
    "checkIntervalSeconds": 60,
    "watchExecutions": true,
    "healthScoreThreshold": 50
  },

  "planning": {
    "enabled": true,
    "autoAnalyzeNewSpecs": true,
    "suggestIssuesFromSpecs": true,
    "maxIssuesPerSpec": 10
  },

  "orchestration": {
    "enabled": true,
    "maxConcurrentExecutions": 3,
    "priorityWeights": {
      "priority": 0.5,
      "blocksCount": 0.3,
      "age": 0.2
    }
  },

  "reporting": {
    "enabled": true,
    "schedule": "daily",
    "time": "09:00",
    "format": "markdown"
  },

  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "temperature": 0.7,
    "maxTokens": 8192
  }
}
```

### Environment Variables

```bash
# Project agent settings
SUDOCODE_PROJECT_AGENT_ENABLED=true
SUDOCODE_PROJECT_AGENT_AUTO_START=false
SUDOCODE_PROJECT_AGENT_MODE=full # monitoring | planning | full

# Model configuration
SUDOCODE_PROJECT_AGENT_MODEL=claude-sonnet-4
SUDOCODE_PROJECT_AGENT_TEMPERATURE=0.7

# Monitoring
SUDOCODE_PROJECT_AGENT_STALL_THRESHOLD=30 # minutes
SUDOCODE_PROJECT_AGENT_CHECK_INTERVAL=60 # seconds
```

---

## Testing Strategy

### Unit Tests

**Coverage Target:** 80%+

#### Event Bus
- `event-bus.test.ts`
  - Event emission and subscription
  - Filesystem watcher triggers
  - Event buffering and replay

#### Action Manager
- `project-agent-actions.test.ts`
  - Action proposal and storage
  - Approval workflow
  - Auto-approval logic
  - Action execution

#### Worktree Inspector
- `worktree-inspector.test.ts`
  - Stall detection algorithm
  - Health scoring
  - Process info extraction

### Integration Tests

#### Project Agent Lifecycle
- `project-agent-lifecycle.test.ts`
  - Start/stop project agent
  - Event processing
  - Action proposal flow
  - MCP tool integration

#### Spec → Issues Flow
- `spec-to-issues.test.ts`
  - Create spec → Agent analyzes → Proposes issues
  - Approve action → Issues created with relationships
  - Verify feedback anchors

#### Execution Orchestration
- `execution-orchestration.test.ts`
  - Agent proposes execution → Approve → Execution starts
  - Multiple ready issues → Agent prioritizes correctly
  - Concurrent execution limits respected

#### Monitoring & Intervention
- `monitoring-intervention.test.ts`
  - Simulate stalled execution → Agent detects
  - Agent proposes pause → Approve → Execution paused
  - Health score calculation

### E2E Tests

**Framework:** Playwright

#### User Journey 1: First Time Setup
```typescript
test('user sets up project agent for first time', async ({ page }) => {
  // Navigate to settings
  await page.goto('/settings/project-agent');

  // Configure agent
  await page.selectOption('[name="mode"]', 'full');
  await page.check('[name="autoApprove.create_issues_from_spec"]');
  await page.click('button:text("Save")');

  // Start agent
  await page.click('button:text("Start Project Agent")');
  await expect(page.locator('.status-indicator')).toHaveText('Running');
});
```

#### User Journey 2: Spec to Execution
```typescript
test('complete flow from spec to execution', async ({ page }) => {
  // Assuming project agent is running

  // Create spec
  await page.goto('/specs');
  await page.click('button:text("Create Spec")');
  await page.fill('[name="title"]', 'Add OAuth authentication');
  await page.fill('[name="content"]', 'Implement OAuth 2.0...');
  await page.click('button:text("Create")');

  // Wait for agent to process
  await expect(page.locator('.notification-badge')).toBeVisible();

  // Open notifications
  await page.click('.notification-badge');
  await expect(page.locator('.notification-item')).toContainText('Create 4 issues');

  // Approve action
  await page.click('.notification-item:has-text("Create 4 issues")');
  await page.click('button:text("Approve")');

  // Verify issues created
  await page.goto('/issues');
  await expect(page.locator('.issue-card')).toHaveCount(4);

  // Wait for next notification (start execution)
  await expect(page.locator('.notification-badge')).toBeVisible();
  await page.click('.notification-badge');
  await page.click('button:text("Start Now")');

  // Verify execution started
  await expect(page).toHaveURL(/\/executions\/exec_\w+/);
});
```

### Performance Tests

#### Event Processing Performance
- Measure event processing latency
- Target: < 100ms per event
- Load test: 1000 events/minute

#### Action Execution Performance
- Measure time from approval to execution start
- Target: < 2 seconds

#### Dashboard Load Time
- Measure time to render project agent dashboard
- Target: < 1 second with 100+ actions

---

## Success Metrics

### Primary Metrics

1. **Time to First Execution**
   - **Metric:** Average time from spec creation to first issue execution
   - **Baseline:** Manual (estimated 2 hours)
   - **Target:** < 30 minutes with project agent
   - **Measurement:** Track timestamp from spec creation to execution start

2. **Issue Idle Time**
   - **Metric:** Average time ready issues sit idle before execution
   - **Baseline:** Manual (estimated 1 day)
   - **Target:** < 4 hours with project agent
   - **Measurement:** Track time from issue status=ready to execution start

3. **User Actions per Completed Issue**
   - **Metric:** Average number of manual user actions needed to complete an issue
   - **Baseline:** Manual (estimated 5-7 actions: create issue, start execution, review, merge, close)
   - **Target:** < 3 actions (approve issue creation, approve execution)
   - **Measurement:** Count user clicks/API calls per issue lifecycle

### Secondary Metrics

4. **Spec Quality Score**
   - **Metric:** Percentage of specs with complete information (no missing sections)
   - **Baseline:** Manual (estimated 60%)
   - **Target:** > 80% with project agent feedback
   - **Measurement:** Automated spec analysis

5. **Execution Success Rate**
   - **Metric:** Percentage of first executions that succeed without follow-up
   - **Baseline:** Manual (estimated 50%)
   - **Target:** > 70% with agent-prepared issues
   - **Measurement:** Track executions without follow-up flag

6. **Stall Detection Rate**
   - **Metric:** Percentage of stalled executions detected by project agent
   - **Target:** > 90%
   - **Measurement:** Manual review of stalled executions vs. agent detections

### User Satisfaction Metrics

7. **Action Approval Rate**
   - **Metric:** Percentage of project agent actions that are approved (vs. rejected)
   - **Target:** > 75%
   - **Measurement:** Track approved vs. rejected actions

8. **Feature Usage**
   - **Metric:** Percentage of projects with project agent enabled
   - **Target:** > 60% after 3 months
   - **Measurement:** Count projects with agent running

9. **User Survey**
   - **Questions:**
     - "Does project agent save you time?" (1-5 scale)
     - "Do you trust project agent suggestions?" (1-5 scale)
     - "Would you recommend project agent to others?" (Yes/No)
   - **Target:** Average score > 4/5, > 80% would recommend

### Technical Metrics

10. **Agent Uptime**
    - **Metric:** Percentage of time project agent is running without errors
    - **Target:** > 99%
    - **Measurement:** Track uptime vs. downtime

11. **Event Processing Latency**
    - **Metric:** Average time to process an event
    - **Target:** < 100ms
    - **Measurement:** Instrument event processing

12. **Action Execution Time**
    - **Metric:** Time from action approval to completion
    - **Target:** < 5 seconds (excluding execution start time)
    - **Measurement:** Track timestamps

---

## Risks & Mitigations

### Risk 1: Agent Makes Poor Decisions
**Impact:** High - Could create incorrect issues, start wrong executions
**Probability:** Medium
**Mitigation:**
- Require approval for all destructive actions initially
- Build confidence through transparency (show reasoning)
- Allow users to provide feedback on agent decisions
- Iterate on prompts based on user feedback

### Risk 2: Performance Degradation
**Impact:** Medium - Slow event processing could lag behind changes
**Probability:** Low
**Mitigation:**
- Implement event buffering and batching
- Use efficient database queries with indexes
- Profile and optimize hot paths
- Add performance monitoring

### Risk 3: High Operating Cost
**Impact:** Medium - Long-running agent could be expensive
**Probability:** Medium
**Mitigation:**
- Implement intelligent polling (slow down when idle)
- Use smaller models for routine tasks (future)
- Allow users to pause agent when not needed
- Provide cost transparency in dashboard

### Risk 4: User Trust Issues
**Impact:** High - Users might not adopt if they don't trust agent
**Probability:** Medium
**Mitigation:**
- Start with read-only analysis mode
- Show all reasoning and justifications
- Make it easy to undo agent actions
- Collect user feedback and iterate

### Risk 5: Conflicts with Manual Changes
**Impact:** Medium - Agent and user might modify same entities
**Probability:** Low
**Mitigation:**
- Implement optimistic locking on entity updates
- Detect conflicts and alert user
- Allow agent to refresh state and re-propose action

---

## Future Enhancements

Beyond the initial 12-week implementation, consider:

1. **Multi-Repository Support**
   - Project agent coordinates across multiple repos
   - Dependency tracking between repos

2. **Agent Swarms**
   - Multiple specialized agents working in parallel
   - Planner, Monitor, Reviewer agents

3. **Learning & Adaptation**
   - Agent learns from approved/rejected actions
   - Personalized suggestions based on user preferences

4. **Advanced Analytics**
   - Predictive analytics (estimate completion time)
   - Burndown charts and velocity tracking
   - Bottleneck identification

5. **CI/CD Integration**
   - Trigger project agent on GitHub Actions
   - Auto-create issues from CI failures

6. **Natural Language Interface**
   - User can chat with project agent
   - "What should I work on next?"
   - "Why is ISS-42 taking so long?"

---

## Appendix

### Glossary

- **Project Agent**: Autonomous agent that operates at project scope
- **Issue Agent**: Existing agent that works on individual issues in worktrees
- **Action**: Proposed change that requires user approval
- **Event Bus**: System for broadcasting and subscribing to events
- **Worktree**: Isolated git working directory for agent execution
- **Stall**: Execution with no progress for extended period

### Related Documents

- `docs/overview.md` - System overview
- `docs/data-model.md` - Entity relationship model
- `docs/feedback-mechanisms.md` - Feedback system architecture
- `docs/mcp.md` - MCP server documentation
- `docs/storage.md` - Storage layer documentation

### References

- [sudocode-ai/sudocode](https://github.com/sudocode-ai/sudocode) - Main repository
- SPEC-007: AG-UI Integration
- Execution Architecture (see codebase exploration notes)

---

**Document Maintenance:**
- Review and update after each phase completion
- Incorporate user feedback and lessons learned
- Update metrics based on actual usage data
