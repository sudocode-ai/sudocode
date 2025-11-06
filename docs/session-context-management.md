# Session-Based Context Management

## Overview

Session-based context management extends sudocode's context system by capturing and reusing Claude Code session IDs. This enables context continuity across multiple agent executions, allowing users to resume previous conversations, fork explorations, and build complex features through multi-turn interactions.

Currently, sudocode maintains context through specs (requirements) and issues (tasks). These provide persistent, version-controlled documentation but don't capture the **conversational context** that develops during agent execution - the back-and-forth refinement, exploration of alternatives, and accumulated understanding that exists within a Claude Code session.

By linking Claude Code sessions to issues and specs, we create a new dimension of context management:
- **Specs** = What needs to be built (requirements)
- **Issues** = What work needs to be done (tasks)
- **Sessions** = How the work was approached (conversational history)

## Problem Statement

### Current Context Management Limitations

1. **No Conversational Continuity**: Each new agent execution starts fresh, losing the conversational context built up in previous runs
2. **Inefficient Re-explanation**: Users must re-explain context that was already understood in a previous session
3. **Lost Exploration Paths**: When exploring alternatives, the original approach is abandoned rather than branched
4. **No Learning from History**: Can't easily reference "how Claude solved this before" for similar problems

### What Users Want

Users want to:
- **Resume work**: Continue where a previous session left off without re-explaining everything
- **Fork explorations**: Try alternative approaches while preserving the original session
- **Reference past sessions**: "Show me how Claude implemented authentication last time"
- **Build incrementally**: Have multi-turn conversations that build on previous context
- **Share context**: Point teammates to sessions that demonstrate problem-solving approaches

## Solution: Session References as Context

Claude Code maintains session state that includes:
- Complete conversation history (messages, tool uses, thinking)
- File context and permissions
- Background processes and working directory state
- Accumulated understanding of the codebase

By capturing and storing session IDs, sudocode can enable:
1. **Session Resumption**: Continue a previous conversation with full context
2. **Session Forking**: Branch to explore alternatives without losing the original
3. **Session References**: Link sessions to specs/issues for traceability
4. **Session Collections**: Group related sessions into context bundles

## Claude Code Session Capabilities

### Session ID Format

Claude Code assigns a unique session ID to each conversation. Session IDs are:
- Alphanumeric strings (e.g., `abc123def456`)
- Returned in the initial system message when using `--output-format=stream-json`
- Stored locally in Claude's session cache
- Persistent across multiple interactions

### Session Extraction

When running Claude Code with JSON output, the session ID appears in the first message:

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "abc123def456"
}
```

### Resume Functionality

Continue an existing session with full context:

```bash
# Interactive selection
claude --resume

# Resume specific session
claude --resume abc123def456 -p "Additional prompt here"
```

### Fork Functionality

Create a branch from an existing session (original remains unchanged):

```bash
# CLI (not yet publicly documented)
claude --resume abc123def456 --fork-session -p "Try a different approach"

# SDK
query({
  prompt: "Try a different approach",
  options: {
    resume: "abc123def456",
    forkSession: true  // Creates new session ID
  }
})
```

## Architecture

### Data Model Extensions

The executions table already has infrastructure for session tracking:

```sql
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  session_id TEXT,  -- Captures Claude session ID
  agent_type TEXT,
  status TEXT,
  ...
);

CREATE INDEX idx_executions_session_id ON executions(session_id);
```

No schema changes needed for Phase 1.

### Session Lifecycle

```
User triggers execution
    ↓
Spawn Claude Code process
    ↓
Parse JSON output stream
    ↓
Extract session_id from system.init message
    ↓
Store session_id in executions table
    ↓
Display in UI for user reference
```

### Session Resume Lifecycle

```
User clicks "Continue Session"
    ↓
Fetch execution record (get session_id)
    ↓
Spawn Claude Code with --resume {session_id}
    ↓
Create new execution record
    ↓
Link to original execution via parent_execution_id
```

### Session Fork Lifecycle

```
User clicks "Fork Session"
    ↓
Fetch execution record (get session_id)
    ↓
Spawn Claude Code with --resume {session_id} --fork-session
    ↓
Extract new session_id from output
    ↓
