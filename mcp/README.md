# Sudocode MCP

Model Context Protocol (MCP) server for [sudocode](https://github.com/sudocode-ai/sudocode) - A git-native spec and issue management system designed for AI-assisted development.

## Features

- **22 MCP Tools** for complete issue and spec management
- **Git-native workflow** - All data stored in git
- **Anchored feedback** - Link issues to specific lines in specs with smart relocation
- **Relationship tracking** - Model dependencies and blockers
- **CLI-first design** - Wraps existing `sudocode` CLI commands

## Installation

```bash
npm install -g sudocode-mcp
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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
        "SUDOCODE_DB": "/path/to/custom/db.sqlite"
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

### Issue Management (7 tools)

- `ready` - Find issues and specs with no blockers
- `list_issues` - List issues with filters (status, type, priority, assignee)
- `show_issue` - Show detailed issue information
- `create_issue` - Create new issue
- `update_issue` - Update issue (status, priority, assignee, etc.)
- `close_issue` - Close one or more issues
- `blocked_issues` - Get issues that are blocked

### Spec Management (3 tools)

- `list_specs` - List specs with filters (status, type, priority)
- `show_spec` - Show detailed spec information with feedback
- `create_spec` - Create new specification

### Relationships (1 tool)

- `link` - Create relationships between entities (blocks, implements, references, depends-on, parent-child, discovered-from, related)

### Feedback System (8 tools)

- `add_feedback` - Add anchored feedback to specs
- `list_feedback` - List feedback with filters
- `show_feedback` - Show feedback details
- `acknowledge_feedback` - Acknowledge feedback
- `resolve_feedback` - Mark feedback as resolved
- `wontfix_feedback` - Mark feedback as won't fix
- `stale_feedback` - Find feedback with stale anchors
- `relocate_feedback` - Manually relocate feedback anchors

### Analytics (2 tools)

- `stats` - Get comprehensive project statistics
- `status` - Get quick project status

### Initialization (1 tool)

- `init` - Initialize sudocode in current directory

## Resources

The server provides two resources for AI agents:

- `sudocode://quickstart` - Introduction to sudocode concepts and workflow
- `sudocode://workflow` - Step-by-step workflow patterns

## Prerequisites

You must have the sudocode CLI (aliased `sudocode` or `sdc`) installed and available in your PATH.

Install sudocode:

```bash
# Installation instructions for sudocode CLI
# (Add link to main sudocode installation docs)
```

## Usage Example

Once configured in Claude Desktop, you can ask Claude to:

1. Find ready tasks: "Show me issues that are ready to work on"
2. Claim work: "Set issue sg-123 to in_progress status"
3. Review specs: "Show me the spec for issue sg-123"
4. Provide feedback: "Add feedback to spec sg-spec-5 about the authentication section"
5. Complete work: "Close issue sg-123"

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
│       ├── analytics.ts
│       └── init.ts
├── tests/
│   └── unit/               # Unit tests (56 tests)
└── dist/                   # Built output
```

## Troubleshooting

### CLI Not Found

If you get "CLI not found" errors:

1. Ensure `sudocode` is installed and in your PATH
2. Try setting `SUDOCODE_PATH` to the full path of the `sudocode` executable
3. Restart Claude Desktop after configuration changes

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
