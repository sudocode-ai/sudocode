/**
 * Tests for SimpleProcessManager
 *
 * Tests the SimpleProcessManager class structure and interface compliance.
 * These tests verify the skeleton implementation before adding actual functionality.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SimpleProcessManager } from '../../simple-manager.js';
import type { ProcessConfig } from '../../types.js';

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
        claudePath: 'claude',
        args: {
          print: true,
          outputFormat: 'stream-json',
          dangerouslySkipPermissions: true,
        },
      });
      assert.ok(mgr instanceof SimpleProcessManager);
    });

    it('creates an instance with partial config', () => {
      const mgr = new SimpleProcessManager({
        claudePath: '/usr/local/bin/claude',
      });
      assert.ok(mgr instanceof SimpleProcessManager);
    });
  });

  describe('interface compliance', () => {
    const mockConfig: ProcessConfig = {
      claudePath: 'claude',
      workDir: '/test',
      args: {
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
      },
    };

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

    // Test that stub methods throw "Not implemented"
    it('acquireProcess throws not implemented', async () => {
      await assert.rejects(
        manager.acquireProcess(mockConfig),
        /Not implemented/
      );
    });

    it('releaseProcess throws not implemented', async () => {
      await assert.rejects(
        manager.releaseProcess('test-id'),
        /Not implemented/
      );
    });

    it('terminateProcess throws not implemented', async () => {
      await assert.rejects(
        manager.terminateProcess('test-id'),
        /Not implemented/
      );
    });

    it('sendInput throws not implemented', async () => {
      await assert.rejects(
        manager.sendInput('test-id', 'input'),
        /Not implemented/
      );
    });

    it('onOutput throws not implemented', () => {
      assert.throws(
        () => manager.onOutput('test-id', () => {}),
        /Not implemented/
      );
    });

    it('onError throws not implemented', () => {
      assert.throws(
        () => manager.onError('test-id', () => {}),
        /Not implemented/
      );
    });

    it('getProcess throws not implemented', () => {
      assert.throws(
        () => manager.getProcess('test-id'),
        /Not implemented/
      );
    });

    it('getActiveProcesses throws not implemented', () => {
      assert.throws(
        () => manager.getActiveProcesses(),
        /Not implemented/
      );
    });

    it('getMetrics throws not implemented', () => {
      assert.throws(
        () => manager.getMetrics(),
        /Not implemented/
      );
    });

    it('shutdown throws not implemented', async () => {
      await assert.rejects(
        manager.shutdown(),
        /Not implemented/
      );
    });
  });

  describe('method signatures', () => {
    it('acquireProcess accepts ProcessConfig', async () => {
      const config: ProcessConfig = {
        claudePath: 'claude',
        workDir: '/test',
        args: {
          print: true,
          outputFormat: 'stream-json',
          dangerouslySkipPermissions: true,
        },
      };

      // Should accept the config without type errors
      await assert.rejects(manager.acquireProcess(config), /Not implemented/);
    });

    it('terminateProcess accepts optional signal parameter', async () => {
      await assert.rejects(manager.terminateProcess('test-id'));
      await assert.rejects(manager.terminateProcess('test-id', 'SIGTERM'));
      await assert.rejects(manager.terminateProcess('test-id', 'SIGKILL'));
    });

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
