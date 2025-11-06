# Guidelines

This repository uses Typescript. Use Typescript for all implementations.

This project uses sudocode for spec and issue management. Make sure to update issue status when working on an issue and close the issue when done with work.
When writing specs and creating issues that refer to specs, make sure to created references to bi-directionally link issues and specs. Refer to spec and issue content to gather more context about your current task. When editing spec or issue content, you can use your provided MCP tools but you can also update their contents directly by modifying the markdown files in ./sudocode/specs/ and ./sudocode/issues.

## Testing Best Practices

This repository uses **Vitest** as the testing framework for all packages.

### Running Tests

- **Frontend**: `npm --prefix frontend test` (watch mode) or `npm --prefix frontend test -- --run` (single run)
- **CLI**: `npm --prefix cli test` (watch mode) or `npm --prefix cli test -- --run` (single run)
- **MCP**: `npm --prefix mcp test` (watch mode) or `npm --prefix mcp test -- --run` (single run)
- **Run specific test file**: Add file path after `--`, e.g., `npm --prefix frontend test -- --run tests/components/issues/IssuePanel.test.tsx`
- **Run tests with specific name**: Use `-t` flag, e.g., `npm --prefix frontend test -- --run -t "auto-save"`

### Test File Organization

- Tests are located in `tests/` directories within each package
- Test files follow naming conventions:
  - `*.test.ts` for unit tests (CLI, MCP, utilities)
  - `*.test.tsx` for component tests (frontend React components)
- Tests are organized by feature/module:
  - Frontend: `tests/components/`, `tests/pages/`, `tests/hooks/`, `tests/contexts/`
  - CLI/MCP/server: `tests/unit/`, `tests/integration/`
