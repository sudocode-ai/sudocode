# Autonomous Issue Execution System

## Overview

The Autonomous Issue Execution System is a scheduler-based orchestration layer that automatically manages the execution of issues in parallel, respecting dependencies, enforcing quality gates, and coordinating branch management across related work streams.

**Core Capabilities:**
- Execute multiple issues concurrently (configurable parallelism, e.g., max 5)
- Respect issue dependencies and topological ordering
- Group related issues to share branches and coordinate execution
- Enforce quality gates (tests, lints, CI checks) before proceeding
- Automatically pause on roadblocks and wait for user intervention
- Visualize execution progress and dependencies in real-time

---

## Current State Analysis

### What Already Exists ✅

1. **Issue Dependency Tracking** (`/home/user/sudocode/cli/src/operations/relationships.ts`)
   - `blocks` and `depends-on` relationship types
   - Automatic status transitions when dependencies are added/removed
   - When blocker is closed → dependent automatically returns to `open`
   - When blocker is added → dependent automatically becomes `blocked`

2. **Ready Issues View** (`/home/user/sudocode/types/src/schema.ts`)
   - Database view: `ready_issues` - issues with `status='open'` AND no active blockers
   - Database view: `blocked_issues` - issues with blocker counts

3. **Execution Infrastructure** (`/home/user/sudocode/server/src/services/execution-service.ts`)
   - Complete workflow orchestration with `LinearOrchestrator`
   - Worktree isolation for parallel executions
   - Event-driven lifecycle (start, complete, failed events)
   - Follow-up execution support
   - Prompt template rendering

4. **Status State Machine**
   - States: `open`, `in_progress`, `blocked`, `needs_review`, `closed`
   - Automatic transitions based on relationships

5. **Branch Management** (`/home/user/sudocode/server/src/services/execution-lifecycle.ts`)
   - Auto-created branches per execution: `{branchPrefix}/{execution-id}/{sanitized-title}`
   - Default pattern: `sudocode/a1b2c3d4/implement-oauth-endpoint`
   - Configurable branch prefix and cleanup policies

6. **Tag System**
   - Free-form labels for organizing issues
   - Could be leveraged for grouping

### What's Missing ❌

1. **Autonomous Scheduler** - No automatic issue selection and execution triggering
2. **Concurrency Pool** - No parallelism control (max N concurrent executions)
3. **Issue Grouping** - No concept of "issue chains" or "work streams" that share branches
4. **Quality Gates** - No automated test verification before proceeding
5. **Topological Execution** - No dependency-aware ordering within groups
6. **Circular Dependency Detection** - No cycle detection in dependency graphs

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   ExecutionScheduler                        │
│                                                             │
│  - Polls ready issues every N seconds                      │
│  - Enforces max concurrency limit                          │
│  - Coordinates group execution                             │
│  - Manages execution lifecycle                             │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Uses
                  ▼
┌─────────────────────────────────────────────────────────────┐
│               IssueSelectionService                         │
│                                                             │
│  - Query ready_issues view                                 │
│  - Filter by group availability                            │
│  - Sort by priority + topological order                    │
│  - Detect circular dependencies                            │
│  - Return next issue to execute                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Delegates to
                  ▼
┌─────────────────────────────────────────────────────────────┐
│               ExecutionService (existing)                   │
│                                                             │
│  - Create execution records                                │
│  - Manage worktrees                                        │
│  - Run workflows via LinearOrchestrator                    │
│  - Handle execution lifecycle                              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Emits events
                  ▼
┌─────────────────────────────────────────────────────────────┐
│            QualityGateService (new)                         │
│                                                             │
│  - Run tests after execution                               │
│  - Execute validation commands                             │
│  - Check CI status (optional)                              │
│  - Determine if issue can be closed                        │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Updates
                  ▼
┌─────────────────────────────────────────────────────────────┐
│          IssueGroupService (new)                            │
│                                                             │
│  - Manage issue groups                                     │
│  - Coordinate branch sharing                               │
│  - Handle group pausing/resuming                           │
│  - Track group execution progress                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Design Challenges

### 1. Branch Isolation Strategy

