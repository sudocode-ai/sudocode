/**
 * Integration tests for deployment workflow
 * 
 * Tests the complete deployment flow including:
 * - Git context detection
 * - Configuration loading and merging
 * - Authentication checks (GitHub, Claude)
 * - Provider deployment execution
 * - Lifecycle commands (list, status, stop)
 * - Error handling scenarios
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
import type { DeployConfig } from '@sudocode-ai/types';

// Mock dependencies
vi.mock('child_process');
vi.mock('sudopod');
vi.mock('../../src/deploy/claude-auth.js');

// Import mocked modules
import * as sudopod from 'sudopod';
import { ClaudeAuthIntegration } from '../../src/deploy/claude-auth.js';

interface CommandContext {
  db: Database.Database;
  outputDir: string;
  jsonOutput: boolean;
}

describe('Deploy Integration Tests', () => {
  let tmpDir: string;
  let db: Database.Database;
  let ctx: CommandContext;
  let mockProvider: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Create temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-integration-'));
    
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

    // Setup mock provider
    mockProvider = {
      type: 'codespaces',
      deploy: vi.fn().mockResolvedValue({
        id: 'test-codespace-123',
        name: 'test-codespace',
        status: 'running',
        git: {
          owner: 'test-owner',
          repo: 'test-repo',
          branch: 'main',
        },
        urls: {
          web: 'https://test-codespace-123.github.dev',
          sudocode: 'https://test-codespace-123.github.dev:3000',
          ssh: 'ssh://git@github.com/codespaces/test-codespace-123',
        },
        createdAt: '2025-01-12T00:00:00Z',
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
          id: 'cs-1',
          name: 'test-deployment-1',
          status: 'running',
          git: {
            owner: 'owner1',
            repo: 'repo1',
            branch: 'main',
          },
        },
        {
          id: 'cs-2',
          name: 'test-deployment-2',
          status: 'stopped',
          git: {
            owner: 'owner2',
            repo: 'repo2',
            branch: 'develop',
          },
        },
      ]),
      getStatus: vi.fn().mockResolvedValue('running'),
      getUrls: vi.fn().mockResolvedValue({
        web: 'https://test-codespace-123.github.dev',
        sudocode: 'https://test-codespace-123.github.dev:3000',
        ssh: 'ssh://git@github.com/codespaces/test-codespace-123',
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(sudopod.createProvider).mockReturnValue(mockProvider);

    // Mock Claude authentication
    vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockResolvedValue(undefined);
    vi.mocked(ClaudeAuthIntegration.getToken).mockResolvedValue('mock-claude-token-abc123');

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
      
      // Git checks - these use encoding: 'utf-8'
      if (cmd.includes('git rev-parse --git-dir')) {
        return hasEncoding ? '.git\n' : Buffer.from('.git\n');
      }
      if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
        return hasEncoding ? 'main\n' : Buffer.from('main\n');
      }
      if (cmd.includes('git config --get remote.origin.url')) {
        return hasEncoding ? 'https://github.com/test-owner/test-repo.git\n' : Buffer.from('https://github.com/test-owner/test-repo.git\n');
      }
      
      throw new Error(`Unexpected command: ${cmd}`);
    }) as any;

    // Create default config file
    const defaultConfig: DeployConfig = {
      provider: 'codespaces',
      port: 3000,
      idleTimeout: 4320,
      keepAliveHours: 72,
      retentionPeriod: 14,
      machine: 'basicLinux32gb',
    };
    fs.writeFileSync(
      path.join(tmpDir, 'deploy-config.json'),
      JSON.stringify(defaultConfig, null, 2)
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    
    if (db) {
      db.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    
    vi.clearAllMocks();
  });

  describe('Happy Path - Full Deployment Flow', () => {
    it('should successfully deploy with default configuration', async () => {
      await handleDeploy(ctx, {});

      // Verify authentication checks
      expect(execSync).toHaveBeenCalledWith('which gh', { stdio: 'pipe' });
      expect(execSync).toHaveBeenCalledWith('gh auth status', { stdio: 'pipe' });
      expect(ClaudeAuthIntegration.ensureAuthenticated).toHaveBeenCalledWith({ silent: true });
      expect(ClaudeAuthIntegration.getToken).toHaveBeenCalled();

      // Verify git context detection
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git rev-parse --git-dir'),
        expect.any(Object)
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git config --get remote.origin.url'),
        expect.any(Object)
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git rev-parse --abbrev-ref HEAD'),
        expect.any(Object)
      );

      // Verify provider was called with correct options
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
          claudeLtt: 'mock-claude-token-abc123',
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

      // Verify success output
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deployment successful')
      );
    });

    it('should deploy with CLI options overriding config', async () => {
      await handleDeploy(ctx, {
        repo: 'custom-owner/custom-repo',
        branch: 'feature-branch',
        port: 8080,
        machine: 'premiumLinux',
        idleTimeout: 1000,
        keepAliveHours: 48,
        retentionPeriod: 7,
        dev: true,
      });

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: {
            owner: 'custom-owner',
            repo: 'custom-repo',
            branch: 'feature-branch',
          },
          dev: true,
          sudocode: {
            mode: 'local',
            version: 'latest',
          },
          server: {
            port: 8080,
            keepAliveHours: 48,
            idleTimeout: 1000,
          },
          providerOptions: {
            machine: 'premiumLinux',
            retentionPeriod: 7,
          },
        })
      );
    });

    it('should output JSON when jsonOutput is true', async () => {
      ctx.jsonOutput = true;

      await handleDeploy(ctx, {});

      // Verify JSON output
      const jsonCalls = consoleLogSpy.mock.calls.filter((call: any[]) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCalls.length).toBeGreaterThan(0);
      
      const lastJsonCall = jsonCalls[jsonCalls.length - 1];
      const output = JSON.parse(lastJsonCall[0]);
      expect(output.id).toBe('test-codespace-123');
      expect(output.status).toBe('running');
      expect(output.urls).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    describe('Git Context Errors', () => {
      it('should fail when not in a git repository', async () => {
        vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
          const cmd = command.toString();
          const hasEncoding = options && options.encoding;
          
          // GitHub CLI checks still pass
          if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
          if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
          
          // Git checks fail
          if (cmd.includes('git rev-parse --git-dir')) {
            throw new Error('fatal: not a git repository');
          }
          
          throw new Error(`Unexpected command: ${cmd}`);
        }) as any;

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Git repository not found')
        );
      });

      it('should fail when no GitHub remote is configured', async () => {
        vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
          const cmd = command.toString();
          const hasEncoding = options && options.encoding;
          
          if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
          if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
          if (cmd.includes('git rev-parse --git-dir')) return hasEncoding ? '.git\n' : Buffer.from('.git\n');
          if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return hasEncoding ? 'main\n' : Buffer.from('main\n');
          
          // No remote configured
          if (cmd.includes('git config --get remote.origin.url')) {
            throw new Error('');
          }
          
          throw new Error(`Unexpected command: ${cmd}`);
        }) as any;

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Git repository not found')
        );
      });

      it('should fail when remote is not a GitHub URL', async () => {
        vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
          const cmd = command.toString();
          const hasEncoding = options && options.encoding;
          
          if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
          if (cmd === 'gh auth status') return hasEncoding ? 'Logged in' : Buffer.from('Logged in');
          if (cmd.includes('git rev-parse --git-dir')) return hasEncoding ? '.git\n' : Buffer.from('.git\n');
          if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return hasEncoding ? 'main\n' : Buffer.from('main\n');
          
          // Non-GitHub remote
          if (cmd.includes('git config --get remote.origin.url')) {
            return hasEncoding ? 'https://gitlab.com/owner/repo.git\n' : Buffer.from('https://gitlab.com/owner/repo.git\n');
          }
          
          throw new Error(`Unexpected command: ${cmd}`);
        }) as any;

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('GitHub remote not configured')
        );
      });
    });

    describe('Authentication Errors', () => {
      it('should fail when GitHub CLI is not installed', async () => {
        vi.mocked(execSync).mockImplementation((command: any) => {
          const cmd = command.toString();
          
          if (cmd === 'which gh') {
            throw new Error('gh: command not found');
          }
          
          throw new Error(`Unexpected command: ${cmd}`);
        });

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('GitHub CLI is not authenticated')
        );
      });

      it('should fail when GitHub CLI is not authenticated', async () => {
        vi.mocked(execSync).mockImplementation((command: any, options?: any) => {
          const cmd = command.toString();
          const hasEncoding = options && options.encoding;
          
          if (cmd === 'which gh') return hasEncoding ? '/usr/local/bin/gh' : Buffer.from('/usr/local/bin/gh');
          
          if (cmd === 'gh auth status') {
            throw new Error('not logged in');
          }
          
          throw new Error(`Unexpected command: ${cmd}`);
        }) as any;

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('GitHub CLI is not authenticated')
        );
      });

      it('should fail when Claude authentication fails', async () => {
        vi.mocked(ClaudeAuthIntegration.ensureAuthenticated).mockRejectedValue(
          new Error('Claude authentication failed: Invalid credentials')
        );

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Claude authentication failed')
        );
      });

      it('should fail when Claude token is not available', async () => {
        vi.mocked(ClaudeAuthIntegration.getToken).mockResolvedValue(null);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
          throw new Error(`process.exit(${code})`);
        });

        try {
          await handleDeploy(ctx, {});
          expect.fail('Should have called process.exit');
        } catch (error: any) {
          expect(error.message).toContain('process.exit(1)');
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Claude authentication failed - no token available')
        );

        exitSpy.mockRestore();
      });
    });

    describe('Deployment Failures', () => {
      it('should handle provider deployment failure', async () => {
        mockProvider.deploy.mockRejectedValue(
          new Error('Deployment failed: quota exceeded')
        );

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
          throw new Error(`process.exit(${code})`);
        });

        try {
          await handleDeploy(ctx, {});
          expect.fail('Should have called process.exit');
        } catch (error: any) {
          expect(error.message).toContain('process.exit(1)');
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Deployment failed: quota exceeded')
        );

        exitSpy.mockRestore();
      });

      it('should handle network errors during deployment', async () => {
        const networkError = new Error('Network error');
        (networkError as any).code = 'ECONNREFUSED';
        mockProvider.deploy.mockRejectedValue(networkError);

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Network')
        );
      });

      it('should handle port conflict errors', async () => {
        mockProvider.deploy.mockRejectedValue(
          new Error('Deployment failed: port 3000 is already in use')
        );

        await expect(handleDeploy(ctx, {})).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('port')
        );
      });
    });
  });

  describe('Configuration Management', () => {
    it('should display current configuration', async () => {
      await handleDeployConfig(ctx, {});

      const output = consoleLogSpy.mock.calls
        .map((call: any[]) => call[0])
        .join('\n');

      expect(output).toContain('codespaces');
      expect(output).toContain('3000');
      expect(output).toContain('basicLinux32gb');
    });

    it('should update configuration values', async () => {
      await handleDeployConfig(ctx, {
        port: '8080',
        machine: 'premiumLinux',
        idleTimeout: '1000',
      });

      // Verify config file was updated
      const configPath = path.join(tmpDir, 'deploy-config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      expect(config.port).toBe(8080);
      expect(config.machine).toBe('premiumLinux');
      expect(config.idleTimeout).toBe(1000);

      // Original values should be preserved
      expect(config.keepAliveHours).toBe(72);
      expect(config.retentionPeriod).toBe(14);
    });

    it('should reset configuration to defaults', async () => {
      // First, modify the config
      await handleDeployConfig(ctx, {
        port: '8080',
        machine: 'premiumLinux',
      });

      // Then reset
      await handleDeployConfig(ctx, { reset: true });

      // Verify defaults are restored
      const configPath = path.join(tmpDir, 'deploy-config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      expect(config.port).toBe(3000);
      expect(config.machine).toBe('basicLinux32gb');
    });

    it('should reject invalid port values', async () => {
      await expect(
        handleDeployConfig(ctx, { port: '99999' })
      ).rejects.toThrow();

      await expect(
        handleDeployConfig(ctx, { port: 'invalid' })
      ).rejects.toThrow();
    });

    it('should prevent combining --reset with other options', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`process.exit(${code})`);
      });

      try {
        await handleDeployConfig(ctx, {
          reset: true,
          port: '8080',
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('process.exit');
      }

      exitSpy.mockRestore();
    });
  });

  describe('Lifecycle Commands', () => {
    describe('list', () => {
      it('should list all active deployments', async () => {
        await handleDeployList(ctx);

        expect(mockProvider.list).toHaveBeenCalled();

        const output = consoleLogSpy.mock.calls
          .map((call: any[]) => call[0])
          .join('\n');

        expect(output).toContain('Active Deployments');
        expect(output).toContain('test-deployment-1');
        expect(output).toContain('test-deployment-2');
        expect(output).toContain('owner1/repo1');
        expect(output).toContain('owner2/repo2');
      });

      it('should show empty state when no deployments exist', async () => {
        mockProvider.list.mockResolvedValue([]);

        await handleDeployList(ctx);

        const output = consoleLogSpy.mock.calls
          .map((call: any[]) => call[0])
          .join('\n');

        expect(output).toContain('No active deployments found');
      });

      it('should output JSON when jsonOutput is true', async () => {
        ctx.jsonOutput = true;

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

      it('should handle network errors during list', async () => {
        const networkError = new Error('Network error');
        (networkError as any).code = 'ETIMEDOUT';
        mockProvider.list.mockRejectedValue(networkError);

        await expect(handleDeployList(ctx)).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalled();
      });
    });

    describe('status', () => {
      beforeEach(() => {
        // Setup mock to return full deployment info
        mockProvider.list.mockResolvedValue([
          {
            id: 'test-codespace-123',
            name: 'test-codespace',
            status: 'running',
            git: {
              owner: 'test-owner',
              repo: 'test-repo',
              branch: 'main',
            },
            createdAt: '2025-01-12T00:00:00Z',
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
      });

      it('should show detailed deployment status', async () => {
        await handleDeployStatus(ctx, 'test-codespace-123');

        expect(mockProvider.getStatus).toHaveBeenCalledWith('test-codespace-123');
        expect(mockProvider.getUrls).toHaveBeenCalledWith('test-codespace-123');
        expect(mockProvider.list).toHaveBeenCalled();

        const output = consoleLogSpy.mock.calls
          .map((call: any[]) => call[0])
          .join('\n');

        expect(output).toContain('test-codespace');
        expect(output).toContain('running');
        expect(output).toContain('test-owner/test-repo');
        expect(output).toContain('main');
        expect(output).toContain('https://test-codespace-123.github.dev');
      });

      it('should fail when deployment ID is not provided', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
          throw new Error(`process.exit(${code})`);
        });

        try {
          await handleDeployStatus(ctx, '');
          expect.fail('Should have thrown');
        } catch (error: any) {
          expect(error.message).toContain('process.exit');
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Deployment ID is required')
        );

        exitSpy.mockRestore();
      });

      it('should handle deployment not found', async () => {
        mockProvider.list.mockResolvedValue([]);

        await expect(
          handleDeployStatus(ctx, 'nonexistent-deployment')
        ).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('not found')
        );
      });

      it('should output JSON when jsonOutput is true', async () => {
        ctx.jsonOutput = true;

        await handleDeployStatus(ctx, 'test-codespace-123');

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
        expect(output.id).toBe('test-codespace-123');
        expect(output.status).toBe('running');
      });
    });

    describe('stop', () => {
      it('should stop deployment with --force flag', async () => {
        await handleDeployStop(ctx, 'test-codespace-123', { force: true });

        expect(mockProvider.stop).toHaveBeenCalledWith('test-codespace-123');

        const output = consoleLogSpy.mock.calls
          .map((call: any[]) => call[0])
          .join('\n');

        expect(output).toContain('stopped successfully');
      });

      it('should fail when deployment ID is not provided', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
          throw new Error(`process.exit(${code})`);
        });

        try {
          await handleDeployStop(ctx, '', { force: true });
          expect.fail('Should have thrown');
        } catch (error: any) {
          expect(error.message).toContain('process.exit');
        }

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Deployment ID is required')
        );

        exitSpy.mockRestore();
      });

      it('should handle deployment not found', async () => {
        const notFoundError = new Error('Deployment not found');
        mockProvider.stop.mockRejectedValue(notFoundError);

        await expect(
          handleDeployStop(ctx, 'nonexistent-deployment', { force: true })
        ).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it('should output JSON when jsonOutput is true', async () => {
        ctx.jsonOutput = true;

        await handleDeployStop(ctx, 'test-codespace-123', { force: true });

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
        expect(output.success).toBe(true);
        expect(output.id).toBe('test-codespace-123');
      });

      it('should handle network errors during stop', async () => {
        const networkError = new Error('Network error');
        (networkError as any).code = 'ENOTFOUND';
        mockProvider.stop.mockRejectedValue(networkError);

        await expect(
          handleDeployStop(ctx, 'test-codespace-123', { force: true })
        ).rejects.toThrow();

        expect(consoleErrorSpy).toHaveBeenCalled();
      });
    });
  });

  describe('Provider Integration', () => {
    it('should create provider with codespaces type', async () => {
      await handleDeploy(ctx, {});

      expect(sudopod.createProvider).toHaveBeenCalledWith({ type: 'codespaces' });
    });

    it('should pass all configuration to provider', async () => {
      await handleDeploy(ctx, {
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

    it('should pass Claude token to provider', async () => {
      await handleDeploy(ctx, {});

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          models: {
            claudeLtt: 'mock-claude-token-abc123',
          },
        })
      );
    });

    it('should configure agents correctly', async () => {
      await handleDeploy(ctx, {});

      expect(mockProvider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: {
            install: ['claude'],
          },
        })
      );
    });

    it('should set dev mode correctly', async () => {
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
  });
});
