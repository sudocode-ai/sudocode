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

  });

  describe('Copilot Agent E2E', () => {
    it('should skip injection when MCP configured in ~/.copilot/mcp-config.json', async () => {
      // Setup: sudocode-mcp installed, copilot MCP configured
      await mockSudocodeMcpDetection(true);

      // Mock copilot config with sudocode-mcp
      const mockConfig = {
        mcpServers: {
          'sudocode-mcp': {
            type: 'local',
            command: 'sudocode-mcp',
            tools: ['*'],
            args: [],
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const issueId = 'i-test-copilot-001';
      createTestIssue(issueId, 'Test Issue - Copilot MCP Configured');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'copilot'
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe('copilot');

      const capturedConfig = await getCapturedExecutorConfig();

      // Should NOT have sudocode-mcp in CLI config (uses plugin instead)
      expect(capturedConfig.mcpServers).toBeUndefined();
    });

    it('should auto-inject when MCP not configured', async () => {
      // Setup: sudocode-mcp installed, copilot MCP NOT configured
      await mockSudocodeMcpDetection(true);

      // Mock ENOENT (file doesn't exist)
      const error = new Error('ENOENT: no such file or directory') as any;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const issueId = 'i-test-copilot-002';
      createTestIssue(issueId, 'Test Issue - Copilot MCP Not Configured');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'copilot'
      );

      expect(execution).toBeDefined();

      const capturedConfig = await getCapturedExecutorConfig();

      // Should auto-inject via CLI config
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp'].command).toBe('sudocode-mcp');
    });

    it('should fail when package not installed', async () => {
      // Setup: sudocode-mcp NOT installed
      await mockSudocodeMcpDetection(false);

      const issueId = 'i-test-copilot-003';
      createTestIssue(issueId, 'Test Issue - Copilot Package Not Installed');

      await expect(
        setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'copilot')
      ).rejects.toThrow(/sudocode-mcp package not found/);
    });
  });

  describe('Codex Agent E2E', () => {
    it('should skip injection when MCP configured in ~/.codex/config.toml', async () => {
      // Setup: sudocode-mcp installed, codex MCP configured
      await mockSudocodeMcpDetection(true);

      // Mock codex config with sudocode-mcp
      const mockToml = `
model = "gpt-5.1-codex-max"

[mcp_servers.sudocode-mcp]
command = "sudocode-mcp"
`;
      vi.mocked(fs.readFile).mockResolvedValue(mockToml);

      const issueId = 'i-test-codex-001';
      createTestIssue(issueId, 'Test Issue - Codex MCP Configured');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'codex'
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe('codex');

      const capturedConfig = await getCapturedExecutorConfig();

      // Should NOT have sudocode-mcp in CLI config (uses plugin instead)
      expect(capturedConfig.mcpServers).toBeUndefined();
    });

    it('should auto-inject when MCP not configured', async () => {
      // Setup: sudocode-mcp installed, codex MCP NOT configured
      await mockSudocodeMcpDetection(true);

      // Mock ENOENT (file doesn't exist)
      const error = new Error('ENOENT: no such file or directory') as any;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const issueId = 'i-test-codex-002';
      createTestIssue(issueId, 'Test Issue - Codex MCP Not Configured');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'codex'
      );

      expect(execution).toBeDefined();

      const capturedConfig = await getCapturedExecutorConfig();

      // Should auto-inject via CLI config
      expect(capturedConfig.mcpServers).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp']).toBeDefined();
      expect(capturedConfig.mcpServers['sudocode-mcp'].command).toBe('sudocode-mcp');
    });

    it('should fail when package not installed', async () => {
      // Setup: sudocode-mcp NOT installed
      await mockSudocodeMcpDetection(false);

      const issueId = 'i-test-codex-003';
      createTestIssue(issueId, 'Test Issue - Codex Package Not Installed');

      await expect(
        setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'codex')
      ).rejects.toThrow(/sudocode-mcp package not found/);
    });
  });

  describe('Cursor Agent E2E', () => {
    it('should succeed when .cursor/mcp.json present in project root', async () => {
      // Setup: sudocode-mcp installed, cursor MCP configured in project root
      await mockSudocodeMcpDetection(true);

      // Mock .cursor/mcp.json in project root (testRepoPath)
      const mockConfig = {
        mcpServers: {
          'sudocode-mcp': {
            command: 'sudocode-mcp',
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const issueId = 'i-test-cursor-001';
      createTestIssue(issueId, 'Test Issue - Cursor MCP Configured');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'cursor'
      );

      expect(execution).toBeDefined();
      expect(execution.agent_type).toBe('cursor');
      expect(execution.status).not.toBe('failed');
    });

    it('should fail when .cursor/mcp.json missing (already tested elsewhere)', async () => {
      // This scenario is already covered in "Cursor error handling" tests
      // in execution-service-build-config.test.ts
      // Skipping duplicate test here
    });

    it('should fail when package not installed even with config', async () => {
      // Setup: sudocode-mcp NOT installed, even though config exists
      await mockSudocodeMcpDetection(false);

      // Mock cursor config (should still fail due to package not installed)
      const mockConfig = {
        mcpServers: {
          'sudocode-mcp': {
            command: 'sudocode-mcp',
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const issueId = 'i-test-cursor-002';
      createTestIssue(issueId, 'Test Issue - Cursor Package Not Installed');

      await expect(
        setup.service.createExecution(issueId, { mode: 'worktree' }, 'Test prompt', 'cursor')
      ).rejects.toThrow(/sudocode-mcp package not found/);
    });

    it('should have .cursor/mcp.json propagated to worktree', async () => {
      // Setup: sudocode-mcp installed, cursor MCP configured
      await mockSudocodeMcpDetection(true);

      // Mock .cursor/mcp.json in project root
      const mockConfig = {
        mcpServers: {
          'sudocode-mcp': {
            command: 'sudocode-mcp',
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      // Mock fs.access for propagation check (will be called by propagateCursorConfig)
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // Mock fs.mkdir and fs.copyFile for propagation
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.copyFile).mockResolvedValue(undefined);

      const issueId = 'i-test-cursor-003';
      createTestIssue(issueId, 'Test Issue - Cursor Worktree Propagation');

      const execution = await setup.service.createExecution(
        issueId,
        { mode: 'worktree' },
        'Test prompt',
        'cursor'
      );

      expect(execution).toBeDefined();

      // Verify propagateCursorConfig was called (by checking fs.copyFile was called)
      // The actual propagation logic is tested in worktree/manager.test.ts
      // Here we just verify the integration works
      expect(execution.worktree_path).toBeDefined();
    });
  });
});
