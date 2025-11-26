/**
 * Copilot Adapter Tests
 *
 * Unit tests for the GitHub Copilot adapter implementation.
 */

import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from '../../../../src/execution/adapters/copilot-adapter.js';
import type { CopilotConfig } from '@sudocode-ai/types/agents';

describe('CopilotAdapter', () => {
  const adapter = new CopilotAdapter();

  describe('metadata', () => {
    it('should have correct agent metadata', () => {
      expect(adapter.metadata.name).toBe('copilot');
      expect(adapter.metadata.displayName).toBe('GitHub Copilot');
      expect(adapter.metadata.supportedModes).toContain('structured');
      expect(adapter.metadata.supportedModes).toContain('interactive');
      expect(adapter.metadata.supportsStreaming).toBe(true);
      expect(adapter.metadata.supportsStructuredOutput).toBe(true);
    });
  });

  describe('buildProcessConfig', () => {
    it('should build basic process config', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe('copilot');
      expect(processConfig.workDir).toBe('/test/project');
      expect(processConfig.args).toContain('--no-color');
      expect(processConfig.args).toContain('--log-level');
      expect(processConfig.args).toContain('debug');
    });

    it('should use custom copilot path', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        copilotPath: '/custom/path/to/copilot',
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.executablePath).toBe('/custom/path/to/copilot');
    });

    it('should add model flag when specified', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        model: 'gpt-4o',
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--model');
      expect(processConfig.args).toContain('gpt-4o');
    });

    it('should add allowAllTools flag', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        allowAllTools: true,
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--allow-all-tools');
    });

    it('should add allowTool flag', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        allowTool: 'bash,read_file',
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--allow-tool');
      expect(processConfig.args).toContain('bash,read_file');
    });

    it('should add denyTool flag', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        denyTool: 'bash',
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--deny-tool');
      expect(processConfig.args).toContain('bash');
    });

    it('should add multiple addDir flags', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        addDir: ['/path/to/lib1', '/path/to/lib2'],
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--add-dir');
      expect(processConfig.args).toContain('/path/to/lib1');
      expect(processConfig.args).toContain('/path/to/lib2');
    });

    it('should add multiple disableMcpServer flags', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        disableMcpServer: ['server1', 'server2'],
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.args).toContain('--disable-mcp-server');
      expect(processConfig.args).toContain('server1');
      expect(processConfig.args).toContain('server2');
    });

    it('should pass through environment variables', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        env: {
          CUSTOM_VAR: 'value',
        },
      };

      const processConfig = adapter.buildProcessConfig(config);

      expect(processConfig.env).toHaveProperty('CUSTOM_VAR', 'value');
    });
  });

  describe('validateConfig', () => {
    it('should validate a valid config', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        model: 'gpt-4o',
      };

      const errors = adapter.validateConfig(config);

      expect(errors).toHaveLength(0);
    });

    it('should require workDir', () => {
      const config = {} as CopilotConfig;

      const errors = adapter.validateConfig(config);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('workDir is required');
    });

    it('should warn when allowTool conflicts with allowAllTools', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        allowAllTools: true,
        allowTool: 'bash',
      };

      const errors = adapter.validateConfig(config);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('allowTool is ignored'))).toBe(true);
    });

    it('should warn when denyTool conflicts with allowAllTools', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        allowAllTools: true,
        denyTool: 'bash',
      };

      const errors = adapter.validateConfig(config);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('denyTool takes precedence'))).toBe(true);
    });

    it('should detect empty paths in addDir', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        addDir: ['', '/valid/path'],
      };

      const errors = adapter.validateConfig(config);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('addDir contains empty path'))).toBe(true);
    });

    it('should detect empty server names in disableMcpServer', () => {
      const config: CopilotConfig = {
        workDir: '/test/project',
        disableMcpServer: ['', 'valid-server'],
      };

      const errors = adapter.validateConfig(config);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('disableMcpServer contains empty server name'))).toBe(true);
    });

    it('should return multiple errors when multiple validations fail', () => {
      const config: CopilotConfig = {
        workDir: '',
        allowAllTools: true,
        allowTool: 'bash',
        addDir: [''],
      } as any;

      const errors = adapter.validateConfig(config);

      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const defaultConfig = adapter.getDefaultConfig();

      expect(defaultConfig.copilotPath).toBe('copilot');
      expect(defaultConfig.allowAllTools).toBe(true);
      expect(defaultConfig.model).toBeUndefined();
    });

    it('should have valid defaults that pass validation', () => {
      const defaultConfig = adapter.getDefaultConfig();
      const fullConfig: CopilotConfig = {
        workDir: '/test/project',
        ...defaultConfig,
      };

      const errors = adapter.validateConfig(fullConfig);

      expect(errors).toHaveLength(0);
    });
  });
});
