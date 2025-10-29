/**
 * Tests for SimpleProcessManager
 *
 * Tests the SimpleProcessManager class structure and interface compliance.
 * These tests verify the skeleton implementation before adding actual functionality.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';

describe('SimpleProcessManager', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  describe('constructor', () => {
    it('creates an instance without config', () => {
      const mgr = new SimpleProcessManager();
      assert.ok(mgr instanceof SimpleProcessManager);
    });

    it('creates an instance with default config', () => {
      const mgr = new SimpleProcessManager({
        executablePath: 'claude',
        args: ['--print', '--output-format', 'stream-json'],
      });
      assert.ok(mgr instanceof SimpleProcessManager);
    });

    it('creates an instance with partial config', () => {
      const mgr = new SimpleProcessManager({
        executablePath: '/usr/local/bin/claude',
      });
      assert.ok(mgr instanceof SimpleProcessManager);
    });
  });

  describe('interface compliance', () => {
    it('implements acquireProcess method', () => {
      assert.ok(manager.acquireProcess);
      assert.strictEqual(typeof manager.acquireProcess, 'function');
    });

    it('implements releaseProcess method', () => {
      assert.ok(manager.releaseProcess);
      assert.strictEqual(typeof manager.releaseProcess, 'function');
    });

    it('implements terminateProcess method', () => {
      assert.ok(manager.terminateProcess);
      assert.strictEqual(typeof manager.terminateProcess, 'function');
    });

    it('implements sendInput method', () => {
      assert.ok(manager.sendInput);
      assert.strictEqual(typeof manager.sendInput, 'function');
    });

    it('implements onOutput method', () => {
      assert.ok(manager.onOutput);
      assert.strictEqual(typeof manager.onOutput, 'function');
    });

    it('implements onError method', () => {
      assert.ok(manager.onError);
      assert.strictEqual(typeof manager.onError, 'function');
    });

    it('implements getProcess method', () => {
      assert.ok(manager.getProcess);
      assert.strictEqual(typeof manager.getProcess, 'function');
    });

    it('implements getActiveProcesses method', () => {
      assert.ok(manager.getActiveProcesses);
      assert.strictEqual(typeof manager.getActiveProcesses, 'function');
    });

    it('implements getMetrics method', () => {
      assert.ok(manager.getMetrics);
      assert.strictEqual(typeof manager.getMetrics, 'function');
    });

    it('implements shutdown method', () => {
      assert.ok(manager.shutdown);
      assert.strictEqual(typeof manager.shutdown, 'function');
    });

    // acquireProcess is now implemented - tested in spawning.test.ts

    // releaseProcess, terminateProcess, and shutdown are now implemented
    // and tested in termination.test.ts

    // sendInput, onOutput, and onError are now implemented
    // and tested in io.test.ts

    // getProcess, getActiveProcesses, and getMetrics are now implemented
    // and tested in spawning.test.ts
  });

  describe('method signatures', () => {
    // acquireProcess signature testing is in spawning.test.ts

    // terminateProcess signature testing is in termination.test.ts

    it('onOutput accepts OutputHandler', () => {
      const handler = (data: Buffer, type: 'stdout' | 'stderr') => {
        void data;
        void type;
      };

      assert.throws(() => manager.onOutput('test-id', handler));
    });

    it('onError accepts ErrorHandler', () => {
      const handler = (error: Error) => {
        void error;
      };

      assert.throws(() => manager.onError('test-id', handler));
    });
  });
});