**Problem:** How do we determine which issues should share a branch vs. get isolated branches?

**Current Behavior:**
- Each execution creates a new branch: `sudocode/{execution-id}/{issue-title}`
- No concept of "continuing work" on an existing branch
- No coordination between related issues

**Proposed Solution: Issue Groups**

Issues can optionally be organized into **Issue Groups** that define:
- A shared working branch for all issues in the group
- Base branch to branch from
- Execution coordination (only one issue executes per group at a time)
- Visual grouping (color-coding in UI)

**Design Options Considered:**

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **A: Explicit Issue Groups** | User controls grouping; flexible; clear boundaries | Requires user setup | ✅ **Recommended** |
| **B: Spec-Based Grouping** | Automatic based on `implements` relationships | Less flexible; rigid coupling | Consider as auto-suggestion |
| **C: Tag-Based Grouping** | Lightweight; reuses tags | Implicit; harder to visualize | Useful for simple cases |

**Implementation:** Start with **Option A** (explicit groups) and add auto-suggestions based on specs and tags.

---

### 2. Execution Selection Algorithm

**Requirements:**
- Respect global concurrency limit (e.g., max 5 concurrent executions)
- Only one execution per issue group at a time (to avoid branch conflicts)
- Prioritize by issue priority (0=highest, 4=lowest)
- Respect dependencies (execute blockers before blocked issues)
- Handle topological ordering within groups

**Algorithm:**

```typescript
async function selectNextIssue(
  db: Database,
  activeExecutions: Set<string>,
  issueGroups: IssueGroup[]
): Promise<Issue | null> {
  // 1. Get all ready issues (no blockers, status='open')
  const readyIssues = getReadyIssues(db);

  // 2. Filter out issues already executing
  const available = readyIssues.filter(
    issue => !isIssueCurrentlyExecuting(issue.id, activeExecutions)
  );

  // 3. Group issues by their issue group (if any)
  const grouped = groupByIssueGroup(available, issueGroups);

  // 4. Filter groups that have active executions
  // (one execution per group at a time)
  const groupsWithActiveWork = new Set(
    activeExecutions.map(execId => getIssueGroupForExecution(execId))
  );

  const availableByGroup = grouped.filter(
    ([groupId, issues]) => !groupsWithActiveWork.has(groupId)
  );

  // 5. Within each available group, get topologically first issue
  const candidates = availableByGroup.map(([groupId, issues]) => {
    return getNextIssueInTopologicalOrder(issues, db);
  });

  // 6. Select highest priority issue from candidates
  return candidates
    .sort((a, b) => a.priority - b.priority)[0] || null;
}
```

**Key Invariants:**
1. Maximum N executions globally (e.g., 5)
2. Maximum 1 execution per issue group
3. Dependencies always execute before dependents
4. Priority-based selection within constraints

---

### 3. Topological Ordering Within Groups

**Problem:** If a group has multiple ready issues with dependencies between them, we need to execute them in topological order.

**Example:**
```
Group: "Auth Feature"
├─ Issue A: "Implement login API" (priority: 0)
├─ Issue B: "Add JWT middleware" (priority: 1)
└─ Issue C: "Create logout endpoint" (priority: 2)

Dependencies:
- B depends-on A (can't add middleware until API exists)
- C depends-on B (can't logout without middleware)

Execution order: A → B → C (regardless of priority)
```

**Algorithm:**

```typescript
function getNextIssueInTopologicalOrder(
  groupIssues: Issue[],
  db: Database
): Issue | null {
  // Build dependency graph for this group
  const graph = buildDependencyGraph(groupIssues, db);

  // Find issues with no incomplete dependencies (topological sources)
  const sources = groupIssues.filter(issue => {
    const deps = getDependencies(db, issue.id, "issue");

    // All dependencies must be closed
    return deps.every(dep => {
      const depIssue = getIssue(db, dep.to_id);
      return !depIssue || depIssue.status === "closed";
    });
  });

  // Return highest priority source
  return sources.sort((a, b) => a.priority - b.priority)[0] || null;
}
```

**Circular Dependency Detection:**

Before adding a dependency relationship, check for cycles:

