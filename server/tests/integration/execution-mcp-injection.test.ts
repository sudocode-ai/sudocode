/**
 * Integration Tests for MCP Auto-Injection Flow
 *
 * End-to-end tests for the complete MCP auto-injection system that automatically
 * configures sudocode-mcp MCP server for agent executions. Tests cover all execution
 * types (adhoc, issue-based, workflow) and error scenarios.
 *
 * Test Strategy:
 * - Uses real ExecutionService (not just mocked methods)
 * - Mocks file system and process execution to control detection results
 * - Verifies config is properly passed to agent adapters
 * - Tests are isolated with proper setup/teardown
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  createExecutionServiceSetup,
  createTestDatabase,
  mockSudocodeMcpDetection,
  mockAgentMcpDetection,
  getCapturedExecutorConfig,
} from './execution/helpers/execution-test-utils.js';
import * as fs from 'fs/promises';
import { createIssue } from '@sudocode-ai/cli/dist/operations/index.js';

/**
 * Mock modules before importing ExecutionService
 */
vi.mock('fs/promises');

// Mock execFileNoThrow for safe process execution mocking
vi.mock('../../src/utils/execFileNoThrow.js', () => ({
  execFileNoThrow: vi.fn(),
}));

// Mock the WebSocket module
vi.mock('../../src/services/websocket.js', () => ({
  broadcastExecutionUpdate: vi.fn(),
}));

// Mock the executor factory to avoid spawning real processes
vi.mock('../../src/execution/executors/executor-factory.js', () => {
  let capturedConfig: any = null;

  return {
    createExecutorForAgent: vi.fn((agentType, config) => {
      // Capture the config for verification
      capturedConfig = config;

      // Return a mock executor wrapper that mimics AgentExecutorWrapper interface
      return {
        executeWithLifecycle: vi.fn(async () => {
          // Return a promise that resolves immediately (non-blocking execution)
          return Promise.resolve();
        }),
        resumeWithLifecycle: vi.fn(async () => {
          // Return a promise that resolves immediately (non-blocking follow-up execution)
          return Promise.resolve();
        }),
        cancel: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
        _capturedConfig: capturedConfig, // Expose for testing
      };
    }),
    validateAgentConfig: vi.fn(() => []),
    // Helper to access captured config in tests
    __getCapturedConfig: () => capturedConfig,
  };
});

