# Manual Tests: Dataplane Execution Stream & Checkpoint Tracking

This document provides step-by-step manual tests to verify that all execution types properly create dataplane streams and checkpoints.

## Prerequisites

1. **Start the server:**
   ```bash
   cd server && npm run dev
   ```

2. **Open the UI:**
   ```
   http://localhost:5173
   ```

3. **Have a test project with dataplane enabled:**
   - Create or use an existing project with `.sudocode/config.json` containing:
   ```json
   {
     "dataplane": {
       "enabled": true,
       "tablePrefix": "dp_"
     }
   }
   ```

4. **Open the project in the UI**

---

## Test 1: Normal Worktree Execution - Stream Creation

**Objective:** Verify that a normal worktree execution creates a dataplane stream.

### Steps:

1. Navigate to the **Issues** page
2. Create a new issue or select an existing one
3. Click **Start Execution** on the issue
4. Configure:
   - Mode: `worktree`
   - Agent: `claude-code`
   - Prompt: "What is 2 + 2? Reply with just the number."
5. Start the execution
6. Navigate to the **Stacks** page (`/stacks`)

### Expected Results:

- [ ] A new stream appears in the Stacks page
- [ ] Stream metadata shows:
  - `execution_id` matching the execution
  - `issue_id` matching the issue
  - `agent_type`: "claude-code"
- [ ] The execution record has a `stream_id` (check in Executions page detail view)

### Verification Query (SQLite):
```sql
SELECT e.id, e.stream_id, s.name, s.metadata
FROM executions e
LEFT JOIN dp_streams s ON e.stream_id = s.id
WHERE e.id = '<execution-id>';
```

---

## Test 2: Normal Worktree Execution - Checkpoint on Completion

**Objective:** Verify that a checkpoint is created when a worktree execution completes with changes.

### Steps:

1. Create a new issue: "Add a greeting function"
2. Start a worktree execution with prompt:
   ```
   Create a new file called greeting.ts with a function that returns "Hello, World!"
   ```
3. Wait for the execution to complete
4. Check the **Stacks** page for checkpoints

### Expected Results:

- [ ] Execution completes successfully
- [ ] A checkpoint appears in the `checkpoints` table
- [ ] Checkpoint is linked to the execution's stream
- [ ] Checkpoint appears in the merge queue (if `autoEnqueue: true`)

### Verification Query:
```sql
SELECT c.id, c.execution_id, c.issue_id, c.commit_sha, c.message
FROM checkpoints c
WHERE c.execution_id = '<execution-id>';

SELECT * FROM dp_merge_queue WHERE execution_id = '<execution-id>';
```

---

## Test 3: Follow-up Execution - Stream Inheritance

**Objective:** Verify that follow-up executions inherit their parent's stream.

### Steps:

1. Complete Test 1 or Test 2 first (need a completed execution)
2. On the completed execution, click **Create Follow-up**
3. Enter feedback: "Now add a farewell function to the same file"
4. Start the follow-up execution
5. Check both executions in the detail view

### Expected Results:

- [ ] Follow-up execution is created with `parent_execution_id` set
- [ ] Follow-up execution has the **same** `stream_id` as parent
- [ ] Both executions appear under the same stream in Stacks page
- [ ] Changes from both executions accumulate in the same stream

### Verification Query:
```sql
SELECT id, parent_execution_id, stream_id, status
FROM executions
WHERE id = '<follow-up-id>' OR id = '<parent-id>';
```

---

## Test 4: Local Mode Execution - Stream Creation

**Objective:** Verify that local mode executions create streams for visibility.

### Steps:

1. Create a new issue
2. Start an execution with:
   - Mode: `local` (not worktree)
   - Prompt: "What is 5 + 5? Reply with just the number."
3. Check the Stacks page

### Expected Results:

