/**
 * SQLite schema definition for sudocode
 * Shared between CLI and server packages
 */

export const SCHEMA_VERSION = "1.0";

/**
 * Database configuration SQL
 */
export const DB_CONFIG = `
-- Enable WAL mode for better concurrency
PRAGMA journal_mode=WAL;

-- Enforce foreign keys
PRAGMA foreign_keys=ON;

-- Optimize for performance
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA mmap_size=30000000000;
PRAGMA page_size=4096;
PRAGMA cache_size=10000;
`;

/**
 * Core table schemas
 */

export const SPECS_TABLE = `
CREATE TABLE IF NOT EXISTS specs (
    id TEXT PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL CHECK(length(title) <= 500),
    file_path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
    archived_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    parent_id TEXT,
    parent_uuid TEXT,
    external_links TEXT,
    FOREIGN KEY (parent_id) REFERENCES specs(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_uuid) REFERENCES specs(uuid) ON DELETE SET NULL
);
`;

export const ISSUES_TABLE = `
CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL CHECK(length(title) <= 500),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    assignee TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
    archived_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    parent_id TEXT,
    parent_uuid TEXT,
    external_links TEXT,
    FOREIGN KEY (parent_id) REFERENCES issues(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_uuid) REFERENCES issues(uuid) ON DELETE SET NULL
);
`;

export const RELATIONSHIPS_TABLE = `
CREATE TABLE IF NOT EXISTS relationships (
    from_id TEXT NOT NULL,
    from_uuid TEXT NOT NULL,
    from_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    to_uuid TEXT NOT NULL,
    to_type TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    PRIMARY KEY (from_id, from_type, to_id, to_type, relationship_type)
);
`;

export const TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS tags (
    entity_id TEXT NOT NULL,
    entity_uuid TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (entity_id, entity_type, tag)
);
`;

export const EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    entity_uuid TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    git_commit_sha TEXT,
    source TEXT
);
`;

export const ISSUE_FEEDBACK_TABLE = `
CREATE TABLE IF NOT EXISTS issue_feedback (
    id TEXT PRIMARY KEY,
    from_id TEXT,
    from_uuid TEXT,
    to_id TEXT NOT NULL,
    to_uuid TEXT NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
    content TEXT NOT NULL,
    agent TEXT,
    anchor TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export const EXECUTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    issue_id TEXT,
    issue_uuid TEXT,

    -- Execution mode and configuration
    mode TEXT CHECK(mode IN ('worktree', 'local')),
    prompt TEXT,
    config TEXT,

    -- Process information (legacy + new)
    agent_type TEXT,
    session_id TEXT,
    workflow_execution_id TEXT,

    -- Git/branch information
    target_branch TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    before_commit TEXT,
    after_commit TEXT,
    worktree_path TEXT,

    -- Status (unified - supports both old and new statuses)
    status TEXT NOT NULL CHECK(status IN (
        'preparing', 'pending', 'running', 'paused',
        'completed', 'failed', 'cancelled', 'stopped'
    )),

    -- Timing (consistent with other tables)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    cancelled_at DATETIME,

    -- Results and metadata
    exit_code INTEGER,
    error_message TEXT,
    error TEXT,
    model TEXT,
    summary TEXT,
    files_changed TEXT,

    -- Relationships
    parent_execution_id TEXT,

    -- Multi-step workflow support (future extension)
    step_type TEXT,
    step_index INTEGER,
    step_config TEXT,

    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
    FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE SET NULL,
    FOREIGN KEY (parent_execution_id) REFERENCES executions(id) ON DELETE SET NULL
);
`;

// Prompt templates table
export const PROMPT_TEMPLATES_TABLE = `
CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('issue', 'spec', 'custom')),
    template TEXT NOT NULL,
    variables TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// Execution logs table - stores detailed execution output
// Supports two formats:
// - raw_logs: Legacy JSONL format (newline-delimited JSON from stream-json output)
// - normalized_entry: New NDJSON format (NormalizedEntry objects from agent-execution-engine)
// At least one of raw_logs or normalized_entry must be non-null
export const EXECUTION_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS execution_logs (
    execution_id TEXT PRIMARY KEY,
    raw_logs TEXT,
    normalized_entry TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    line_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
    CHECK (raw_logs IS NOT NULL OR normalized_entry IS NOT NULL)
);
`;

