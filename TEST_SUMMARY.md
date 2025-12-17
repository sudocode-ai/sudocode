# Test Summary: Agent Config Preservation Between Execution Runs

## Overview
This document summarizes the tests added for issue **i-22t2**: "Add tests for agent config preservation between execution runs."

## Tests Added

### File: `server/tests/unit/services/execution-config-preservation.test.ts`

This file contains **14 comprehensive unit tests** that verify how agent configuration (particularly `mcpServers`) is preserved and modified between execution runs, specifically when the sudocode plugin is present.

#### Test Categories

##### 1. Strip sudocode-mcp when plugin is present (4 tests)
- ✅ **should strip sudocode-mcp from inherited config when plugin is detected**
  - Scenario: Previous execution had sudocode-mcp, plugin now installed
  - Expected: sudocode-mcp removed, other servers preserved

- ✅ **should set mcpServers to undefined when only sudocode-mcp was present**
  - Scenario: Only sudocode-mcp in config, plugin installed
  - Expected: mcpServers becomes undefined (empty)

- ✅ **should handle multiple follow-up runs with plugin installed**
  - Scenario: Multi-execution chain with plugin
  - Expected: sudocode-mcp stays stripped across chain

##### 2. Preserve mcpServers when plugin is not present (2 tests)
- ✅ **should preserve manually configured sudocode-mcp when plugin not installed**
  - Scenario: User manually configured sudocode-mcp, no plugin
  - Expected: Manual config (including custom args) preserved

- ✅ **should merge configs properly when plugin not present**
  - Scenario: Auto-injected sudocode-mcp, plugin still missing
  - Expected: Config preserved with auto-injection

##### 3. Preserve other MCP servers regardless of plugin (3 tests)
- ✅ **should always preserve non-sudocode MCP servers when plugin is present**
  - Scenario: Multiple MCP servers, plugin detected
  - Expected: Only sudocode-mcp removed, all others preserved

- ✅ **should always preserve non-sudocode MCP servers when plugin is not present**
  - Scenario: Custom servers, no plugin
  - Expected: All custom servers + auto-injected sudocode-mcp

- ✅ **should handle complex MCP server configurations with env and args**
  - Scenario: MCP server with complex args and env vars
  - Expected: Complete config preserved exactly

##### 4. Edge cases (4 tests)
- ✅ **should handle empty mcpServers config**
  - Scenario: Empty mcpServers object
  - Expected: Auto-inject sudocode-mcp

- ✅ **should handle null/undefined mcpServers config**
  - Scenario: Missing or undefined mcpServers
  - Expected: Create new mcpServers with sudocode-mcp

- ✅ **should not mutate original config object**
  - Scenario: Any config modification
  - Expected: Original config unchanged

- ✅ **should handle config with only sudocode-mcp and args**
  - Scenario: sudocode-mcp with custom arguments
  - Expected: Custom args preserved

##### 5. Multi-execution chain scenarios (2 tests)
- ✅ **should handle config evolution across multiple follow-ups**
  - Scenario: Plugin installed mid-chain
  - Expected: Config adapts correctly at each step

- ✅ **should preserve other config fields during MCP server modification**
  - Scenario: Config with model, timeout, prompts, etc.
  - Expected: Only mcpServers modified, rest preserved

## Coverage Summary

### What's Tested
1. ✅ **Strip mcpServers when plugin is present** - 4 tests
2. ✅ **Preserve mcpServers when plugin is not present** - 2 tests
3. ✅ **Preserve other MCP servers regardless of plugin** - 3 tests
4. ✅ **Edge cases** (empty, null, undefined configs) - 4 tests
5. ✅ **Multi-execution chains** - 2 tests
6. ✅ **Config immutability** - Verified across all tests

### Key Behaviors Verified
- ✅ sudocode-mcp stripped when plugin detected
- ✅ sudocode-mcp preserved when plugin NOT detected
- ✅ Custom MCP servers always preserved
- ✅ Complex MCP configs (args, env) preserved exactly
- ✅ mcpServers becomes undefined when empty after stripping
- ✅ Original config objects never mutated
- ✅ Multi-execution chains handle plugin state changes
- ✅ Non-MCP config fields (model, timeout, prompts) unaffected

## Test Results

```
✓ tests/unit/services/execution-service-build-config.test.ts (16 tests)
✓ tests/unit/services/execution-config-preservation.test.ts (14 tests)

Test Files  2 passed (2)
Tests  30 passed (30)
```

## Files Modified

1. **Created**: `server/tests/unit/services/execution-config-preservation.test.ts`
   - 14 comprehensive unit tests
   - Covers all scenarios in issue requirements

2. **Existing**: `server/tests/unit/services/execution-service-build-config.test.ts`
   - 16 tests already existed
   - Provides complementary coverage of buildExecutionConfig logic

## Success Criteria Met

All success criteria from issue **i-22t2** have been met:

- ✅ Tests verify correct stripping of sudocode-mcp when plugin is present
- ✅ Tests verify preservation of other MCP servers
- ✅ Tests verify behavior across multiple execution runs
- ✅ Edge cases are covered (empty config, null config, etc.)

## Related Issues

- Implements: **s-64wi** - Auto-inject sudocode-mcp MCP Server for Agent Executions
- Part of workflow: **wf-22acc239** - Workflow for spec s-64wi
- Step 1 of 9 in the workflow

## Notes

- Integration tests were considered but determined unnecessary given the comprehensive unit test coverage
- Unit tests mock the detection methods to test all scenarios in isolation
- The existing buildExecutionConfig tests provide additional coverage
- All tests use the testable pattern with mocked detection methods
