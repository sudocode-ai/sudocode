# Sudocode MCP Server Specification

The Sudocode MCP will be a local MCP server that exposes Sudocode CLI functionality to AI agents via the Model Context Protocol, enabling agentic management of specs, issues, and the feedback system.

## Overview

Sudocode MCP provides tools for:
- **Spec Management**: Creating and managing specifications with markdown support
- **Issue Management**: Full CRUD operations for bugs, features, tasks, epics, and chores
- **Relationship Management**: Creating links between specs and issues (blocks, implements, etc.)
- **Feedback System**: Anchored feedback from issues to specs with smart relocation
- **Analytics**: Ready work, blocked items, and project statistics

## Architecture

### Technology Stack
- **Runtime**: Node.js with TypeScript
- **MCP Framework**: `@modelcontextprotocol/sdk` or `fastmcp` (if available for Node.js)
- **CLI Integration**: Spawn `sudocode` CLI commands (similar to beads-mcp approach)
- **Working Directory**: Use `SUDOCODE_WORKING_DIR` env var or `process.cwd()`

### Design Principles
1. **CLI-First**: MCP server wraps existing CLI commands rather than duplicating logic
2. **JSON Output**: Always use `--json` flag for structured, parseable responses
3. **Error Handling**: Parse and return meaningful error messages from CLI
4. **Context Preservation**: Maintain working directory across tool calls
5. **Database Auto-Discovery**: Leverage CLI's built-in `.sudocode` discovery

## Resources

### 1. `sudocode://quickstart`
**Name**: "Sudocode Quickstart Guide"
**Description**: Introduction to Sudocode workflow and best practices for agents

**Content**:
```markdown
# Sudocode Quickstart

Sudocode is a git-native spec and issue management system designed for AI-assisted development.

## Core Concepts

**Specs**: Technical specifications stored as markdown files
- Types: architecture, api, database, feature, research
- Status: draft → review → approved → deprecated
- Each spec has a unique ID (e.g., sudocode-spec-1) and file path

**Issues**: Work items tracked in the database
- Types: bug, feature, task, epic, chore
- Status: open → in_progress → blocked → closed
- Can reference and implement specs

**Feedback**: Issues can provide anchored feedback on specs
- Anchors track specific lines/sections in spec markdown
- Auto-relocates when specs change (smart anchoring)
- Types: ambiguity, missing_requirement, technical_constraint, suggestion, question

## Typical Workflow

1. **Check ready work**: `ready` tool to find tasks with no blockers
2. **Claim work**: `update_issue` with status=in_progress
3. **Review specs**: `show_spec` to understand requirements
4. **Provide feedback**: `add_feedback` when specs are unclear
5. **Complete work**: `close_issue` when done
6. **Link entities**: Use `link` to create relationships

## Relationship Types
- `blocks`: Hard blocker (to_id must complete before from_id)
- `implements`: Issue implements a spec
- `references`: Soft reference
- `depends-on`: General dependency
- `parent-child`: Epic/subtask hierarchy
- `discovered-from`: New work found during implementation
```

### 2. `sudocode://workflow`
**Name**: "Agent Workflow Guide"
**Description**: Step-by-step workflow patterns for AI agents

## Tools

### Issue Management

#### 1. `ready`
**Description**: Find issues and specs ready to work on (no blockers)

**Parameters**:
- `limit` (number, default: 10): Max items to return
- `priority` (number?, 0-4): Filter by priority (0=highest)
- `assignee` (string?): Filter by assignee
- `show_specs` (boolean, default: false): Include ready specs
- `show_issues` (boolean, default: true): Include ready issues

**Returns**: `{ specs?: Spec[], issues?: Issue[] }`

**CLI Command**: `sudocode ready --json [--limit N] [--priority P] [--assignee A] [--specs] [--issues]`

**Considerations**: Make sure the returned issue doesn't overflow context.

---

#### 2. `list_issues`
**Description**: List all issues with optional filters

**Parameters**:
- `status` (IssueStatus?): Filter by status (open, in_progress, blocked, closed)
- `type` (IssueType?): Filter by type (bug, feature, task, epic, chore)
- `priority` (number?): Filter by priority (0-4)
- `assignee` (string?): Filter by assignee
- `limit` (number, default: 50): Max results

**Returns**: `Issue[]`

**CLI Command**: `sudocode issue list --json [filters]`

**Considerations**: This may produce too much context. The MCP server needs a way of reducing the total context (maybe just name/description) if the total context is too large.

---

#### 3. `show_issue`
**Description**: Show detailed issue information including relationships and feedback

**Parameters**:
- `issue_id` (string, required): Issue ID (e.g., "sudocode-1")

**Returns**: `IssueDetail` (includes relationships, tags, feedback provided)

**CLI Command**: `sudocode issue show <id> --json`

---

#### 4. `create_issue`
**Description**: Create a new issue

