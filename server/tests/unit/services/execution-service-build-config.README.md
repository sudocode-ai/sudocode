# ExecutionService.buildExecutionConfig Unit Tests

## Overview

This test suite covers the `buildExecutionConfig()` method which handles automatic detection and injection of the sudocode-mcp MCP server for agent executions.

## Test Structure

The tests are organized into the following categories:

### 1. sudocode-mcp detection and error handling
- Tests error scenarios when sudocode-mcp package is not installed
- Verifies error messages include helpful installation instructions
- Ensures GitHub repository link is provided for installation guidance

### 2. MCP server auto-injection
- Tests automatic injection of sudocode-mcp when agent plugin is not configured
- Verifies injection is skipped when plugin is already configured
- Tests preservation of user-provided MCP server configurations
- Ensures no duplication of sudocode-mcp entries

### 3. config merging and structure
- Tests handling of empty/undefined mcpServers configurations
- Verifies proper merging of user config with auto-injected config
- Ensures original config object is not mutated
- Tests preservation of all config fields (model, timeout, etc.)

### 4. agent type handling
- Tests support for claude-code agent type
- Verifies extensibility to other agent types (codex, copilot, cursor)

### 5. error scenarios
- Tests clear error messages for missing package
- Verifies graceful handling of detection errors

## TDD Approach

These tests follow Test-Driven Development (TDD) principles:

1. **RED Phase (Current)**: Tests are written with mocked implementations that demonstrate the expected behavior. The actual implementation in ExecutionService does not exist yet.

2. **GREEN Phase (Next)**: Implement the actual `buildExecutionConfig()`, `detectSudocodeMcp()`, and `detectAgentMcp()` methods in ExecutionService to make all tests pass.

3. **REFACTOR Phase (Final)**: Clean up and optimize the implementation while keeping all tests green.

## Test Coverage

The test suite covers:

✅ Error handling when sudocode-mcp package is not installed
✅ Auto-injection when agent plugin is not configured
✅ Skipping injection when plugin is already configured
✅ Preservation of user-provided MCP servers
✅ Prevention of duplicate sudocode-mcp entries
✅ Handling of empty/undefined mcpServers
✅ Proper config merging and structure
✅ Non-mutation of original config object
✅ Support for multiple agent types
✅ Clear error messages with installation instructions

## Running the Tests

```bash
# Run all tests in this file
npm test -- --run tests/unit/services/execution-service-build-config.test.ts

# Run with watch mode
npm test -- tests/unit/services/execution-service-build-config.test.ts

# Run specific test by name
npm test -- --run tests/unit/services/execution-service-build-config.test.ts -t "should add sudocode-mcp"
```

## Implementation Notes

When implementing the actual methods, ensure:

1. `detectSudocodeMcp()` checks if the sudocode-mcp package is available (e.g., via `which sudocode-mcp` or checking PATH)

2. `detectAgentMcp()` checks agent-specific configuration:
   - For claude-code: Check ~/.claude/settings.json for `enabledPlugins["sudocode@sudocode-marketplace"] === true`
   - For other agents: Return true (assume configured) until specific detection is implemented

3. `buildExecutionConfig()`:
   - First check if sudocode-mcp package is installed (throw error if not)
   - Check if agent has sudocode plugin configured
   - If not configured and not already in user config, inject sudocode-mcp
   - Return merged config without mutating original

## Dependencies

This issue depends on:
- i-2zt8: Implement MCP detection methods to pass unit tests

## Related Spec

Implements spec s-64wi: Auto-inject sudocode-mcp MCP Server for Agent Executions