```typescript
function wouldCreateCycle(
  db: Database,
  fromId: string,
  toId: string
): boolean {
  // Check if adding "fromId depends-on toId" creates a cycle
  // Use DFS to see if there's already a path from toId to fromId
  return hasPath(db, toId, fromId);
}
```

---

### 4. Quality Gates and Roadblock Handling

**Workflow:**

```
1. Execute issue (agent makes changes)
2. On execution completion:
   a. Run quality gates (tests, lints, validation)
   b. If gates pass:
      - Mark issue as `closed`
      - Commit changes to group branch (if in group)
      - Clean up worktree
      - Schedule next issue in group
   c. If gates fail:
      - Mark issue as `needs_review`
      - Pause group execution
      - Keep worktree for debugging
      - Wait for user intervention
```

**Quality Gate Configuration:**

```typescript
interface QualityGateConfig {
  enabled: boolean;

  // Test execution
  runTests?: boolean;
  testCommand?: string;           // e.g., "npm test"
  testTimeout?: number;           // milliseconds

  // Build validation
  runBuild?: boolean;
  buildCommand?: string;          // e.g., "npm run build"

  // Linting
  runLint?: boolean;
  lintCommand?: string;           // e.g., "npm run lint"

  // Custom checks
  customChecks?: Array<{
    name: string;
    command: string;
    timeout?: number;
  }>;

  // CI integration (future)
  requiredChecks?: string[];      // GitHub check names
}
```

**User Intervention Flow:**

When an issue enters `needs_review` state:

1. **Scheduler pauses the group** (no more issues from this group)
2. **User is notified** (UI, email, webhook)
3. **User has options:**
   - **Fix manually:** Edit files in worktree, mark as ready to retry
   - **Create follow-up:** Use execution's follow-up feature to iterate
   - **Override gates:** Mark issue as closed despite failures
   - **Cancel execution:** Abandon this issue, revert to previous state

4. **User marks group as ready to resume**
5. **Scheduler continues with next issue**

---

### 5. Group-Level Branch Management

**Data Model:**

```typescript
interface IssueGroup {
  id: string;
  name: string;
  description?: string;

  // Branch configuration
  baseBranch: string;          // e.g., "main"
  workingBranch: string;       // e.g., "sudocode/auth-feature-chain"

  // Status
  status: "active" | "paused" | "completed";
  pauseReason?: string;

  // Visualization
  color?: string;              // Hex color for UI

  // Tracking
  lastExecutionId?: string;
  lastCommitSha?: string;

  // Timestamps
  created_at: string;
  updated_at: string;
  closed_at?: string;
}
```

**Branch Reuse Strategy:**

```typescript
async function createExecutionForGroupIssue(
  issue: Issue,
  group: IssueGroup,
  executionService: ExecutionService
): Promise<Execution> {
  // Check if working branch exists
  const branchExists = await gitBranchExists(group.workingBranch);

  if (!branchExists) {
    // First execution in group - create branch from base
    await gitCreateBranch(group.workingBranch, group.baseBranch);
  } else {
    // Subsequent execution - continue from last commit
    // Branch already has previous issue's changes
    await gitPull(group.workingBranch);
  }

  // Create execution using group's working branch
  const execution = await executionService.createExecution(
    issue.id,
    {
      mode: "worktree",
      baseBranch: group.workingBranch,  // ← Use working branch
      branchName: group.workingBranch,  // ← Reuse same branch
      ...config
    }
  );

  return execution;
}
```

**Commit Strategy:**

After successful execution + quality gates:

```typescript
async function commitGroupChanges(
  group: IssueGroup,
  issue: Issue,
  execution: Execution
): Promise<string> {
  // 1. Stage all changes
  await git.add(".", { cwd: execution.worktree_path });

  // 2. Create commit
  const commitMessage = generateCommitMessage(issue, execution);
  // Example: "Complete issue-001: Implement login API\n\n- Add POST /api/login endpoint\n- Add password hashing\n- Add JWT generation"

  const commitSha = await git.commit(commitMessage, {
    cwd: execution.worktree_path
  });

  // 3. Update group tracking
  await updateIssueGroup(db, group.id, {
    lastCommitSha: commitSha,
    lastExecutionId: execution.id,
    updated_at: new Date().toISOString()
  });

  return commitSha;
}
```

