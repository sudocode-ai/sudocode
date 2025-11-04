# sudocode

Git-native spec and issue management for AI-assisted software development.

## Overview

Sudocode is a git-native workflow tool designed for AI-assisted development. It stores specs and issues as JSONL files alongside your code, enabling version control, branching, and merging of your project management data just like code.

**Key Features:**
- **Git-native** - All data stored in `.sudocode/` as JSONL, versioned with your code
- **Anchored feedback** - Link issues to specific lines in specs with smart relocation
- **Relationship tracking** - Model dependencies, blockers, and implementations
- **MCP integration** - Works seamlessly with Claude and other AI assistants
- **Fast local cache** - SQLite for instant queries without parsing JSONL
- **Bidirectional sync** - Export to markdown, edit, import back

## What's Included

This meta-package bundles all sudocode components:

- **@sudocode-ai/cli** - Command-line interface (`sudocode` command)
- **@sudocode-ai/mcp** - Model Context Protocol server for AI assistants
- **@sudocode-ai/types** - TypeScript type definitions

## Installation

```bash
npm install -g sudocode
```

After installation, both `sudocode` (also aliased as `sdc`) commands will be available.

## Quick Start

```bash
# Initialize in your project
sudocode init

# Create your first spec
sudocode spec create "User authentication system" -p 4

# Create an issue
sudocode issue create "Implement OAuth login" -p 3 -a alice

# Link the issue to the spec
sudocode link ISSUE-1 SPEC-1 --type implements

# Show what's ready to work on
sudocode ready

# Update issue status
sudocode issue update ISSUE-1 --status in_progress

# View project status
sudocode status
```

## Core Commands

```bash
# Initialization
sudocode init                                    # Set up .sudocode/ directory

# Specs (specifications/requirements)
sudocode spec create <title> [options]           # Create a spec
sudocode spec list                               # List all specs
sudocode spec show <id>                          # Show spec details

# Issues (tasks/bugs)
sudocode issue create <title> [options]          # Create an issue
sudocode issue list [options]                    # List issues
sudocode issue update <id> [options]             # Update issue
sudocode issue close <id>                        # Close issue

# Relationships
sudocode link <from> <to> --type <type>          # Link entities
sudocode ready                                   # Show unblocked work
sudocode blocked                                 # Show blocked issues

# Feedback (link issues to spec lines)
sudocode feedback add <issue> <spec> [options]   # Add anchored feedback
sudocode feedback list                           # List feedback

# Status
sudocode status                                  # Quick status
sudocode stats                                   # Detailed statistics

# Sync
sudocode sync                                    # Sync JSONL with database
sudocode sync --watch                            # Auto-sync on changes
```

For full command documentation, see [@sudocode-ai/cli](https://github.com/sudocode-ai/sudocode/tree/main/cli).

## MCP Integration

Sudocode includes an MCP server for seamless AI assistant integration. To use with Claude Code, you can either:

1. Add sudocode as a plugin:

```bash
# In Claude Code
/plugin marketplace add sudocode-ai/sudocode
/plugin install sudocode
```

2. Configure Claude Code MCP server:

```json
{
  "mcpServers": {
    "sudocode": {
      "command": "sudocode-mcp"
    }
  }
}
```

Restart Claude Code to apply changes.

For full MCP documentation, see [@sudocode-ai/mcp](https://github.com/sudocode-ai/sudocode/tree/main/mcp).

## Example Workflow

### Creating a Feature

```bash
# Create a spec for the feature
sudocode spec create "OAuth2 Authentication" -p 4 --tags auth,security

# Create implementation issues
sudocode issue create "Set up OAuth provider configuration" -p 3 -a alice
sudocode issue create "Implement login endpoint" -p 3 -a bob
sudocode issue create "Add token refresh logic" -p 2 -a alice

# Link issues to spec
sudocode link ISSUE-1 SPEC-1 --type implements
sudocode link ISSUE-2 SPEC-1 --type implements
sudocode link ISSUE-3 SPEC-1 --type implements

# Model dependencies
sudocode link ISSUE-2 ISSUE-1 --type depends-on

# Check what's ready
sudocode ready
# Shows: ISSUE-1 (no dependencies)

# Start work
sudocode issue update ISSUE-1 --status in_progress
```

### Adding Feedback to Specs

```bash
# Add feedback at a specific line
sudocode feedback add ISSUE-4 SPEC-1 \
  --line 42 \
  --content "Should we support 2FA?" \
  --type suggestion

# Or search for text
sudocode feedback add ISSUE-5 SPEC-1 \
  --text "password requirements" \
  --content "Consider adding passwordless options" \
  --type comment

# View feedback
sudocode feedback list --spec SPEC-1
```

## File Structure

After `sudocode init`, your project will have:

```
.sudocode/
├── meta.json         # Config & ID counters (git tracked)
├── specs.jsonl       # All specs (git tracked)
├── issues.jsonl      # All issues (git tracked)
├── cache.db          # SQLite cache (gitignored)
├── specs/            # Generated markdown that you can edit (gitignored)
├── issues/           # Generated markdown that you can edit (gitignored)
└── .gitignore        # Ignores cache and generated files
```

The JSONL files are designed to be merged in git like code - each line is a complete entity.

## Why Git-Native?

**Traditional approach:** Project management data lives in external tools (Jira, Linear, etc.), disconnected from your code.

**Sudocode approach:** Project management data lives alongside your code in git, enabling:
- **Branch specs/issues** with your code branches
- **Merge specs/issues** when merging branches
- **Revert specs/issues** along with code changes
- **Review specs/issues** in pull requests
- **Version specs/issues** with release tags
- **AI assistants** can read and modify directly

## Use Cases

- **AI-assisted development** - Let AI agents manage issues and provide spec feedback
- **Spec-driven development** - Write specs, generate issues, track implementation
- **Context management** - Store project context that moves with your code
- **Local-first workflow** - No external services required, works offline
- **Team coordination** - Share specs/issues through git, merge like code

## Documentation

- **CLI Reference:** [@sudocode-ai/cli](https://github.com/sudocode-ai/sudocode/tree/main/cli)
- **MCP Server:** [@sudocode-ai/mcp](https://github.com/sudocode-ai/sudocode/tree/main/mcp)
- **Type Definitions:** [@sudocode-ai/types](https://github.com/sudocode-ai/sudocode/tree/main/types)

## Individual Package Installation

You can also install packages individually:

```bash
npm install -g @sudocode-ai/cli             # CLI only
npm install -g @sudocode-ai/mcp             # MCP server only
npm install -g @sudocode-ai/local-server    # Under construction!
npm install @sudocode-ai/types              # Types only (for development)
```