- [ ] Execution is created with `mode: "local"`
- [ ] Execution has no `worktree_path`
- [ ] A stream is created for the execution (for visibility)
- [ ] No checkpoint is created (local mode doesn't have isolated worktree)

### Verification Query:
```sql
SELECT id, mode, worktree_path, stream_id
FROM executions
WHERE id = '<execution-id>';
```

---

## Test 5: Workflow Execution - Stream per Step

**Objective:** Verify that workflow executions create streams and checkpoints for each step.

### Steps:

1. Create 2-3 issues for workflow steps:
   - Issue 1: "Set up project structure"
   - Issue 2: "Add core functionality"
   - Issue 3: "Add tests"

2. Create a workflow:
   - Go to Workflows page
   - Create new workflow with the issues
   - Config: sequential, autoCommitAfterStep: true

3. Start the workflow

4. Wait for workflow to complete (or at least first step)

5. Check Stacks page

### Expected Results:

- [ ] Each step execution has a `stream_id`
- [ ] Each step creates a checkpoint after completion
- [ ] Checkpoints contain proper commit information
- [ ] Workflow executions have `workflow_execution_id` set

### Verification Query:
```sql
SELECT e.id, e.issue_id, e.stream_id, e.workflow_execution_id, e.status
FROM executions e
WHERE e.workflow_execution_id IS NOT NULL
ORDER BY e.created_at;

SELECT c.id, c.execution_id, c.message, c.checkpointed_at
FROM checkpoints c
WHERE c.execution_id IN (
  SELECT id FROM executions WHERE workflow_execution_id IS NOT NULL
);
```

---

## Test 6: Multiple Concurrent Executions - Separate Streams

**Objective:** Verify that multiple executions for different issues get separate streams.

### Steps:

1. Create 3 separate issues
2. Start executions for all 3 issues **simultaneously** (or in quick succession)
3. Wait for all to be in "running" or "completed" state
4. Check Stacks page

### Expected Results:

- [ ] Each execution has a unique `stream_id`
- [ ] 3 separate streams appear in Stacks page
- [ ] No stream ID collisions
- [ ] Each stream's metadata correctly identifies its execution

### Verification Query:
```sql
SELECT id, issue_id, stream_id
FROM executions
WHERE issue_id IN ('<issue-1>', '<issue-2>', '<issue-3>');

-- Verify all stream_ids are unique
SELECT stream_id, COUNT(*) as count
FROM executions
WHERE stream_id IS NOT NULL
GROUP BY stream_id
HAVING count > 1;  -- Should return no rows
```

---

## Test 7: Stream Persistence After Completion

**Objective:** Verify that streams persist after execution completes.

### Steps:

1. Start a worktree execution
2. Wait for it to complete
3. Note the `stream_id`
4. Refresh the Stacks page
5. Check if the stream still exists

### Expected Results:

- [ ] Stream exists before completion
- [ ] Stream still exists after completion
- [ ] Stream metadata is intact
- [ ] Execution still references the stream

---

## Test 8: Checkpoint Infrastructure Verification

**Objective:** Verify all required tables exist and are properly structured.

### Verification Queries:

```sql
-- Check dp_streams table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='dp_streams';

-- Check checkpoints table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints';

-- Check dp_merge_queue table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='dp_merge_queue';

-- Check stream_id column in executions
PRAGMA table_info(executions);
-- Should include: stream_id column

-- Check checkpoints table structure
PRAGMA table_info(checkpoints);
-- Should include: id, issue_id, execution_id, stream_id, commit_sha, etc.
```

### Expected Results:

- [ ] `dp_streams` table exists
- [ ] `checkpoints` table exists
- [ ] `dp_merge_queue` table exists
- [ ] `executions.stream_id` column exists
- [ ] All foreign key relationships are valid

---

## Test 9: API Endpoint Verification

**Objective:** Verify stream data is accessible via API.

### API Calls:

```bash
# Get execution with stream info
curl http://localhost:3000/api/executions/<execution-id> \
  -H "X-Project-ID: <project-id>"

# Get all streams (if endpoint exists)
curl http://localhost:3000/api/stacks \
  -H "X-Project-ID: <project-id>"

# Get checkpoints for execution
curl http://localhost:3000/api/executions/<execution-id>/checkpoints \
  -H "X-Project-ID: <project-id>"
```

### Expected Results:

- [ ] Execution response includes `stream_id`
- [ ] Stream data is accessible
- [ ] Checkpoint data is accessible

---

## Test 10: Error Handling - Stream Creation Failure

**Objective:** Verify execution continues even if stream creation fails.

### Steps:

1. Temporarily disable dataplane (modify config)
2. Start an execution
3. Verify execution proceeds without stream
4. Re-enable dataplane
5. Start another execution
6. Verify stream is created

### Expected Results:

- [ ] Execution without dataplane completes (no stream_id)
- [ ] Execution with dataplane creates stream
- [ ] No errors crash the execution flow
- [ ] Logs show appropriate warnings when stream creation fails

---

## Quick Verification Checklist

Run these queries after completing all tests:

```sql
-- Summary of executions with streams
SELECT
  COUNT(*) as total_executions,
  COUNT(stream_id) as executions_with_streams,
  COUNT(CASE WHEN mode = 'worktree' THEN 1 END) as worktree_executions,
  COUNT(CASE WHEN mode = 'local' THEN 1 END) as local_executions
FROM executions;

-- Summary of checkpoints
SELECT COUNT(*) as total_checkpoints FROM checkpoints;

-- Summary of streams
SELECT COUNT(*) as total_streams FROM dp_streams;

-- Summary of merge queue
SELECT
  COUNT(*) as total_queue_entries,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN status = 'merged' THEN 1 END) as merged
FROM dp_merge_queue;
```

---

## Troubleshooting

### Stream not created
1. Check if dataplane is enabled in config
2. Check server logs for errors
3. Verify `getDataplaneAdapterSync()` returns an initialized adapter

### Checkpoint not created
1. Verify execution completed successfully
2. Check if execution has `stream_id`
3. Check if execution has `worktree_path` (required for checkpoint)
4. Check if `before_commit` and `after_commit` are different

### Follow-up doesn't inherit stream
1. Verify parent execution has `stream_id`
2. Check `createFollowUpStream` is called with `reuseWorktree: true`
3. Check server logs for follow-up stream creation

### Workflow checkpoints missing
1. Verify `autoCommitAfterStep: true` in workflow config
2. Check if commits are being made after each step
3. Verify `after_commit` is updated after workflow commit