**Parameters**:
- `title` (string, required): Issue title
- `description` (string, default: ""): Description
- `type` (IssueType, default: "task"): Issue type
- `priority` (number, default: 2): Priority 0-4
- `assignee` (string?): Assignee username
- `parent` (string?): Parent issue ID
- `tags` (string[]?): Tags
- `estimate` (number?): Estimated minutes

**Returns**: `Issue`

**CLI Command**: `sudocode issue create "<title>" --json [options]`

---

#### 5. `update_issue`
**Description**: Update an existing issue

**Parameters**:
- `issue_id` (string, required): Issue ID
- `status` (IssueStatus?): New status
- `priority` (number?): New priority
- `assignee` (string?): New assignee
- `type` (IssueType?): New type
- `title` (string?): New title
- `description` (string?): New description

**Returns**: `Issue`

**CLI Command**: `sudocode issue update <id> --json [options]`

---

#### 6. `close_issue`
**Description**: Close one or more issues

**Parameters**:
- `issue_ids` (string[], required): Issue IDs to close
- `reason` (string, default: "Completed"): Reason for closing

**Returns**: `CloseResult[]` (array of { id, success, error? })

**CLI Command**: `sudocode issue close <ids...> --json [--reason]`

---

#### 7. `blocked_issues`
**Description**: Get blocked issues showing what's blocking them

**Parameters**:
- `show_specs` (boolean, default: false): Include blocked specs
- `show_issues` (boolean, default: true): Include blocked issues

**Returns**: `{ specs?: BlockedSpec[], issues?: BlockedIssue[] }`

**CLI Command**: `sudocode blocked --json [--specs] [--issues]`

---

### Spec Management

#### 8. `list_specs`
**Description**: List all specs with optional filters

**Parameters**:
- `status` (SpecStatus?): Filter by status (draft, review, approved, deprecated)
- `type` (SpecType?): Filter by type (architecture, api, database, feature, research)
- `priority` (number?): Filter by priority
- `limit` (number, default: 50): Max results

**Returns**: `Spec[]`

**CLI Command**: `sudocode spec list --json [filters]`

---

#### 9. `show_spec`
**Description**: Show detailed spec information including relationships and feedback received

**Parameters**:
- `spec_id` (string, required): Spec ID (e.g., "sudocode-spec-1")

**Returns**: `SpecDetail` (includes relationships, tags, feedback received)

**CLI Command**: `sudocode spec show <id> --json`

---

#### 10. `create_spec`
**Description**: Create a new spec with markdown file

**Parameters**:
- `title` (string, required): Spec title
- `type` (SpecType, default: "feature"): Spec type
- `priority` (number, default: 2): Priority 0-4
- `description` (string?): Description
- `design` (string?): Design notes (markdown content)
- `file_path` (string?): Custom file path (default: specs/{id}.md)
- `parent` (string?): Parent spec ID
- `tags` (string[]?): Tags

**Returns**: `Spec`

**CLI Command**: `sudocode spec create "<title>" --json [options]`

---

### Relationship Management

#### 11. `link`
**Description**: Create a relationship between two entities

**Parameters**:
- `from_id` (string, required): Source entity ID
- `to_id` (string, required): Target entity ID
- `type` (RelationshipType, default: "references"): Relationship type
  - `blocks`: Hard blocker
  - `implements`: Issue implements spec
  - `references`: Soft reference
  - `depends-on`: General dependency
  - `parent-child`: Hierarchical
  - `discovered-from`: Found during work
  - `related`: Related entities

**Returns**: `{ from, to, type, success }`

**CLI Command**: `sudocode link <from> <to> --json [--type]`

---

### Feedback System

#### 12. `add_feedback`
**Description**: Add anchored feedback to a spec from an issue

**Parameters**:
- `issue_id` (string, required): Issue providing feedback
- `spec_id` (string, required): Spec receiving feedback
- `content` (string, required): Feedback content
- `type` (FeedbackType, default: "ambiguity"): Feedback type
  - `ambiguity`, `missing_requirement`, `technical_constraint`, `suggestion`, `question`
- `line` (number?): Line number in spec (exclusive with text)
- `text` (string?): Text to search for anchor (exclusive with line)
- `agent` (string?): Agent name (default: USER env var)

**Returns**: `Feedback`

**CLI Command**: `sudocode feedback add <issue-id> <spec-id> --json --content "<text>" [options]`

**Notes**: Either `line` or `text` must be provided to create an anchor

---

#### 13. `list_feedback`
**Description**: List feedback with filters

**Parameters**:
- `issue_id` (string?): Filter by issue
- `spec_id` (string?): Filter by spec
- `type` (FeedbackType?): Filter by feedback type
- `status` (FeedbackStatus?): Filter by status (open, acknowledged, resolved, wont_fix)
- `limit` (number, default: 50): Max results

**Returns**: `Feedback[]`

**CLI Command**: `sudocode feedback list --json [filters]`

---

#### 14. `show_feedback`
**Description**: Show detailed feedback including anchor status

