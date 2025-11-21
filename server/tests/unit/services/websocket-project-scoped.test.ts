/**
 * WebSocket Project-Scoped Subscriptions Tests
 *
 * Tests project-scoped subscription logic in the WebSocket service.
 *
 * @module services/tests/websocket-project-scoped
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { websocketManager } from '../../../src/services/websocket.js';
import { WebSocket } from 'ws';

// Mock WebSocket
class MockWebSocket {
  public sent: string[] = [];
  public readyState = WebSocket.OPEN;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }

  on() {}
  off() {}
}

describe('WebSocketManager - Project-Scoped Subscriptions', () => {
  // Use the singleton instance
  const manager = websocketManager;

  beforeEach(() => {
    // Clear all clients before each test
    (manager as any).clients.clear();
  });

  afterEach(() => {
    // Clean up after each test
    (manager as any).clients.clear();
  });

  describe('Subscription Format', () => {
    it('should require project_id for subscriptions', () => {
      const ws = new MockWebSocket() as any;
      const clientId = 'test-client-1';

      // Add client
      (manager as any).clients.set(clientId, {
        id: clientId,
        ws,
        subscriptions: new Set(),
        isAlive: true,
        connectedAt: new Date(),
      });

      // Try to subscribe without project_id
      (manager as any).handleSubscribe(clientId, {
        type: 'subscribe',
        entity_type: 'issue',
        entity_id: 'i-001',
      });

      // Should receive error message
      expect(ws.sent.length).toBe(1);
      const errorMsg = JSON.parse(ws.sent[0]);
      expect(errorMsg.type).toBe('error');
      expect(errorMsg.message).toContain('project_id is required');
    });

    it('should create project-scoped subscription for specific entity', () => {
      const ws = new MockWebSocket() as any;
      const clientId = 'test-client-1';
      const projectId = 'project-123';

      // Add client
      const client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        isAlive: true,
        connectedAt: new Date(),
      };
      (manager as any).clients.set(clientId, client);

      // Subscribe to specific issue
      (manager as any).handleSubscribe(clientId, {
        type: 'subscribe',
        project_id: projectId,
        entity_type: 'issue',
        entity_id: 'i-001',
      });

      // Should have subscription in format projectId:entity_type:entity_id
      expect(client.subscriptions.has(`${projectId}:issue:i-001`)).toBe(true);

      // Should receive subscribed confirmation
      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('subscribed');
      expect(msg.subscription).toBe(`${projectId}:issue:i-001`);
    });

    it('should create wildcard subscription for entity type', () => {
      const ws = new MockWebSocket() as any;
      const clientId = 'test-client-1';
      const projectId = 'project-123';

      // Add client
      const client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        isAlive: true,
        connectedAt: new Date(),
      };
      (manager as any).clients.set(clientId, client);

      // Subscribe to all issues in project
      (manager as any).handleSubscribe(clientId, {
        type: 'subscribe',
        project_id: projectId,
        entity_type: 'issue',
      });

      // Should have wildcard subscription
      expect(client.subscriptions.has(`${projectId}:issue:*`)).toBe(true);

      // Should receive subscribed confirmation
      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('subscribed');
      expect(msg.subscription).toBe(`${projectId}:issue:*`);
    });

    it('should create "all" subscription for entire project', () => {
      const ws = new MockWebSocket() as any;
      const clientId = 'test-client-1';
      const projectId = 'project-123';

      // Add client
      const client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        isAlive: true,
        connectedAt: new Date(),
      };
      (manager as any).clients.set(clientId, client);

      // Subscribe to all updates in project
      (manager as any).handleSubscribe(clientId, {
        type: 'subscribe',
        project_id: projectId,
        entity_type: 'all',
      });

      // Should have "all" subscription
      expect(client.subscriptions.has(`${projectId}:all`)).toBe(true);

      // Should receive subscribed confirmation
      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('subscribed');
      expect(msg.subscription).toBe(`${projectId}:all`);
    });
  });

  describe('Broadcasting', () => {
    it('should only broadcast to subscribers of specific project', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      const ws3 = new MockWebSocket() as any;

      const projectId1 = 'project-1';
      const projectId2 = 'project-2';

      // Add clients with different project subscriptions
      const client1 = {
        id: 'client-1',
        ws: ws1,
        subscriptions: new Set([`${projectId1}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      const client2 = {
        id: 'client-2',
        ws: ws2,
        subscriptions: new Set([`${projectId2}:issue:i-001`]), // Different project!
        isAlive: true,
        connectedAt: new Date(),
      };

      const client3 = {
        id: 'client-3',
        ws: ws3,
        subscriptions: new Set([`${projectId1}:issue:*`]), // Wildcard for project1
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client1);
      (manager as any).clients.set('client-2', client2);
      (manager as any).clients.set('client-3', client3);

      // Broadcast to project1, issue i-001
      manager.broadcast(projectId1, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001', title: 'Test' },
      });

      // Only client1 and client3 should receive (project1 subscribers)
      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(0); // Different project
      expect(ws3.sent.length).toBe(1); // Wildcard match

      const msg1 = JSON.parse(ws1.sent[0]);
      expect(msg1.projectId).toBe(projectId1);
      expect(msg1.type).toBe('issue_updated');

      const msg3 = JSON.parse(ws3.sent[0]);
      expect(msg3.projectId).toBe(projectId1);
      expect(msg3.type).toBe('issue_updated');
    });

    it('should broadcast to "all" subscribers', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;

      const projectId = 'project-1';

      // Add clients - one with specific subscription, one with "all"
      const client1 = {
        id: 'client-1',
        ws: ws1,
        subscriptions: new Set([`${projectId}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      const client2 = {
        id: 'client-2',
        ws: ws2,
        subscriptions: new Set([`${projectId}:all`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client1);
      (manager as any).clients.set('client-2', client2);

      // Broadcast to project1, issue i-001
      manager.broadcast(projectId, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001' },
      });

      // Both should receive
      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(1);

      const msg1 = JSON.parse(ws1.sent[0]);
      expect(msg1.projectId).toBe(projectId);

      const msg2 = JSON.parse(ws2.sent[0]);
      expect(msg2.projectId).toBe(projectId);
    });

    it('should not broadcast to subscribers of different projects', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;

      const projectId1 = 'project-1';
      const projectId2 = 'project-2';

      // Add clients subscribed to different projects
      const client1 = {
        id: 'client-1',
        ws: ws1,
        subscriptions: new Set([`${projectId1}:all`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      const client2 = {
        id: 'client-2',
        ws: ws2,
        subscriptions: new Set([`${projectId2}:all`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client1);
      (manager as any).clients.set('client-2', client2);

      // Broadcast to project1
      manager.broadcast(projectId1, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001' },
      });

      // Only client1 should receive
      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(0);
    });

    it('should include projectId in all broadcast messages', () => {
      const ws = new MockWebSocket() as any;
      const projectId = 'project-123';

      const client = {
        id: 'client-1',
        ws,
        subscriptions: new Set([`${projectId}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client);

      // Broadcast without projectId in message
      manager.broadcast(projectId, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001' },
      });

      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);

      // projectId should be added by broadcast function
      expect(msg.projectId).toBe(projectId);
    });
  });

  describe('Unsubscribe', () => {
    it('should remove project-scoped subscription', () => {
      const ws = new MockWebSocket() as any;
      const clientId = 'test-client-1';
      const projectId = 'project-123';

      // Add client with subscription
      const client = {
        id: clientId,
        ws,
        subscriptions: new Set([`${projectId}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };
      (manager as any).clients.set(clientId, client);

      // Unsubscribe
      (manager as any).handleUnsubscribe(clientId, {
        type: 'unsubscribe',
        project_id: projectId,
        entity_type: 'issue',
        entity_id: 'i-001',
      });

      // Subscription should be removed
      expect(client.subscriptions.has(`${projectId}:issue:i-001`)).toBe(false);

      // Should receive unsubscribed confirmation
      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('unsubscribed');
      expect(msg.subscription).toBe(`${projectId}:issue:i-001`);
    });
  });

  describe('Project Lifecycle Events', () => {
    it('should broadcast project_opened event to all project subscribers', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      const ws3 = new MockWebSocket() as any;

      const projectId = 'project-123';

      // Add clients with various subscriptions to the project
      const client1 = {
        id: 'client-1',
        ws: ws1,
        subscriptions: new Set([`${projectId}:all`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      const client2 = {
        id: 'client-2',
        ws: ws2,
        subscriptions: new Set([`${projectId}:issue:*`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      const client3 = {
        id: 'client-3',
        ws: ws3,
        subscriptions: new Set(['other-project:all']), // Different project
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client1);
      (manager as any).clients.set('client-2', client2);
      (manager as any).clients.set('client-3', client3);

      // Broadcast project opened
      manager.broadcastProjectEvent(projectId, 'opened', { path: '/path/to/project' });

      // Only client1 should receive (subscribed to project-123:all)
      // Client2 is only subscribed to issues, not project lifecycle events
      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(0);
      expect(ws3.sent.length).toBe(0); // Different project

      const msg1 = JSON.parse(ws1.sent[0]);
      expect(msg1.type).toBe('project_opened');
      expect(msg1.projectId).toBe(projectId);
      expect(msg1.data.path).toBe('/path/to/project');
    });

    it('should broadcast project_closed event', () => {
      const ws = new MockWebSocket() as any;
      const projectId = 'project-123';

      const client = {
        id: 'client-1',
        ws,
        subscriptions: new Set([`${projectId}:all`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client);

      // Broadcast project closed
      manager.broadcastProjectEvent(projectId, 'closed');

      expect(ws.sent.length).toBe(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe('project_closed');
      expect(msg.projectId).toBe(projectId);
    });
  });

  describe('Multi-Project Isolation', () => {
    it('should maintain separate subscription spaces for different projects', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;

      const project1 = 'project-1';
      const project2 = 'project-2';

      // Client 1 subscribes to issue:i-001 in project1
      const client1 = {
        id: 'client-1',
        ws: ws1,
        subscriptions: new Set([`${project1}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      // Client 2 subscribes to issue:i-001 in project2 (same issue ID, different project)
      const client2 = {
        id: 'client-2',
        ws: ws2,
        subscriptions: new Set([`${project2}:issue:i-001`]),
        isAlive: true,
        connectedAt: new Date(),
      };

      (manager as any).clients.set('client-1', client1);
      (manager as any).clients.set('client-2', client2);

      // Broadcast to project1, issue i-001
      manager.broadcast(project1, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001', title: 'Project 1 Issue' },
      });

      // Only client1 should receive
      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(0);

      const msg = JSON.parse(ws1.sent[0]);
      expect(msg.projectId).toBe(project1);
      expect(msg.data.title).toBe('Project 1 Issue');

      // Clear messages
      ws1.sent = [];
      ws2.sent = [];

      // Broadcast to project2, issue i-001
      manager.broadcast(project2, 'issue', 'i-001', {
        type: 'issue_updated',
        data: { id: 'i-001', title: 'Project 2 Issue' },
      });

      // Only client2 should receive
      expect(ws1.sent.length).toBe(0);
      expect(ws2.sent.length).toBe(1);

      const msg2 = JSON.parse(ws2.sent[0]);
      expect(msg2.projectId).toBe(project2);
      expect(msg2.data.title).toBe('Project 2 Issue');
    });
  });
});