Create new execution record with both IDs
```

## Implementation Phases

### Phase 1: Capture & Display Session IDs (MVP)

**Goal**: Extract session IDs from Claude Code output and display in UI

**Tasks**:
1. Update log parser to detect and extract `session_id` from JSON output
2. Update execution lifecycle to store `session_id` in database
3. Display session ID in ExecutionView component
4. Display session ID in ExecutionHistory component

**Deliverable**: Users can see the Claude session ID associated with each execution

**Implementation Details**:
- Modify `server/src/services/execution-lifecycle.ts` to parse session_id
- Use existing `updateExecution()` to store session_id
- Add session_id display to `frontend/src/components/executions/ExecutionView.tsx`
- Add session_id to `frontend/src/components/executions/ExecutionHistory.tsx`

**Success Criteria**:
- Session ID extracted from first system message
- Session ID stored in database
- Session ID visible in UI for completed executions

### Phase 2: Resume Functionality

**Goal**: Enable users to continue previous sessions

**Tasks**:
1. Add "Continue Session" button to execution UI
2. Implement resume logic in execution service
3. Pass `--resume {session_id}` to Claude Code spawner
4. Track parent-child relationships between executions
5. Add execution relationship table/field

**Schema Changes**:
```sql
ALTER TABLE executions ADD COLUMN parent_execution_id TEXT REFERENCES executions(id);
CREATE INDEX idx_executions_parent_id ON executions(parent_execution_id);
```

**UI Changes**:
- Add "Continue" button to ExecutionView
- Show execution chains (original → continuation)
- Highlight which execution is the "head" of a chain

**Deliverable**: Users can click a button to continue any previous session

**Success Criteria**:
- Resume button appears for executions with session_id
- New execution created with --resume flag
- Conversation context preserved from original session

### Phase 3: Fork for Exploration

**Goal**: Enable branching to explore alternative approaches

**Tasks**:
1. Add "Fork Session" button to execution UI
2. Implement fork logic with `--fork-session` flag
3. Track forked session relationships
4. Visualize session branching in UI

**Schema Changes**:
```sql
-- Add fork tracking
ALTER TABLE executions ADD COLUMN forked_from_execution_id TEXT REFERENCES executions(id);
ALTER TABLE executions ADD COLUMN fork_session_id TEXT; -- Original session ID this was forked from
CREATE INDEX idx_executions_forked_from ON executions(forked_from_execution_id);
```

**UI Changes**:
- Add "Fork" button next to "Continue"
- Show forked execution trees
- Compare outcomes between forks

**Deliverable**: Users can explore alternatives without losing original work

**Success Criteria**:
- Fork creates new session with original context
- Original session remains accessible
- UI shows fork relationships clearly

### Phase 4: Sessions as First-Class Entities

**Goal**: Treat sessions as referenceable entities like specs and issues

**Tasks**:
1. Create sessions table with metadata
2. Extend EntityType to include 'session'
3. Enable `[[SESS-001]]` references in specs/issues
4. Add session management UI

**Schema Changes**:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- SESS-001
  uuid TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,         -- Claude session ID
  title TEXT NOT NULL,
  description TEXT,
  agent_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER DEFAULT 0
);

-- Link sessions to executions
ALTER TABLE executions ADD COLUMN managed_session_id TEXT REFERENCES sessions(id);
```

**Features**:
- Create session entities with friendly names
- Reference sessions from specs: "See [[SESS-042]] for auth implementation"
- Reference sessions from issues: "Based on approach in [[SESS-015]]"
- Search sessions by title/description

**Deliverable**: Sessions are first-class citizens with relationships to specs/issues

**Success Criteria**:
- Can create named session entities
- Can reference sessions with [[SESS-ID]] syntax
- Relationships appear in spec/issue views

### Phase 5: Context Bundles

**Goal**: Package related context together for complex workflows

**Tasks**:
1. Create context_bundles table
2. Implement bundle creation UI
3. Enable one-click context loading
4. Export/import bundles

**Schema Changes**:
```sql
CREATE TABLE context_bundles (
  id TEXT PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE context_bundle_items (
  bundle_id TEXT REFERENCES context_bundles(id),
  entity_type TEXT NOT NULL,  -- 'session' | 'spec' | 'issue' | 'commit'
  entity_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, entity_type, entity_id)
);
```

**Features**:
- Bundle multiple sessions, specs, issues together
- Name bundles: "Auth Feature Context", "Database Migration Work"
- One-click "Load Context" that resumes latest session in bundle
- Share bundles with teammates

**Deliverable**: Users can package and share complete context for complex features

