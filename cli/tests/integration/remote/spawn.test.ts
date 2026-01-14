/**
 * Integration tests for SpawnOrchestrator
 * 
 * Tests the full deployment workflow with mocked dependencies
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpawnOrchestrator } from '../../../src/remote/orchestrator.js';
import type { DeploymentInfo } from '../../../src/remote/types.js';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock sudopod
vi.mock('sudopod', () => ({
  createProvider: vi.fn(),
}));

describe('SpawnOrchestrator Integration', () => {
  let tempDir: string;
  let orchestrator: SpawnOrchestrator;
  let execSyncMock: any;
  let createProviderMock: any;

  beforeEach(async () => {
    // Create temporary directory for test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-test-'));
    const sudocodeDir = path.join(tempDir, '.sudocode');
    fs.mkdirSync(sudocodeDir, { recursive: true });

    // Initialize git repository for context detection
    const { execSync } = await import('child_process');
    execSyncMock = execSync as any;
    
    // Setup default git mocks
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'gh auth status') {
        return ''; // Authenticated
      }
      if (cmd === 'git rev-parse --git-dir') {
        return '.git';
      }
      if (cmd === 'git rev-parse --abbrev-ref HEAD') {
        return 'main';
      }
      if (cmd === 'git remote get-url origin') {
        return 'https://github.com/owner/repo.git';
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    // Setup sudopod mock
    const sudopod = await import('sudopod');
    createProviderMock = sudopod.createProvider as any;
    
    const mockProvider = {
      deploy: vi.fn(),
      list: vi.fn(),
      getStatus: vi.fn(),
      stop: vi.fn(),
    };
    
    createProviderMock.mockReturnValue(mockProvider);

    // Setup Claude auth mock - create credentials directory and file
    const credsDir = path.join(os.homedir(), '.sudocode', 'credentials');
    fs.mkdirSync(credsDir, { recursive: true });
    const credsFile = path.join(credsDir, 'claude.json');
    fs.writeFileSync(credsFile, JSON.stringify({ 
      accessToken: 'test-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    }));

    orchestrator = new SpawnOrchestrator(sudocodeDir);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    // Cleanup credentials
    const credsFile = path.join(os.homedir(), '.sudocode', 'credentials', 'claude.json');
    if (fs.existsSync(credsFile)) {
      fs.unlinkSync(credsFile);
    }

    vi.clearAllMocks();
  });

  describe('deploy()', () => {
    it('should orchestrate full deployment workflow', async () => {
      const mockDeployment: DeploymentInfo = {
        id: 'codespace-abc123',
        name: 'codespace-abc123',
        provider: 'codespaces',
        git: {
          owner: 'owner',
          repo: 'repo',
          branch: 'main',
        },
        status: 'running',
        createdAt: new Date().toISOString(),
        urls: {
          workspace: 'https://codespace-abc123.github.dev',
          sudocode: 'https://codespace-abc123-3000.app.github.dev',
          ssh: 'gh codespace ssh --codespace codespace-abc123',
        },
        keepAliveHours: 72,
        idleTimeout: 4320,
        machine: 'basicLinux32gb',
        retentionPeriod: 14,
      };

      const sudopod = await import('sudopod');
      const provider = createProviderMock();
      provider.deploy.mockResolvedValue(mockDeployment);

      const result = await orchestrator.deploy({});

      // Verify deployment was called with correct config
      expect(provider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: {
            owner: 'owner',
            repo: 'repo',
            branch: 'main',
          },
          server: {
            port: 3000,
            idleTimeout: 4320,
            keepAliveHours: 72,
          },
          providerOptions: {
            machine: 'basicLinux32gb',
            retentionPeriod: 14,
          },
          env: expect.objectContaining({
            CLAUDE_TOKEN: expect.any(String),
          }),
        })
      );

      expect(result).toEqual(mockDeployment);
    });

    it('should merge CLI options with config', async () => {
      const mockDeployment: DeploymentInfo = {
        id: 'codespace-xyz789',
        name: 'codespace-xyz789',
        provider: 'codespaces',
        git: {
          owner: 'owner',
          repo: 'repo',
          branch: 'feature-x',
        },
        status: 'running',
        createdAt: new Date().toISOString(),
        urls: {
          workspace: 'https://codespace-xyz789.github.dev',
          sudocode: 'https://codespace-xyz789-3001.app.github.dev',
          ssh: 'gh codespace ssh --codespace codespace-xyz789',
        },
        keepAliveHours: 24,
        idleTimeout: 60,
        machine: 'premiumLinux',
        retentionPeriod: 7,
      };

      const provider = createProviderMock();
      provider.deploy.mockResolvedValue(mockDeployment);

      await orchestrator.deploy({
        branch: 'feature-x',
        port: 3001,
        machine: 'premiumLinux',
        idleTimeout: 60,
        keepAliveHours: 24,
        retentionPeriod: 7,
      });

      expect(provider.deploy).toHaveBeenCalledWith(
        expect.objectContaining({
          git: expect.objectContaining({
            branch: 'feature-x',
          }),
          server: {
            port: 3001,
            idleTimeout: 60,
            keepAliveHours: 24,
          },
          providerOptions: {
            machine: 'premiumLinux',
            retentionPeriod: 7,
          },
        })
      );
    });

    it('should throw error if GitHub CLI not authenticated', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'gh auth status') {
          throw new Error('Not authenticated');
        }
        if (cmd === 'git rev-parse --git-dir') {
          return '.git';
        }
        if (cmd === 'git rev-parse --abbrev-ref HEAD') {
          return 'main';
        }
        if (cmd === 'git remote get-url origin') {
          return 'https://github.com/owner/repo.git';
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      await expect(orchestrator.deploy({})).rejects.toThrow(
        'GitHub CLI is not authenticated'
      );
    });

    it('should throw error if not in git repository', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'gh auth status') {
          return ''; // Authenticated
        }
        if (cmd === 'git rev-parse --git-dir') {
          throw new Error('Not a git repository');
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      await expect(orchestrator.deploy({})).rejects.toThrow(
        'Not in a git repository'
      );
    });

    it('should handle deployment errors gracefully', async () => {
      const provider = createProviderMock();
      provider.deploy.mockRejectedValue(
        new Error('Deployment failed: insufficient quota')
      );

      await expect(orchestrator.deploy({})).rejects.toThrow(
        'Deployment failed: insufficient quota'
      );
    });
  });

  describe('list()', () => {
    it('should list all deployments', async () => {
      const mockDeployments: DeploymentInfo[] = [
        {
          id: 'codespace-1',
          name: 'codespace-1',
          provider: 'codespaces',
          git: { owner: 'owner', repo: 'repo', branch: 'main' },
          status: 'running',
          createdAt: new Date().toISOString(),
          urls: {
            workspace: 'https://codespace-1.github.dev',
            sudocode: 'https://codespace-1-3000.app.github.dev',
            ssh: 'gh codespace ssh --codespace codespace-1',
          },
          keepAliveHours: 72,
          idleTimeout: 4320,
        },
        {
          id: 'codespace-2',
          name: 'codespace-2',
          provider: 'codespaces',
          git: { owner: 'owner', repo: 'repo', branch: 'feature-x' },
          status: 'stopped',
          createdAt: new Date().toISOString(),
          urls: {
            workspace: 'https://codespace-2.github.dev',
            sudocode: 'https://codespace-2-3000.app.github.dev',
            ssh: 'gh codespace ssh --codespace codespace-2',
          },
          keepAliveHours: 72,
          idleTimeout: 4320,
        },
      ];

      const provider = createProviderMock();
      provider.list.mockResolvedValue(mockDeployments);

      const result = await orchestrator.list('codespaces');

      expect(result).toEqual(mockDeployments);
      expect(provider.list).toHaveBeenCalled();
    });
  });

  describe('status()', () => {
    it('should get deployment status', async () => {
      const mockDeployment: DeploymentInfo = {
        id: 'codespace-abc123',
        name: 'codespace-abc123',
        provider: 'codespaces',
        git: { owner: 'owner', repo: 'repo', branch: 'main' },
        status: 'running',
        createdAt: new Date().toISOString(),
        urls: {
          workspace: 'https://codespace-abc123.github.dev',
          sudocode: 'https://codespace-abc123-3000.app.github.dev',
          ssh: 'gh codespace ssh --codespace codespace-abc123',
        },
        keepAliveHours: 72,
        idleTimeout: 4320,
        machine: 'basicLinux32gb',
        retentionPeriod: 14,
      };

      const provider = createProviderMock();
      provider.getStatus.mockResolvedValue(mockDeployment);

      const result = await orchestrator.status('codespaces', 'codespace-abc123');

      expect(result).toEqual(mockDeployment);
      expect(provider.getStatus).toHaveBeenCalledWith('codespace-abc123');
    });

    it('should throw error if deployment not found', async () => {
      const provider = createProviderMock();
      provider.getStatus.mockRejectedValue(
        new Error('Deployment not found: codespace-invalid')
      );

      await expect(
        orchestrator.status('codespaces', 'codespace-invalid')
      ).rejects.toThrow('Deployment not found');
    });
  });

  describe('stop()', () => {
    it('should stop deployment', async () => {
      const provider = createProviderMock();
      provider.stop.mockResolvedValue(undefined);

      await orchestrator.stop('codespaces', 'codespace-abc123');

      expect(provider.stop).toHaveBeenCalledWith('codespace-abc123');
    });

    it('should throw error if deployment not found', async () => {
      const provider = createProviderMock();
      provider.stop.mockRejectedValue(
        new Error('Deployment not found: codespace-invalid')
      );

      await expect(
        orchestrator.stop('codespaces', 'codespace-invalid')
      ).rejects.toThrow('Deployment not found');
    });
  });
});
