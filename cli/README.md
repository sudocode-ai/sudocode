# @sudocode-ai/cli

Command-line interface for [sudocode](https://github.com/sudocode-ai/sudocode) - Git-native spec and issue management for AI-assisted software development.

## Overview

The sudocode CLI provides a complete toolkit for managing specifications and issues in a git-native workflow. All data is stored in `.sudocode/` as JSONL files that can be versioned alongside your code, with a local SQLite cache for fast queries.

## Features

- **Git-native workflow** - All specs and issues stored as JSONL in `.sudocode/`
- **Fast local cache** - SQLite database for instant queries
- **Bidirectional sync** - Export to markdown for editing, import back to database
- **Relationship tracking** - Link specs and issues with typed relationships
- **Cross-references** - Add inline Obsidian-style `[[ID]]` references in markdown
- **Anchored feedback** - Attach issue feedback to specific lines in specs
- **Priority management** - 5-level priority system (0-4)
- **Flexible queries** - Filter by status, assignee, priority, or grep content
- **Watch mode** - Auto-sync markdown changes to database

## Installation

```bash
npm install -g @sudocode-ai/cli
```

Or install the meta-package that includes the CLI:

```bash
npm install -g sudocode
```

## Authentication

### Overview

Sudocode supports multiple AI service credentials for remote deployment. Configure at least one service to enable Codespace deployment.

### Supported Services

1. **Claude Code** (Available now)
2. **LLM Key** (OpenAI/LiteLLM) - Coming soon
3. **LiteLLM** (Custom LLM configs) - Coming soon

### Setup Claude Code

#### Interactive Setup (Recommended)

Run the interactive authentication flow:

```bash
sudocode auth claude
```

This will:
1. Check for Claude CLI installation
2. Launch OAuth flow in your browser
3. Store the token securely
4. Verify configuration

#### Non-Interactive Setup

If you already have a token:

```bash
sudocode auth claude --token sk-ant-api03-xxxxx
```

### Check Authentication Status

View all configured credentials:

```bash
sudocode auth status
```

Output:
```
Authentication Status:

Claude Code: ✓ Configured
  Token: sk-ant-api03-***************************xxx

LLM Key: ✗ Not configured
  Run: sudocode auth llm --key <key> (coming soon)

LiteLLM: ✗ Not configured
  Run: sudocode auth litellm (coming soon)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Configured: 1/3 services
Storage: ~/.config/sudocode/user_credentials.json

✓ Ready for remote deployment
```

### Clear Credentials

Remove all stored credentials:

```bash
sudocode auth clear
```

Or skip confirmation:

```bash
sudocode auth clear --force
```

### How It Works

1. Configure one or more services locally
2. Credentials stored in `~/.config/sudocode/user_credentials.json` (600 permissions)
3. When deploying to Codespace, all credentials are passed to the deployment system
4. AI services are configured in the remote environment
5. Sudocode server can use any configured service for executions

### Security

- Credentials stored in `~/.config/sudocode/` with restrictive permissions (600)
- File is never committed to git (user-level config)
- Tokens are masked in command output
- Atomic file writes prevent corruption

### Troubleshooting

#### Claude CLI Not Found

If you see "claude CLI not found":

```bash
npm install -g @anthropic-ai/claude-cli
```

#### Invalid Token Format

Tokens must:
- Start with `sk-ant-`
- Be at least 20 characters long
- Contain only alphanumeric characters, dashes, and underscores

#### Permission Errors

If you get permission errors:

```bash
# Check permissions
ls -la ~/.config/sudocode/user_credentials.json

# Fix permissions
chmod 600 ~/.config/sudocode/user_credentials.json
```

#### File Corrupted

If credentials file is corrupted, clear and reconfigure:

```bash
sudocode auth clear --force
sudocode auth claude
```

## Quick Start

```bash
# Initialize sudocode in your project
sudocode init

# Create a spec
sudocode spec create "User authentication system" -p 4

# Create an issue
sudocode issue create "Implement login endpoint" -p 3 -a alice

# Link issue to spec
sudocode link ISSUE-1 SPEC-1 --type implements

# Show ready work
sudocode ready

# Update issue status
sudocode issue update ISSUE-1 --status in_progress
```

## Commands

### Initialization

```bash
sudocode init [options]
```

Initialize `.sudocode/` directory structure with database, JSONL files, and configuration.

**Options:**
- `--spec-prefix <prefix>` - ID prefix for specs (default: "SPEC")
- `--issue-prefix <prefix>` - ID prefix for issues (default: "ISSUE")

**Creates:**
- `.sudocode/cache.db` - SQLite database (gitignored)
- `.sudocode/specs.jsonl` - Spec storage (versioned)
- `.sudocode/issues.jsonl` - Issue storage (versioned)
- `.sudocode/config.json` - Metadata config (versioned)
- `.sudocode/.gitignore` - Ignores cache and markdown files

### Spec Management

```bash
# Create a new spec
sudocode spec create <title> [options]
  -p, --priority <0-4>        Priority level (default: 2)
  -d, --description <text>    Description
  --design <text>             Design notes
  --file-path <path>          Custom markdown file path
  --parent <id>               Parent spec ID
  --tags <tags>               Comma-separated tags

# List specs
sudocode spec list [options]
  -p, --priority <priority>   Filter by priority
  -g, --grep <query>          Search title or content
  --limit <num>               Limit results (default: 50)

# Show spec details
sudocode spec show <id>

# Delete specs
sudocode spec delete <id...>
```

### Issue Management

```bash
# Create a new issue
sudocode issue create <title> [options]
  -p, --priority <0-4>        Priority level (default: 2)
  -d, --description <text>    Description
  -a, --assignee <name>       Assignee username
  --parent <id>               Parent issue ID
  --tags <tags>               Comma-separated tags

# List issues
sudocode issue list [options]
  -s, --status <status>       Filter by status (open, in_progress, blocked, needs_review, closed)
  -a, --assignee <assignee>   Filter by assignee
  -p, --priority <priority>   Filter by priority
  -g, --grep <query>          Search title, description, or content
  --limit <num>               Limit results (default: 50)

# Show issue details
sudocode issue show <id>

# Update issue
sudocode issue update <id> [options]
  -s, --status <status>       New status
  -p, --priority <priority>   New priority
  -a, --assignee <assignee>   New assignee
  --title <title>             New title
  --description <desc>        New description

# Close issues
sudocode issue close <id...> [options]
  -r, --reason <text>         Reason for closing

# Delete issues
sudocode issue delete <id...> [options]
  --hard                      Permanently delete (default: close)
```

### Relationships

```bash
# Link entities
sudocode link <from> <to> [options]
  -t, --type <type>           Relationship type (default: "references")
```

**Relationship types:**
- `blocks` - From blocks To (e.g., ISSUE-1 blocks ISSUE-2)
- `implements` - From implements To (e.g., ISSUE-1 implements SPEC-1)
- `references` - From references To (general reference)
- `depends-on` - From depends on To
- `related` - General relation
- `discovered-from` - Issue discovered from spec feedback

### Cross-References

Add inline references to specs or issues using Obsidian-style `[[ID]]` syntax.

```bash
# Add reference to a spec or issue
sudocode spec add-ref <entity-id> <reference-id> [options]
sudocode issue add-ref <entity-id> <reference-id> [options]
  -l, --line <number>         Line number to insert reference
  -t, --text <text>           Text to search for insertion point
  --display <text>            Display text for reference (creates [[ID|text]])
  --type <type>               Relationship type (creates [[ID]]{ type })
  --format <format>           Format: inline or newline (default: inline)
  --position <position>       Position: before or after (default: after)
```

**Notes:**
- Either `--line` or `--text` is required (mutually exclusive)
- References use Obsidian-style syntax: `[[ISSUE-001]]`
- Display text: `[[ISSUE-001|OAuth Implementation]]`
- With relationship: `[[SPEC-002]]{ implements }`
- Combined: `[[SPEC-002|Auth Spec]]{ blocks }`
- Inline format adds reference on same line with surrounding text
- Newline format adds reference on its own line

**Examples:**

```bash
# Add reference inline after line 45
sudocode spec add-ref SPEC-001 ISSUE-003 --line 45

# Add reference after specific text
sudocode spec add-ref SPEC-001 ISSUE-003 --text "Requirements:"

# Add with display text
sudocode spec add-ref SPEC-001 ISSUE-003 --line 45 --display "OAuth implementation"

# Add with relationship type
sudocode issue add-ref ISSUE-001 SPEC-002 --text "Design" --type implements

# Add on new line before text
sudocode spec add-ref SPEC-001 ISSUE-004 --text "## Tasks" --format newline --position before
```

### Query Commands

```bash
# Show ready work (no blockers)
sudocode ready

# Show blocked issues
sudocode blocked
```

### Status & Stats

```bash
# Quick project status
sudocode status [options]
  -v, --verbose               Show detailed status

# Detailed statistics
sudocode stats
```

### Feedback Management

Feedback allows issues to reference specific locations in specs with anchored comments.

```bash
# Add feedback to a spec
sudocode feedback add <issue-id> <spec-id> [options]
  -l, --line <number>         Line number in spec
  -t, --text <text>           Text to search for anchor
  --type <type>               Feedback type (comment, suggestion, request)
  -c, --content <text>        Feedback content (required)
  -a, --agent <name>          Agent name

# List feedback
sudocode feedback list [options]
  -i, --issue <id>            Filter by issue ID
  -s, --spec <id>             Filter by spec ID
  -t, --type <type>           Filter by type
  --status <status>           Filter by status (open, acknowledged, resolved, wont_fix)
  --limit <num>               Limit results (default: 50)

# Show feedback details
sudocode feedback show <id>

# Dismiss feedback
sudocode feedback dismiss <id> [options]
  -c, --comment <text>        Optional comment

# List stale feedback anchors
sudocode feedback stale

# Manually relocate stale anchor
sudocode feedback relocate <id> --line <number>
```

### Sync & Export

```bash
# Sync between markdown, JSONL, and database
sudocode sync [options]
  --watch                     Watch for changes and auto-sync
  --from-markdown             Sync from markdown to database
  --to-markdown               Sync from database to markdown

# Export database to JSONL
sudocode export [options]
  -o, --output <dir>          Output directory (default: ".sudocode")

# Import JSONL to database
sudocode import [options]
  -i, --input <dir>           Input directory (default: ".sudocode")
```

## Global Options

```bash
--db <path>                   Custom database path (auto-discovers by default)
--json                        Output in JSON format
```

## Example Workflows

### Creating and Working on a Feature

```bash
# Create a spec for the feature
sudocode spec create "Add OAuth authentication" -p 4 --tags auth,security

# Create implementation issues
sudocode issue create "Set up OAuth provider" -p 3 -a alice
sudocode issue create "Create login flow" -p 3 -a bob

# Link issues to spec
sudocode link ISSUE-1 SPEC-1 --type implements
sudocode link ISSUE-2 SPEC-1 --type implements

# Mark an issue as blocking another
sudocode link ISSUE-1 ISSUE-2 --type blocks

# Check what's ready to work on
sudocode ready

# Start working
sudocode issue update ISSUE-1 --status in_progress

# Complete the work
sudocode issue close ISSUE-1 -r "OAuth provider configured"
```

### Adding Feedback to Specs

```bash
# Add feedback at a specific line
sudocode feedback add ISSUE-3 SPEC-1 \
  --line 42 \
  --content "Consider adding rate limiting" \
  --type suggestion

# Add feedback by searching for text
sudocode feedback add ISSUE-4 SPEC-1 \
  --text "password requirements" \
  --content "Should we support passkeys?" \
  --type comment

# List all feedback for a spec
sudocode feedback list --spec SPEC-1

# Check for stale anchors
sudocode feedback stale
```