**Parameters**:
- `feedback_id` (string, required): Feedback ID

**Returns**: `FeedbackDetail` (includes parsed anchor with location info)

**CLI Command**: `sudocode feedback show <id> --json`

---

#### 15. `acknowledge_feedback`
**Description**: Acknowledge feedback (status → acknowledged)

**Parameters**:
- `feedback_id` (string, required): Feedback ID

**Returns**: `Feedback`

**CLI Command**: `sudocode feedback acknowledge <id> --json`

---

#### 16. `resolve_feedback`
**Description**: Mark feedback as resolved

**Parameters**:
- `feedback_id` (string, required): Feedback ID
- `comment` (string?): Resolution comment

**Returns**: `Feedback`

**CLI Command**: `sudocode feedback resolve <id> --json [--comment]`

---

#### 17. `wontfix_feedback`
**Description**: Mark feedback as won't fix

**Parameters**:
- `feedback_id` (string, required): Feedback ID
- `reason` (string?): Reason for not fixing

**Returns**: `Feedback`

**CLI Command**: `sudocode feedback wont-fix <id> --json [--reason]`

---

#### 18. `stale_feedback`
**Description**: List feedback with stale anchors (spec changed, anchor lost)

**Parameters**: None

**Returns**: `Feedback[]` (filtered to anchor_status === 'stale')

**CLI Command**: `sudocode feedback stale --json`

---

#### 19. `relocate_feedback`
**Description**: Manually relocate a stale feedback anchor

**Parameters**:
- `feedback_id` (string, required): Feedback ID
- `line` (number, required): New line number in spec

**Returns**: `Feedback`

**CLI Command**: `sudocode feedback relocate <id> --json --line <number>`

---

### Analytics

#### 20. `stats`
**Description**: Get comprehensive project statistics

**Parameters**: None

**Returns**:
```typescript
{
  specs: {
    total: number,
    by_status: Record<SpecStatus, number>,
    by_type: Record<SpecType, number>,
    ready: number
  },
  issues: {
    total: number,
    by_status: Record<IssueStatus, number>,
    by_type: Record<IssueType, number>,
    ready: number,
    blocked: number
  },
  relationships: {
    total: number,
    by_type: Record<RelationshipType, number>
  },
  recent_activity: {
    specs_updated: number,
    issues_updated: number,
    issues_created: number,
    issues_closed: number
  }
}
```

**CLI Command**: `sudocode stats --json`

---

#### 21. `status`
**Description**: Get quick project status summary

**Parameters**:
- `verbose` (boolean, default: false): Show detailed status

**Returns**: Simplified version of stats

**CLI Command**: `sudocode status --json [--verbose]`

---

### Initialization

#### 22. `init`
**Description**: Initialize Sudocode in current directory

**Parameters**:
- `prefix` (string, default: "sudocode"): ID prefix for specs/issues

**Returns**: `{ success: boolean, path: string, prefix: string }`

**CLI Command**: `sudocode init --json [--prefix]`

---

## Implementation Notes

### CLI Client Architecture

```typescript
class SudocodeClient {
  private workingDir: string;
  private cliPath: string;

  constructor(config?: {
    workingDir?: string;
    cliPath?: string;
    dbPath?: string;
  });

  private async exec(
    command: string[],
    options?: { json?: boolean }
  ): Promise<any>;

  // Implement tool methods that call this.exec()
  async ready(params: ReadyParams): Promise<ReadyResult>;
  async listIssues(params: ListIssuesParams): Promise<Issue[]>;
  // ... etc
}
```

### Environment Variables

- `SUDOCODE_PATH`: Path to `sudocode` CLI (default: auto-discover from PATH)
- `SUDOCODE_DB`: Path to database file (default: auto-discover)
- `SUDOCODE_WORKING_DIR`: Working directory for commands (default: process.cwd())
- `SUDOCODE_ACTOR`: Actor name for audit trail (default: process.env.USER)

### Error Handling

1. **CLI Not Found**: Return helpful error directing to installation
2. **Invalid Database**: Suggest running `init` tool
3. **Entity Not Found**: Return 404-style error with clear message
4. **Validation Errors**: Parse CLI error output and return structured errors

### Testing Strategy

1. **Unit Tests**: Mock CLI calls, test parameter mapping
2. **Integration Tests**: Real CLI calls with temp database
3. **MCP Protocol Tests**: Test tool registration and execution
4. **Error Cases**: Invalid inputs, missing entities, CLI errors

## Future Enhancements

1. **Batch Operations**: Support bulk create/update/close
2. **Search Tools**: Full-text search across specs and issues
3. **Sync Commands**: Expose sync, export, import tools
4. **Graph Queries**: Advanced relationship traversal
5. **Feedback Auto-Relocation**: AI-assisted anchor relocation for stale feedback
6. **Prompts**: Add MCP prompts for common workflows (e.g., "start work on next task")

## Reference Implementation

See `references/beads/integrations/beads-mcp` for similar Python-based MCP server architecture.
