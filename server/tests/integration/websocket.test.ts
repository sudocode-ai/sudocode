/**
 * WebSocket Connection Integration Tests
 * Tests basic WebSocket connectivity and message handling
 *
 * NOTE: These tests require a running server at ws://localhost:3002/ws
 * Run the server with: npm run dev:server
 * Then run these tests with: npm test -- --run tests/integration/websocket.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3002/ws';

// Helper function to wait for a specific WebSocket message
function waitForMessage(
  ws: WebSocket,
  predicate: (message: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (data: any) => {
      try {
        const message = JSON.parse(data.toString());
        if (predicate(message)) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(message);
        }
      } catch (error) {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

describe.skip('WebSocket Integration Tests', () => {
  let ws: WebSocket;

  beforeAll(async () => {
    // Connect to WebSocket server
    ws = new WebSocket(WS_URL);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  });

  afterAll(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it('should connect to WebSocket server', () => {
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('should respond to ping', async () => {
    const messagePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'pong'
    );

    ws.send(JSON.stringify({ type: 'ping' }));

    const message = await messagePromise;
    expect(message.type).toBe('pong');
  });

  it('should subscribe to all issues', async () => {
    const messagePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'subscribed' && msg.subscription === 'issue:*'
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'issue',
      })
    );

    const message = await messagePromise;
    expect(message.type).toBe('subscribed');
    expect(message.subscription).toBe('issue:*');
  });

  it('should subscribe to a specific issue', async () => {
    const testIssueId = 'ISSUE-001';
    const messagePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === 'subscribed' && msg.subscription === `issue:${testIssueId}`
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'issue',
        entity_id: testIssueId,
      })
    );

    const message = await messagePromise;
    expect(message.type).toBe('subscribed');
    expect(message.subscription).toBe(`issue:${testIssueId}`);
  });

  it('should subscribe to all updates', async () => {
    const messagePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'subscribed' && msg.subscription === 'all'
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'all',
      })
    );

    const message = await messagePromise;
    expect(message.type).toBe('subscribed');
    expect(message.subscription).toBe('all');
  });

  it('should unsubscribe from specific issue', async () => {
    const testIssueId = 'ISSUE-001';

    // First subscribe
    const subscribePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === 'subscribed' && msg.subscription === `issue:${testIssueId}`
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'issue',
        entity_id: testIssueId,
      })
    );

    await subscribePromise;

    // Then unsubscribe
    const unsubscribePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === 'unsubscribed' &&
        msg.subscription === `issue:${testIssueId}`
    );

    ws.send(
      JSON.stringify({
        type: 'unsubscribe',
        entity_type: 'issue',
        entity_id: testIssueId,
      })
    );

    const message = await unsubscribePromise;
    expect(message.type).toBe('unsubscribed');
    expect(message.subscription).toBe(`issue:${testIssueId}`);
  });

  it('should subscribe to all executions', async () => {
    const messagePromise = waitForMessage(
      ws,
      (msg) => msg.type === 'subscribed' && msg.subscription === 'execution:*'
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'execution',
      })
    );

    const message = await messagePromise;
    expect(message.type).toBe('subscribed');
    expect(message.subscription).toBe('execution:*');
  });

  it('should subscribe to a specific execution', async () => {
    const testExecutionId = 'exec-123';
    const messagePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === 'subscribed' && msg.subscription === `execution:${testExecutionId}`
    );

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        entity_type: 'execution',
        entity_id: testExecutionId,
      })
    );

    const message = await messagePromise;
    expect(message.type).toBe('subscribed');
    expect(message.subscription).toBe(`execution:${testExecutionId}`);
  });
});