**Success Criteria**:
- Can create bundles with multiple entities
- Can resume from bundle (loads most recent session)
- Can export/import bundles

### Phase 6: Advanced Session Management

**Goal**: Production-ready session features

**Tasks**:
1. Session search and filtering
2. Session comparison (diff two approaches)
3. Session analytics (success rate, common patterns)
4. Session cleanup and archival
5. Cross-machine session sync (if possible)
6. Session expiration handling

**Features**:
- Search sessions by content, tools used, files modified
- Compare two forked sessions side-by-side
- Analytics: "Claude succeeds 80% of time when using X approach"
- Archive old sessions to free up space
- Handle expired sessions gracefully

**Deliverable**: Production-ready session management system

## Key Design Decisions

### Why Store Session IDs vs. Full Conversation History?

**Decision**: Store session IDs and rely on Claude's session storage

**Rationale**:
- Claude Code already maintains full session state
- Duplicating would waste storage and risk inconsistency
- Session IDs are small (just strings)
- Can always fall back to raw execution logs if needed

**Trade-offs**:
- ✅ Minimal storage overhead
- ✅ Always get latest Claude session features
- ⚠️ Dependent on Claude's session persistence
- ⚠️ Sessions may expire (need to handle gracefully)

### Why Index on session_id?

**Decision**: Create database index on session_id column

**Rationale**:
- Need fast lookups by session ID
- Users will query "find all executions for this session"
- Enabling "Continue Session" requires quick lookup

**Performance**:
- Small overhead on write (one index update)
- Significant speedup on reads

### Why Parent-Child Relationships vs. Session Trees?

**Decision**: Use simple parent_execution_id for resumes, separate forked_from_execution_id for forks

**Rationale**:
- Resume = linear continuation (parent → child)
- Fork = branching (parent → multiple children)
- Need to distinguish between "continuation" and "alternative"

**Alternative Considered**: Single relationship table with type field
**Why Rejected**: Foreign key constraints and queries are simpler with explicit columns

### Why Not Extract Full Trajectory?

**Decision**: Phase 1 only extracts session_id, not full trajectory

**Rationale**:
- Session ID is sufficient for resume/fork
- Full trajectory parsing is complex (separate feature)
- Want quick wins for context continuity
- Can add trajectory later as Phase N+1

## Testing Strategy

### Unit Tests

**Log Parsing**:
- Test extraction of session_id from JSON output
- Test handling of missing session_id
- Test various JSON message formats

**Database Operations**:
- Test updateExecution with session_id
- Test queries by session_id
- Test parent-child relationships

### Integration Tests

**End-to-End Session Capture**:
- Spawn real Claude Code process
- Verify session_id extracted
- Verify session_id stored in database
- Verify session_id appears in UI

**Resume Flow**:
- Create execution with session_id
- Trigger resume
- Verify --resume flag passed correctly
- Verify new execution linked to original

### E2E Tests

**User Workflows**:
- Run execution → See session ID → Click Continue → Verify context preserved
- Run execution → Click Fork → Verify both sessions accessible
- Create context bundle → Load bundle → Verify correct session resumed

## Error Handling

### Session ID Not Found

**Scenario**: Claude Code doesn't emit session_id in output

**Handling**:
- Log warning
- Store execution without session_id
- UI shows "No session ID" or hides resume button

### Session Expired

**Scenario**: User tries to resume but Claude says session not found

**Handling**:
- Show error: "Session expired or not found"
- Offer to start fresh execution with same prompt
- Link to documentation about session persistence

### Resume/Fork Fails

**Scenario**: --resume flag accepted but execution fails

**Handling**:
- Capture error in execution record
- Show error in UI
- Provide fallback: "Try starting fresh?"

## Security Considerations

### Session ID Exposure

**Risk**: Session IDs might contain sensitive information or enable session hijacking

**Mitigation**:
- Session IDs are user-scoped (only accessible to Claude account owner)
- Don't expose session IDs in public URLs
- Require authentication to view execution details

### Cross-User Sessions

**Risk**: User A tries to resume User B's session

**Mitigation**:
- Claude Code manages session access control
- If resume fails, show appropriate error
- Don't share session IDs across team members

## Open Questions

1. **Session Persistence Duration**: How long do Claude Code sessions persist?
   - Need to document and test
   - May vary by Claude account type

