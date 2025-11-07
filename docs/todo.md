 Execution System Gap Analysis

  I've reviewed the current implementation against
   the specs (SPEC-001, SPEC-002, SPEC-011) and
  found several significant gaps:

  1. Agent Interaction Capabilities (MISSING)

  The current system lacks the ability to interact
   with a running agent:

  What's Missing:
  - No way to inject messages into a running
  execution - there's no POST 
  /api/executions/:id/inject endpoint
  - No pause/resume functionality - While the
  Process Manager has sendInput() in
  server/src/execution/process/manager.ts:93,
  there are no API endpoints exposing this
  - No way to send user feedback during execution
  - Current "follow-up" only works after
  completion
  - No stdin control - Can't send interactive
  commands to the Claude Code process while it's
  running

  What Exists:
  - SimpleProcessManager.sendInput() method
  (infrastructure exists)
  - SimpleProcessManager.closeInput() method
  - Process I/O streaming via output handlers

  Needed Additions:
  // API routes needed:
  POST /api/executions/:executionId/input
    - Send input to running execution's stdin
    - Body: { input: string }

  POST /api/executions/:executionId/pause
    - Pause execution (via process signal)

  POST /api/executions/:executionId/resume
    - Resume paused execution

  GET /api/executions/:executionId/status
    - Real-time status including stdin/stdout
  state

  2. Code Change Management (MISSING)

  No tooling for reviewing/managing code changes
  from executions:

  What's Missing:
  - No diff viewing - Can't see what the agent
  changed
  - No commit management - Changes aren't
  automatically committed
  - No PR creation - Can't create PRs from
  completed executions
  - No change approval workflow - All changes are
  auto-applied
  - No rollback mechanism - Can't undo agent
  changes
  - No file change tracking - While Execution
  entity has filesChanged field, it's not
  populated

  What Exists:
  - Worktree isolation (good foundation)
  - Git CLI wrapper at
  server/src/execution/worktree/git-cli.ts
  - Branch creation capability

  Needed Additions:
  // API routes needed:
  GET /api/executions/:executionId/changes
    - Get list of modified files with diffs

  POST /api/executions/:executionId/commit
    - Commit changes with message
    - Body: { message: string, files?: string[] }

  POST /api/executions/:executionId/pr
    - Create pull request from execution changes
    - Body: { title: string, description: string,
  base: string }

  POST /api/executions/:executionId/rollback
    - Discard all changes from execution

  GET /api/executions/:executionId/diff/:filePath
    - Get unified diff for specific file

  3. Real-time Interaction Flow

  The follow-up mechanism exists but only works
  after completion:

  Current Limitation:
  - POST /api/executions/:executionId/follow-up
  only works when status !== 'running'
  (server/src/routes/executions.ts:235)
  - Can't provide guidance while agent is actively
   working

  Needed:
  - Real-time message injection during execution
  - Ability to course-correct without waiting for
  completion

  4. Missing Execution Controls

  What's Missing:
  - No timeout override - Can't extend execution
  timeout mid-run
  - No priority adjustment - Can't change priority
   of queued tasks
  - No resource limits - No CPU/memory limits on
  agent processes
  - No execution templates - Have to manually
  configure each execution

  What Exists:
  - Basic cancel functionality
  - Metrics tracking

  5. Missing Observability

  What's Missing:
  - No file watch stream - Can't see files as
  they're modified in real-time
  - No token usage tracking - Can't monitor cost
  during execution
  - No progress estimation - No ETA or percentage
  complete
  - Limited log retention policy - Logs might grow
   unbounded

  What Exists:
  - AG-UI event streaming (good foundation)
  - Execution logs store
  - Basic SSE transport

  6. Missing Execution History Features

  What's Missing:
  - No execution comparison - Can't diff between
  two execution attempts
  - No execution replay - Can't re-run exact same
  execution
  - No execution forking - Can't branch from
  mid-execution checkpoint
  - No execution search - Can't search across
  execution logs

  7. Missing Worktree Management UI

  What Exists (API only):
  - GET /api/executions/:id/worktree - Check
  worktree exists
  - DELETE /api/executions/:id/worktree - Delete
  worktree

  What's Missing:
  - No worktree list view - Can't see all active
  worktrees
  - No cleanup warnings - No notification of
  orphaned worktrees
  - No worktree disk usage tracking
  - No automatic cleanup scheduling

  Priority Recommendations

  High Priority (Core Functionality):

  1. Real-time message injection API - Critical
  for agent interaction
    - POST /api/executions/:id/input
    - Connect to existing sendInput()
  infrastructure
  2. Code change viewing - Essential for reviewing
   agent work
    - GET /api/executions/:id/changes
    - GET /api/executions/:id/diff/:filePath
  3. Commit & PR creation - Complete the workflow
    - POST /api/executions/:id/commit
    - POST /api/executions/:id/pr

  Medium Priority (Productivity):

  4. Pause/Resume controls - Better execution
  management
  5. File change tracking - Populate filesChanged
  field
  6. Execution templates - Reusable configurations
  7. Change approval workflow - Safety mechanism

  Low Priority (Nice to Have):

  8. Execution comparison
  9. Token usage tracking
  10. Progress estimation
  11. Worktree cleanup UI

  Suggested Next Steps

  The two most impactful additions would be:

  1. Agent Interaction API - Add the missing
  interaction endpoints to enable real-time
  collaboration with the running agent
  2. Change Management - Add diff viewing and
  commit/PR creation to complete the
  execution-to-deployment workflow