/**
 * Unit tests for DeployOrchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeployOrchestrator } from '../../../src/deploy/orchestrator.js';
import * as childProcess from 'child_process';
import * as sudopod from 'sudopod';

// Mock dependencies
vi.mock('child_process');
vi.mock('sudopod');
vi.mock('../../../src/deploy/git-context.js');
vi.mock('../../../src/deploy/claude-auth.js');
vi.mock('../../../src/deploy/config.js');

// Import mocked modules to access their mock implementations
import { GitContextDetector } from '../../../src/deploy/git-context.js';
import { ClaudeAuthIntegration } from '../../../src/deploy/claude-auth.js';
import { DeployConfigManager } from '../../../src/deploy/config.js';

describe('DeployOrchestrator', () => {
  let orchestrator: DeployOrchestrator;
  let mockProvider: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Setup mock provider
    mockProvider = {
      type: 'codespaces',
      deploy: vi.fn().mockResolvedValue({
        name: 'test-codespace',
        status: 'running',
        urls: {
          web: 'https://test.github.dev',
          ssh: 'ssh://test',
        },
      }),
      stop: vi.fn(),
      getStatus: vi.fn(),
      list: vi.fn(),
      getUrls: vi.fn(),
    };

    vi.mocked(sudopod.createProvider).mockReturnValue(mockProvider);

    // Mock GitContextDetector
    vi.mocked(GitContextDetector.detectContext).mockReturnValue({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
    });

    // Mock ClaudeAuthIntegration
    vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockResolvedValue(undefined);
    vi.mocked(ClaudeAuthIntegration.getToken).mockResolvedValue('mock-claude-token');

    // Mock DeployConfigManager
    const mockConfigManager = {
      loadConfig: vi.fn().mockReturnValue({
        provider: 'codespaces',
        port: 3000,
        idleTimeout: 4320,
        keepAliveHours: 72,
        retentionPeriod: 14,
        machine: 'basicLinux32gb',
      }),
      saveConfig: vi.fn(),
      updateConfig: vi.fn(),
      resetConfig: vi.fn(),
    };
    vi.mocked(DeployConfigManager).mockImplementation(() => mockConfigManager as any);

    // Mock execSync for GitHub auth checks
    vi.mocked(childProcess.execSync).mockImplementation((command: any) => {
      if (command === 'which gh' || command === 'gh auth status') {
        return Buffer.from('');
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    orchestrator = new DeployOrchestrator('.sudocode');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('deploy()', () => {
    it('should successfully deploy with default options', async () => {
      const result = await orchestrator.deploy();

      expect(result).toEqual({
        name: 'test-codespace',
        status: 'running',
        urls: {
          web: 'https://test.github.dev',
          ssh: 'ssh://test',
        },
      });

      // Verify all steps were executed
      expect(childProcess.execSync).toHaveBeenCalledWith('which gh', { stdio: 'pipe' });
      expect(childProcess.execSync).toHaveBeenCalledWith('gh auth status', { stdio: 'pipe' });
      expect(GitContextDetector.detectContext).toHaveBeenCalledWith({
        repo: undefined,
        branch: undefined,
      });
      expect(ClaudeAuthIntegration.ensureAuthenticated).toHaveBeenCalledWith({ silent: true });
      expect(ClaudeAuthIntegration.getToken).toHaveBeenCalled();
      expect(mockProvider.deploy).toHaveBeenCalledWith({
        git: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'main',
        },
        dev: false,
        agents: {
          install: ['claude'],
        },
        models: {
          claudeLtt: 'mock-claude-token',
        },
        sudocode: {
          mode: 'npm',
          version: 'latest',
        },
        server: {
          port: 3000,
          keepAliveHours: 72,
          idleTimeout: 4320,
        },
        providerOptions: {
          machine: 'basicLinux32gb',
          retentionPeriod: 14,
        },
      });
    });

    it('should deploy with CLI options overriding config', async () => {
      await orchestrator.deploy({
        repo: 'custom-owner/custom-repo',
        branch: 'develop',
        port: 8080,
        machine: 'premiumLinux',
        dev: true,
      });

      expect(GitContextDetector.detectContext).toHaveBeenCalledWith({
        repo: 'custom-owner/custom-repo',
        branch: 'develop',
      });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          dev: true,
          sudocode: {
            mode: 'local',
            version: 'latest',
          },
          server: expect.objectContaining({
            port: 8080,
          }),
          providerOptions: expect.objectContaining({
            machine: 'premiumLinux',
          }),
        })
      );
    });

    it('should throw error if GitHub CLI is not installed', async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('gh: command not found');
      });

      await expect(orchestrator.deploy()).rejects.toThrow(
        'GitHub CLI is not installed'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('GitHub CLI is not authenticated')
      );
    });

    it('should throw error if GitHub CLI is not authenticated', async () => {
      vi.mocked(childProcess.execSync).mockImplementation((command: any) => {
        if (command === 'which gh') {
          return Buffer.from('');
        }
        if (command === 'gh auth status') {
          throw new Error('not logged in');
        }
        throw new Error(`Unexpected command: ${command}`);
      });

      await expect(orchestrator.deploy()).rejects.toThrow(
        'GitHub CLI is not authenticated'
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('GitHub CLI is not authenticated')
      );
    });

    it('should throw error if not in a git repository', async () => {
      vi.mocked(GitContextDetector.detectContext).mockImplementation(() => {
        throw new Error('Not in a git repository. Please run this command from within a git repository.');
      });

      await expect(orchestrator.deploy()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Not in a git repository')
      );
    });

    it('should throw error if Claude authentication fails', async () => {
      vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockRejectedValue(
        new Error('Claude authentication failed: Invalid credentials')
      );

      await expect(orchestrator.deploy()).rejects.toThrow('Claude authentication failed');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Claude authentication failed')
      );
    });

    it('should throw error if Claude token is missing', async () => {
      vi.mocked(ClaudeAuthIntegration.getToken).mockResolvedValue(null);

      await expect(orchestrator.deploy()).rejects.toThrow(
        'Claude authentication failed - no token available'
      );
    });

    it('should handle deployment failures gracefully', async () => {
      mockProvider.deploy.mockRejectedValue(new Error('Deployment failed: quota exceeded'));

      // Our enhanced error handling wraps quota errors with a better message
      await expect(orchestrator.deploy()).rejects.toThrow('Resource quota exceeded');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resource quota exceeded')
      );
    });

    it('should clear progress interval after deployment', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      await orchestrator.deploy();

      // Should clear the interval after deployment completes
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('should create provider with codespaces type', async () => {
      await orchestrator.deploy();

      expect(sudopod.createProvider).toHaveBeenCalledWith({ type: 'codespaces' });
    });

    it('should pass all configuration to provider', async () => {
      await orchestrator.deploy({
        port: 5000,
        idleTimeout: 1000,
        keepAliveHours: 48,
        machine: 'standardLinux',
        retentionPeriod: 7,
      });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          server: {
            port: 5000,
            keepAliveHours: 48,
            idleTimeout: 1000,
          },
          providerOptions: {
            machine: 'standardLinux',
            retentionPeriod: 7,
          },
        })
      );
    });
  });
});
