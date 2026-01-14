/**
 * End-to-End tests for deploy commands
 * 
 * Tests complete user workflows from CLI invocation to final output:
 * - First time deployment flow
 * - Configuration management workflows
 * - Deployment lifecycle (deploy → list → status → stop)
 * - Error scenarios with proper user feedback
 * - Edge cases and validation
 * 
 * These tests mock external dependencies (sudopod, gh CLI) but test
 * the complete command flow including CLI argument parsing, validation,
 * orchestration, and output formatting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { initDatabase } from '../../src/db.js';
import {
  handleDeploy,
  handleDeployConfig,
  handleDeployList,
  handleDeployStatus,
  handleDeployStop,
} from '../../src/cli/deploy-commands.js';
import type Database from 'better-sqlite3';

// Mock external dependencies
vi.mock('child_process');
vi.mock('sudopod');
vi.mock('../../src/deploy/claude-auth.js');
vi.mock('readline', () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        // Auto-respond 'y' to confirmation prompts in tests
        callback('y');
      }),
      close: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    })),
  },
}));

// Import mocked modules
import * as sudopod from 'sudopod';
import { ClaudeAuthIntegration } from '../../src/deploy/claude-auth.js';

interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

describe('Deploy Commands E2E Tests', () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;
  let mockProvider: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Create temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-e2e-'));
    
    // Initialize database
    const dbPath = path.join(tmpDir, 'cache.db');
    db = initDatabase({ path: dbPath });

    ctx = {
      db,
      outputDir: tmpDir,
      jsonOutput: false,
    };

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });

    // Setup mock provider with realistic responses
    mockProvider = {
      type: 'codespaces',
      deploy: vi.fn().mockResolvedValue({
        id: 'test-codespace-abc123',
        name: 'test-workspace',
        status: 'running',
        git: {
          owner: 'test-user',
          repo: 'test-repo',
          branch: 'main',
        },
        urls: {
          web: 'https://test-codespace-abc123.github.dev',
          sudocode: 'https://test-codespace-abc123.github.dev:3000',
          ssh: 'ssh://git@github.com/codespaces/test-codespace-abc123',
        },
        createdAt: '2025-01-12T10:00:00Z',
        keepAliveHours: 72,
        idleTimeout: 4320,
        metadata: {
          codespaces: {
            machine: 'basicLinux32gb',
            retentionPeriod: 14,
          },
        },
      }),
      list: vi.fn().mockResolvedValue([
        {
          id: 'codespace-1',
          name: 'deployment-1',
          status: 'running',
          git: {
            owner: 'owner1',
            repo: 'repo1',
            branch: 'main',
          },
        },
        {
          id: 'codespace-2',
          name: 'deployment-2',
          status: 'stopped',
          git: {
            owner: 'owner2',
            repo: 'repo2',
            branch: 'feature',
          },
        },
      ]),
      getStatus: vi.fn().mockResolvedValue('running'),
      getUrls: vi.fn().mockResolvedValue({
        web: 'https://test-codespace-abc123.github.dev',
        sudocode: 'https://test-codespace-abc123.github.dev:3000',
        ssh: 'ssh://git@github.com/codespaces/test-codespace-abc123',
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(sudopod.createProvider).mockReturnValue(mockProvider);

    // Mock Claude authentication
    vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockResolvedValue(undefined);
    vi.mocked(ClaudeAuthIntegration.getToken).mockResolvedValue('test-claude-token-xyz789');

    // Mock execSync for git and GitHub CLI commands
    vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
      const cmd = command.toString();
      const hasEncoding = options && options.encoding;
      
      // GitHub CLI checks
      if (cmd === 'which gh') {
        return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
      }
      if (cmd === 'gh auth status') {
        return hasEncoding ? 'Logged in to github.com as testuser' : Buffer.from('Logged in to github.com as testuser');
      }
      
      // Git context detection
      if (cmd.includes('git rev-parse --git-dir')) {
        return hasEncoding ? '.git\n' : Buffer.from('.git\n');
      }
      if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
        return hasEncoding ? 'main\n' : Buffer.from('main\n');
      }
      if (cmd.includes('git config --get remote.origin.url')) {
        return hasEncoding ? 'https://github.com/test-user/test-repo.git\n' : Buffer.from('https://github.com/test-user/test-repo.git\n');
      }
      
      throw new Error(`Unexpected command: ${cmd}`);
    }) as any;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    
    vi.clearAllMocks();
  });

  describe('E2E Workflow: First Time Deployment', () => {
    it('should complete full first-time deployment workflow', async () => {
      // Step 1: View default configuration (no config file exists yet)
      await handleDeployConfig(ctx, {});
      
      let output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('"provider": "codespaces"');
      expect(output).toContain('"port": 3000');
      
      consoleLogSpy.mockClear();

      // Step 2: Configure custom settings
      await handleDeployConfig(ctx, {
        port: '8080',
        machine: 'premiumLinux',
        idleTimeout: '1000',
      });

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Deploy configuration updated');
      expect(output).toContain('Port: 8080');
      expect(output).toContain('Machine: premiumLinux');
      expect(output).toContain('Idle timeout: 1000 minutes');

      consoleLogSpy.mockClear();

      // Step 3: Deploy with custom configuration
      await handleDeploy(ctx, {});

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Checking GitHub authentication');
      expect(output).toContain('GitHub authenticated');
      expect(output).toContain('Detecting git context');
      expect(output).toContain('Checking Claude authentication');
      expect(output).toContain('Claude authenticated');
      expect(output).toContain('Loading deployment configuration');
      expect(output).toContain('Deploying to GitHub Codespaces');
      expect(output).toContain('Deployment successful');
      expect(output).toContain('https://test-codespace-abc123.github.dev');

      // Verify deployment was called with custom config
      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          server: expect.objectContaining({
            port: 8080,
            idleTimeout: 1000,
          }),
          providerOptions: expect.objectContaining({
            machine: 'premiumLinux',
          }),
        })
      );

      consoleLogSpy.mockClear();

      // Step 4: List deployments
      await handleDeployList(ctx);

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Active Deployments');
      expect(output).toContain('deployment-1');
      expect(output).toContain('deployment-2');

      consoleLogSpy.mockClear();

      // Step 5: Check status of specific deployment
      mockProvider.list.mockResolvedValueOnce([
        {
          id: 'test-codespace-abc123',
          name: 'test-workspace',
          status: 'running',
          git: {
            owner: 'test-user',
            repo: 'test-repo',
            branch: 'main',
          },
          createdAt: '2025-01-12T10:00:00Z',
          keepAliveHours: 72,
          idleTimeout: 4320,
          metadata: {
            codespaces: {
              machine: 'basicLinux32gb',
              retentionPeriod: 14,
            },
          },
        },
      ]);

      await handleDeployStatus(ctx, 'test-codespace-abc123');

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Deployment: test-workspace');
      expect(output).toContain('Status:');
      expect(output).toContain('running');
      expect(output).toContain('Repository: test-user/test-repo');
      expect(output).toContain('Branch: main');
      expect(output).toContain('URLs:');
      expect(output).toContain('https://test-codespace-abc123.github.dev');

      consoleLogSpy.mockClear();

      // Step 6: Stop deployment
      await handleDeployStop(ctx, 'test-codespace-abc123', { force: true });

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Stopping deployment');
      expect(output).toContain('stopped successfully');
      expect(mockProvider.stop).toHaveBeenCalledWith('test-codespace-abc123');
    });
  });

  describe('E2E Workflow: Configure Then Deploy', () => {
    it('should update config and deploy with overrides', async () => {
      // Step 1: Set base configuration
      await handleDeployConfig(ctx, {
        port: '5000',
        keepAliveHours: '48',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deploy configuration updated')
      );

      consoleLogSpy.mockClear();

      // Step 2: Deploy with CLI overrides
      await handleDeploy(ctx, {
        port: 6000, // Override config
        branch: 'develop', // Override detected branch
      });

      // Verify CLI options took precedence
      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            branch: 'develop', // CLI override
          }),
          server: expect.objectContaining({
            port: 6000, // CLI override
            keepAliveHours: 48, // From config
          }),
        })
      );

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Deployment successful');
    });

    it('should handle config reset workflow', async () => {
      // Step 1: Set custom config
      await handleDeployConfig(ctx, {
        port: '9000',
        machine: 'standardLinux',
      });

      consoleLogSpy.mockClear();

      // Step 2: View current config
      await handleDeployConfig(ctx, {});

      let output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('"port": 9000');
      expect(output).toContain('"machine": "standardLinux"');

      consoleLogSpy.mockClear();

      // Step 3: Reset to defaults
      await handleDeployConfig(ctx, { reset: true });

      output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('reset to defaults');
      expect(output).toContain('"port": 3000');
      expect(output).toContain('"machine": "basicLinux32gb"');
    });
  });

  describe('E2E Workflow: Error Path - Authentication', () => {
    it('should guide user through GitHub authentication failure', async () => {
      // Mock GitHub CLI not installed
      vi.mocked(execSync).mockImplementation((command: any) => {
        const cmd = command.toString();
        if (cmd === 'which gh') {
          throw new Error('gh: command not found');
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('GitHub CLI is not authenticated');
      expect(output).toContain('https://cli.github.com');
    });

    it('should guide user through GitHub not authenticated', async () => {
      vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
        const cmd = command.toString();
        const hasEncoding = options && options.encoding;
        
        if (cmd === 'which gh') {
          return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
        }
        if (cmd === 'gh auth status') {
          throw new Error('not logged in');
        }
        throw new Error(`Unexpected command: ${cmd}`);
      }) as any;

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('GitHub CLI is not authenticated');
      expect(output).toContain('gh auth login');
    });

    it('should guide user through Claude authentication failure', async () => {
      vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockRejectedValue(
        new Error('Claude authentication failed: Session expired')
      );

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Claude authentication failed');
    });
  });

  describe('E2E Workflow: Error Path - Git Context', () => {
    it('should handle not in a git repository', async () => {
      vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
        const cmd = command.toString();
        const hasEncoding = options && options.encoding;
        
        // GitHub CLI works
        if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
        if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
        
        // Git fails
        if (cmd.includes('git rev-parse --git-dir')) {
          throw new Error('fatal: not a git repository');
        }
        
        throw new Error(`Unexpected command: ${cmd}`);
      }) as any;

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Git repository not found');
    });

    it('should handle missing GitHub remote', async () => {
      vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
        const cmd = command.toString();
        const hasEncoding = options && options.encoding;
        
        if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
        if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
        if (cmd.includes('git rev-parse --git-dir')) return hasEncoding ? '.git\n' : Buffer.from('.git\n');
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return hasEncoding ? 'main\n' : Buffer.from('main\n');
        
        if (cmd.includes('git config --get remote.origin.url')) {
          throw new Error('');
        }
        
        throw new Error(`Unexpected command: ${cmd}`);
      }) as any;

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Git repository not found');
    });

    it('should handle non-GitHub remote URL', async () => {
      vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
        const cmd = command.toString();
        const hasEncoding = options && options.encoding;
        
        if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
        if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
        if (cmd.includes('git rev-parse --git-dir')) return hasEncoding ? '.git\n' : Buffer.from('.git\n');
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return hasEncoding ? 'main\n' : Buffer.from('main\n');
        if (cmd.includes('git config --get remote.origin.url')) {
          return hasEncoding ? 'https://gitlab.com/user/repo.git\n' : Buffer.from('https://gitlab.com/user/repo.git\n');
        }
        
        throw new Error(`Unexpected command: ${cmd}`);
      }) as any;

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('GitHub remote not configured');
    });
  });

  describe('E2E Workflow: Configuration Validation', () => {
    it('should reject invalid port values', async () => {
      await expect(handleDeployConfig(ctx, { port: '99999' })).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port number')
      );

      consoleErrorSpy.mockClear();

      await expect(handleDeployConfig(ctx, { port: 'abc' })).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port number')
      );

      consoleErrorSpy.mockClear();

      await expect(handleDeployConfig(ctx, { port: '0' })).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port number')
      );
    });

    it('should reject invalid idle timeout values', async () => {
      await expect(handleDeployConfig(ctx, { idleTimeout: '0' })).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Idle timeout must be at least 1 minute')
      );

      consoleErrorSpy.mockClear();

      await expect(handleDeployConfig(ctx, { idleTimeout: 'invalid' })).rejects.toThrow('process.exit(1)');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid idle timeout')
      );
    });

    it('should reject combining --reset with other options', async () => {
      await expect(
        handleDeployConfig(ctx, { reset: true, port: '8080' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot combine --reset with other options')
      );
    });

    it('should validate all numeric fields', async () => {
      // Invalid keep-alive hours
      await expect(handleDeployConfig(ctx, { keepAliveHours: 'text' })).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid keep-alive hours')
      );

      consoleErrorSpy.mockClear();

      // Invalid retention period
      await expect(handleDeployConfig(ctx, { retentionPeriod: '-1' })).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid retention period')
      );
    });
  });

  describe('E2E Workflow: Deployment Lifecycle', () => {
    it('should handle deployment not found in status check', async () => {
      mockProvider.list.mockResolvedValue([]);

      await expect(
        handleDeployStatus(ctx, 'nonexistent-deployment')
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    it('should handle deployment not found in stop', async () => {
      mockProvider.stop.mockRejectedValue(new Error('Deployment not found'));

      await expect(
        handleDeployStop(ctx, 'nonexistent-deployment', { force: true })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should require deployment ID for status command', async () => {
      await expect(handleDeployStatus(ctx, '')).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deployment ID is required')
      );
    });

    it('should require deployment ID for stop command', async () => {
      await expect(handleDeployStop(ctx, '', { force: true })).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deployment ID is required')
      );
    });

    it('should show empty state when no deployments exist', async () => {
      mockProvider.list.mockResolvedValue([]);

      await handleDeployList(ctx);

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('No active deployments found');
      expect(output).toContain('sudocode deploy');
    });
  });

  describe('E2E Workflow: Network and Provider Errors', () => {
    it('should handle network timeout during deployment', async () => {
      const networkError = new Error('Network timeout');
      (networkError as any).code = 'ETIMEDOUT';
      mockProvider.deploy.mockRejectedValue(networkError);

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Network');
    });

    it('should handle connection refused during list', async () => {
      const networkError = new Error('Connection refused');
      (networkError as any).code = 'ECONNREFUSED';
      mockProvider.list.mockRejectedValue(networkError);

      await expect(handleDeployList(ctx)).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      // Error message includes network connection failed
      expect(output).toContain('Network connection failed');
    });

    it('should handle DNS resolution failure during status', async () => {
      const networkError = new Error('DNS resolution failed');
      (networkError as any).code = 'ENOTFOUND';
      mockProvider.getStatus.mockRejectedValue(networkError);

      await expect(handleDeployStatus(ctx, 'test-deployment')).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      // Error message includes network connection failed
      expect(output).toContain('Network connection failed');
    });

    it('should handle quota exceeded error', async () => {
      mockProvider.deploy.mockRejectedValue(
        new Error('Deployment failed: Codespaces quota exceeded')
      );

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('quota exceeded');
    });

    it('should handle port conflict error', async () => {
      mockProvider.deploy.mockRejectedValue(
        new Error('Deployment failed: port 3000 is already in use')
      );

      await expect(handleDeploy(ctx, {})).rejects.toThrow();

      const output = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('port');
    });
  });

  describe('E2E Workflow: JSON Output Mode', () => {
    beforeEach(() => {
      ctx.jsonOutput = true;
    });

    it('should output JSON for deploy command', async () => {
      await handleDeploy(ctx, {});

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output).toHaveProperty('id');
      expect(output).toHaveProperty('status');
      expect(output).toHaveProperty('urls');
      expect(output.id).toBe('test-codespace-abc123');
    });

    it('should output JSON for list command', async () => {
      await handleDeployList(ctx);

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(Array.isArray(output)).toBe(true);
      expect(output).toHaveLength(2);
    });

    it('should output JSON for status command', async () => {
      mockProvider.list.mockResolvedValueOnce([
        {
          id: 'test-codespace-abc123',
          name: 'test-workspace',
          status: 'running',
          git: { owner: 'test-user', repo: 'test-repo', branch: 'main' },
        },
      ]);

      await handleDeployStatus(ctx, 'test-codespace-abc123');

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output).toHaveProperty('id');
      expect(output).toHaveProperty('status');
    });

    it('should output JSON for stop command', async () => {
      await handleDeployStop(ctx, 'test-codespace-abc123', { force: true });

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output).toHaveProperty('success');
      expect(output.success).toBe(true);
      expect(output.id).toBe('test-codespace-abc123');
    });

    it('should output JSON errors for config validation failures', async () => {
      await expect(handleDeployConfig(ctx, { port: '99999' })).rejects.toThrow();

      const errorCall = consoleErrorSpy.mock.calls.find((call: any[]) => {
        try {
          const obj = JSON.parse(call[0]);
          return obj.error !== undefined;
        } catch {
          return false;
        }
      });

      expect(errorCall).toBeDefined();
      const errorOutput = JSON.parse(errorCall![0]);
      expect(errorOutput).toHaveProperty('error');
      expect(errorOutput.error).toContain('Invalid port number');
    });

    it('should output JSON for config view', async () => {
      await handleDeployConfig(ctx, {});

      const jsonCall = consoleLogSpy.mock.calls.find((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output).toHaveProperty('provider');
      expect(output).toHaveProperty('port');
      expect(output).toHaveProperty('machine');
    });
  });

  describe('E2E Workflow: Edge Cases', () => {
    it('should handle manual repo/branch override', async () => {
      // Deploy to a different repo than detected
      await handleDeploy(ctx, {
        repo: 'different-owner/different-repo',
        branch: 'staging',
      });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: {
            owner: 'different-owner',
            repo: 'different-repo',
            branch: 'staging',
          },
        })
      );

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('different-owner/different-repo');
      expect(output).toContain('staging');
    });

    it('should handle dev mode deployment', async () => {
      await handleDeploy(ctx, { dev: true });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          dev: true,
          sudocode: {
            mode: 'local',
            version: 'latest',
          },
        })
      );
    });

    it('should handle production mode deployment', async () => {
      await handleDeploy(ctx, { dev: false });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          dev: false,
          sudocode: {
            mode: 'npm',
            version: 'latest',
          },
        })
      );
    });

    it('should handle all CLI options at once', async () => {
      await handleDeploy(ctx, {
        repo: 'owner/repo',
        branch: 'feature',
        port: 4000,
        machine: 'standardLinux',
        idleTimeout: 500,
        keepAliveHours: 24,
        retentionPeriod: 3,
        dev: true,
      });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: {
            owner: 'owner',
            repo: 'repo',
            branch: 'feature',
          },
          dev: true,
          server: {
            port: 4000,
            keepAliveHours: 24,
            idleTimeout: 500,
          },
          providerOptions: {
            machine: 'standardLinux',
            retentionPeriod: 3,
          },
        })
      );
    });

    it('should handle deployment with minimal configuration', async () => {
      // Clear config file
      const configPath = path.join(tmpDir, 'deploy-config.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      await handleDeploy(ctx, {});

      // Should use default values
      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          server: expect.objectContaining({
            port: 3000,
            keepAliveHours: 72,
            idleTimeout: 4320,
          }),
        })
      );
    });

    it('should handle updating only one config value', async () => {
      // Set initial config
      await handleDeployConfig(ctx, {
        port: '5000',
        machine: 'premiumLinux',
      });

      consoleLogSpy.mockClear();

      // Update only port
      await handleDeployConfig(ctx, {
        port: '6000',
      });

      // Verify config file still has machine
      const configPath = path.join(tmpDir, 'deploy-config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(config.port).toBe(6000);
      expect(config.machine).toBe('premiumLinux'); // Should be preserved
    });

    it('should handle status check with all deployment details', async () => {
      mockProvider.list.mockResolvedValueOnce([
        {
          id: 'detailed-deployment',
          name: 'detailed-workspace',
          status: 'running',
          git: {
            owner: 'test-owner',
            repo: 'test-repo',
            branch: 'main',
          },
          createdAt: '2025-01-12T10:00:00Z',
          keepAliveHours: 48,
          idleTimeout: 1000,
          metadata: {
            codespaces: {
              machine: 'premiumLinux',
              retentionPeriod: 7,
            },
          },
        },
      ]);

      await handleDeployStatus(ctx, 'detailed-deployment');

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('detailed-workspace');
      expect(output).toContain('running');
      expect(output).toContain('test-owner/test-repo');
      expect(output).toContain('main');
      expect(output).toContain('Keep-alive: 48 hours');
      expect(output).toContain('Idle timeout: 1000 minutes');
      expect(output).toContain('Machine: premiumLinux');
      expect(output).toContain('Retention: 7 days');
    });
  });

  describe('E2E Workflow: Multiple Sequential Operations', () => {
    it('should handle deploy → status → stop sequence', async () => {
      // Deploy - note that handleDeploy doesn't return the deployment in non-JSON mode
      await handleDeploy(ctx, {});
      
      // Verify deployment was called
      expect(mockProvider.deploy).toHaveBeenCalled();
      
      consoleLogSpy.mockClear();

      // Check status
      mockProvider.list.mockResolvedValueOnce([
        {
          id: 'test-codespace-abc123',
          name: 'test-workspace',
          status: 'running',
          git: { owner: 'test-user', repo: 'test-repo', branch: 'main' },
        },
      ]);

      await handleDeployStatus(ctx, 'test-codespace-abc123');
      expect(mockProvider.getStatus).toHaveBeenCalledWith('test-codespace-abc123');
      
      consoleLogSpy.mockClear();

      // Stop
      await handleDeployStop(ctx, 'test-codespace-abc123', { force: true });
      expect(mockProvider.stop).toHaveBeenCalledWith('test-codespace-abc123');
    });

    it('should handle config update → deploy → list sequence', async () => {
      // Update config
      await handleDeployConfig(ctx, {
        port: '7000',
        machine: 'standardLinux',
      });

      consoleLogSpy.mockClear();

      // Deploy with config
      await handleDeploy(ctx, {});
      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          server: expect.objectContaining({
            port: 7000,
          }),
          providerOptions: expect.objectContaining({
            machine: 'standardLinux',
          }),
        })
      );

      consoleLogSpy.mockClear();

      // List deployments
      await handleDeployList(ctx);
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Active Deployments');
    });
  });
});
