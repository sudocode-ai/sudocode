# Contributing to sudocode

## Prerequisites

- Node.js >= 18.0.0
- npm >= 7.0.0
- Git

## Setup

```bash
# Clone the repository
git clone https://github.com/sudocode-ai/sudocode.git
cd sudocode

# Install dependencies for all workspace packages
npm install

# Build all packages (types → cli → mcp → frontend → server)
npm run build
```

### Optional: Link for Global Testing

If you want to test the CLI/server/MCP globally on other projects:

```bash
# Link packages (makes sudocode, sudocode-server, sudocode-mcp available globally)
npm run link

# Unlink when done
npm run unlink
```

Now you can use `sudocode` commands anywhere, pointing to your local development build.

### Server (with hot reload)
```bash
npm run dev:server
# Server runs at http://localhost:3000 with auto-reload on changes
```

## Testing

```bash
# Run all tests
npm test

# Test specific package
npm --prefix cli test -- --run
npm --prefix server test -- --run
npm --prefix frontend test -- --run

# Test specific file
npm --prefix server test -- --run tests/unit/services/editor-service.test.ts

# Test with pattern matching
npm --prefix frontend test -- --run -t "auto-save"

# Watch mode for active development
npm --prefix frontend test
npm --prefix cli test
```

## Troubleshooting

If you encounter dependency conflicts or build issues:

```bash
npm unlink

npm run clean

npm run build

npm link
```

## Questions?

- [GitHub Issues](https://github.com/sudocode-ai/sudocode/issues)
- [Discord](https://discord.gg/5t8GUW65EW)
- [Docs](https://docs.sudocode.ai)

## License

Contributions licensed under Apache 2.0.