---

### 6. Concurrency Control

**Scheduler Tick Algorithm:**

```typescript
class ExecutionScheduler {
  private maxConcurrency: number = 5;
  private pollInterval: number = 5000; // 5 seconds
  private enabled: boolean = false;

  private activeExecutions = new Map<string, {
    executionId: string;
    issueId: string;
    groupId?: string;
    startedAt: Date;
  }>();

  async start(): Promise<void> {
    this.enabled = true;
    this.run();
  }

  async stop(): Promise<void> {
    this.enabled = false;
  }

  private async run(): Promise<void> {
    while (this.enabled) {
      try {
        await this.tick();
      } catch (error) {
        console.error("Scheduler tick error:", error);
      }

      // Wait before next tick
      await sleep(this.pollInterval);
    }
  }

  private async tick(): Promise<void> {
    // 1. Clean up completed executions
    await this.cleanupCompletedExecutions();

    // 2. Check if we have capacity
    if (this.activeExecutions.size >= this.maxConcurrency) {
      return; // At max capacity
    }

    // 3. Get active groups
    const activeGroups = new Set(
      Array.from(this.activeExecutions.values())
        .map(e => e.groupId)
        .filter(Boolean)
    );

    // 4. Select and start new executions
    const slotsAvailable = this.maxConcurrency - this.activeExecutions.size;

    for (let i = 0; i < slotsAvailable; i++) {
      // Select next issue (respecting group constraints)
      const nextIssue = await this.selectNextIssue(activeGroups);

      if (!nextIssue) {
        break; // No more issues ready to execute
      }

      // Start execution
      const execution = await this.startExecution(nextIssue);

      // Track active execution
      this.activeExecutions.set(execution.id, {
        executionId: execution.id,
        issueId: nextIssue.id,
        groupId: await this.getGroupIdForIssue(nextIssue.id),
        startedAt: new Date()
      });

      // Update active groups for next iteration
      const groupId = await this.getGroupIdForIssue(nextIssue.id);
      if (groupId) {
        activeGroups.add(groupId);
      }
    }
  }

  private async cleanupCompletedExecutions(): Promise<void> {
    for (const [execId, info] of this.activeExecutions.entries()) {
      const execution = await getExecution(this.db, execId);

      if (!execution) {
        this.activeExecutions.delete(execId);
        continue;
      }

      // Check if execution completed
      if (["completed", "failed", "cancelled"].includes(execution.status)) {
        // Handle completion
        await this.onExecutionComplete(execution);

        // Remove from active set
        this.activeExecutions.delete(execId);
      }
    }
  }
}
```

---

## Data Model

### New Tables

#### `issue_groups` Table

```sql
CREATE TABLE IF NOT EXISTS issue_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  base_branch TEXT NOT NULL,
  working_branch TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
  pause_reason TEXT,
  color TEXT,
  last_execution_id TEXT,
  last_commit_sha TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  FOREIGN KEY (last_execution_id) REFERENCES executions(id) ON DELETE SET NULL
);

CREATE INDEX idx_issue_groups_status ON issue_groups(status);
CREATE INDEX idx_issue_groups_working_branch ON issue_groups(working_branch);
```

#### `issue_group_members` Table

```sql
CREATE TABLE IF NOT EXISTS issue_group_members (
  group_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  issue_uuid TEXT NOT NULL,
  position INTEGER,  -- Optional ordering within group
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, issue_id),
  FOREIGN KEY (group_id) REFERENCES issue_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE CASCADE
);

CREATE INDEX idx_group_members_group ON issue_group_members(group_id);
CREATE INDEX idx_group_members_issue ON issue_group_members(issue_id);
```

#### `scheduler_config` Table

```sql
CREATE TABLE IF NOT EXISTS scheduler_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  max_concurrency INTEGER NOT NULL DEFAULT 5 CHECK(max_concurrency > 0),
  poll_interval INTEGER NOT NULL DEFAULT 5000 CHECK(poll_interval >= 1000),

  -- Quality gates
  quality_gates_enabled INTEGER NOT NULL DEFAULT 0,
  quality_gates_config TEXT,  -- JSON serialized QualityGateConfig

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default config
INSERT OR IGNORE INTO scheduler_config (id) VALUES ('default');
```

