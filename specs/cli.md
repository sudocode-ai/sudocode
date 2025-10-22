# CLI Design Specification

## Overview

The `sudocode` CLI tool provides commands for managing technical specifications, issues, and their relationships. It follows a git-like command structure with subcommands for different entity types and operations.

## Command Structure

```
sudocode <command> [subcommand] [options] [arguments]
```

## Core Commands

### Initialization

```bash
# Initialize sudocode in current directory
sudocode init [--prefix <prefix>]

# Creates:
# - .sudocode/ directory
# - .sudocode/db.sqlite
# - .sudocode/specs/ directory (for JSONL)
# - .sudocode/issues/ directory (for JSONL)
# - specs/ directory (for markdown files)
# - issues/ directory (for markdown files)
```

**Options:**
- `--prefix`: Custom prefix for IDs (default: repo name or "sudocode")

**Behavior:**
- Fails if .sudocode already exists
- Initializes SQLite database with schema
- Creates directory structure
- Adds .sudocode/db.sqlite to .gitignore

### Status

```bash
# Show status of specs and issues
sudocode status [--verbose]

# Output:
# Specs:
#   5 total (3 draft, 1 review, 1 approved)
#   2 ready to work on
#
# Issues:
#   10 total (6 open, 3 in_progress, 1 closed)
#   4 ready to work on
#   2 blocked
#
# Sync status:
#   All files in sync
```

**Options:**
- `--verbose`: Show detailed sync status for each file

## Spec Commands

### Create Spec

```bash
# Create new spec interactively
sudocode spec create

# Create with options
sudocode spec create --title "Authentication System" \
  --type architecture \
  --priority 1 \
  --tags auth,security

# Create from template
sudocode spec create --template feature
```

**Interactive prompts:**
1. Title (required)
2. Type (architecture/feature/process/decision/integration)
3. Priority (1-4, default: 2)
4. Status (default: draft)
5. Tags (comma-separated)
6. Open in editor? (y/n)

**Behavior:**
- Generates next ID: `spec-NNN`
- Creates markdown file: `specs/spec-NNN-title-slug.md`
- Adds entry to `.sudocode/specs/specs.jsonl`
- Inserts into SQLite
- Records creation event
- Opens in $EDITOR if requested

### List Specs

```bash
# List all specs
sudocode spec list

# Filter by status
sudocode spec list --status draft

# Filter by type
sudocode spec list --type architecture

# Filter by tag
sudocode spec list --tag security

# Show only ready specs
sudocode spec list --ready

# Limit results
sudocode spec list --limit 10
```

**Output format:**
```
spec-001  Authentication System         [architecture] draft      P1
spec-002  API Gateway Design           [architecture] review     P1
spec-003  Database Migration Process   [process]      approved   P2
```

### Show Spec

```bash
# Show detailed spec information
sudocode spec show <id>

# Example output:
# spec-001: Authentication System
# Status: draft
# Type: architecture
# Priority: 1
# Tags: auth, security
# Created: 2025-01-15
# Updated: 2025-01-16
#
# Dependencies:
#   → spec-002 (blocked by)
#   → spec-005 (related to)
#
# Linked Issues:
#   → issue-010 (implements)
#   → issue-012 (blocked by)
#
# Content preview:
#   # Authentication System
#   This spec defines...
#   [truncated]
#
# Open full content? (y/n)
```

**Options:**
- `--json`: Output as JSON
- `--content`: Show full content
- `--graph`: Show ASCII graph of relationships

### Update Spec

```bash
# Update spec fields
sudocode spec update <id> --status review
sudocode spec update <id> --priority 1
sudocode spec update <id> --add-tag security
sudocode spec update <id> --remove-tag draft

# Update interactively
sudocode spec update <id>
```

**Behavior:**
- Updates markdown frontmatter
- Syncs to JSONL
- Updates SQLite
- Records update event

### Delete Spec

```bash
# Delete spec (soft delete by default)
sudocode spec delete <id>

# Hard delete (removes files)
sudocode spec delete <id> --hard

# Confirmation prompt unless --force
```

### Add Relationship

```bash
# Add relationship between specs
sudocode spec link <from-id> <to-id> [--type <type>]

# Types: blocks, depends-on, related, parent-child
# Examples:
sudocode spec link spec-001 spec-002 --type blocks
sudocode spec link spec-003 spec-001 --type depends-on
sudocode spec link spec-001 issue-010 --type implements
```