// Workflows table - orchestrates multi-issue execution
// Supports both sequential and agent-managed workflow strategies
export const WORKFLOWS_TABLE = `
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,          -- JSON (WorkflowSource: spec, issues, root_issue, or goal)
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'running', 'paused',
        'completed', 'failed', 'cancelled'
    )),
    steps TEXT NOT NULL DEFAULT '[]',  -- JSON array (WorkflowStep[])
    worktree_path TEXT,
    branch_name TEXT,
    base_branch TEXT NOT NULL,
    current_step_index INTEGER NOT NULL DEFAULT 0,
    orchestrator_execution_id TEXT,
    orchestrator_session_id TEXT,
    config TEXT NOT NULL,          -- JSON (WorkflowConfig)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (orchestrator_execution_id) REFERENCES executions(id) ON DELETE SET NULL
);
`;

// Workflow events table - tracks workflow lifecycle events for orchestrator wakeups
export const WORKFLOW_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    type TEXT NOT NULL,            -- WorkflowEventType (step_completed, workflow_paused, etc.)
    step_id TEXT,
    execution_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',  -- JSON (event-specific data)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,         -- When orchestrator processed this event
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL
);
`;

// CodeGraph cache table - caches full codebase analysis results keyed by git SHA
export const CODE_GRAPH_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS code_graph_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    git_sha TEXT NOT NULL UNIQUE,
    code_graph TEXT NOT NULL,
    file_tree TEXT NOT NULL,
    analyzed_at DATETIME NOT NULL,
    file_count INTEGER NOT NULL DEFAULT 0,
    symbol_count INTEGER NOT NULL DEFAULT 0,
    analysis_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Index definitions
 */

export const SPECS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_specs_uuid ON specs(uuid);
CREATE INDEX IF NOT EXISTS idx_specs_priority ON specs(priority);
CREATE INDEX IF NOT EXISTS idx_specs_parent_id ON specs(parent_id);
CREATE INDEX IF NOT EXISTS idx_specs_parent_uuid ON specs(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_specs_archived ON specs(archived);
CREATE INDEX IF NOT EXISTS idx_specs_created_at ON specs(created_at);
CREATE INDEX IF NOT EXISTS idx_specs_updated_at ON specs(updated_at);
`;

export const ISSUES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_issues_uuid ON issues(uuid);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee);
CREATE INDEX IF NOT EXISTS idx_issues_parent_id ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_parent_uuid ON issues(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_issues_archived ON issues(archived);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at);
CREATE INDEX IF NOT EXISTS idx_issues_closed_at ON issues(closed_at);
`;

export const RELATIONSHIPS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rel_from_id ON relationships(from_id, from_type);
CREATE INDEX IF NOT EXISTS idx_rel_from_uuid ON relationships(from_uuid, from_type);
CREATE INDEX IF NOT EXISTS idx_rel_to_id ON relationships(to_id, to_type);
CREATE INDEX IF NOT EXISTS idx_rel_to_uuid ON relationships(to_uuid, to_type);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_rel_created_at ON relationships(created_at);
`;

export const TAGS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tags_entity_id ON tags(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_tags_entity_uuid ON tags(entity_uuid, entity_type);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
`;

export const EVENTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_events_entity_id ON events(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_events_entity_uuid ON events(entity_uuid, entity_type);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_git_commit ON events(git_commit_sha);
`;

export const ISSUE_FEEDBACK_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_feedback_from_id ON issue_feedback(from_id);
CREATE INDEX IF NOT EXISTS idx_feedback_from_uuid ON issue_feedback(from_uuid);
CREATE INDEX IF NOT EXISTS idx_feedback_to_id ON issue_feedback(to_id);
CREATE INDEX IF NOT EXISTS idx_feedback_to_uuid ON issue_feedback(to_uuid);
CREATE INDEX IF NOT EXISTS idx_feedback_dismissed ON issue_feedback(dismissed);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON issue_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON issue_feedback(created_at);
`;

export const EXECUTIONS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_executions_issue_id ON executions(issue_id);
CREATE INDEX IF NOT EXISTS idx_executions_issue_uuid ON executions(issue_uuid);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_session_id ON executions(session_id);
CREATE INDEX IF NOT EXISTS idx_executions_parent ON executions(parent_execution_id);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at);
CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_executions_workflow_step ON executions(workflow_execution_id, step_index);
CREATE INDEX IF NOT EXISTS idx_executions_step_type ON executions(step_type);
`;

export const PROMPT_TEMPLATES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_templates_type ON prompt_templates(type);
CREATE INDEX IF NOT EXISTS idx_templates_default ON prompt_templates(is_default);
`;

export const EXECUTION_LOGS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_execution_logs_updated_at ON execution_logs(updated_at);
CREATE INDEX IF NOT EXISTS idx_execution_logs_byte_size ON execution_logs(byte_size);
CREATE INDEX IF NOT EXISTS idx_execution_logs_line_count ON execution_logs(line_count);
`;

export const WORKFLOWS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_orchestrator ON workflows(orchestrator_execution_id);
CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at);
CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows(updated_at);
CREATE INDEX IF NOT EXISTS idx_workflows_base_branch ON workflows(base_branch);
`;

export const WORKFLOW_EVENTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow_id ON workflow_events(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(type);
CREATE INDEX IF NOT EXISTS idx_workflow_events_execution_id ON workflow_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_processed ON workflow_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON workflow_events(created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_unprocessed ON workflow_events(workflow_id, processed_at) WHERE processed_at IS NULL;
`;

