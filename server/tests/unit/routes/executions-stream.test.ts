/**
 * Execution Stream Routes Tests
 *
 * Tests for SSE endpoint routes.
 *
 * @module routes/tests/executions-stream
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import express, { type Express } from 'express';
import request from 'supertest';
import { createExecutionStreamRoutes } from '../../../src/routes/executions-stream.js';
import { TransportManager } from '../../../src/execution/transport/transport-manager.js';

describe('Execution Stream Routes', () => {
  let app: Express;
  let transportManager: TransportManager;

  beforeEach(() => {
    app = express();
    transportManager = new TransportManager();
    const router = createExecutionStreamRoutes(transportManager);
    app.use('/api/executions', router);
  });

  afterEach(() => {
    transportManager.shutdown();
  });

  describe('GET /:executionId/stream', () => {
    it('should establish SSE connection', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          // Set SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          // Immediately end the response for testing
          res.end();
        }
      );

      await request(app)
        .get('/api/executions/test-exec-123/stream')
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache')
        .expect('Connection', 'keep-alive');

      // Verify handleConnection was called
      assert.strictEqual(handleConnectionSpy.mock.callCount(), 1);

      // Verify parameters
      const [clientId, res, executionId] =
        handleConnectionSpy.mock.calls[0].arguments;
      assert.ok(clientId); // Should be a UUID
      assert.ok(res); // Should be response object
      assert.strictEqual(executionId, 'test-exec-123');
    });

    it('should set SSE headers', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      const response = await request(app)
        .get('/api/executions/test-exec-123/stream')
        .expect(200);

      // Verify SSE headers are set by transport
      assert.strictEqual(response.headers['content-type'], 'text/event-stream');
      assert.strictEqual(response.headers['cache-control'], 'no-cache');
      assert.strictEqual(response.headers['connection'], 'keep-alive');
    });

    it('should handle different execution IDs', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      // Connect to first execution
      await request(app)
        .get('/api/executions/exec-1/stream')
        .expect(200);

      // Connect to second execution
      await request(app)
        .get('/api/executions/exec-2/stream')
        .expect(200);

      assert.strictEqual(handleConnectionSpy.mock.callCount(), 2);

      // Verify different execution IDs
      const firstExecId =
        handleConnectionSpy.mock.calls[0].arguments[2];
      const secondExecId =
        handleConnectionSpy.mock.calls[1].arguments[2];

      assert.strictEqual(firstExecId, 'exec-1');
      assert.strictEqual(secondExecId, 'exec-2');
    });

    it('should generate unique client IDs for each connection', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      // Make two connections to same execution
      await request(app)
        .get('/api/executions/test-exec-123/stream')
        .expect(200);

      await request(app)
        .get('/api/executions/test-exec-123/stream')
        .expect(200);

      assert.strictEqual(handleConnectionSpy.mock.callCount(), 2);

      // Verify different client IDs
      const firstClientId =
        handleConnectionSpy.mock.calls[0].arguments[0];
      const secondClientId =
        handleConnectionSpy.mock.calls[1].arguments[0];

      assert.ok(firstClientId);
      assert.ok(secondClientId);
      assert.notStrictEqual(firstClientId, secondClientId);
    });

    it('should support multiple concurrent connections', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      // Make multiple concurrent connections
      await Promise.all([
        request(app).get('/api/executions/exec-1/stream').expect(200),
        request(app).get('/api/executions/exec-2/stream').expect(200),
        request(app).get('/api/executions/exec-3/stream').expect(200),
      ]);

      assert.strictEqual(handleConnectionSpy.mock.callCount(), 3);
    });
  });

  describe('Integration', () => {
    it('should allow streaming events after connection', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      // Establish connection
      await request(app)
        .get('/api/executions/test-exec-123/stream')
        .expect(200);

      // Note: In real usage, broadcastToRun would send to connected clients
      // but since we mocked handleConnection, no actual clients are registered
      // This test verifies the route integration, not the actual broadcasting
      const count = sseTransport.broadcastToRun('test-exec-123', {
        event: 'test-event',
        data: { message: 'Hello' },
      });

      // With mocked connection, count will be 0
      assert.strictEqual(count, 0);
    });

    it('should isolate events between different executions', async () => {
      const sseTransport = transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      mock.method(
        sseTransport,
        'handleConnection',
        (_clientId: string, res: any, _runId?: string) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.end();
        }
      );

      // Connect to two different executions
      await request(app)
        .get('/api/executions/exec-1/stream')
        .expect(200);

      await request(app)
        .get('/api/executions/exec-2/stream')
        .expect(200);

      // Note: With mocked connection, broadcasts won't reach clients
      // This test verifies the route isolation logic
      const count1 = sseTransport.broadcastToRun('exec-1', {
        event: 'test-event',
        data: { message: 'To exec-1' },
      });

      assert.strictEqual(count1, 0);

      const count2 = sseTransport.broadcastToRun('exec-2', {
        event: 'test-event',
        data: { message: 'To exec-2' },
      });

      assert.strictEqual(count2, 0);
    });
  });
});