**Behavior:**
- Validates both entities exist
- Prevents duplicate relationships
- Updates relationships table
- Records event

### Remove Relationship

```bash
sudocode spec unlink <from-id> <to-id>
```

## Issue Commands

Similar structure to spec commands:

```bash
# Create
sudocode issue create [--title] [--type] [--priority] [--assignee]

# List
sudocode issue list [--status] [--type] [--assignee] [--ready] [--blocked]

# Show
sudocode issue show <id> [--json] [--content] [--graph]

# Update
sudocode issue update <id> [--status] [--priority] [--assignee]

# Close
sudocode issue close <id> [--reason]

# Link
sudocode issue link <from-id> <to-id> [--type]

# Unlink
sudocode issue unlink <from-id> <to-id>
```

**Issue types:** bug, feature, task, epic, chore

**Issue statuses:** open, in_progress, blocked, needs_review, closed

## Query Commands

### Ready

```bash
# Show all ready-to-work entities
sudocode ready [--type spec|issue]

# Output:
# Ready Specs (no blocking dependencies):
#   spec-005  API Documentation       [process]    P2
#   spec-008  Logging Strategy        [decision]   P3
#
# Ready Issues (no blocking dependencies):
#   issue-010 Implement auth tokens   [feature]    P1
#   issue-015 Fix CORS headers        [bug]        P1
```

### Blocked

```bash
# Show blocked entities
sudocode blocked [--type spec|issue]

# Output:
# Blocked Specs:
#   spec-001  Authentication System   [architecture] P1
#     blocked by: spec-002 (API Gateway Design - in review)
#
#   spec-007  Payment Integration     [integration]  P2
#     blocked by: issue-020 (Setup Stripe account - in_progress)
```

### Stats

```bash
# Show project statistics
sudocode stats

# Output:
# Project Statistics
#
# Specs:
#   Total: 25
#   By Status: 10 draft, 8 review, 5 approved, 2 deprecated
#   By Type: 8 architecture, 6 feature, 5 process, 4 decision, 2 integration
#   Ready: 5
#   Blocked: 3
#
# Issues:
#   Total: 48
#   By Status: 20 open, 15 in_progress, 2 blocked, 11 closed
#   By Type: 15 feature, 12 bug, 10 task, 8 chore, 3 epic
#   Ready: 12
#   Blocked: 2
#
# Relationships:
#   Total: 87
#   Blocks: 23, Depends-on: 31, Related: 20, Parent-child: 13
#
# Recent Activity (last 7 days):
#   15 specs updated
#   23 issues updated
#   8 new issues created
#   5 issues closed
```

### Graph

```bash
# Show relationship graph
sudocode graph [--from <id>] [--depth <n>] [--format ascii|dot|json]

# Examples:
# Show dependencies from a spec
sudocode graph --from spec-001

# Generate DOT format for Graphviz
sudocode graph --from spec-001 --format dot > graph.dot
dot -Tpng graph.dot -o graph.png

# Show full project graph
sudocode graph --depth 10
```

**ASCII output example:**
```
spec-001 (Authentication System)
├─[blocks]─> spec-002 (API Gateway)
├─[related]─> spec-005 (Security Guidelines)
└─[implements]─> issue-010 (Auth tokens)
              └─[blocks]─> issue-012 (Token refresh)
```

## Sync Commands

```bash
# Sync all markdown files to JSONL and SQLite
sudocode sync [--dry-run] [--force]

# Sync specific file
sudocode sync specs/spec-001-auth.md

# Watch for changes and auto-sync
sudocode sync --watch

# Check sync status
sudocode sync --status
```

**Options:**
- `--dry-run`: Show what would be synced without making changes
- `--force`: Force sync even if no changes detected
- `--watch`: Start file watcher for continuous sync
- `--status`: Show which files are out of sync

## Search Commands

```bash
# Search across all content
sudocode search <query> [--type spec|issue] [--field title|content|all]

# Examples:
sudocode search "authentication"
sudocode search "auth" --type spec
sudocode search "bug" --field title
```

## Export Commands

```bash
# Export to various formats
sudocode export --format json > project.json
sudocode export --format csv --type spec > specs.csv
sudocode export --format markdown > summary.md

# Export graph
sudocode export --graph --format dot > graph.dot
```

## History Commands

```bash
# Show event history for an entity
sudocode history <id> [--limit 10] [--full]

# Show recent events across project
sudocode history --recent [--limit 20]

# Reconstruct full history from git (future)
sudocode history --rebuild [--from-git]
```

## Configuration

