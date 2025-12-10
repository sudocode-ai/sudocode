# Contributing to sudocode

Thank you for your interest in contributing to sudocode! This document provides guidelines and instructions for setting up your development environment and contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Local Development Setup](#local-development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and professional in all interactions.

## Getting Started

sudocode is a monorepo using npm workspaces. The project consists of several packages:

- **cli** - Command-line interface
- **server** - Local backend server with REST API and WebSocket support
- **frontend** - Web UI for visualizing and managing specs/issues
- **mcp** - Model Context Protocol server
- **types** - Shared TypeScript types
- **sudocode** - Meta-package that bundles all components

## Local Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm >= 7.0.0 (for workspace support)
- Git

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sudocode-ai/sudocode.git
   cd sudocode
   ```

2. **Uninstall any globally installed sudocode:**
   ```bash
   npm uninstall -g sudocode
   ```

   This prevents conflicts between the published package and your local development version.

3. **Clean and install dependencies:**
   ```bash
   # Install all workspace dependencies from the root
   npm install
   ```

4. **Build all packages:**
   ```bash
   npm run build
   ```

   This builds packages in the correct order (types → cli → mcp → frontend → server).

5. **Link packages for local development:**
   ```bash
   # Link CLI (provides `sudocode` and `sdc` commands)
   cd cli && npm link

   # Link server (provides `sudocode-server` command)
   cd ../server && npm link

   # Optionally link MCP server (provides `sudocode-mcp` command)
   cd ../mcp && npm link
   ```

6. **Verify installation:**
   ```bash
   sudocode --version        # Should show 0.1.10
   which sudocode-server     # Should show path to your linked binary
   ```

7. **Test the server:**
   ```bash
   # Navigate to a test directory
   mkdir ~/test-sudocode && cd ~/test-sudocode

   # Initialize sudocode
   sudocode init

   # Start the server
   sudocode server
   ```

   The server should start and be accessible at http://localhost:3000

### Why Link Individual Packages?

The `sudocode` meta-package is designed for npm distribution, where it bundles all individual packages. For local development:

- **Don't use the meta-package**: It expects dependencies in `node_modules/@sudocode-ai/*`, which doesn't work in a workspace setup
- **Link individual packages**: This makes the binaries (`sudocode`, `sudocode-server`, etc.) available globally and points them to your local builds

## Project Structure

```
sudocode/
├── cli/                  # Command-line interface
│   ├── src/
│   │   ├── cli/         # Command handlers
│   │   ├── db.ts        # SQLite database initialization
│   │   └── cli.ts       # Main CLI entry point
│   └── tests/
├── server/              # Local backend server
│   ├── src/
│   │   ├── services/    # Business logic
│   │   ├── routes/      # Express routes
│   │   └── index.ts     # Server entry point
│   └── tests/
├── frontend/            # Web UI (React + TypeScript)
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── contexts/    # React contexts
│   │   └── pages/       # Page components
│   └── tests/
├── mcp/                 # Model Context Protocol server
│   ├── src/
│   └── tests/
├── types/               # Shared TypeScript types
│   └── src/
├── sudocode/            # Meta-package (npm distribution only)
├── scripts/             # Build and release scripts
└── .sudocode/          # Example sudocode project data
```

## Development Workflow

### Working on a Package

Each package can be developed independently:

```bash
# Work on CLI
cd cli
npm run build       # Build TypeScript
npm test            # Run tests

# Work on server
cd server
npm run dev         # Start dev server with hot reload
npm test            # Run tests

# Work on frontend
cd frontend
npm run dev         # Start Vite dev server
npm test            # Run tests
```

### Building All Packages

From the root directory:

```bash
npm run build              # Build all packages
npm run build:cli          # Build only CLI
npm run build:server       # Build only server
npm run build:frontend     # Build only frontend
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests for specific package
npm test --workspace=cli
npm test --workspace=server
npm test --workspace=frontend

# Run specific test file
npm --prefix frontend test -- --run tests/components/issues/IssuePanel.test.tsx

# Run tests matching a pattern
npm --prefix frontend test -- --run -t "auto-save"
```

### Cleaning Build Artifacts

```bash
# Clean all packages
npm run clean

# Manual cleanup
find . -name "node_modules" -type d -prune -exec rm -rf {} +
find . -name "dist" -type d -prune -exec rm -rf {} +
```

## Testing

This project uses **Vitest** as the testing framework for all packages.

### Test Organization

- Tests are located in `tests/` directories within each package
- Test files follow naming conventions:
  - `*.test.ts` for unit tests (CLI, MCP, utilities)
  - `*.test.tsx` for component tests (frontend React components)

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('MyFunction', () => {
  it('should do something', () => {
    expect(myFunction()).toBe(expectedValue);
  });
});
```

### Running Tests in Watch Mode

```bash
# Frontend (watch mode for development)
npm --prefix frontend test

# CLI (watch mode)
npm --prefix cli test
```

## Submitting Changes

### Before Submitting

1. **Run tests**: Ensure all tests pass
   ```bash
   npm test
   ```

2. **Build successfully**: Verify all packages build without errors
   ```bash
   npm run build
   ```

3. **Follow code style**: The project uses TypeScript with strict mode

4. **Update documentation**: If you're adding features, update relevant docs

### Pull Request Process

1. **Fork the repository** and create a branch from `main`

2. **Make your changes** with clear, descriptive commits

3. **Test thoroughly** - add tests for new functionality

4. **Submit a pull request** with:
   - Clear description of changes
   - Link to related issues
   - Screenshots/examples if relevant
   - Test results

5. **Respond to feedback** - be open to suggestions and changes

### Commit Message Guidelines

Use clear, descriptive commit messages:

```
feat: add support for issue archiving
fix: resolve sync conflict in JSONL export
docs: update installation instructions
test: add tests for feedback anchoring
refactor: simplify relationship graph logic
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` types - use proper typing
- Use interfaces for object shapes
- Use type guards for runtime type checking

### Code Style

- Use 2 spaces for indentation
- Use semicolons
- Prefer `const` over `let`
- Use async/await over raw promises
- Use meaningful variable and function names

### Error Handling

- Always handle errors appropriately
- Provide helpful error messages
- Log errors with context
- Don't swallow errors silently

### Comments

- Write self-documenting code
- Add comments for complex logic
- Use JSDoc for public APIs
- Explain **why**, not **what**

## Questions?

If you have questions or need help:

- Open a [GitHub Issue](https://github.com/sudocode-ai/sudocode/issues)
- Join our [Discord](https://discord.gg/5t8GUW65EW)
- Check the [documentation](https://docs.sudocode.ai)

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
