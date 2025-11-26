/**
 * Tests for AgentConfigUtils
 */

import { describe, it, expect } from 'vitest';
import { AgentConfigUtils } from '../../../../../src/execution/adapters/shared/config-utils.js';
import type { BaseAgentConfig } from '@sudocode-ai/types/agents';

describe('AgentConfigUtils', () => {
  describe('validateBaseConfig', () => {
    it('should return no errors for valid config', () => {
      const config: BaseAgentConfig = {
        workDir: '/path/to/project',
      };

      const errors = AgentConfigUtils.validateBaseConfig(config);
      expect(errors).toEqual([]);
    });

    it('should return error when workDir is missing', () => {
      const config = {} as BaseAgentConfig;

      const errors = AgentConfigUtils.validateBaseConfig(config);
      expect(errors).toContain('workDir is required');
    });

    it('should return error when timeout is negative', () => {
      const config: BaseAgentConfig = {
        workDir: '/path/to/project',
        timeout: -100,
      };

      const errors = AgentConfigUtils.validateBaseConfig(config);
      expect(errors).toContain('timeout must be a positive number');
    });
  });

  describe('withDefaults', () => {
    it('should merge config with defaults', () => {
      const config = {
        workDir: '/path/to/project',
        timeout: 5000,
      } as BaseAgentConfig;

      const defaults = {
        timeout: 10000,
        env: { NODE_ENV: 'test' },
      };

      const result = AgentConfigUtils.withDefaults(config, defaults);

      expect(result).toEqual({
        workDir: '/path/to/project',
        timeout: 5000, // User value takes precedence
        env: { NODE_ENV: 'test' },
      });
    });
  });

  describe('buildBaseProcessConfig', () => {
    it('should build ProcessConfig with required fields', () => {
      const config: BaseAgentConfig = {
        workDir: '/path/to/project',
        env: { FOO: 'bar' },
        timeout: 5000,
      };

      const result = AgentConfigUtils.buildBaseProcessConfig(
        'test-executable',
        ['--arg1', '--arg2'],
        config
      );

      expect(result).toEqual({
        executablePath: 'test-executable',
        args: ['--arg1', '--arg2'],
        workDir: '/path/to/project',
        env: { FOO: 'bar' },
        timeout: 5000,
        idleTimeout: undefined,
        retry: undefined,
      });
    });
  });

  describe('validateTimeouts', () => {
    it('should return no errors for valid timeouts', () => {
      const errors = AgentConfigUtils.validateTimeouts(10000, 5000);
      expect(errors).toEqual([]);
    });

    it('should return error when timeout is negative', () => {
      const errors = AgentConfigUtils.validateTimeouts(-100, 5000);
      expect(errors).toContain('timeout must be a positive number');
    });

    it('should return error when idleTimeout is negative', () => {
      const errors = AgentConfigUtils.validateTimeouts(10000, -100);
      expect(errors).toContain('idleTimeout must be a positive number');
    });

    it('should return error when idleTimeout > timeout', () => {
      const errors = AgentConfigUtils.validateTimeouts(5000, 10000);
      expect(errors).toContain('idleTimeout cannot be greater than timeout');
    });
  });

  describe('validateRetryConfig', () => {
    it('should return no errors for valid retry config', () => {
      const errors = AgentConfigUtils.validateRetryConfig({
        maxAttempts: 3,
        backoffMs: 1000,
      });
      expect(errors).toEqual([]);
    });

    it('should return error when maxAttempts is negative', () => {
      const errors = AgentConfigUtils.validateRetryConfig({
        maxAttempts: -1,
        backoffMs: 1000,
      });
      expect(errors).toContain('retry.maxAttempts must be non-negative');
    });

    it('should return error when backoffMs is negative', () => {
      const errors = AgentConfigUtils.validateRetryConfig({
        maxAttempts: 3,
        backoffMs: -100,
      });
      expect(errors).toContain('retry.backoffMs must be non-negative');
    });

    it('should return no errors when retry is undefined', () => {
      const errors = AgentConfigUtils.validateRetryConfig(undefined);
      expect(errors).toEqual([]);
    });
  });

  describe('validatePaths', () => {
    it('should return no errors for valid paths', () => {
      const errors = AgentConfigUtils.validatePaths(
        ['/path/one', '/path/two'],
        'testField'
      );
      expect(errors).toEqual([]);
    });

    it('should return error for empty path', () => {
      const errors = AgentConfigUtils.validatePaths(
        ['/path/one', '', '/path/two'],
        'testField'
      );
      expect(errors).toContain('testField contains empty path');
    });

    it('should return no errors for undefined paths', () => {
      const errors = AgentConfigUtils.validatePaths(undefined, 'testField');
      expect(errors).toEqual([]);
    });

    it('should return no errors for empty array', () => {
      const errors = AgentConfigUtils.validatePaths([], 'testField');
      expect(errors).toEqual([]);
    });
  });

  describe('validateEnum', () => {
    it('should return no errors for valid enum value', () => {
      const errors = AgentConfigUtils.validateEnum(
        'option1',
        ['option1', 'option2', 'option3'] as const,
        'testField'
      );
      expect(errors).toEqual([]);
    });

    it('should return error for invalid enum value', () => {
      const errors = AgentConfigUtils.validateEnum(
        'invalid',
        ['option1', 'option2', 'option3'] as const,
        'testField'
      );
      expect(errors).toContain(
        'testField must be one of: option1, option2, option3'
      );
    });

    it('should return no errors when value is undefined', () => {
      const errors = AgentConfigUtils.validateEnum(
        undefined,
        ['option1', 'option2'] as const,
        'testField'
      );
      expect(errors).toEqual([]);
    });
  });

  describe('buildConditionalArgs', () => {
    it('should build args for true conditions', () => {
      const args = AgentConfigUtils.buildConditionalArgs([
        { flag: '--flag1', condition: true },
        { flag: '--flag2', condition: false },
        { flag: '--flag3', value: 'value3', condition: true },
      ]);

      expect(args).toEqual(['--flag1', '--flag3', 'value3']);
    });

    it('should handle empty flags array', () => {
      const args = AgentConfigUtils.buildConditionalArgs([]);
      expect(args).toEqual([]);
    });

    it('should handle all false conditions', () => {
      const args = AgentConfigUtils.buildConditionalArgs([
        { flag: '--flag1', condition: false },
        { flag: '--flag2', condition: false },
      ]);

      expect(args).toEqual([]);
    });
  });
});
