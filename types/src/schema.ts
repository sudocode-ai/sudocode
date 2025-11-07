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
    issue_id TEXT NOT NULL,
    issue_uuid TEXT NOT NULL,
    spec_id TEXT NOT NULL,
    spec_uuid TEXT NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('comment', 'suggestion', 'request')),
    content TEXT NOT NULL,
    agent TEXT,
    anchor TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (issue_uuid) REFERENCES issues(uuid) ON DELETE CASCADE,
    FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE,
    FOREIGN KEY (spec_uuid) REFERENCES specs(uuid) ON DELETE CASCADE
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
    agent_type TEXT CHECK(agent_type IN ('claude-code', 'codex', 'project-coordinator')),
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
// Logs are stored in JSONL format (newline-delimited JSON)
export const EXECUTION_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS execution_logs (
    execution_id TEXT PRIMARY KEY,
    raw_logs TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL DEFAULT 0,
    line_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
`;

// Project agent executions table - tracks project agent lifecycle
export const PROJECT_AGENT_EXECUTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS project_agent_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('running', 'stopped', 'error')),
    mode TEXT NOT NULL CHECK(mode IN ('monitoring', 'planning', 'full')),
    use_worktree INTEGER NOT NULL DEFAULT 1 CHECK(use_worktree IN (0, 1)),
    worktree_path TEXT,
    config_json TEXT NOT NULL,

    -- Metrics
    events_processed INTEGER NOT NULL DEFAULT 0,
    actions_proposed INTEGER NOT NULL DEFAULT 0,
    actions_approved INTEGER NOT NULL DEFAULT 0,
    actions_rejected INTEGER NOT NULL DEFAULT 0,

    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stopped_at DATETIME,
    last_activity_at DATETIME,

    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
`;

// Project agent actions table - stores proposed actions and their lifecycle
export const PROJECT_AGENT_ACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS project_agent_actions (
    id TEXT PRIMARY KEY,
    project_agent_execution_id TEXT NOT NULL,

    action_type TEXT NOT NULL CHECK(action_type IN (
        'create_issues_from_spec',
        'start_execution',
        'pause_execution',
        'resume_execution',
        'add_feedback',
        'modify_spec',
        'create_relationship',
        'update_issue_status'
    )),
    status TEXT NOT NULL CHECK(status IN (
        'proposed',
        'approved',
        'rejected',
        'executing',
        'completed',
        'failed'
    )),
    priority TEXT CHECK(priority IN ('high', 'medium', 'low')),

    -- Action details
    target_id TEXT,
    target_type TEXT CHECK(target_type IN ('spec', 'issue', 'execution')),
    payload_json TEXT NOT NULL,
    justification TEXT NOT NULL,

    -- Lifecycle
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    rejected_at DATETIME,
    executed_at DATETIME,
    completed_at DATETIME,

    -- Result
    result_json TEXT,
    error_message TEXT,

    FOREIGN KEY (project_agent_execution_id) REFERENCES project_agent_executions(id) ON DELETE CASCADE
);
`;

// Project agent events table - log of events processed by project agent
export const PROJECT_AGENT_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS project_agent_events (
    id TEXT PRIMARY KEY,
    project_agent_execution_id TEXT NOT NULL,

    event_type TEXT NOT NULL,
    event_payload_json TEXT NOT NULL,

    processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_duration_ms INTEGER,

    -- Action taken (if any)
    action_id TEXT,

    FOREIGN KEY (project_agent_execution_id) REFERENCES project_agent_executions(id) ON DELETE CASCADE,
    FOREIGN KEY (action_id) REFERENCES project_agent_actions(id) ON DELETE SET NULL
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
CREATE INDEX IF NOT EXISTS idx_feedback_issue_id ON issue_feedback(issue_id);
CREATE INDEX IF NOT EXISTS idx_feedback_issue_uuid ON issue_feedback(issue_uuid);
CREATE INDEX IF NOT EXISTS idx_feedback_spec_id ON issue_feedback(spec_id);
CREATE INDEX IF NOT EXISTS idx_feedback_spec_uuid ON issue_feedback(spec_uuid);
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

export const PROJECT_AGENT_EXECUTIONS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_project_agent_exec_execution_id ON project_agent_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_project_agent_exec_status ON project_agent_executions(status);
CREATE INDEX IF NOT EXISTS idx_project_agent_exec_mode ON project_agent_executions(mode);
CREATE INDEX IF NOT EXISTS idx_project_agent_exec_started_at ON project_agent_executions(started_at);
`;

export const PROJECT_AGENT_ACTIONS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_project_agent_actions_exec_id ON project_agent_actions(project_agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_project_agent_actions_status ON project_agent_actions(status);
CREATE INDEX IF NOT EXISTS idx_project_agent_actions_type ON project_agent_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_project_agent_actions_created_at ON project_agent_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_project_agent_actions_target ON project_agent_actions(target_id, target_type);
`;

export const PROJECT_AGENT_EVENTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_project_agent_events_exec_id ON project_agent_events(project_agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_project_agent_events_type ON project_agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_project_agent_events_processed_at ON project_agent_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_project_agent_events_action_id ON project_agent_events(action_id);
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
  PROJECT_AGENT_EXECUTIONS_TABLE,
  PROJECT_AGENT_ACTIONS_TABLE,
  PROJECT_AGENT_EVENTS_TABLE,
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
  PROJECT_AGENT_EXECUTIONS_INDEXES,
  PROJECT_AGENT_ACTIONS_INDEXES,
  PROJECT_AGENT_EVENTS_INDEXES,
];

export const ALL_VIEWS = [READY_ISSUES_VIEW, BLOCKED_ISSUES_VIEW];