### Extended Types

```typescript
// Extend existing Execution type
interface Execution {
  // ... existing fields ...

  // Add group tracking
  group_id?: string;
  group_uuid?: string;
}

// New types
interface IssueGroup {
  id: string;
  name: string;
  description?: string;
  baseBranch: string;
  workingBranch: string;
  status: "active" | "paused" | "completed";
  pauseReason?: string;
  color?: string;
  lastExecutionId?: string;
  lastCommitSha?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

interface IssueGroupMember {
  group_id: string;
  issue_id: string;
  issue_uuid: string;
  position?: number;
  added_at: string;
}

interface SchedulerConfig {
  id: string;
  enabled: boolean;
  maxConcurrency: number;
  pollInterval: number;
  qualityGatesEnabled: boolean;
  qualityGatesConfig?: QualityGateConfig;
  created_at: string;
  updated_at: string;
}

interface QualityGateConfig {
  runTests?: boolean;
  testCommand?: string;
  testTimeout?: number;
  runBuild?: boolean;
  buildCommand?: string;
  runLint?: boolean;
  lintCommand?: string;
  customChecks?: Array<{
    name: string;
    command: string;
    timeout?: number;
  }>;
}
```

---

## Implementation Phases

### Phase 0: Prerequisites
**Goal:** Ensure existing infrastructure is solid
- ✅ Issue dependency tracking (exists)
- ✅ Execution service (exists)
- ✅ Worktree isolation (exists)
- ✅ `ready_issues` view (exists)

### Phase 1: Issue Groups (Foundation)
**Goal:** Enable users to organize related issues
**Deliverables:**
- [ ] Add `issue_groups` and `issue_group_members` tables
- [ ] Create CRUD operations for groups
- [ ] Add REST API endpoints:
  - `POST /api/issue-groups` - Create group
  - `GET /api/issue-groups` - List groups
  - `GET /api/issue-groups/:id` - Get group details
  - `PUT /api/issue-groups/:id` - Update group
  - `DELETE /api/issue-groups/:id` - Delete group
  - `POST /api/issue-groups/:id/members` - Add issue to group
  - `DELETE /api/issue-groups/:id/members/:issueId` - Remove issue from group
- [ ] Add UI components:
  - Group creation modal
  - Group list/grid view with color coding
  - Drag-and-drop to add issues to groups
  - Group detail page showing member issues
- [ ] Database migrations

**Estimated Effort:** 2-3 days

### Phase 2: Minimal Viable Scheduler
**Goal:** Automatic execution without groups (simple mode)
**Deliverables:**
- [ ] Create `ExecutionScheduler` class
- [ ] Implement basic tick loop (poll every N seconds)
- [ ] Implement issue selection (priority-based, no groups yet)
- [ ] Add concurrency control (max N executions)
- [ ] Hook into execution lifecycle events:
  - `onWorkflowComplete` → mark issue as closed
  - `onWorkflowFailed` → mark issue as needs_review
- [ ] Add `scheduler_config` table and config management
- [ ] Add REST API endpoints:
  - `POST /api/scheduler/start` - Start scheduler
  - `POST /api/scheduler/stop` - Stop scheduler
  - `GET /api/scheduler/status` - Get scheduler status
  - `PUT /api/scheduler/config` - Update config
- [ ] Add UI toggle for scheduler on/off
- [ ] Add real-time status display (active executions count)

**Key Feature:** Each issue executes in isolation (own branch)

**Estimated Effort:** 3-4 days

### Phase 3: Group Branch Management
**Goal:** Enable branch sharing within groups
**Deliverables:**
- [ ] Modify execution service to support branch reuse
- [ ] Implement group-aware execution creation
- [ ] Add "one execution per group" constraint to scheduler
- [ ] Implement commit logic for group branches
- [ ] Add group status tracking (active/paused/completed)
- [ ] Add API endpoints for group pause/resume
- [ ] Update UI to show group execution status
- [ ] Add worktree persistence for paused groups

