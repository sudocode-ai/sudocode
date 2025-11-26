/**
 * Tests for Configuration Presets
 */

import { describe, it, expect } from 'vitest';
import {
  applyCursorPreset,
  applyCopilotPreset,
  applyCodexPreset,
  applyClaudeCodePreset,
  getRecommendedTimeouts,
  getRecommendedRetry,
} from '../../../../../src/execution/adapters/shared/config-presets.js';
import type {
  CursorConfig,
  CopilotConfig,
  CodexConfig,
  ClaudeCodeConfig,
} from '@sudocode-ai/types/agents';

describe('Configuration Presets', () => {
  describe('applyCursorPreset', () => {
    const baseConfig: CursorConfig = {
      workDir: '/test',
    };

    it('should apply safe preset', () => {
      const result = applyCursorPreset(baseConfig, 'safe');
      expect(result.force).toBe(false);
    });

    it('should apply automation preset', () => {
      const result = applyCursorPreset(baseConfig, 'automation');
      expect(result.force).toBe(true);
    });

    it('should apply development preset', () => {
      const result = applyCursorPreset(baseConfig, 'development');
      expect(result.force).toBe(true);
    });

    it('should apply production preset', () => {
      const result = applyCursorPreset(baseConfig, 'production');
      expect(result.force).toBe(false);
    });

    it('should preserve existing config properties', () => {
      const config: CursorConfig = {
        workDir: '/test',
        model: 'sonnet-4.5',
      };
      const result = applyCursorPreset(config, 'automation');
      expect(result.workDir).toBe('/test');
      expect(result.model).toBe('sonnet-4.5');
    });
  });

  describe('applyCopilotPreset', () => {
    const baseConfig: CopilotConfig = {
      workDir: '/test',
    };

    it('should apply safe preset', () => {
      const result = applyCopilotPreset(baseConfig, 'safe');
      expect(result.allowAllTools).toBe(false);
    });

    it('should apply automation preset', () => {
      const result = applyCopilotPreset(baseConfig, 'automation');
      expect(result.allowAllTools).toBe(true);
    });
  });

  describe('applyCodexPreset', () => {
    const baseConfig: CodexConfig = {
      workDir: '/test',
    };

    it('should apply safe preset', () => {
      const result = applyCodexPreset(baseConfig, 'safe');
      expect(result.sandbox).toBe('read-only');
      expect(result.askForApproval).toBe('untrusted');
      expect(result.fullAuto).toBe(false);
      expect(result.yolo).toBe(false);
    });

    it('should apply automation preset', () => {
      const result = applyCodexPreset(baseConfig, 'automation');
      expect(result.sandbox).toBe('workspace-write');
      expect(result.askForApproval).toBe('never');
      expect(result.fullAuto).toBe(true);
      expect(result.yolo).toBe(false);
    });

    it('should apply development preset', () => {
      const result = applyCodexPreset(baseConfig, 'development');
      expect(result.sandbox).toBe('workspace-write');
      expect(result.askForApproval).toBe('on-failure');
      expect(result.fullAuto).toBe(true);
    });

    it('should apply production preset', () => {
      const result = applyCodexPreset(baseConfig, 'production');
      expect(result.sandbox).toBe('workspace-write');
      expect(result.askForApproval).toBe('untrusted');
      expect(result.fullAuto).toBe(false);
    });
  });

  describe('applyClaudeCodePreset', () => {
    const baseConfig: ClaudeCodeConfig = {
      workDir: '/test',
    };

    it('should apply safe preset', () => {
      const result = applyClaudeCodePreset(baseConfig, 'safe');
      expect(result.dangerouslySkipPermissions).toBe(false);
    });

    it('should apply automation preset', () => {
      const result = applyClaudeCodePreset(baseConfig, 'automation');
      expect(result.dangerouslySkipPermissions).toBe(true);
    });
  });

  describe('getRecommendedTimeouts', () => {
    it('should return safe timeouts', () => {
      const timeouts = getRecommendedTimeouts('safe');
      expect(timeouts.timeout).toBe(5 * 60 * 1000); // 5 minutes
      expect(timeouts.idleTimeout).toBe(2 * 60 * 1000); // 2 minutes
    });

    it('should return automation timeouts', () => {
      const timeouts = getRecommendedTimeouts('automation');
      expect(timeouts.timeout).toBe(30 * 60 * 1000); // 30 minutes
      expect(timeouts.idleTimeout).toBe(10 * 60 * 1000); // 10 minutes
    });

    it('should return development timeouts', () => {
      const timeouts = getRecommendedTimeouts('development');
      expect(timeouts.timeout).toBe(15 * 60 * 1000);
      expect(timeouts.idleTimeout).toBe(5 * 60 * 1000);
    });

    it('should return production timeouts', () => {
      const timeouts = getRecommendedTimeouts('production');
      expect(timeouts.timeout).toBe(10 * 60 * 1000);
      expect(timeouts.idleTimeout).toBe(3 * 60 * 1000);
    });
  });

  describe('getRecommendedRetry', () => {
    it('should return safe retry config', () => {
      const retry = getRecommendedRetry('safe');
      expect(retry.maxAttempts).toBe(1);
      expect(retry.backoffMs).toBe(0);
    });

    it('should return automation retry config', () => {
      const retry = getRecommendedRetry('automation');
      expect(retry.maxAttempts).toBe(3);
      expect(retry.backoffMs).toBe(1000);
    });

    it('should return development retry config', () => {
      const retry = getRecommendedRetry('development');
      expect(retry.maxAttempts).toBe(2);
      expect(retry.backoffMs).toBe(500);
    });

    it('should return production retry config', () => {
      const retry = getRecommendedRetry('production');
      expect(retry.maxAttempts).toBe(2);
      expect(retry.backoffMs).toBe(1000);
    });
  });
});
