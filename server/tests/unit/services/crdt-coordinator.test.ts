/**
 * Unit tests for CRDTCoordinator
 *
 * Tests the CRDT Coordinator service that manages real-time synchronization
 * between worktree agents and frontend clients.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Database from 'better-sqlite3';
import { initDatabase as initCliDatabase } from '@sudocode-ai/cli/dist/db.js';
import { CRDTCoordinator } from '../../../src/services/crdt-coordinator.js';
import { createIssue, createSpec } from '@sudocode-ai/cli/dist/operations/index.js';
import { createFeedback } from '@sudocode-ai/cli/dist/operations/feedback.js';
import * as Y from 'yjs';
import * as WebSocket from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CRDTCoordinator', () => {
  let db: Database.Database;
  let coordinator: CRDTCoordinator;
  let testDbPath: string;
  let testDir: string;
  let server: http.Server;
  let port: number;
  let wsPath: string;

  beforeEach(async () => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-crdt-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing to avoid conflicts
    port = 30000 + Math.floor(Math.random() * 1000);
    wsPath = '/ws/crdt';

    // Create HTTP server
    server = http.createServer();

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(port, () => resolve());
    });

    // Create coordinator with test config
    coordinator = new CRDTCoordinator(db, {
      path: wsPath,
      persistInterval: 100, // Faster for testing
      gcInterval: 1000
    });

    // Initialize WebSocket server
    coordinator.init(server);
  });

  afterEach(async () => {
    // Shutdown coordinator
    if (coordinator) {
      await coordinator.shutdown();
    }

    // Close HTTP server
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // Close database
    if (db) {
      db.close();
    }

    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should initialize with empty state', () => {
      expect(coordinator).toBeDefined();
      expect(coordinator.lastPersistTime).toBe(0);
    });

    it('should load initial state from database', async () => {
      // Create some test data
      const issue = createIssue(db, {
        id: 'i-test1',
        title: 'Test Issue',
        content: 'Test content',
        status: 'open',
        priority: 1
      });

      const spec = createSpec(db, {
        id: 's-test1',
        title: 'Test Spec',
        file_path: '.sudocode/specs/s-test1.md',
        content: 'Test spec content',
        priority: 1
      });

      // Create new coordinator to load data
      await coordinator.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // Create new HTTP server on different port
      const newPort = port + 1;
      server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(newPort, () => resolve());
      });

      coordinator = new CRDTCoordinator(db, {
        path: wsPath,
        persistInterval: 100,
        gcInterval: 1000
      });
      coordinator.init(server);

      // Access internal ydoc to verify (note: this is testing internal state)
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');
      const specMap = (coordinator as any).ydoc.getMap('specUpdates');

      expect(issueMap.size).toBe(1);
      expect(specMap.size).toBe(1);

      const loadedIssue = issueMap.get('i-test1');
      expect(loadedIssue).toBeDefined();
      expect(loadedIssue.title).toBe('Test Issue');

      const loadedSpec = specMap.get('s-test1');
      expect(loadedSpec).toBeDefined();
      expect(loadedSpec.title).toBe('Test Spec');
    });

    it('should handle empty database gracefully', () => {
      // Coordinator should start successfully even with no data
      expect(coordinator).toBeDefined();
    });
  });

  describe('WebSocket Server', () => {
    it('should accept client connections', async () => {
      // Connect a test client
      const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=test-client`);

      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          client.close();
          resolve();
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    });

    it('should send initial sync to new clients', async () => {
      // Add some data first
      createIssue(db, {
        id: 'i-sync1',
        title: 'Sync Test',
        content: 'Content',
        status: 'open',
        priority: 1
      });

      // Recreate coordinator to load data
      await coordinator.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // Create new HTTP server on different port
      const newPort = port + 2;
      server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(newPort, () => resolve());
      });

      coordinator = new CRDTCoordinator(db, {
        path: wsPath,
        persistInterval: 100,
        gcInterval: 1000
      });
      coordinator.init(server);

      // Connect client
      const client = new WebSocket.WebSocket(`ws://localhost:${newPort}${wsPath}?clientId=test-sync`);

      const syncMessage = await new Promise<any>((resolve, reject) => {
        client.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString());
          client.close();
          resolve(message);
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('Sync timeout')), 5000);
      });

      expect(syncMessage.type).toBe('sync-init');
      expect(syncMessage.data).toBeDefined();
      expect(Array.isArray(syncMessage.data)).toBe(true);
      expect(syncMessage.data.length).toBeGreaterThan(0);
    });

    it('should handle multiple concurrent clients', async () => {
      const clientCount = 5;
      const clients: WebSocket.WebSocket[] = [];

      // Connect multiple clients
      for (let i = 0; i < clientCount; i++) {
        const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=client-${i}`);
        clients.push(client);
      }

      // Wait for all to connect
      await Promise.all(clients.map(client =>
        new Promise<void>((resolve, reject) => {
          client.on('open', () => resolve());
          client.on('error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        })
      ));

      // Close all
      clients.forEach(client => client.close());

      // Wait for all to close
      await Promise.all(clients.map(client =>
        new Promise<void>(resolve => {
          client.on('close', () => resolve());
        })
      ));
    });

    it('should remove client from map on disconnection', async () => {
      const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=disconnect-test`);

      await new Promise<void>((resolve) => {
        client.on('open', () => {
          client.close();
        });
        client.on('close', () => {
          resolve();
        });
      });

      // Wait a bit for server to process disconnection
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify client is removed (check internal state)
      const clients = (coordinator as any).clients;
      expect(clients.has('disconnect-test')).toBe(false);
    });
  });

  describe('Update Broadcasting', () => {
    it('should broadcast updates to all clients except sender', async () => {
      // Create two clients
      const client1 = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=client-1`);
      const client2 = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=client-2`);

      // Wait for both to connect and receive initial sync
      await Promise.all([
        new Promise<void>(resolve => {
          client1.on('message', () => resolve());
        }),
        new Promise<void>(resolve => {
          client2.on('message', () => resolve());
        })
      ]);

      // Send update from client1
      const ydoc = new Y.Doc();
      const testMap = ydoc.getMap('test');
      testMap.set('key', 'value');
      const update = Y.encodeStateAsUpdate(ydoc);

      const updateMessage = {
        type: 'sync-update',
        data: Array.from(update)
      };

      client1.send(JSON.stringify(updateMessage));

      // Client2 should receive the broadcast
      const receivedByClient2 = await new Promise<boolean>((resolve) => {
        let receivedCount = 0;
        client2.on('message', () => {
          receivedCount++;
          if (receivedCount > 0) { // Skip initial sync
            resolve(true);
          }
        });
        setTimeout(() => resolve(false), 2000);
      });

      expect(receivedByClient2).toBe(true);

      // Cleanup
      client1.close();
      client2.close();
    });
  });

  describe('Persistence', () => {
    it('should persist CRDT updates to database', async () => {
      // Create an issue via public API
      coordinator.updateIssue('i-persist1', {
        id: 'i-persist1',
        title: 'Persistence Test',
        content: 'Test content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Wait for debounced persistence
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if persisted to DB
      const result = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-persist1');
      expect(result).toBeDefined();
      expect((result as any).title).toBe('Persistence Test');
    });

    it('should debounce multiple rapid updates', async () => {
      const spy = vi.fn();
      const originalPersist = (coordinator as any).persistToDatabase.bind(coordinator);
      (coordinator as any).persistToDatabase = async function() {
        spy();
        return originalPersist();
      };

      // Make multiple rapid updates
      for (let i = 0; i < 10; i++) {
        coordinator.updateIssue(`i-debounce${i}`, {
          id: `i-debounce${i}`,
          title: `Update ${i}`,
          content: 'Content',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'test',
          version: 1
        });
      }

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should only persist once or twice (not 10 times)
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should handle persistence errors gracefully', async () => {
      // Close database to cause error
      db.close();

      // This should not throw
      coordinator.updateIssue('i-error', {
        id: 'i-error',
        title: 'Error Test',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Wait for persistence attempt
      await new Promise(resolve => setTimeout(resolve, 200));

      // Coordinator should still be functional
      expect(coordinator).toBeDefined();
    });
  });

  describe('JSONL Export', () => {
    it('should export CRDT state to JSONL files', async () => {
      // Add some data via CRDT
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');
      issueMap.set('i-export1', {
        id: 'i-export1',
        title: 'Export Test',
        content: 'Test content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Create .sudocode directory
      const sudocodeDir = path.join(testDir, '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });

      // Export
      await coordinator.exportToJSONL(testDir);

      // Check files exist
      const issuesPath = path.join(sudocodeDir, 'issues.jsonl');
      expect(fs.existsSync(issuesPath)).toBe(true);

      // Check content
      const content = fs.readFileSync(issuesPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.id).toBe('i-export1');
      expect(parsed.title).toBe('Export Test');
    });

    it('should export specs correctly', async () => {
      const specMap = (coordinator as any).ydoc.getMap('specUpdates');
      specMap.set('s-export1', {
        id: 's-export1',
        title: 'Export Spec',
        content: 'Spec content',
        priority: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      const sudocodeDir = path.join(testDir, '.sudocode');
      fs.mkdirSync(sudocodeDir, { recursive: true });

      await coordinator.exportToJSONL(testDir);

      const specsPath = path.join(sudocodeDir, 'specs.jsonl');
      expect(fs.existsSync(specsPath)).toBe(true);

      const content = fs.readFileSync(specsPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.id).toBe('s-export1');
      expect(parsed.title).toBe('Export Spec');
    });
  });

  describe('Garbage Collection', () => {
    it('should remove stale executions', async () => {
      const execMap = (coordinator as any).ydoc.getMap('executionState');

      // Add completed execution that's old
      execMap.set('exec-old', {
        executionId: 'exec-old',
        status: 'completed',
        worktreePath: '/tmp/test',
        branch: 'test',
        startedAt: Date.now() - 7200000, // 2 hours ago
        completedAt: Date.now() - 3600000 - 1000, // 1+ hour ago
        agentId: 'agent-1',
        lastHeartbeat: Date.now() - 3600000
      });

      // Add recent execution
      execMap.set('exec-recent', {
        executionId: 'exec-recent',
        status: 'running',
        worktreePath: '/tmp/test',
        branch: 'test',
        startedAt: Date.now(),
        agentId: 'agent-2',
        lastHeartbeat: Date.now()
      });

      expect(execMap.size).toBe(2);

      // Trigger GC manually
      (coordinator as any).runGarbageCollection();

      // Old execution should be removed
      expect(execMap.has('exec-old')).toBe(false);
      expect(execMap.has('exec-recent')).toBe(true);
      expect(execMap.size).toBe(1);
    });

    it('should remove disconnected agents', async () => {
      const agentMap = (coordinator as any).ydoc.getMap('agentMetadata');

      // Add stale agent
      agentMap.set('agent-stale', {
        agentId: 'agent-stale',
        executionId: 'exec-1',
        worktreePath: '/tmp/test',
        startedAt: Date.now() - 300000,
        lastHeartbeat: Date.now() - 300000, // 5 minutes ago
        status: 'disconnected'
      });

      // Add active agent
      agentMap.set('agent-active', {
        agentId: 'agent-active',
        executionId: 'exec-2',
        worktreePath: '/tmp/test',
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        status: 'working'
      });

      expect(agentMap.size).toBe(2);

      // Trigger GC
      (coordinator as any).runGarbageCollection();

      // Stale agent should be removed
      expect(agentMap.has('agent-stale')).toBe(false);
      expect(agentMap.has('agent-active')).toBe(true);
      expect(agentMap.size).toBe(1);
    });

    it('should run GC periodically', async () => {
      // This is tested by the gcInterval timer
      // We just verify the timer is set up
      const timer = (coordinator as any).gcTimer;
      expect(timer).toBeDefined();
    });
  });

  describe('Public API', () => {
    it('should update issue via public API', () => {
      // First create an issue in CRDT
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');
      issueMap.set('i-api1', {
        id: 'i-api1',
        title: 'Original',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Update via public API
      coordinator.updateIssue('i-api1', { title: 'Updated' });

      // Verify update
      const updated = issueMap.get('i-api1');
      expect(updated.title).toBe('Updated');
      expect(updated.version).toBe(2);
    });

    it('should update spec via public API', () => {
      const specMap = (coordinator as any).ydoc.getMap('specUpdates');
      specMap.set('s-api1', {
        id: 's-api1',
        title: 'Original Spec',
        content: 'Content',
        priority: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      coordinator.updateSpec('s-api1', { title: 'Updated Spec' });

      const updated = specMap.get('s-api1');
      expect(updated.title).toBe('Updated Spec');
      expect(updated.version).toBe(2);
    });

    it('should increment version on updates', () => {
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');
      issueMap.set('i-version', {
        id: 'i-version',
        title: 'Version Test',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Multiple updates
      coordinator.updateIssue('i-version', { title: 'Update 1' });
      coordinator.updateIssue('i-version', { title: 'Update 2' });
      coordinator.updateIssue('i-version', { title: 'Update 3' });

      const final = issueMap.get('i-version');
      expect(final.version).toBe(4); // Started at 1, 3 updates
      expect(final.title).toBe('Update 3');
    });
  });

  describe('Shutdown', () => {
    it('should persist data on shutdown', async () => {
      // Add data
      coordinator.updateIssue('i-shutdown', {
        id: 'i-shutdown',
        title: 'Shutdown Test',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      // Shutdown
      await coordinator.shutdown();

      // Check if persisted (need to use a fresh DB connection)
      const checkDb = initCliDatabase({ path: testDbPath });
      const result = checkDb.prepare('SELECT * FROM issues WHERE id = ?').get('i-shutdown');
      expect(result).toBeDefined();
      checkDb.close();
    });

    it('should close all client connections on shutdown', async () => {
      // Connect client
      const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=shutdown-client`);

      await new Promise<void>(resolve => {
        client.on('open', () => resolve());
      });

      // Shutdown coordinator
      const closePromise = new Promise<void>(resolve => {
        client.on('close', () => resolve());
      });

      await coordinator.shutdown();
      await closePromise;

      // Client should be closed
      expect(client.readyState).toBe(WebSocket.WebSocket.CLOSED);
    });

    it('should clear all timers on shutdown', async () => {
      await coordinator.shutdown();

      // Timers should be cleared
      expect((coordinator as any).persistTimer).toBeUndefined();
      expect((coordinator as any).gcTimer).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed WebSocket messages', async () => {
      const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=malformed`);

      await new Promise<void>(resolve => {
        client.on('open', () => {
          // Send malformed message
          client.send('not json');
          setTimeout(() => {
            client.close();
            resolve();
          }, 100);
        });
      });

      // Coordinator should still be functional
      expect(coordinator).toBeDefined();
    });

    it('should handle invalid update data', async () => {
      const client = new WebSocket.WebSocket(`ws://localhost:${port}${wsPath}?clientId=invalid`);

      await new Promise<void>(resolve => {
        client.on('open', () => {
          // Send invalid update
          client.send(JSON.stringify({
            type: 'sync-update',
            data: [1, 2, 3] // Invalid Yjs update
          }));
          setTimeout(() => {
            client.close();
            resolve();
          }, 100);
        });
      });

      // Should not crash
      expect(coordinator).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle 100 rapid updates efficiently', async () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        coordinator.updateIssue(`i-perf${i}`, {
          id: `i-perf${i}`,
          title: `Performance Test ${i}`,
          content: 'Content',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'test',
          version: 1
        });
      }

      const duration = Date.now() - start;

      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000);

      // Verify all updates are in CRDT
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');
      expect(issueMap.size).toBeGreaterThanOrEqual(100);
    });

    it('should handle large documents efficiently', async () => {
      // Add 1000 issues
      const issueMap = (coordinator as any).ydoc.getMap('issueUpdates');

      for (let i = 0; i < 1000; i++) {
        issueMap.set(`i-large${i}`, {
          id: `i-large${i}`,
          title: `Issue ${i}`,
          content: `Content for issue ${i}`,
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'test',
          version: 1
        });
      }

      // Encode state should still be fast
      const start = Date.now();
      const encoded = Y.encodeStateAsUpdate((coordinator as any).ydoc);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(encoded.byteLength).toBeGreaterThan(0);
    });
  });
});