**Key Feature:** Issues in a group share a working branch

**Estimated Effort:** 3-4 days

### Phase 4: Quality Gates
**Goal:** Automated validation before closing issues
**Deliverables:**
- [ ] Create `QualityGateService` class
- [ ] Implement test runner integration
- [ ] Implement build/lint validation
- [ ] Add configurable quality gate config (per repo or per group)
- [ ] Implement gate failure → `needs_review` transition
- [ ] Add user intervention workflow:
  - Manual fix option
  - Override gate option
  - Retry option
- [ ] Add UI for quality gate results
- [ ] Add API endpoints for gate configuration

**Key Feature:** Issues only close if tests pass

**Estimated Effort:** 2-3 days

### Phase 5: Topological Ordering & Dependency Management
**Goal:** Smart dependency-aware execution
**Deliverables:**
- [ ] Implement dependency graph builder
- [ ] Implement topological sort for issue selection
- [ ] Add circular dependency detection (prevent cycles)
- [ ] Update scheduler to respect topological order within groups
- [ ] Add UI visualization of dependency graph
- [ ] Add warnings for complex dependency structures
- [ ] Add "ready to execute" indicator in UI (shows when dependencies met)

**Key Feature:** Dependencies always execute before dependents

**Estimated Effort:** 3-4 days

### Phase 6: Advanced Features
**Goal:** Production-ready orchestration
**Deliverables:**
- [ ] Add execution timeout handling
- [ ] Add retry logic for failed executions
- [ ] Add notification system (email, webhook, Slack)
- [ ] Add execution history and analytics
- [ ] Add group completion workflows (auto-PR creation)
- [ ] Add conflict detection and resolution
- [ ] Add scheduler performance metrics
- [ ] Add load balancing for execution resources

**Estimated Effort:** 5-7 days

---

## API Design

### Scheduler Endpoints

```typescript
// Start scheduler
POST /api/scheduler/start
Response: { status: "started", config: SchedulerConfig }

// Stop scheduler
POST /api/scheduler/stop
Response: { status: "stopped" }

// Get scheduler status
GET /api/scheduler/status
Response: {
  enabled: boolean,
  activeExecutions: number,
  maxConcurrency: number,
  activeExecutionDetails: Array<{
    executionId: string,
    issueId: string,
    issueTitle: string,
    groupId?: string,
    startedAt: string
  }>
}

// Update scheduler config
PUT /api/scheduler/config
Body: Partial<SchedulerConfig>
Response: { config: SchedulerConfig }
```

### Issue Group Endpoints

```typescript
// Create issue group
POST /api/issue-groups
Body: {
  name: string,
  description?: string,
  baseBranch: string,
  color?: string
}
Response: { group: IssueGroup }

// List issue groups
GET /api/issue-groups?status=active
Response: { groups: IssueGroup[] }

// Get group details
GET /api/issue-groups/:id
Response: {
  group: IssueGroup,
  members: Array<{
    issue: Issue,
    position?: number
  }>,
  stats: {
    totalIssues: number,
    completedIssues: number,
    readyIssues: number,
    blockedIssues: number
  }
}

// Update group
PUT /api/issue-groups/:id
Body: Partial<IssueGroup>
Response: { group: IssueGroup }

// Delete group (keeps issues, just removes grouping)
DELETE /api/issue-groups/:id
Response: { success: boolean }

// Add issue to group
POST /api/issue-groups/:id/members
Body: { issueId: string, position?: number }
Response: { member: IssueGroupMember }

// Remove issue from group
DELETE /api/issue-groups/:id/members/:issueId
Response: { success: boolean }

// Pause group
POST /api/issue-groups/:id/pause
Body: { reason: string }
Response: { group: IssueGroup }

// Resume group
POST /api/issue-groups/:id/resume
Response: { group: IssueGroup }

// Complete group (mark as done, optionally create PR)
POST /api/issue-groups/:id/complete
Body: { createPR?: boolean, prTitle?: string, prBody?: string }
Response: { group: IssueGroup, pr?: { url: string, number: number } }
```

### Quality Gate Endpoints