export const CODE_GRAPH_CACHE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_code_graph_cache_sha ON code_graph_cache(git_sha);
CREATE INDEX IF NOT EXISTS idx_code_graph_cache_analyzed_at ON code_graph_cache(analyzed_at);
`;

/**
 * View definitions
 */

export const READY_ISSUES_VIEW = `
CREATE VIEW IF NOT EXISTS ready_issues AS
SELECT i.*
FROM issues i
WHERE i.status = 'open'
  AND i.archived = 0
  AND NOT EXISTS (
    SELECT 1 FROM relationships r
    JOIN issues blocker ON (
      (r.relationship_type = 'blocks' AND r.from_id = blocker.id AND r.from_type = 'issue') OR
      (r.relationship_type = 'depends-on' AND r.to_id = blocker.id AND r.to_type = 'issue')
    )
    WHERE (
      (r.relationship_type = 'blocks' AND r.to_id = i.id AND r.to_type = 'issue') OR
      (r.relationship_type = 'depends-on' AND r.from_id = i.id AND r.from_type = 'issue')
    )
      AND blocker.status IN ('open', 'in_progress', 'blocked')
  );
`;

export const BLOCKED_ISSUES_VIEW = `
CREATE VIEW IF NOT EXISTS blocked_issues AS
SELECT
    i.*,
    COUNT(DISTINCT blocker.id) as blocked_by_count,
    GROUP_CONCAT(DISTINCT blocker.id) as blocked_by_ids
FROM issues i
JOIN relationships r ON (
  (r.relationship_type = 'blocks' AND i.id = r.to_id AND r.to_type = 'issue') OR
  (r.relationship_type = 'depends-on' AND i.id = r.from_id AND r.from_type = 'issue')
)
JOIN issues blocker ON (
  (r.relationship_type = 'blocks' AND r.from_id = blocker.id AND r.from_type = 'issue') OR
  (r.relationship_type = 'depends-on' AND r.to_id = blocker.id AND r.to_type = 'issue')
)
WHERE i.status IN ('open', 'in_progress', 'blocked')
  AND i.archived = 0
  AND blocker.status IN ('open', 'in_progress', 'blocked')
GROUP BY i.id;
`;

/**
 * Combined schema initialization
 */
export const ALL_TABLES = [
  SPECS_TABLE,
  ISSUES_TABLE,
  RELATIONSHIPS_TABLE,
  TAGS_TABLE,
  EVENTS_TABLE,
  ISSUE_FEEDBACK_TABLE,
  EXECUTIONS_TABLE,
  PROMPT_TEMPLATES_TABLE,
  EXECUTION_LOGS_TABLE,
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
  CODE_GRAPH_CACHE_TABLE,
];

export const ALL_INDEXES = [
  SPECS_INDEXES,
  ISSUES_INDEXES,
  RELATIONSHIPS_INDEXES,
  TAGS_INDEXES,
  EVENTS_INDEXES,
  ISSUE_FEEDBACK_INDEXES,
  EXECUTIONS_INDEXES,
  PROMPT_TEMPLATES_INDEXES,
  EXECUTION_LOGS_INDEXES,
  WORKFLOWS_INDEXES,
  WORKFLOW_EVENTS_INDEXES,
  CODE_GRAPH_CACHE_INDEXES,
];

export const ALL_VIEWS = [READY_ISSUES_VIEW, BLOCKED_ISSUES_VIEW];