2. **Cross-Machine Sessions**: Can sessions be resumed on different machines?
   - Sessions stored in `~/.claude/` directory
   - May not work across machines unless that directory is synced

3. **Session Size Limits**: Is there a limit to how many messages a session can contain?
   - Need to test long-running sessions
   - May need to "compress" or start fresh after N turns

4. **Fork Support in CLI**: Is --fork-session officially supported in Claude Code CLI?
   - Documented in SDK but not in CLI docs
   - May need to use SDK wrapper or wait for CLI support

5. **Session Metadata**: Can we query session metadata without resuming?
   - Would be useful for displaying "Session has 50 messages, last used 2 days ago"
   - May not be possible without Claude API support

## Success Metrics

### Phase 1 Success Metrics
- 95%+ of Claude Code executions have session_id captured
- Session ID visible in UI within 5 seconds of execution start
- Zero performance impact on execution spawning

### Phase 2 Success Metrics
- Users successfully resume 90%+ of attempted resumes
- Average time saved: 2-5 minutes per resumed session (no re-explaining context)
- 30%+ of executions are resumed sessions

### Phase 3 Success Metrics
- 10%+ of executions are forks (users exploring alternatives)
- Users prefer forked approach 40-60% of time (validates exploration)

### Phase 4 Success Metrics
- Sessions referenced in 20%+ of specs
- Users search for sessions by description
- Session references reduce duplicate work by 25%

### Long-Term Success Metrics
- Context continuity reduces failed executions by 30%
- Users report "Claude remembers what we discussed" as top feature
- Multi-turn workflows become standard practice

## References

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Claude Agent SDK - Session Management](https://docs.claude.com/en/api/agent-sdk/sessions)
- [sudocode Data Model](./data-model.md)
- [sudocode Storage](./storage.md)
- [Agent Execution System Spec](../sudocode/specs/agent_execution_system.md)

## Appendix: Session JSON Format

Example system.init message from Claude Code:

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "abc123def456",
  "version": "1.0.0",
  "capabilities": {
    "tools": ["read", "write", "edit", "bash", "grep", "glob"],
    "resume": true,
    "fork": true
  }
}
```

Example session resume in SDK:

```typescript
import { query } from '@anthropic-ai/agent-sdk';

// Initial session
const response1 = query({
  prompt: "Help me build a login page",
  options: { model: "claude-sonnet-4-5" }
});

let sessionId: string;
for await (const message of response1) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
}

// Resume session later
const response2 = query({
  prompt: "Now add password reset",
  options: {
    resume: sessionId,
    model: "claude-sonnet-4-5"
  }
});

// Fork session for alternative approach
const response3 = query({
  prompt: "Try using OAuth instead",
  options: {
    resume: sessionId,
    forkSession: true,
    model: "claude-sonnet-4-5"
  }
});
```

## Appendix: UI Mockups

### ExecutionView with Session ID

```
┌─────────────────────────────────────────────────┐
│ Execution #abc-123                              │
├─────────────────────────────────────────────────┤
│ Status: Completed ✓                             │
│ Issue: ISSUE-042 (Fix authentication bug)       │
│ Agent: claude-code                              │
│ Session: abc123def456                [Copy]     │
│                                                  │
│ [Continue Session]  [Fork Session]              │
└─────────────────────────────────────────────────┘
```

### Execution History with Sessions

```
┌─────────────────────────────────────────────────┐
│ Execution History                               │
├─────────────────────────────────────────────────┤
│ ● #exec-1  Completed  2 hours ago              │
│   Session: abc123def                            │
│   [Continue] [Fork]                             │
│                                                  │
│ ● #exec-2  Running    Started 5 min ago        │
│   Session: (extracting...)                      │
│                                                  │
│ ● #exec-3  Failed     1 day ago                │
│   Session: xyz789ghi                            │
│   [Resume with Fix] [Fork]                      │
└─────────────────────────────────────────────────┘
```

### Session Tree View

```
┌─────────────────────────────────────────────────┐
│ Session Tree: abc123def                         │
├─────────────────────────────────────────────────┤
│ ● #exec-1  Initial attempt                     │
│   └─ ● #exec-2  Continued after review         │
│      └─ ● #exec-3  Final implementation        │
│   └─ ● #exec-4  Forked for OAuth approach      │
│      └─ ● #exec-5  OAuth working!              │
│                                                  │
│ [Load Latest] [Compare Forks]                   │
└─────────────────────────────────────────────────┘
```
