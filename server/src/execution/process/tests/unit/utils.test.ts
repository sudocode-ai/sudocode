/**
 * Tests for Process Layer Utilities
 *
 * Tests utility functions including ID generation, formatting,
 * and validation helpers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateId,
  formatDuration,
  isValidSignal,
  formatProcessError,
} from '../../utils.js';

describe('generateId', () => {
  it('generates an ID with the specified prefix', () => {
    const id = generateId('process');
    assert.match(id, /^process-[a-z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      ids.add(generateId('test'));
    }

    // All IDs should be unique
    assert.strictEqual(ids.size, count);
  });

  it('generates IDs of consistent length', () => {
    const id1 = generateId('process');
    const id2 = generateId('process');

    // Both should have prefix + separator + 10 character nanoid
    assert.strictEqual(id1.length, id2.length);
    assert.strictEqual(id1.length, 'process-'.length + 10);
  });

  it('generates URL-safe IDs (alphanumeric lowercase)', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateId('test');
      const suffix = id.split('-')[1];

      // Should only contain lowercase alphanumeric
      assert.match(suffix, /^[a-z0-9]+$/);
    }
  });

  it('handles different prefixes', () => {
    const processId = generateId('process');
    const taskId = generateId('task');
    const executionId = generateId('execution');

    assert.match(processId, /^process-/);
    assert.match(taskId, /^task-/);
    assert.match(executionId, /^execution-/);
  });
});

describe('formatDuration', () => {
  it('formats milliseconds under 1 second', () => {
    assert.strictEqual(formatDuration(0), '0ms');
    assert.strictEqual(formatDuration(500), '500ms');
    assert.strictEqual(formatDuration(999), '999ms');
  });

  it('formats seconds', () => {
    assert.strictEqual(formatDuration(1000), '1s');
    assert.strictEqual(formatDuration(5000), '5s');
    assert.strictEqual(formatDuration(30000), '30s');
    assert.strictEqual(formatDuration(59000), '59s');
  });

  it('formats minutes and seconds', () => {
    assert.strictEqual(formatDuration(60000), '1m');
    assert.strictEqual(formatDuration(65000), '1m 5s');
    assert.strictEqual(formatDuration(125000), '2m 5s');
    assert.strictEqual(formatDuration(3599000), '59m 59s');
  });

  it('formats hours and minutes', () => {
    assert.strictEqual(formatDuration(3600000), '1h');
    assert.strictEqual(formatDuration(3660000), '1h 1m');
    assert.strictEqual(formatDuration(7200000), '2h');
    assert.strictEqual(formatDuration(7320000), '2h 2m');
  });

  it('omits zero values in compound formats', () => {
    // 1 minute exactly (no seconds)
    assert.strictEqual(formatDuration(60000), '1m');

    // 1 hour exactly (no minutes)
    assert.strictEqual(formatDuration(3600000), '1h');
  });

  it('handles large durations', () => {
    // 24 hours
    assert.strictEqual(formatDuration(86400000), '24h');

    // 24 hours 30 minutes
    assert.strictEqual(formatDuration(88200000), '24h 30m');
  });
});

describe('isValidSignal', () => {
  it('validates common Unix signals', () => {
    assert.strictEqual(isValidSignal('SIGTERM'), true);
    assert.strictEqual(isValidSignal('SIGKILL'), true);
    assert.strictEqual(isValidSignal('SIGINT'), true);
    assert.strictEqual(isValidSignal('SIGHUP'), true);
    assert.strictEqual(isValidSignal('SIGQUIT'), true);
    assert.strictEqual(isValidSignal('SIGABRT'), true);
  });

  it('rejects invalid signals', () => {
    assert.strictEqual(isValidSignal('INVALID'), false);
    assert.strictEqual(isValidSignal('SIGFOO'), false);
    assert.strictEqual(isValidSignal('sigterm'), false); // lowercase
    assert.strictEqual(isValidSignal(''), false);
    assert.strictEqual(isValidSignal('SIG'), false);
  });

  it('is case sensitive', () => {
    assert.strictEqual(isValidSignal('SIGTERM'), true);
    assert.strictEqual(isValidSignal('sigterm'), false);
    assert.strictEqual(isValidSignal('SigTerm'), false);
  });
});

describe('formatProcessError', () => {
  it('formats signal termination', () => {
    const error = formatProcessError(null, 'SIGTERM');
    assert.strictEqual(error, 'Process terminated by signal: SIGTERM');
  });

  it('formats exit code errors', () => {
    const error = formatProcessError(1, null);
    assert.strictEqual(error, 'Process exited with code: 1');
  });

  it('prioritizes signal over exit code', () => {
    // If both are present, signal takes precedence
    const error = formatProcessError(1, 'SIGKILL');
    assert.strictEqual(error, 'Process terminated by signal: SIGKILL');
  });

  it('handles successful exit (code 0)', () => {
    const error = formatProcessError(0, null);
    assert.strictEqual(error, 'Process exited unexpectedly');
  });

  it('handles unknown failures', () => {
    const error = formatProcessError(null, null);
    assert.strictEqual(error, 'Process exited unexpectedly');
  });

  it('formats different exit codes', () => {
    assert.match(formatProcessError(1, null), /code: 1/);
    assert.match(formatProcessError(137, null), /code: 137/);
    assert.match(formatProcessError(255, null), /code: 255/);
  });

  it('formats different signals', () => {
    assert.match(formatProcessError(null, 'SIGKILL'), /SIGKILL/);
    assert.match(formatProcessError(null, 'SIGINT'), /SIGINT/);
    assert.match(formatProcessError(null, 'SIGHUP'), /SIGHUP/);
  });
});
