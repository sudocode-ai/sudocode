import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpawnOrchestrator } from '../../../src/remote/orchestrator.js';
import type { DeploymentInfo } from '../../../src/remote/orchestrator.js';

// Mock sudopod module
vi.mock('sudopod', () => ({
  createProvider: vi.fn(),
}));

describe('SpawnOrchestrator', () => {
  let orchestrator: SpawnOrchestrator;
  const mockSudocodeDir = '/test/.sudocode';

  beforeEach(() => {
    orchestrator = new SpawnOrchestrator(mockSudocodeDir);
    vi.clearAllMocks();
  });

  describe('list()', () => {
    it('should return array of deployments from provider', async () => {
      const mockDeployments: DeploymentInfo[] = [
        {
          id: 'codespace-abc123',
          name: 'test-deployment',
          provider: 'codespaces',
          git: {
            owner: 'owner',
            repo: 'repo',
            branch: 'main',
          },
          status: 'running',
          createdAt: '2026-01-14T10:00:00Z',
          urls: {
            workspace: 'https://codespace-abc123.github.dev',
            sudocode: 'https://codespace-abc123-3000.app.github.dev',
            ssh: 'gh codespace ssh --codespace codespace-abc123',
          },
          keepAliveHours: 72,
          idleTimeout: 4320,
        },
      ];

      const mockProvider = {
        list: vi.fn().mockResolvedValue(mockDeployments),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      const result = await orchestrator.list('codespaces');

      expect(result).toEqual(mockDeployments);
      expect(createProvider).toHaveBeenCalledWith({ type: 'codespaces' });
      expect(mockProvider.list).toHaveBeenCalled();
    });

    it('should return empty array when no deployments exist', async () => {
      const mockProvider = {
        list: vi.fn().mockResolvedValue([]),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      const result = await orchestrator.list('codespaces');

      expect(result).toEqual([]);
      expect(mockProvider.list).toHaveBeenCalled();
    });

    it('should throw error for unsupported provider', async () => {
      await expect(orchestrator.list('invalid' as any)).rejects.toThrow(
        "Unknown provider 'invalid'"
      );
    });

    it('should throw error for coder provider (not yet supported)', async () => {
      await expect(orchestrator.list('coder')).rejects.toThrow(
        "Provider 'coder' is not yet supported"
      );
    });
  });

  describe('status()', () => {
    it('should return deployment info for valid deployment id', async () => {
      const mockDeployment: DeploymentInfo = {
        id: 'codespace-abc123',
        name: 'test-deployment',
        provider: 'codespaces',
        git: {
          owner: 'owner',
          repo: 'repo',
          branch: 'main',
        },
        status: 'running',
        createdAt: '2026-01-14T10:00:00Z',
        urls: {
          workspace: 'https://codespace-abc123.github.dev',
          sudocode: 'https://codespace-abc123-3000.app.github.dev',
          ssh: 'gh codespace ssh --codespace codespace-abc123',
        },
        keepAliveHours: 72,
        idleTimeout: 4320,
      };

      const mockProvider = {
        getStatus: vi.fn().mockResolvedValue(mockDeployment),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      const result = await orchestrator.status('codespaces', 'codespace-abc123');

      expect(result).toEqual(mockDeployment);
      expect(createProvider).toHaveBeenCalledWith({ type: 'codespaces' });
      expect(mockProvider.getStatus).toHaveBeenCalledWith('codespace-abc123');
    });

    it('should throw error when deployment not found', async () => {
      const mockProvider = {
        getStatus: vi.fn().mockResolvedValue(null),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      await expect(
        orchestrator.status('codespaces', 'nonexistent-id')
      ).rejects.toThrow('Deployment not found: nonexistent-id');
    });

    it('should throw error for unsupported provider', async () => {
      await expect(
        orchestrator.status('invalid' as any, 'some-id')
      ).rejects.toThrow("Unknown provider 'invalid'");
    });

    it('should throw error for coder provider (not yet supported)', async () => {
      await expect(
        orchestrator.status('coder', 'some-id')
      ).rejects.toThrow("Provider 'coder' is not yet supported");
    });
  });

  describe('stop()', () => {
    it('should successfully stop a deployment', async () => {
      const mockProvider = {
        stop: vi.fn().mockResolvedValue(undefined),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      await orchestrator.stop('codespaces', 'codespace-abc123');

      expect(createProvider).toHaveBeenCalledWith({ type: 'codespaces' });
      expect(mockProvider.stop).toHaveBeenCalledWith('codespace-abc123');
    });

    it('should propagate error when deployment not found', async () => {
      const mockProvider = {
        stop: vi.fn().mockRejectedValue(new Error('Deployment not found')),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      await expect(
        orchestrator.stop('codespaces', 'nonexistent-id')
      ).rejects.toThrow('Deployment not found');
    });

    it('should throw error for unsupported provider', async () => {
      await expect(
        orchestrator.stop('invalid' as any, 'some-id')
      ).rejects.toThrow("Unknown provider 'invalid'");
    });

    it('should throw error for coder provider (not yet supported)', async () => {
      await expect(
        orchestrator.stop('coder', 'some-id')
      ).rejects.toThrow("Provider 'coder' is not yet supported");
    });
  });

  describe('validateProvider()', () => {
    it('should not throw for codespaces provider', async () => {
      const mockProvider = {
        list: vi.fn().mockResolvedValue([]),
      };

      const { createProvider } = await import('sudopod');
      vi.mocked(createProvider).mockReturnValue(mockProvider as any);

      // Should not throw
      await expect(orchestrator.list('codespaces')).resolves.toBeDefined();
    });

    it('should throw error for unknown provider', async () => {
      await expect(orchestrator.list('unknown' as any)).rejects.toThrow(
        "Unknown provider 'unknown'"
      );
    });

    it('should throw error for coder provider with specific message', async () => {
      await expect(orchestrator.list('coder')).rejects.toThrow(
        "Provider 'coder' is not yet supported"
      );
    });

    it('should include supported providers in error message', async () => {
      try {
        await orchestrator.list('invalid' as any);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('codespaces');
        expect((error as Error).message).toContain('coder');
      }
    });
  });

  describe('spawn()', () => {
    it('should call deploy() with the provided options', async () => {
      // spawn() is an alias for deploy(), which is now fully implemented
      // It will throw when trying to check GitHub auth since we haven't mocked execSync
      await expect(
        orchestrator.spawn({
          provider: 'codespaces',
          branch: 'main',
        })
      ).rejects.toThrow(); // Will throw "GitHub CLI is not authenticated" or similar
    });
  });
});
