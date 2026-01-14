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

## Remote Deployment

### Overview

Sudocode supports deploying your project to remote development environments for AI-assisted development. Currently supports GitHub Codespaces, with additional providers planned for future releases.

**What is Remote Deployment?**

Remote deployment creates an isolated cloud environment where:
- Your project code is cloned from git
- Sudocode server runs automatically
- AI agents can execute tasks remotely
- Changes are committed back to git branches
- Multiple deployments can run in parallel

**Use Cases:**
- Run long-running AI tasks without keeping your laptop running
- Enable team members to review AI execution progress
- Execute tasks in a clean, reproducible environment
- Scale AI assistance across multiple issues simultaneously

**Supported Providers:**
- **GitHub Codespaces** - Fully supported (requires GitHub CLI)
- **Coder** - Coming soon

### Prerequisites

Before deploying to remote environments, ensure you have:

1. **GitHub CLI** - Required for Codespaces deployment
   ```bash
   # macOS
   brew install gh
   
   # Windows
   winget install GitHub.cli
   
   # Linux
   sudo apt install gh  # Debian/Ubuntu
   ```

2. **Git Repository** - Your project must be:
   - Committed to a git repository
   - Pushed to GitHub
   - You have write access to the repository

3. **Claude Authentication** - Configure at least one AI service
   ```bash
   sudocode auth claude
   ```
   See the [Authentication](#authentication) section for details.

4. **GitHub Authentication** - Login to GitHub CLI
   ```bash
   gh auth login
   ```

### Quick Start

Deploy your current project to a Codespace:

```bash
# From your project directory
cd /path/to/your/project
sudocode init  # If not already initialized

# Authenticate with Claude
sudocode auth claude

# Deploy to Codespaces
sudocode remote codespaces spawn
```

The deployment process will:
1. Detect your git repository and branch
2. Create a new GitHub Codespace
3. Clone your code and install dependencies
4. Start the sudocode server
5. Configure AI credentials
6. Print access URLs

**Output:**
```
✓ Created Codespace: sudocode-myproject-ab12cd
✓ Installing dependencies...
✓ Starting sudocode server...
✓ Deployment complete

URLs:
  Workspace: https://myorg-myproject-ab12cd.github.dev
  Sudocode:  https://myorg-myproject-ab12cd-3000.app.github.dev
  SSH:       gh cs ssh -c sudocode-myproject-ab12cd
```

### Command Reference

All remote deployment commands follow the pattern:

```bash
sudocode remote <provider> <command> [options]
```

Where `<provider>` is currently `codespaces` (with `coder` coming soon).

#### Spawn Deployment

Create a new remote deployment from your current project.

```bash
sudocode remote codespaces spawn [options]
```

**Options:**
- `--repo <owner/repo>` - Override repository (default: auto-detected from git remote)
- `--branch <name>` - Override branch (default: current branch or from config)
- `--port <number>` - Server port (default: 3000 or from config)
- `--machine <type>` - Machine type (default: "basicLinux32gb" or from config)
- `--idle-timeout <minutes>` - Idle timeout in minutes (default: 4320 or from config)
- `--keep-alive <hours>` - Keep-alive duration in hours (default: 72 or from config)
- `--retention <days>` - Retention period in days (default: 14 or from config)

**Examples:**

```bash
# Deploy with defaults
sudocode remote codespaces spawn

# Deploy specific branch
sudocode remote codespaces spawn --branch feature/new-auth

# Deploy with custom port
sudocode remote codespaces spawn --port 8080

# Deploy with larger machine
sudocode remote codespaces spawn --machine "premiumLinux"

# Deploy with shorter timeout for quick tasks
sudocode remote codespaces spawn --idle-timeout 30 --keep-alive 2

# Deploy different repository
sudocode remote codespaces spawn --repo myorg/other-project --branch main

# Deploy with all custom options
sudocode remote codespaces spawn \
  --branch develop \
  --port 5000 \
  --machine "standardLinux32gb" \
  --idle-timeout 1440 \
  --keep-alive 48 \
  --retention 7
```

**Auto-Detection:**
- Repository is detected from git remote `origin`
- Branch is detected from current git HEAD
- Configuration defaults from `.sudocode/spawn-config.json` are applied
- If repository has uncommitted changes, you'll be prompted to commit or stash them

#### List Deployments

List all active deployments for the specified provider.

```bash
sudocode remote <provider> list
```

**Examples:**

```bash
# List Codespaces deployments
sudocode remote codespaces list

# JSON output
sudocode remote codespaces list --json
```

**Output:**
```
Active Deployments (codespaces):

┌─────────────────────────┬──────────────────┬─────────────┬──────────┐
│ ID                      │ Repository       │ Branch      │ Status   │
├─────────────────────────┼──────────────────┼─────────────┼──────────┤
│ codespace-ab12cd        │ myorg/myproject  │ main        │ running  │
│ codespace-xy98zf        │ myorg/myproject  │ feature/new │ running  │
│ codespace-mn34kl        │ myorg/other      │ develop     │ starting │
└─────────────────────────┴──────────────────┴─────────────┴──────────┘

To view details: sudocode remote codespaces status <id>
To stop a deployment: sudocode remote codespaces stop <id>
```

**Empty State:**
```
No active deployments found for codespaces.

Spawn with: sudocode remote codespaces spawn
```

**JSON Output:**
```bash
sudocode remote codespaces list --json
```

```json
[
  {
    "id": "codespace-ab12cd",
    "name": "deployment-ab12cd",
    "provider": "codespaces",
    "status": "running",
    "git": {
      "owner": "myorg",
      "repo": "myproject",
      "branch": "main"
    },
    "urls": {
      "workspace": "https://myorg-myproject-ab12cd.github.dev",
      "sudocode": "https://myorg-myproject-ab12cd-3000.app.github.dev",
      "ssh": "gh cs ssh -c codespace-ab12cd"
    },
    "createdAt": "2026-01-14T10:30:00Z",
    "keepAliveHours": 72,
    "idleTimeout": 4320
  }
]
```

#### Deployment Status

Get detailed information about a specific deployment.

```bash
sudocode remote <provider> status <id>
```

**Arguments:**
- `<id>` - Deployment ID (from list output)

**Examples:**

```bash
# Get status
sudocode remote codespaces status codespace-ab12cd

# JSON output
sudocode remote codespaces status codespace-ab12cd --json
```

**Output:**
```
Deployment: codespace-ab12cd
Provider: codespaces

Status: running
Repository: myorg/myproject
Branch: main
Created: 2026-01-14T10:30:00Z

URLs:
  Workspace: https://myorg-myproject-ab12cd.github.dev
  Sudocode:  https://myorg-myproject-ab12cd-3000.app.github.dev
  SSH:       gh cs ssh -c codespace-ab12cd

Configuration:
  Port: 3000
  Machine: basicLinux32gb
  Keep-alive: 72 hours
  Idle timeout: 4320 minutes
  Retention: 14 days
```

**Status Values:**
- `running` - Deployment is active and ready
- `starting` - Deployment is being provisioned
- `stopped` - Deployment has been stopped
- `stopping` - Deployment is shutting down
- `failed` - Deployment failed to start

**Error Handling:**

If deployment is not found:
```
✗ Deployment not found: codespace-invalid

List deployments with: sudocode remote codespaces list
```

**JSON Output:**
```bash
sudocode remote codespaces status codespace-ab12cd --json
```

```json
{
  "id": "codespace-ab12cd",
  "name": "deployment-ab12cd",
  "provider": "codespaces",
  "status": "running",
  "git": {
    "owner": "myorg",
    "repo": "myproject",
    "branch": "main"
  },
  "urls": {
    "workspace": "https://myorg-myproject-ab12cd.github.dev",
    "sudocode": "https://myorg-myproject-ab12cd-3000.app.github.dev",
    "ssh": "gh cs ssh -c codespace-ab12cd"
  },
  "createdAt": "2026-01-14T10:30:00Z",
  "keepAliveHours": 72,
  "idleTimeout": 4320
}
```

#### Stop Deployment

Stop and delete a running deployment.

```bash
sudocode remote <provider> stop <id> [options]
```

**Arguments:**
- `<id>` - Deployment ID (from list output)

**Options:**
- `-f, --force` - Skip confirmation prompt

**Examples:**

```bash
# With confirmation prompt
sudocode remote codespaces stop codespace-ab12cd

# Skip confirmation
sudocode remote codespaces stop codespace-ab12cd --force

# JSON output
sudocode remote codespaces stop codespace-ab12cd --force --json
```

**Confirmation Prompt:**
```
⚠  Stop deployment codespace-ab12cd?
  This will delete the codespace and all uncommitted changes.
  
  Continue? (y/N):
```

**Output:**
```
Stopping deployment...

✓ Deployment stopped: codespace-ab12cd
```

**JSON Output:**
```json
{
  "success": true,
  "id": "codespace-ab12cd"
}
```

**Warning:** Stopping a deployment:
- Deletes the Codespace immediately
- Loses all uncommitted changes in the Codespace
- Cannot be undone
- Committed changes on git branches are preserved

**Error Handling:**

If deployment is not found:
```
✗ Deployment not found: codespace-invalid

List deployments with: sudocode remote codespaces list
```

#### Configuration Management

Manage deployment configuration for a provider.

```bash
sudocode remote <provider> config [options]
```

**Options:**
- `--port <number>` - Set server port (1024-65535)
- `--idle-timeout <minutes>` - Set idle timeout in minutes (min: 1)
- `--keep-alive <hours>` - Set keep-alive duration in hours (min: 1)
- `--retention <days>` - Set retention period in days (min: 1)
- `--machine <type>` - Set machine type/size
- `--reset` - Reset to default configuration (cannot be combined with other options)

**Examples:**

```bash
# View current configuration
sudocode remote codespaces config

# Update individual values
sudocode remote codespaces config --port 8080
sudocode remote codespaces config --idle-timeout 60
sudocode remote codespaces config --keep-alive 24

# Update multiple values at once
sudocode remote codespaces config \
  --port 8080 \
  --idle-timeout 60 \
  --keep-alive 24 \
  --machine "premiumLinux"

# Reset to defaults
sudocode remote codespaces config --reset

# JSON output
sudocode remote codespaces config --json
```

**View Configuration Output:**
```json
{
  "provider": "codespaces",
  "port": 3000,
  "idleTimeout": 4320,
  "keepAliveHours": 72,
  "machine": "basicLinux32gb",
  "retentionPeriod": 14
}
```

**Update Output:**
```
✓ Spawn configuration updated for codespaces
  Port: 8080
  Idle timeout: 60 minutes
  Keep-alive: 24 hours
  Machine: premiumLinux

Updated: .sudocode/spawn-config.json
```

**Reset Output:**
```
✓ Spawn configuration reset to defaults for codespaces
{
  "provider": "codespaces",
  "port": 3000,
  "idleTimeout": 4320,
  "keepAliveHours": 72,
  "machine": "basicLinux32gb",
  "retentionPeriod": 14
}

Updated: .sudocode/spawn-config.json
```

**Configuration File Location:**
- File: `.sudocode/spawn-config.json`
- Git tracked (shared across team)
- Created automatically with defaults on first use

**Validation Rules:**
- Port: 1024-65535 (non-privileged ports only)
- Idle Timeout: Minimum 1 minute
- Keep-Alive: Minimum 1 hour
- Retention Period: Minimum 1 day
- Machine: Non-empty string

**Error Examples:**

Invalid port:
```
✗ Port must be between 1024 and 65535
```

Cannot combine --reset:
```
Error: Cannot combine --reset with other options
```

Unknown provider:
```
✗ Unknown provider 'azure'
Supported providers: codespaces, coder
```

### Common Workflows

#### Quick Task Deployment

For short-lived AI tasks (e.g., bug fixes, small features):

```bash
# Configure aggressive cleanup
sudocode remote codespaces config \
  --idle-timeout 30 \
  --keep-alive 2 \
  --retention 1

# Deploy and run task
sudocode remote codespaces spawn --branch feature/quick-fix

# List deployments
sudocode remote codespaces list

# Stop when done
sudocode remote codespaces stop <id> --force
```

#### Long-Running Project Deployment

For extended AI assistance sessions or demos:

```bash
# Configure longer retention
sudocode remote codespaces config \
  --idle-timeout 1440 \
  --keep-alive 168 \
  --retention 30 \
  --machine "premiumLinux"

# Deploy
sudocode remote codespaces spawn --branch main

# Check status
sudocode remote codespaces status <id>
```

#### Multi-Issue Parallel Execution

Deploy multiple branches simultaneously:

```bash
# Deploy multiple branches for different issues
sudocode remote codespaces spawn --branch feature/auth-system
sudocode remote codespaces spawn --branch feature/payment-flow
sudocode remote codespaces spawn --branch bugfix/memory-leak

# Monitor all deployments
sudocode remote codespaces list

# Check individual progress
sudocode remote codespaces status <id-1>
sudocode remote codespaces status <id-2>
sudocode remote codespaces status <id-3>

# Stop completed ones
sudocode remote codespaces stop <id-1> --force
```

#### Team Collaboration

Share deployment URLs with team members:

```bash
# Deploy with team-friendly configuration
sudocode remote codespaces config --machine "basicLinux32gb"

# Deploy
sudocode remote codespaces spawn

# Share URLs from output
# Team members can access:
# - Workspace URL for viewing code in browser
# - Sudocode URL for monitoring AI execution in UI
# - SSH command for terminal access
```

#### Configuration for Different Use Cases

Development environment (quick iterations):
```bash
sudocode remote codespaces config \
  --idle-timeout 30 \
  --keep-alive 4 \
  --retention 1
```

Production/long-running environment:
```bash
sudocode remote codespaces config \
  --idle-timeout 1440 \
  --keep-alive 168 \
  --retention 30 \
  --machine "premiumLinux"
```

Cost optimization (minimal resources):
```bash
sudocode remote codespaces config \
  --idle-timeout 15 \
  --keep-alive 1 \
  --retention 1 \
  --machine "basicLinux32gb"
```

### How It Works

#### Deployment Lifecycle

1. **Preparation**
   - Detect git repository and current branch
   - Load configuration from `.sudocode/deploy-config.json`
   - Validate prerequisites (gh CLI, git remote, auth)
   - Apply command-line option overrides

2. **Provisioning**
   - Create GitHub Codespace via `gh codespace create`
   - Apply machine type, timeout, and retention settings
   - Wait for Codespace to become available

3. **Initialization**
   - Clone repository and checkout specified branch
   - Install dependencies (`npm install`)
   - Build sudocode packages
   - Transfer user credentials securely

4. **Server Startup**
   - Start sudocode server on configured port
   - Configure AI services from transferred credentials
   - Expose ports for web access
   - Register URLs

5. **Ready**
   - Print access URLs
   - Codespace is ready for AI execution
   - Server accepts API requests
   - Frontend UI is accessible

#### Credential Transfer

User credentials (configured via `sudocode auth`) are securely transferred:

1. Credentials read from `~/.config/sudocode/user_credentials.json` on local machine
2. Transferred to Codespace using secure GitHub APIs
3. Written to `~/.config/sudocode/user_credentials.json` in Codespace
4. File permissions set to 600 (owner read/write only)
5. Used by sudocode server for AI service authentication

**Security Notes:**
- Credentials are never committed to git
- Transfer uses GitHub's secure Codespace APIs
- File permissions prevent unauthorized access
- Credentials are isolated per Codespace

#### Auto-Cleanup

Codespaces are automatically cleaned up based on configuration:

- **Idle Timeout**: Codespace stops after configured idle period (default: 72 hours)
- **Retention Period**: Stopped Codespace is deleted after retention period (default: 14 days)
- **Keep-Alive**: Active connections reset idle timer

Manual cleanup:
```bash
sudocode deploy stop <id>
```

### Usage Examples

#### Example 1: Deploy Current Branch

```bash
# Working on feature branch
git checkout feature/user-auth
git add .
git commit -m "WIP: implementing OAuth"
git push origin feature/user-auth

# Deploy this branch
sudocode remote codespaces spawn
```

**Output:**
```
✓ Detected repository: myorg/myproject
✓ Detected branch: feature/user-auth
✓ Creating Codespace...
✓ Codespace created: codespace-xyz123
✓ Installing dependencies...
✓ Starting server...
✓ Deployment complete

URLs:
  Workspace: https://myorg-myproject-xyz123.github.dev
  Sudocode:  https://myorg-myproject-xyz123-3000.app.github.dev
  SSH:       gh cs ssh -c codespace-xyz123
```

#### Example 2: Deploy Different Branch

```bash
# From any branch, deploy main
sudocode remote codespaces spawn --branch main
```

#### Example 3: Custom Configuration

```bash
# Deploy with custom settings for intensive task
sudocode remote codespaces spawn \
  --branch feature/refactor-db \
  --machine "premiumLinux" \
  --keep-alive 48 \
  --idle-timeout 480
```

#### Example 4: Monitor Multiple Deployments

```bash
# Deploy multiple branches
sudocode remote codespaces spawn --branch feature/api-v2
sudocode remote codespaces spawn --branch bugfix/cors-issue
sudocode remote codespaces spawn --branch feature/new-ui

# List all
sudocode remote codespaces list

# Check each status
sudocode remote codespaces status <id-1>
sudocode remote codespaces status <id-2>
sudocode remote codespaces status <id-3>

# Stop completed ones
sudocode remote codespaces stop <id-1> --force
```

#### Example 5: JSON Automation

```bash
# Deploy and capture ID
DEPLOY_ID=$(sudocode remote codespaces spawn --json | jq -r '.id')

# Monitor status
while true; do
  STATUS=$(sudocode remote codespaces status $DEPLOY_ID --json | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "running" ]; then
    break
  fi
  sleep 5
done

# Get Sudocode URL
SUDOCODE_URL=$(sudocode remote codespaces status $DEPLOY_ID --json | jq -r '.urls.sudocode')
echo "Sudocode UI: $SUDOCODE_URL"
```

#### Example 6: Full Lifecycle

```bash
# 1. Configure for your needs
sudocode remote codespaces config \
  --port 8080 \
  --machine "standardLinux32gb" \
  --idle-timeout 120 \
  --keep-alive 24

# 2. Deploy
sudocode remote codespaces spawn --branch feature/new-feature

# 3. Monitor
sudocode remote codespaces list
sudocode remote codespaces status <id>

# 4. Access via SSH to check logs
gh cs ssh -c <codespace-name>
tail -f ~/.sudocode/server.log

# 5. Clean up when done
sudocode remote codespaces stop <id> --force
```

### Troubleshooting

#### GitHub CLI Not Found

**Error:**
```
Error: gh CLI not found. Please install GitHub CLI first.
```

**Solution:**
```bash
# macOS
brew install gh

# Windows  
winget install GitHub.cli

# Linux
sudo apt install gh

# Verify installation
gh --version
```

#### Not Authenticated with GitHub

**Error:**
```
Error: Not authenticated with GitHub
```

**Solution:**
```bash
# Login to GitHub
gh auth login

# Select GitHub.com
# Choose HTTPS or SSH
# Authenticate in browser
```

#### No Git Repository

**Error:**
```
Error: Not a git repository
```

**Solution:**
```bash
# Initialize git repository
git init

# Add remote
git remote add origin https://github.com/myorg/myproject.git

# Commit and push
git add .
git commit -m "Initial commit"
git push -u origin main
```

#### Uncommitted Changes

**Error:**
```
Error: Repository has uncommitted changes
```

**Solution:**
```bash
# Option 1: Commit changes
git add .
git commit -m "Work in progress"
git push

# Option 2: Stash changes
git stash
sudocode remote codespaces spawn
git stash pop

# Option 3: Deploy different branch
sudocode remote codespaces spawn --branch main
```

#### No Authentication Configured

**Error:**
```
Error: No AI credentials configured
```

**Solution:**
```bash
# Configure Claude
sudocode auth claude

# Verify
sudocode auth status

# Should show "Claude Code: ✓ Configured"
```

#### Port Already in Use

**Error:**
```
Error: Port 3000 is already in use
```

**Solution:**
```bash
# Use different port
sudocode remote codespaces spawn --port 8080

# Or update config
sudocode remote codespaces config --port 8080
sudocode remote codespaces spawn
```

#### Deployment Not Found

**Error:**
```
✗ Deployment not found: codespace-abc123
```

**Solution:**
```bash
# List all deployments
sudocode remote codespaces list

# Use correct ID from list
sudocode remote codespaces status <correct-id>
```

#### Codespace Creation Failed

**Error:**
```
Error: Failed to create Codespace
```

**Common Causes:**
- GitHub API rate limit exceeded
- Repository not accessible
- Insufficient permissions
- GitHub Codespaces not enabled for repository

**Solution:**
```bash
# Check GitHub authentication
gh auth status

# Verify repository access
gh repo view myorg/myproject

# Check Codespaces status
gh codespace list

# Try again with specific repo
sudocode remote codespaces spawn --repo myorg/myproject
```

#### Deployment Stuck in Starting

**Issue:**
Deployment shows "starting" status for extended period.

**Solution:**
```bash
# Check detailed status
sudocode remote codespaces status <id>

# If stuck > 5 minutes, stop and retry
sudocode remote codespaces stop <id> --force
sudocode remote codespaces spawn
```

#### Cannot Access Sudocode URL

**Issue:**
Sudocode URL returns connection error.

**Solutions:**
```bash
# 1. Check deployment status
sudocode remote codespaces status <id>
# Status should be "running"

# 2. Wait for port forwarding
# Codespace port forwarding can take 30-60 seconds

# 3. Try SSH access
gh cs ssh -c <codespace-name>
curl http://localhost:3000/health

# 4. Check logs in Codespace
gh cs ssh -c <codespace-name>
cd /workspaces/myproject
cat ~/.sudocode/server.log
```

#### Deployment Stops Unexpectedly

**Issue:**
Deployment status changes to "stopped" without manual intervention.

**Causes:**
- Idle timeout reached (no activity for configured period)
- GitHub Codespaces automatic cleanup
- Insufficient credits/quota

**Solution:**
```bash
# Check configuration
sudocode remote codespaces config

# Increase timeouts for longer tasks
sudocode remote codespaces config \
  --idle-timeout 1440 \
  --keep-alive 168

# Redeploy
sudocode remote codespaces spawn --branch <branch>
```

### Machine Types

GitHub Codespaces offers different machine types with varying resources:

| Machine Type | vCPUs | RAM | Storage | Use Case |
|-------------|-------|-----|---------|----------|
| `basicLinux32gb` | 2 | 8 GB | 32 GB | Small projects, quick tasks |
| `standardLinux32gb` | 4 | 16 GB | 32 GB | Medium projects |
| `premiumLinux` | 8 | 32 GB | 64 GB | Large projects, intensive tasks |

**Cost Considerations:**
- Larger machines consume GitHub Codespaces quota faster
- Free tier provides limited monthly minutes
- Paid plans offer more quota

**Selecting Machine:**
```bash
# Configure default machine
sudocode remote codespaces config --machine "standardLinux32gb"

# Override for specific deployment
sudocode remote codespaces spawn --machine "premiumLinux"
```

### Best Practices

1. **Commit Before Deploy**
   - Always commit and push changes before deploying
   - Deployments clone from git, not local working directory

2. **Use Configuration Defaults**
   - Set project defaults in `.sudocode/spawn-config.json`
   - Commit configuration to share with team
   - Override per-deployment as needed

3. **Monitor Active Deployments**
   - Regularly check `sudocode remote codespaces list`
   - Stop unused deployments to save quota
   - Use `--force` flag for batch cleanup

4. **Right-Size Resources**
   - Start with `basicLinux32gb` for most tasks
   - Upgrade to larger machines only when needed
   - Use shorter timeouts for quick tasks

5. **Secure Credentials**
   - Never commit credentials to git
   - Credentials are automatically secured in Codespaces
   - Use `sudocode auth clear` if credentials are compromised

6. **Branch Strategy**
   - Deploy feature branches for isolated work
   - Keep deployments aligned with git workflow
   - Use configuration to set consistent defaults

7. **Team Sharing**
   - Share Sudocode URLs with team members for review
   - Use descriptive branch names for clarity
   - Document deployment purpose in commit messages

8. **Cleanup Routine**
   - Stop deployments when work is complete
   - Don't rely solely on auto-cleanup
   - Check monthly to avoid quota surprises

9. **Provider-Specific Commands**
   - Always specify provider in commands: `sudocode remote <provider> <command>`
   - Currently only `codespaces` is fully supported
   - `coder` support coming soon

### Error Messages

All deploy commands provide consistent, actionable error messages with clear guidance on how to resolve issues.

#### Error Message Format

All errors follow this consistent format:

```
✗ Error Title

  Detailed explanation of what went wrong
  
  Suggested action:
    command to run or steps to take
```

#### Example Error Messages

**Authentication Error:**
```
✗ GitHub CLI is not authenticated

  Sudocode needs GitHub CLI to deploy to Codespaces.
  
  To authenticate:
    gh auth login
```

**Git Repository Not Found:**
```
✗ Git repository not found

  This command must be run from within a git repository.
  
  To initialize a repository:
    git init
```

**Port Conflict:**
```
✗ Port 3000 is already in use

  The requested port is not available on your system.
  
  To use a different port:
    sudocode deploy --port 3001
```

**Deployment Not Found:**
```
✗ Deployment 'codespace-xyz' not found

  The specified deployment does not exist or has been deleted.
  
  To list all deployments:
    sudocode remote codespaces list
```

**Network Connection Failed:**
```
✗ Network connection failed

  Unable to list deployments due to network issues.
  
  Suggested actions:
    • Check your internet connection
    • Verify VPN or proxy settings
    • Try again in a few moments
```

**Invalid Configuration:**
```
✗ Invalid configuration: port

  Port must be between 1024 and 65535
  
  To view current configuration:
    sudocode remote codespaces config
```

#### Error Types

The deploy system uses typed errors for consistent handling:

- **AuthenticationError** - Missing or invalid credentials (GitHub, Claude)
- **GitContextError** - Git repository issues (not a repo, no remote, invalid branch)
- **ConfigurationError** - Invalid configuration values
- **ProviderError** - Deployment provider failures (Codespaces API errors)
- **NetworkError** - Network connectivity issues
- **PortConflictError** - Port already in use
- **DeploymentNotFoundError** - Deployment ID not found

Each error type provides context-specific guidance for resolution.

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