/**
 * Tests for Claude Code Configuration Builder
 */

import { describe, it, expect } from 'vitest';
import {
  buildClaudeConfig,
  buildClaudeArgs,
  validateClaudeConfig,
  getDefaultClaudeConfig,
} from '../../../../../src/execution/process/builders/claude.js';
import type { ClaudeCodeConfig } from '@sudocode-ai/types/agents';

describe('Claude Code Configuration Builder', () => {
  describe('buildClaudeArgs', () => {
    it('should build basic args with print and output format', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: true,
        outputFormat: 'stream-json',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--print');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose'); // Auto-added for stream-json + print
    });

    it('should add model flag when specified', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        model: 'sonnet',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
    });

    it('should add fallback model flag when specified', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        model: 'opus',
        fallbackModel: 'sonnet',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--model');
      expect(args).toContain('opus');
      expect(args).toContain('--fallback-model');
      expect(args).toContain('sonnet');
    });

    it('should add allowed tools', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        allowedTools: ['Bash(git:*)', 'Edit', 'Read'],
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--allowed-tools');
      expect(args).toContain('Bash(git:*)');
      expect(args).toContain('Edit');
      expect(args).toContain('Read');
    });

    it('should add disallowed tools', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        disallowedTools: ['Bash', 'Write'],
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--disallowed-tools');
      expect(args).toContain('Bash');
      expect(args).toContain('Write');
    });

    it('should add tools list', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        tools: ['default'],
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--tools');
      expect(args).toContain('default');
    });

    it('should add system prompt', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        systemPrompt: 'You are a helpful assistant',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--system-prompt');
      expect(args).toContain('You are a helpful assistant');
    });

    it('should add append system prompt', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        appendSystemPrompt: 'Always be concise',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('Always be concise');
    });

    it('should add multiple add-dir flags', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        addDir: ['/extra/dir1', '/extra/dir2'],
      };

      const args = buildClaudeArgs(config);

      // Check for multiple --add-dir entries
      const addDirIndices = args.reduce((acc: number[], arg, i) => {
        if (arg === '--add-dir') acc.push(i);
        return acc;
      }, []);

      expect(addDirIndices.length).toBe(2);
      expect(args[addDirIndices[0] + 1]).toBe('/extra/dir1');
      expect(args[addDirIndices[1] + 1]).toBe('/extra/dir2');
    });

    it('should add mcp config flags', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        mcpConfig: ['./mcp-servers.json', '{"server":"custom"}'],
        strictMcpConfig: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--mcp-config');
      expect(args).toContain('./mcp-servers.json');
      expect(args).toContain('{"server":"custom"}');
      expect(args).toContain('--strict-mcp-config');
    });

    it('should add permission flags', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        dangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--permission-mode');
      expect(args).toContain('bypassPermissions');
    });

    it('should add allow-dangerously-skip-permissions flag', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        allowDangerouslySkipPermissions: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--allow-dangerously-skip-permissions');
    });

    it('should add session management flags', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        continue: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--continue');
    });

    it('should add resume with session ID', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        resume: 'abc123',
        forkSession: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--resume');
      expect(args).toContain('abc123');
      expect(args).toContain('--fork-session');
    });

    it('should add session ID', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        sessionId: 'uuid-1234-5678',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--session-id');
      expect(args).toContain('uuid-1234-5678');
    });

    it('should add json schema', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: true,
        outputFormat: 'stream-json',
        jsonSchema: '{"type":"object"}',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--json-schema');
      expect(args).toContain('{"type":"object"}');
    });

    it('should add include-partial-messages flag', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: true,
        outputFormat: 'stream-json',
        includePartialMessages: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--include-partial-messages');
    });

    it('should add debug flag as boolean', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        debug: true,
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--debug');
      // Should not have a value after --debug when boolean
      const debugIndex = args.indexOf('--debug');
      expect(args[debugIndex + 1]).not.toBe('true');
    });

    it('should add debug flag with filter string', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        debug: 'api,hooks',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--debug');
      expect(args).toContain('api,hooks');
    });

    it('should add settings and setting-sources', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        settings: './custom-settings.json',
        settingSources: 'user,project',
      };

      const args = buildClaudeArgs(config);

      expect(args).toContain('--settings');
      expect(args).toContain('./custom-settings.json');
      expect(args).toContain('--setting-sources');
      expect(args).toContain('user,project');
    });

    it('should add prompt as last argument', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        model: 'sonnet',
        prompt: 'Hello, Claude!',
      };

      const args = buildClaudeArgs(config);

      // Prompt should be the last argument
      expect(args[args.length - 1]).toBe('Hello, Claude!');
    });
  });

  describe('buildClaudeConfig', () => {
    it('should build ProcessConfig with correct executable', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        claudePath: '/custom/path/claude',
      };

      const processConfig = buildClaudeConfig(config);

      expect(processConfig.executablePath).toBe('/custom/path/claude');
      expect(processConfig.workDir).toBe('/test');
    });

    it('should use default claude path when not specified', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
      };

      const processConfig = buildClaudeConfig(config);

      expect(processConfig.executablePath).toBe('claude');
    });
  });

  describe('validateClaudeConfig', () => {
    it('should return no errors for valid config', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: true,
        outputFormat: 'stream-json',
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toEqual([]);
    });

    it('should return error when workDir is missing', () => {
      const config = {} as ClaudeCodeConfig;

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('workDir is required');
    });

    it('should return error when stream-json without print', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: false,
        outputFormat: 'stream-json',
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('stream-json output format requires print mode to be enabled');
    });

    it('should return error when includePartialMessages without print', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        includePartialMessages: true,
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('includePartialMessages requires print mode to be enabled');
    });

    it('should return error when includePartialMessages without stream-json', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        print: true,
        outputFormat: 'json',
        includePartialMessages: true,
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('includePartialMessages requires outputFormat to be stream-json');
    });

    it('should return error for invalid permission mode', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        permissionMode: 'invalid' as any,
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain(
        'permissionMode must be one of: acceptEdits, bypassPermissions, default, dontAsk, plan'
      );
    });

    it('should return error when continue and resume both set', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        continue: true,
        resume: 'abc123',
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('Cannot use both continue and resume options');
    });

    it('should return error when sessionId with continue or resume', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        sessionId: 'uuid-1234',
        continue: true,
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('sessionId cannot be used with continue or resume');
    });

    it('should return error for empty path in addDir', () => {
      const config: ClaudeCodeConfig = {
        workDir: '/test',
        addDir: ['/valid/path', '', '/another/path'],
      };

      const errors = validateClaudeConfig(config);

      expect(errors).toContain('addDir contains empty path');
    });
  });

  describe('getDefaultClaudeConfig', () => {
    it('should return sensible defaults', () => {
      const defaults = getDefaultClaudeConfig();

      expect(defaults.claudePath).toBe('claude');
      expect(defaults.print).toBe(true);
      expect(defaults.outputFormat).toBe('stream-json');
      expect(defaults.verbose).toBe(true);
      expect(defaults.dangerouslySkipPermissions).toBe(false);
    });
  });
});
