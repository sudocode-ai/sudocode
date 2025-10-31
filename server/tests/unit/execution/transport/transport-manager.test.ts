/**
 * TransportManager Tests
 *
 * Tests for the transport manager that coordinates AG-UI adapters with SSE transport.
 *
 * @module execution/transport/tests/transport-manager
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { TransportManager, type AgUiEvent } from '../../../../src/execution/transport/transport-manager.js';
import { AgUiEventAdapter } from '../../../../src/execution/output/ag-ui-adapter.js';
import { EventType } from '@ag-ui/core';

describe('TransportManager', () => {
  let manager: TransportManager;

  beforeEach(() => {
    manager = new TransportManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('constructor', () => {
    it('should create manager with SSE transport', () => {
      assert.ok(manager);
      assert.ok(manager.getSseTransport());
    });

    it('should start with no connected adapters', () => {
      assert.strictEqual(manager.getAdapterCount(), 0);
    });
  });

  describe('connectAdapter', () => {
    it('should connect adapter and forward events to transport', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      // Spy on broadcast method
      const broadcastSpy = mock.method(transport, 'broadcast');

      // Connect adapter
      manager.connectAdapter(adapter);

      // Emit event from adapter using public method
      adapter.emitRunStarted();

      // Verify event was broadcast
      assert.strictEqual(broadcastSpy.mock.callCount(), 2); // RUN_STARTED + STATE_SNAPSHOT
    });

    it('should use broadcastToRun when runId is provided', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      // Spy on broadcastToRun method
      const broadcastToRunSpy = mock.method(transport, 'broadcastToRun');

      // Connect adapter with runId
      manager.connectAdapter(adapter, 'run-123');

      // Emit event from adapter
      adapter.emitRunStarted();

      // Verify event was broadcast to run
      assert.strictEqual(broadcastToRunSpy.mock.callCount(), 2); // RUN_STARTED + STATE_SNAPSHOT
      assert.strictEqual(broadcastToRunSpy.mock.calls[0].arguments[0], 'run-123');
    });

    it('should support multiple adapters', () => {
      const adapter1 = new AgUiEventAdapter('run-1');
      const adapter2 = new AgUiEventAdapter('run-2');
      const transport = manager.getSseTransport();

      const broadcastSpy = mock.method(transport, 'broadcast');

      manager.connectAdapter(adapter1);
      manager.connectAdapter(adapter2);

      assert.strictEqual(manager.getAdapterCount(), 2);

      // Emit from both adapters
      adapter1.emitRunStarted();
      adapter2.emitRunStarted();

      assert.strictEqual(broadcastSpy.mock.callCount(), 4); // 2 adapters * 2 events each
    });

    it('should increment adapter count', () => {
      const adapter = new AgUiEventAdapter('run-123');

      assert.strictEqual(manager.getAdapterCount(), 0);
      manager.connectAdapter(adapter);
      assert.strictEqual(manager.getAdapterCount(), 1);
    });
  });

  describe('disconnectAdapter', () => {
    it('should disconnect adapter and stop forwarding events', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      const broadcastSpy = mock.method(transport, 'broadcast');

      manager.connectAdapter(adapter);
      const disconnected = manager.disconnectAdapter(adapter);

      assert.strictEqual(disconnected, true);
      assert.strictEqual(manager.getAdapterCount(), 0);

      // Emit event after disconnect
      adapter.emitRunStarted();

      // Verify event was NOT broadcast (still 0 because we disconnected before emitting)
      assert.strictEqual(broadcastSpy.mock.callCount(), 0);
    });

    it('should return false for non-existent adapter', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const disconnected = manager.disconnectAdapter(adapter);

      assert.strictEqual(disconnected, false);
    });

    it('should decrement adapter count', () => {
      const adapter = new AgUiEventAdapter('run-123');

      manager.connectAdapter(adapter);
      assert.strictEqual(manager.getAdapterCount(), 1);

      manager.disconnectAdapter(adapter);
      assert.strictEqual(manager.getAdapterCount(), 0);
    });
  });

  describe('broadcast', () => {
    it('should broadcast event to all clients', () => {
      const transport = manager.getSseTransport();
      const broadcastSpy = mock.method(transport, 'broadcast', () => 2);

      const event: AgUiEvent = {
        type: EventType.RUN_STARTED,
        runId: 'run-123',
        threadId: 'run-123',
        timestamp: Date.now(),
      };

      const count = manager.broadcast(event);

      assert.strictEqual(count, 2);
      assert.strictEqual(broadcastSpy.mock.callCount(), 1);
      // Verify SSE event format
      const sseEvent = broadcastSpy.mock.calls[0].arguments[0];
      assert.ok(sseEvent);
      assert.strictEqual(sseEvent.event, EventType.RUN_STARTED);
      assert.deepStrictEqual(sseEvent.data, event);
    });
  });

  describe('broadcastToRun', () => {
    it('should broadcast event to specific run', () => {
      const transport = manager.getSseTransport();
      const broadcastToRunSpy = mock.method(transport, 'broadcastToRun', () => 1);

      const event: AgUiEvent = {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'Read',
        timestamp: Date.now(),
      };

      const count = manager.broadcastToRun('run-123', event);

      assert.strictEqual(count, 1);
      assert.strictEqual(broadcastToRunSpy.mock.callCount(), 1);
      assert.strictEqual(broadcastToRunSpy.mock.calls[0].arguments[0], 'run-123');
      // Verify SSE event format
      const sseEvent = broadcastToRunSpy.mock.calls[0].arguments[1];
      assert.ok(sseEvent);
      assert.strictEqual(sseEvent.event, EventType.TOOL_CALL_START);
      assert.deepStrictEqual(sseEvent.data, event);
    });
  });

  describe('getSseTransport', () => {
    it('should return SSE transport instance', () => {
      const transport = manager.getSseTransport();

      assert.ok(transport);
      assert.strictEqual(typeof transport.handleConnection, 'function');
      assert.strictEqual(typeof transport.broadcast, 'function');
      assert.strictEqual(typeof transport.broadcastToRun, 'function');
    });

    it('should return same transport instance', () => {
      const transport1 = manager.getSseTransport();
      const transport2 = manager.getSseTransport();

      assert.strictEqual(transport1, transport2);
    });
  });

  describe('getAdapterCount', () => {
    it('should return correct count', () => {
      assert.strictEqual(manager.getAdapterCount(), 0);

      const adapter1 = new AgUiEventAdapter('run-1');
      manager.connectAdapter(adapter1);
      assert.strictEqual(manager.getAdapterCount(), 1);

      const adapter2 = new AgUiEventAdapter('run-2');
      manager.connectAdapter(adapter2);
      assert.strictEqual(manager.getAdapterCount(), 2);

      manager.disconnectAdapter(adapter1);
      assert.strictEqual(manager.getAdapterCount(), 1);

      manager.disconnectAdapter(adapter2);
      assert.strictEqual(manager.getAdapterCount(), 0);
    });
  });

  describe('shutdown', () => {
    it('should disconnect all adapters', () => {
      const adapter1 = new AgUiEventAdapter('run-1');
      const adapter2 = new AgUiEventAdapter('run-2');

      manager.connectAdapter(adapter1);
      manager.connectAdapter(adapter2);

      assert.strictEqual(manager.getAdapterCount(), 2);

      manager.shutdown();

      assert.strictEqual(manager.getAdapterCount(), 0);
    });

    it('should shutdown SSE transport', () => {
      const transport = manager.getSseTransport();
      const shutdownSpy = mock.method(transport, 'shutdown');

      manager.shutdown();

      assert.strictEqual(shutdownSpy.mock.callCount(), 1);
    });

    it('should be idempotent', () => {
      const adapter = new AgUiEventAdapter('run-123');
      manager.connectAdapter(adapter);

      manager.shutdown();
      manager.shutdown(); // Should not throw

      assert.strictEqual(manager.getAdapterCount(), 0);
    });

    it('should stop forwarding events after shutdown', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      const broadcastSpy = mock.method(transport, 'broadcast');

      manager.connectAdapter(adapter);
      manager.shutdown();

      // Try to emit after shutdown
      adapter.emitRunStarted();

      // Verify event was NOT broadcast (adapter was disconnected)
      assert.strictEqual(broadcastSpy.mock.callCount(), 0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete adapter lifecycle', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      const broadcastToRunSpy = mock.method(transport, 'broadcastToRun', () => 1);

      // Connect
      manager.connectAdapter(adapter, 'run-123');

      // Emit lifecycle events
      adapter.emitRunStarted();
      adapter.emitStateSnapshot();
      adapter.emitRunFinished();

      // Verify all events were broadcast
      // emitRunStarted = RUN_STARTED + STATE_SNAPSHOT (2 events)
      // emitStateSnapshot = 1 event
      // emitRunFinished = 1 event
      // Total: 4 events
      assert.strictEqual(broadcastToRunSpy.mock.callCount(), 4);

      // Disconnect
      manager.disconnectAdapter(adapter);

      // Reset the spy count for next check
      broadcastToRunSpy.mock.resetCalls();

      // Emit after disconnect
      adapter.emitRunStarted();

      // Should be 0 (no new broadcast)
      assert.strictEqual(broadcastToRunSpy.mock.callCount(), 0);
    });

    it('should support run-specific and global broadcasts simultaneously', () => {
      const globalAdapter = new AgUiEventAdapter('global');
      const runAdapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      const broadcastSpy = mock.method(transport, 'broadcast', () => 5);
      const broadcastToRunSpy = mock.method(transport, 'broadcastToRun', () => 1);

      // Connect one globally, one to specific run
      manager.connectAdapter(globalAdapter);
      manager.connectAdapter(runAdapter, 'run-123');

      // Emit from both
      globalAdapter.emitRunStarted();
      runAdapter.emitRunStarted();

      // Global adapter emits 2 events via broadcast
      assert.strictEqual(broadcastSpy.mock.callCount(), 2);
      // Run adapter emits 2 events via broadcastToRun
      assert.strictEqual(broadcastToRunSpy.mock.callCount(), 2);
    });

    it('should handle rapid event emissions', () => {
      const adapter = new AgUiEventAdapter('run-123');
      const transport = manager.getSseTransport();

      const broadcastSpy = mock.method(transport, 'broadcast', () => 1);

      manager.connectAdapter(adapter);

      // Emit events rapidly using public methods
      for (let i = 0; i < 10; i++) {
        adapter.emitStateSnapshot();
      }

      assert.strictEqual(broadcastSpy.mock.callCount(), 10);
    });
  });
});