describe('MCP Auto-Injection Integration Tests', () => {
  let setup: ReturnType<typeof createExecutionServiceSetup>;
  let testRepoPath: string;

  beforeAll(() => {
    testRepoPath = '/tmp/test-repo-mcp-injection';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Create ExecutionService setup with all dependencies
    setup = createExecutionServiceSetup('test-project-id', testRepoPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      setup.db.close();
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create a test issue in the database
   */
  function createTestIssue(issueId: string, title: string): void {
    createIssue(
      setup.db,
      {
        id: issueId,
        title,
        description: 'Test issue for MCP auto-injection',
        status: 'open',
        priority: 0,
      },
      testRepoPath
    );
  }

  describe('End-to-end execution tests', () => {
    it('should auto-inject sudocode-mcp when package is installed but plugin not configured', async () => {
      // Setup: sudocode-mcp package installed, but not configured in agent
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-001';
      createTestIssue(issueId, 'Test Issue for MCP Injection');

      // Create execution
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();
      expect(execution.id).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();
      expect(capturedConfig).toBeDefined();

      // Verify sudocode-mcp was auto-injected
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp'].command).toBe('sudocode-mcp');
      expect(capturedConfig.mcpServers['sudocode-mcp'].args).toEqual([]);
    });

    it('should skip injection when plugin already configured', async () => {
      // Setup: both package and plugin are configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(true);

      // Create test issue
      const issueId = 'i-test-002';
      createTestIssue(issueId, 'Test Issue - Plugin Already Configured');

      // Create execution
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();
      expect(capturedConfig).toBeDefined();

      // Verify sudocode-mcp was NOT injected (plugin already configured)
      expect(capturedConfig.mcpServers).toBeUndefined();
    });

    it('should fail with clear error when sudocode-mcp package not installed', async () => {
      // Setup: sudocode-mcp package NOT installed
      await mockSudocodeMcpDetection(false);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-003';
      createTestIssue(issueId, 'Test Issue - Package Not Installed');

      // Attempt to create execution - should fail
      await expect(
        setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'claude-code')
      ).rejects.toThrow();
    });

    it('should verify sudocode MCP tools would be available after auto-injection', async () => {
      // Setup: sudocode-mcp package installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-004';
      createTestIssue(issueId, 'Test Issue - Verify Tools Available');

      // Create execution
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify the MCP server config would enable sudocode tools
      expect(capturedConfig.mcpServers['sudocode-mcp']).toEqual({
        command: 'sudocode-mcp',
        args: [],
      });

      // This config structure is what claude-code needs to connect to sudocode MCP tools
      // The actual connection happens in the agent adapter, but we've verified
      // the config is correctly formed
    });

    it('should preserve user-provided MCP servers alongside auto-injected one', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-005';
      createTestIssue(issueId, 'Test Issue - Preserve User MCP');

      // Create execution with user-provided MCP server
      const userConfig = {
        mode: 'worktree' as const,
        mcpServers: {
          'custom-mcp': {
            command: 'custom-mcp-server',
            args: ['--verbose'],
          },
        },
      };

      const execution = await setup.service.createExecution(
        issueId,
        userConfig,
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify both custom MCP and sudocode-mcp are present
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['custom-mcp']).toEqual({
        command: 'custom-mcp-server',
        args: ['--verbose'],
      });
      expect(capturedConfig.mcpServers['sudocode-mcp']).toEqual({
        command: 'sudocode-mcp',
        args: [],
      });
    });
  });

  describe('Error scenario tests', () => {
    it('should fail with informative error when sudocode-mcp not in PATH', async () => {
      // Setup: sudocode-mcp not installed
      await mockSudocodeMcpDetection(false);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-006';
      createTestIssue(issueId, 'Test Issue - Not In PATH');

      // Attempt to create execution
      try {
        await setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'claude-code');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;

        // Verify error message is informative
        expect(message.toLowerCase()).toContain('sudocode');
        expect(message.toLowerCase()).toContain('not found');
      }
    });

    it('should include link to github.com/sudocode-ai/sudocode in error message', async () => {
      // Setup: sudocode-mcp not installed
      await mockSudocodeMcpDetection(false);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-007';
      createTestIssue(issueId, 'Test Issue - Error Link');

      // Attempt to create execution
      try {
        await setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'claude-code');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;

        // Verify error message includes GitHub link
        expect(message).toContain('github.com/sudocode-ai/sudocode');
      }
    });

    it('should not block execution when detection fails (settings.json read errors)', async () => {
      // Setup: sudocode-mcp installed, but settings.json read fails
      await mockSudocodeMcpDetection(true);

      // Mock settings.json read error (permission denied)
      const error = new Error('EACCES: permission denied') as any;
      error.code = 'EACCES';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      // Create test issue
      const issueId = 'i-test-008';
      createTestIssue(issueId, 'Test Issue - Detection Failure');

      // Create execution - should NOT fail despite detection error
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Detection failed, so it should proceed as normal without injection
      // (conservative behavior: if we can't detect, assume it's already configured)
      expect(capturedConfig.mcpServers).toBeUndefined();
    });
  });

  describe('Multi-execution type tests', () => {
    it('should auto-inject for adhoc executions (no issue)', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create adhoc execution (issueId = null) in local mode
      // Worktree mode requires an issue or reuseWorktreePath
      const execution = await setup.service.createExecution(
        null,
        { mode: 'local' },
        'Adhoc prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify sudocode-mcp was auto-injected for adhoc execution
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
    });

    it('should auto-inject for issue-based executions', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-009';
      createTestIssue(issueId, 'Test Issue - Issue-Based');

      // Create issue-based execution
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Issue prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify sudocode-mcp was auto-injected for issue-based execution
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
    });

    it('should auto-inject for workflow sub-executions', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-010';
      createTestIssue(issueId, 'Test Issue - Workflow Sub-Execution');

      // Create workflow sub-execution (with workflow context)
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Workflow step prompt',
        'claude-code',
        {
          workflowId: 'wf-test-001',
          stepId: 'step-001',
        }
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify sudocode-mcp was auto-injected for workflow sub-execution
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
    });
  });

  describe('Config structure verification', () => {
    it('should pass properly structured config to agent adapter', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-011';
      createTestIssue(issueId, 'Test Issue - Config Structure');

      // Create execution with various config options
      const userConfig = {
        mode: 'worktree' as const,
        model: 'claude-sonnet-4',
        timeout: 30000,
        appendSystemPrompt: 'Be concise',
      };

      const execution = await setup.service.createExecution(
        issueId,
        userConfig,
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify agent-relevant config fields are preserved
      // Note: mode is a sudocode-specific field and is stripped out before passing to agent
      expect(capturedConfig.model).toBe('claude-sonnet-4');
      expect(capturedConfig.timeout).toBe(30000);
      expect(capturedConfig.appendSystemPrompt).toBe('Be concise');

      // Verify sudocode-mcp was added
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
    });

    it('should not duplicate sudocode-mcp if user already provided it', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-012';
      createTestIssue(issueId, 'Test Issue - No Duplication');

      // User explicitly provides sudocode-mcp with custom args
      const userConfig = {
        mode: 'worktree' as const,
        mcpServers: {
          'sudocode-mcp': {
            command: 'sudocode-mcp',
            args: ['--custom-flag'],
          },
        },
      };

      const execution = await setup.service.createExecution(
        issueId,
        userConfig,
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify user's config is preserved (not overwritten by auto-injection)
      expect(capturedConfig.mcpServers['sudocode-mcp']).toEqual({
        command: 'sudocode-mcp',
        args: ['--custom-flag'],
      });

      // Verify only one sudocode-mcp entry exists
      const mcpKeys = Object.keys(capturedConfig.mcpServers).filter((k) =>
        k.includes('sudocode-mcp')
      );
      expect(mcpKeys).toHaveLength(1);
    });
  });

  describe('Agent type handling', () => {
    it('should work with claude-code agent type', async () => {
      // Setup: sudocode-mcp installed, plugin not configured
      await mockSudocodeMcpDetection(true);
      mockAgentMcpDetection(false);

      // Create test issue
      const issueId = 'i-test-013';
      createTestIssue(issueId, 'Test Issue - Claude Code Agent');

      // Create execution with claude-code agent
      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'claude-code'
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe('claude-code');

      // Get the config that was passed to the executor
      const capturedConfig = await getCapturedExecutorConfig();

      // Verify auto-injection worked for claude-code
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
    });

    it('should handle other agent types gracefully (extensibility)', async () => {
      // Setup: sudocode-mcp installed
      await mockSudocodeMcpDetection(true);

      // For non-claude-code agents, detection should return true (safe default)
      // No settings.json needed for these agents

      // Test with different agent types - use separate issues for each agent
      const agentTypes = ['codex', 'copilot', 'cursor'] as const;
      let issueCounter = 14; // Start from 14 as base

      for (const agentType of agentTypes) {
        vi.clearAllMocks();

        // Create unique issue for each agent type
        const issueId = `i-test-${issueCounter++}`;
        createTestIssue(issueId, `Test Issue - ${agentType} Agent`);

        const execution = await setup.service.createExecution(
          issueId,
          { mode: 'worktree' },
          'Test prompt',
          agentType
        );

        expect(execution).toBeDefined();
        expect(execution.agent_type).toBe(agentType);

        // Get the config that was passed to the executor
        const capturedConfig = await getCapturedExecutorConfig();

        // For unsupported agents, detection returns true (assumes configured),
        // so no auto-injection occurs
        expect(capturedConfig.mcpServers).toBeUndefined();
      }
    });
  });
});
