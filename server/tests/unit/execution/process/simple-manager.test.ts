/**
 * Tests for SimpleProcessManager
 *
 * Tests the SimpleProcessManager class structure and interface compliance.
 * These tests verify the skeleton implementation before adding actual functionality.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { SimpleProcessManager } from '../../../../src/execution/process/simple-manager.js';

describe('SimpleProcessManager', () => {
  let manager: SimpleProcessManager;

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  afterEach(async () => {
    // Clean up all processes to prevent resource leaks
    try {
      await manager.shutdown();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('creates an instance without config', () => {
      const mgr = new SimpleProcessManager();
      expect(mgr instanceof SimpleProcessManager).toBeTruthy();
    });

    it('creates an instance with default config', () => {
      const mgr = new SimpleProcessManager({
        executablePath: 'claude',
        args: ['--print', '--output-format', 'stream-json'],
      });
      expect(mgr instanceof SimpleProcessManager).toBeTruthy();
    });

    it('creates an instance with partial config', () => {
      const mgr = new SimpleProcessManager({
        executablePath: '/usr/local/bin/claude',
      });
      expect(mgr instanceof SimpleProcessManager).toBeTruthy();
    });
  });

  describe('interface compliance', () => {
    it('implements acquireProcess method', () => {
      expect(manager.acquireProcess).toBeTruthy();
      expect(typeof manager.acquireProcess).toBe('function');
    });

    it('implements releaseProcess method', () => {
      expect(manager.releaseProcess).toBeTruthy();
      expect(typeof manager.releaseProcess).toBe('function');
    });

    it('implements terminateProcess method', () => {
      expect(manager.terminateProcess).toBeTruthy();
      expect(typeof manager.terminateProcess).toBe('function');
    });

    it('implements sendInput method', () => {
      expect(manager.sendInput).toBeTruthy();
      expect(typeof manager.sendInput).toBe('function');
    });

    it('implements onOutput method', () => {
      expect(manager.onOutput).toBeTruthy();
      expect(typeof manager.onOutput).toBe('function');
    });

    it('implements onError method', () => {
      expect(manager.onError).toBeTruthy();
      expect(typeof manager.onError).toBe('function');
    });

    it('implements getProcess method', () => {
      expect(manager.getProcess).toBeTruthy();
      expect(typeof manager.getProcess).toBe('function');
    });

    it('implements getActiveProcesses method', () => {
      expect(manager.getActiveProcesses).toBeTruthy();
      expect(typeof manager.getActiveProcesses).toBe('function');
    });

    it('implements getMetrics method', () => {
      expect(manager.getMetrics).toBeTruthy();
      expect(typeof manager.getMetrics).toBe('function');
    });

    it('implements shutdown method', () => {
      expect(manager.shutdown).toBeTruthy();
      expect(typeof manager.shutdown).toBe('function');
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

      expect(() => manager.onOutput('test-id', handler)).toThrow();
    });

    it('onError accepts ErrorHandler', () => {
      const handler = (error: Error) => {
        void error;
      };

      expect(() => manager.onError('test-id', handler)).toThrow();
    });
  });
});