```typescript
// Get quality gate config
GET /api/quality-gates/config
Response: { config: QualityGateConfig }

// Update quality gate config
PUT /api/quality-gates/config
Body: Partial<QualityGateConfig>
Response: { config: QualityGateConfig }

// Get quality gate results for execution
GET /api/executions/:id/quality-gates
Response: {
  executionId: string,
  passed: boolean,
  results: Array<{
    name: string,
    passed: boolean,
    output?: string,
    error?: string,
    duration: number
  }>
}

// Retry quality gates for execution
POST /api/executions/:id/quality-gates/retry
Response: { /* same as GET */ }
```

---

## Key Design Decisions

### 1. Group Creation UX
**Decision:** Hybrid approach
- **Manual creation:** User explicitly creates groups
- **Auto-suggestions:** System suggests groups based on:
  - Issues implementing the same spec
  - Issues with shared tags (e.g., `feature:auth`)
  - Issues with dependency relationships
- **User confirms:** User reviews and approves suggestions

**Rationale:** Balance between automation and control

### 2. Ungrouped Issue Handling
**Decision:** Ungrouped issues execute independently
- Each ungrouped issue gets its own branch (current behavior)
- Ungrouped issues participate in scheduler (not excluded)
- No "default group" - explicit is better than implicit

**Rationale:** Preserve current behavior, make groups opt-in

### 3. Conflict Resolution
**Decision:** Pause group on merge conflict
- When group branch conflicts with base branch → pause group
- Mark all remaining issues in group as `blocked`
- Notify user to resolve conflict manually
- User resolves conflict and resumes group

**Rationale:** Conflicts require human judgment, don't try to auto-resolve

### 4. Group Completion
**Decision:** User-triggered PR creation
- When all issues closed → group marked as `completed`
- System notifies user
- User decides whether to:
  - Create PR from working branch
  - Merge directly (if allowed)
  - Continue adding more issues
- No automatic merging (too risky)

**Rationale:** PR creation is high-stakes, require explicit user action