```bash
# Show current configuration
sudocode config list

# Set configuration
sudocode config set editor "code --wait"
sudocode config set author.name "Alex Ngai"
sudocode config set sync.auto true

# Get configuration value
sudocode config get editor
```

**Config file location:** `.sudocode/config.json`

## Workflow Examples

### Creating a new feature spec

```bash
# 1. Create the spec
sudocode spec create --title "WebSocket Support" --type feature --priority 1

# 2. Open in editor (opens automatically or run:)
vim specs/spec-012-websocket-support.md

# 3. Add relationships
sudocode spec link spec-012 spec-001 --type depends-on

# 4. Create implementation issues
sudocode issue create --title "Implement WebSocket server"
sudocode issue link issue-025 spec-012 --type implements

# 5. Check what's ready
sudocode ready
```

### Working on issues

```bash
# 1. Find ready issues
sudocode ready --type issue

# 2. Start work on an issue
sudocode issue update issue-010 --status in_progress

# 3. Complete the issue
sudocode issue close issue-010 --reason "Implemented and tested"

# 4. Check project status
sudocode stats
```

### Reviewing dependencies

```bash
# 1. Show blocked items
sudocode blocked

# 2. Show specific dependency graph
sudocode graph --from spec-001

# 3. Update spec status to unblock others
sudocode spec update spec-002 --status approved
```

## Implementation Notes

### Command-line Parser

Use `commander.js` or `yargs` for command parsing:

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('sudocode')
  .description('Technical specification and issue tracker')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize sudocode in current directory')
  .option('--prefix <prefix>', 'Custom prefix for IDs')
  .action(initCommand);

program
  .command('spec')
  .description('Manage specifications')
  .addCommand(makeSpecCommands());

// ... more commands
```

### Interactive Prompts

Use `inquirer` for interactive prompts:

```typescript
import inquirer from 'inquirer';

async function createSpecInteractive() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: 'Spec title:',
      validate: (input) => input.length > 0,
    },
    {
      type: 'list',
      name: 'type',
      message: 'Spec type:',
      choices: ['architecture', 'feature', 'process', 'decision', 'integration'],
    },
    {
      type: 'number',
      name: 'priority',
      message: 'Priority (1-4):',
      default: 2,
    },
    {
      type: 'confirm',
      name: 'openEditor',
      message: 'Open in editor?',
      default: true,
    },
  ]);

  return answers;
}
```

### Output Formatting

Use `chalk` for colored output and `cli-table3` for tables:

```typescript
import chalk from 'chalk';
import Table from 'cli-table3';

function displaySpecList(specs: Spec[]) {
  const table = new Table({
    head: ['ID', 'Title', 'Type', 'Status', 'Priority'],
    colWidths: [15, 40, 15, 12, 10],
  });

  for (const spec of specs) {
    table.push([
      chalk.cyan(spec.id),
      spec.title,
      chalk.gray(`[${spec.type}]`),
      getStatusColor(spec.status),
      `P${spec.priority}`,
    ]);
  }

  console.log(table.toString());
}

function getStatusColor(status: string): string {
  const colors = {
    draft: chalk.yellow,
    review: chalk.blue,
    approved: chalk.green,
    deprecated: chalk.red,
  };
  return colors[status](status);
}
```

### Editor Integration

```typescript
import { spawn } from 'child_process';
import { env } from 'process';

async function openInEditor(filePath: string): Promise<void> {
  const editor = env.EDITOR || env.VISUAL || 'vim';

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [filePath], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });
  });
}
```

## Error Handling

All commands should provide clear error messages:

```typescript
class SudocodeError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SudocodeError';
  }
}

// Usage:
if (!fs.existsSync('.sudocode')) {
  throw new SudocodeError(
    'Not a sudocode directory. Run "sudocode init" first.',
    'NOT_INITIALIZED'
  );
}

// In main:
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof SudocodeError) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
  throw error;
}
```

## Testing Strategy

1. **Unit tests:** Test individual command handlers
2. **Integration tests:** Test full command workflows with temporary directories
3. **Snapshot tests:** Test output formatting

```typescript
describe('spec create command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    process.chdir(tmpDir);
    execSync('sudocode init');
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it('should create a new spec', async () => {
    const result = await execCommand(
      'sudocode spec create --title "Test Spec" --type feature'
    );

    expect(result.stdout).toContain('Created spec-001');
    expect(fs.existsSync('specs/spec-001-test-spec.md')).toBe(true);
  });
});
```
