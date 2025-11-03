# Sudocode MCP

Model Context Protocol (MCP) server for [sudocode](https://github.com/sudocode-ai/sudocode) - A git-native spec and issue management system designed for AI-assisted development.

## Features

- **MCP Tools** for complete issue and spec management
- **Git-native workflow** - All data stored in git
- **Anchored feedback** - Link issues to specific lines in specs with smart relocation
- **Relationship tracking** - Model dependencies and blockers
- **CLI-first design** - Wraps existing `sudocode` CLI commands

## Installation

```bash
npm install -g sudocode-mcp
```

## Configuration

**IMPORTANT**: Before using this MCP server, sudocode MUST be initialized in your project directory (`sudocode init`)

### First-time setup:
1. Navigate to your project root directory
2. Run: \`sudocode init\`
3. This creates the \`.sudocode/\` directory with necessary database files
4. Verify setup: Check that \`.sudocode/cache.db\` exists

**Without initialization, all MCP tools will fail with errors.**

If you see errors about missing database or .sudocode directory, run \`sudocode init\` first.

### Claude Code

Add to your Claude Code configuration:

```json
{
  "mcpServers": {
    "sudocode": {
      "command": "sudocode-mcp"
    }
  }
}
```

### Custom Configuration

```json
{
  "mcpServers": {
    "sudocode": {
      "command": "sudocode-mcp",
      "env": {
        "SUDOCODE_WORKING_DIR": "/path/to/your/project",
        "SUDOCODE_PATH": "sudocode",
      }
    }
  }
}
```

## Environment Variables

- `SUDOCODE_PATH` - Path to `sudocode` CLI executable (default: `sudocode`)
- `SUDOCODE_WORKING_DIR` - Working directory for sudocode (default: current directory)
- `SUDOCODE_DB` - Custom database path (default: `.sudocode/db.sqlite`)
- `SUDOCODE_ACTOR` - Actor name for operations (default: system username)

## Available Tools

### Issue Management

- `ready` - Find issues and specs with no blockers
- `list_issues` - List issues with filters (status, type, priority, assignee)
- `show_issue` - Show detailed issue information
- `upsert_issue` - Create/update issue

### Spec Management

- `list_specs` - List specs with filters (status, type, priority)
- `show_spec` - Show detailed spec information with feedback
- `upsert_spec` - Create/update a specification

### Relationships

- `link` - Create relationships between entities (blocks, implements, references, depends-on, parent-child, discovered-from, related)

### Cross-References

- `add_reference` - Add inline cross-reference to spec or issue using Obsidian-style `[[ID]]` syntax. Insert references at specific locations (line or text-based) with optional display text and relationship types.

### Feedback System

- `upsert_feedback` - Create/update anchored feedback to specs

## Prerequisites

You must have the sudocode CLI (aliased `sudocode` or `sdc`) installed and available in your PATH.

Install sudocode:

```bash
# Installation instructions for sudocode CLI
# (Add link to main sudocode installation docs)
```

## Usage Example

Once configured in Claude Code, you can ask Claude to:

1. Find ready tasks: "Show me issues that are ready to work on"
2. Claim work: "Set issue ISSUE-123 to in_progress status"
3. Review specs: "Show me the spec for issue ISSUE-123"
4. Add cross-references: "Add a reference to ISSUE-042 in the requirements section of SPEC-010"
5. Provide feedback: "Add feedback to spec SPEC-005 about the authentication section"
6. Complete work: "Close issue ISSUE-123"

## Development

### Building from Source

```bash
git clone https://github.com/sudocode-ai/sudocode.git
cd sudocode/mcp
npm install
npm run build
```

### Running Tests

```bash
npm test              # Run all tests in watch mode
npm test -- --run     # Run once
npm run test:unit     # Unit tests only
```

### Project Structure

```
mcp/
├── src/
│   ├── client.ts           # CLI wrapper
│   ├── server.ts           # MCP server
│   ├── types.ts            # Type definitions
│   └── tools/              # Tool implementations
│       ├── issues.ts
│       ├── specs.ts
│       ├── feedback.ts
│       ├── relationships.ts
│       ├── references.ts
│       ├── analytics.ts
│       └── init.ts
├── tests/
│   └── unit/               # Unit tests
└── dist/                   # Built output
```

## Troubleshooting

### CLI Not Found

If you get "CLI not found" errors:

1. Ensure `sudocode` is installed and in your PATH
2. Try setting `SUDOCODE_PATH` to the full path of the `sudocode` executable
3. Restart Claude Code after configuration changes

### Database Not Found

If you get database errors:

1. Run `sudocode init` in your project directory first
2. Ensure the working directory is set correctly
3. Check that `.sudocode/db.sqlite` exists

### Permission Errors

Ensure you have read/write access to:

- The project directory
- The `.sudocode` directory
- The database file

## Contributing

Contributions are welcome! Please see the main [sudocode repository](https://github.com/sudocode-ai/sudocode) for contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [sudocode Main Repository](https://github.com/sudocode-ai/sudocode)
- [Issue Tracker](https://github.com/sudocode-ai/sudocode/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
