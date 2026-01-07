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

## Remote Deployment

Deploy sudocode to GitHub Codespaces for cloud-based development accessible from anywhere.

### Prerequisites

- [GitHub CLI](https://cli.github.com) installed and authenticated (`gh auth login`)
- Repository pushed to GitHub
- Git repository with GitHub remote

### Quick Start

Deploy with defaults (72-hour keep-alive, 14-day retention):

```bash
sudocode deploy remote
```

This will:
1. Create a GitHub Codespace
2. Install sudocode globally
3. Start the sudocode server
4. Make the UI accessible via public HTTPS URL
5. Keep the Codespace active for 72 hours
6. Auto-delete after 14 days

### Custom Configuration

```bash
# Use larger machine
sudocode deploy remote --machine 4core

# Keep alive for 7 days (168 hours)
sudocode deploy remote --keep-alive 168h

# Custom retention period (30 days)
sudocode deploy remote --retention-period 30

# Combine options
sudocode deploy remote --machine 4core --keep-alive 168h --retention-period 30

# Skip opening browsers
sudocode deploy remote --no-open
```

### Managing Deployments

List all deployments:

```bash
sudocode deploy list
```

Stop and delete a deployment:

```bash
sudocode deploy stop <codespace-name>
```

### How It Works

**Two-Tier Timeout System:**
- **Codespace timeout**: GitHub's maximum (4 hours of inactivity)
- **Keep-alive**: Sudocode keeps the Codespace active for your configured duration (default: 72 hours)
- **Auto-delete**: Codespaces are deleted after the retention period (default: 14 days)

After the keep-alive duration expires, the Codespace will naturally shut down within 4 hours of inactivity.

**Port Forwarding:**
- Server runs on port 3000 in the Codespace
- GitHub automatically provides a public HTTPS URL: `https://<codespace-name>-3000.app.github.dev`
- Ports are made public for easy access

### Available Machine Types

- `basicLinux32gb` (default) - 2-core, 8GB RAM
- `standardLinux32gb` - 4-core, 16GB RAM
- `premiumLinux` - 8-core, 32GB RAM

See [GitHub Codespaces machine types](https://docs.github.com/en/codespaces/customizing-your-codespace/changing-the-machine-type-for-your-codespace) for more details.

### Troubleshooting

**Error: GitHub CLI not found**
```bash
# Install GitHub CLI
# macOS
brew install gh

# Linux
# See https://cli.github.com/manual/installation

# Authenticate
gh auth login
```

**Error: Not authenticated with GitHub**
```bash
gh auth login
```

**Error: Not in a git repository with GitHub remote**
```bash
# Initialize git and add GitHub remote
git init
git remote add origin git@github.com:username/repo.git
git push -u origin main
```

**Deployment stuck or failed**
- Check Codespace status: `gh codespace list`
- View Codespace logs: `gh codespace ssh --codespace <name> -- tail -f /tmp/sudocode.log`
- Delete and retry: `sudocode deploy stop <name>` then `sudocode deploy remote`

**Server not accessible**
- Verify Codespace is running: `gh codespace list`
- Check port forwarding: `gh codespace ports list --codespace <name>`
- Ensure port visibility is public: `gh codespace ports visibility 3000:public --codespace <name>`

### Manual Authentication in Codespace

For the MVP, you'll need to manually authenticate Claude Code inside the Codespace:

1. SSH into the Codespace: `gh codespace ssh --codespace <name>`
2. Run: `claude setup-token`
3. Follow the prompts to generate and configure your token

Future versions will automate this process.

### Cost Considerations

GitHub Codespaces usage is billed based on:
- Machine type (compute hours)
- Storage (GB-months)

Free tier includes:
- 120 core-hours per month (60 hours on 2-core machine)
- 15 GB storage

See [GitHub Codespaces pricing](https://docs.github.com/en/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces) for details.