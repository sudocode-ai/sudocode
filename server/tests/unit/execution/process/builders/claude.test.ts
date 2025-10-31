/**
 * Tests for Claude Code Configuration Builder
 *
 * Tests the buildClaudeConfig utility for creating ProcessConfig
 * specific to Claude Code CLI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildClaudeConfig } from '../../../../../src/execution/process/builders/claude.js';

describe('buildClaudeConfig', () => {
  it('builds config with minimal options', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
    });

    assert.strictEqual(config.executablePath, 'claude');
    assert.deepStrictEqual(config.args, []);
    assert.strictEqual(config.workDir, '/test/dir');
  });

  it('builds config with custom claudePath', () => {
    const config = buildClaudeConfig({
      claudePath: '/custom/path/to/claude',
      workDir: '/test/dir',
    });

    assert.strictEqual(config.executablePath, '/custom/path/to/claude');
  });

  it('includes --print flag when enabled', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      print: true,
    });

    assert.ok(config.args.includes('--print'));
  });

  it('includes --output-format flag', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      outputFormat: 'stream-json',
    });

    assert.ok(config.args.includes('--output-format'));
    assert.ok(config.args.includes('stream-json'));
  });

  it('includes --dangerously-skip-permissions flag when enabled', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      dangerouslySkipPermissions: true,
    });

    assert.ok(config.args.includes('--dangerously-skip-permissions'));
  });

  it('includes --permission-mode flag when provided', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      permissionMode: 'bypassPermissions',
    });

    assert.ok(config.args.includes('--permission-mode'));
    assert.ok(config.args.includes('bypassPermissions'));
  });

  it('builds config with all flags together', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      print: true,
      outputFormat: 'stream-json',
      dangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
    });

    assert.ok(config.args.includes('--print'));
    assert.ok(config.args.includes('--output-format'));
    assert.ok(config.args.includes('stream-json'));
    assert.ok(config.args.includes('--dangerously-skip-permissions'));
    assert.ok(config.args.includes('--permission-mode'));
    assert.ok(config.args.includes('bypassPermissions'));
  });

  it('passes through environment variables', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      env: {
        TEST_VAR: 'test_value',
      },
    });

    assert.deepStrictEqual(config.env, { TEST_VAR: 'test_value' });
  });

  it('passes through timeout settings', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      timeout: 5000,
      idleTimeout: 1000,
    });

    assert.strictEqual(config.timeout, 5000);
    assert.strictEqual(config.idleTimeout, 1000);
  });

  it('passes through retry configuration', () => {
    const config = buildClaudeConfig({
      workDir: '/test/dir',
      retry: {
        maxAttempts: 3,
        backoffMs: 1000,
      },
    });

    assert.deepStrictEqual(config.retry, {
      maxAttempts: 3,
      backoffMs: 1000,
    });
  });

  it('creates valid ProcessConfig structure', () => {
    const config = buildClaudeConfig({
      claudePath: '/usr/local/bin/claude',
      workDir: '/test/dir',
      print: true,
      outputFormat: 'stream-json',
      dangerouslySkipPermissions: true,
      env: { TEST: 'value' },
      timeout: 10000,
    });

    // Verify structure matches ProcessConfig interface
    assert.ok(config.executablePath);
    assert.ok(Array.isArray(config.args));
    assert.ok(config.workDir);
    assert.strictEqual(typeof config.executablePath, 'string');
    assert.strictEqual(typeof config.workDir, 'string');
  });
});