### 5. Cross-Group Dependencies
**Decision:** Allow but discourage
- Issue A in Group 1 CAN depend on Issue B in Group 2
- Scheduler respects these dependencies (Group 1 waits for Group 2's Issue B)
- UI shows warning: "Cross-group dependency detected"
- Suggest: "Consider moving Issue B to Group 1 or creating a parent issue"

**Rationale:** Flexible but warn about complexity

### 6. Scheduler Lifecycle
**Decision:** Manual start with persistence
- Scheduler does NOT auto-start on server startup
- User explicitly starts/stops via UI or API
- Config persists in database
- On server restart, scheduler remains stopped (requires manual restart)

**Rationale:** Prevent unexpected resource usage, user has control

---

## Open Questions & Future Considerations

### 1. Circular Dependencies
**Question:** How aggressively should we prevent cycles?
**Options:**
- Block at relationship creation time (strictest)
- Warn but allow (permissive)
- Detect at execution time and skip (lazy)

**Recommendation:** Block at creation time with clear error message

### 2. Long-Running Executions
**Question:** What if an execution takes hours?
**Considerations:**
- Blocks other issues in the group
- Ties up one concurrency slot
- User might want to intervene

**Proposal:**
- Add configurable timeout (default: 30 minutes)
- After timeout → mark as `needs_review` and pause
- User can override timeout per issue or per group

### 3. Execution Priority vs. Dependency Priority
**Question:** If Issue A (priority 0) depends on Issue B (priority 2), which executes first?
**Answer:** Dependencies always win. Issue B must execute before Issue A, regardless of priority.

### 4. Resource Limits
**Question:** What if 5 concurrent executions saturate CPU/memory?
**Proposal:**
- Add resource monitoring
- Dynamic concurrency adjustment
- "Light" vs. "Heavy" execution profiles
- Queue prioritization based on resource availability

### 5. Multi-Repo Support
**Question:** Can groups span multiple repos?
**Answer:** Not in Phase 1. Future consideration:
- Multi-repo groups
- Cross-repo dependencies
- Federated scheduler

### 6. Rollback Mechanism
**Question:** If Issue C fails, should we rollback Issues A and B in the group?
**Answer:** No automatic rollback. Instead:
- Group branch preserves all commits
- User can manually revert if needed
- Consider "savepoint" feature for future

### 7. Human-in-the-Loop Modes
**Question:** Should there be different automation levels?
**Proposal:**
- **Full Auto:** Execute, validate, close, continue (no user intervention)
- **Supervised:** Execute, validate, wait for approval before closing
- **Manual:** Execute only, user decides all transitions

**Recommendation:** Start with Full Auto, add Supervised mode in Phase 6

---

## Success Metrics

### Phase 2 (Scheduler) Success:
- [ ] Scheduler can execute 5 issues concurrently
- [ ] Issues transition from `open` → `in_progress` → `closed` automatically
- [ ] Failed executions transition to `needs_review`
- [ ] Scheduler respects dependencies (blockers first)

### Phase 3 (Groups) Success:
- [ ] Multiple issues in a group share a working branch
- [ ] Only one execution per group at a time
- [ ] Group branch accumulates commits from multiple issues
- [ ] Paused groups can be resumed

### Phase 4 (Quality Gates) Success:
- [ ] Test failures prevent issue closure
- [ ] Issues transition to `needs_review` on gate failure
- [ ] Users can override gates when needed
- [ ] Quality gate results visible in UI

### Phase 5 (Topological) Success:
- [ ] Dependencies execute in correct order
- [ ] Circular dependencies are prevented
- [ ] Complex dependency graphs execute correctly

---

## Security & Safety Considerations

1. **Branch Protection:**
   - Don't allow groups to target protected branches directly
   - Require PRs for merging to main/master

2. **Execution Sandboxing:**
   - Worktrees provide isolation
   - Consider additional sandboxing for untrusted prompts

3. **Rate Limiting:**
   - Limit scheduler tick frequency
   - Prevent runaway execution loops

4. **Audit Trail:**
   - Log all scheduler decisions
   - Track which issues were auto-closed
   - Preserve execution history

5. **Rollback Protection:**
   - Don't auto-delete branches after execution
   - Keep worktrees for debugging (configurable retention)

6. **User Permissions:**
   - Only authorized users can start/stop scheduler
   - Group modifications require appropriate permissions

---

## Testing Strategy

### Unit Tests
- [ ] Issue selection algorithm
- [ ] Topological sort implementation
- [ ] Circular dependency detection
- [ ] Quality gate execution
- [ ] Branch management logic

### Integration Tests
- [ ] Scheduler tick loop
- [ ] Execution lifecycle with groups
- [ ] Multi-issue group execution
- [ ] Quality gate integration
- [ ] Pause/resume workflows

### End-to-End Tests
- [ ] Complete group execution (3 issues, sequential)
- [ ] Concurrent execution across groups
- [ ] Failure handling and recovery
- [ ] User intervention workflows
- [ ] Cross-group dependencies

### Performance Tests
- [ ] Scheduler performance with 100+ issues
- [ ] Database query performance for ready_issues
- [ ] Concurrent execution overhead
- [ ] Memory usage with multiple worktrees

---

## Migration Path

For existing users with issues and executions:

1. **Schema Migration:**
   - Add new tables (non-breaking)
   - Add optional group columns to executions

2. **Backward Compatibility:**
   - Ungrouped issues continue to work as before
   - Scheduler is opt-in, disabled by default
   - Existing execution workflows unchanged

3. **Gradual Adoption:**
   - Phase 1: Users can organize existing issues into groups
   - Phase 2: Users can enable scheduler for automatic execution
   - Phase 3+: Advanced features are opt-in

---

## References

### Related Documentation
- `/home/user/sudocode/docs/data-model.md` - Core data model
- `/home/user/sudocode/docs/storage.md` - Database schema
- `/home/user/sudocode/cli/src/operations/relationships.ts` - Dependency tracking
- `/home/user/sudocode/server/src/services/execution-service.ts` - Execution service
- `/home/user/sudocode/server/src/execution/workflow/linear-orchestrator.ts` - Workflow orchestration

### External Inspiration
- GitHub Actions workflow orchestration
- Temporal.io workflow engine
- Apache Airflow DAG execution
- Kubernetes Job scheduling
