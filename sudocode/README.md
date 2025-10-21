# sudocode

Git-native spec and issue management for AI-assisted software development.

This is a meta-package that includes:

- **@sudocode/cli** - Command-line interface for managing specs and issues
- **@sudocode/types** - TypeScript type definitions
- **@sudocode/mcp** - Model Context Protocol server

## Installation

```bash
npm install sudocode
```

## Usage

After installation, use the `sudocode` command:

```bash
sudocode init
sudocode issue create "My first issue"
sudocode spec create "My first spec"
```

## Packages

- [@sudocode/cli](../cli) - Main CLI tool
- [@sudocode/types](../types) - Shared TypeScript types
- [@sudocode/mcp](../mcp) - MCP server for AI assistants

## License

MIT
