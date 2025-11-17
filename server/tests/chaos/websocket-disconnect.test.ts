/**
 * WebSocket Disconnect Chaos Tests
 *
 * Tests CRDT system behavior when WebSocket connections drop unexpectedly.
 * Validates reconnection logic, buffering, and sync recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CRDTAgent } from '../../src/execution/crdt-agent.js';
import { CRDTCoordinator } from '../../src/services/crdt-coordinator.js';
import * as Database from 'better-sqlite3';
import { initDatabase as initCliDatabase } from '@sudocode-ai/cli/dist/db.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WebSocket Disconnect Chaos Tests', () => {
  let db: Database.Database;
  let coordinator: CRDTCoordinator;
  let testDbPath: string;
  let testDir: string;
  let server: http.Server;
  let port: number;
  let wsPath: string;
  let coordinatorUrl: string;

  beforeEach(async () => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-ws-disc-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 37000 + Math.floor(Math.random() * 1000);
    wsPath = '/ws/crdt';

    // Create HTTP server
    server = http.createServer();

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(port, () => resolve());
    });

    // Create coordinator
    coordinator = new CRDTCoordinator(db, {
      path: wsPath,
      persistInterval: 100,
      gcInterval: 60000
    });
    coordinator.init(server);

    // Construct coordinator URL
    coordinatorUrl = `ws://localhost:${port}${wsPath}`;
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
    if (db && db.open) {
      db.close();
    }

    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Agent reconnects after WebSocket close', () => {
    it('should automatically reconnect when WebSocket closes', async () => {
      console.log('\nWebSocket Disconnect Test - Auto Reconnection:');

      const agent = new CRDTAgent({
        agentId: 'reconnect-agent',
        coordinatorUrl,
        reconnectInterval: 500,
        maxReconnectAttempts: 5
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Agent connected');

      // Create initial issue
      agent.updateIssue('i-ws-disconnect', {
        id: 'i-ws-disconnect',
        title: 'Before Disconnect',
        content: 'Initial',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'reconnect-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Closing WebSocket connection...');

      // Close WebSocket
      const ws = (agent as any).ws;
      ws.close();

      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  WebSocket closed');
      console.log('  Waiting for automatic reconnection...');

      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Check if reconnected
      const newWs = (agent as any).ws;
      const isConnected = newWs && newWs.readyState === 1; // OPEN

      console.log(`  Reconnection status: ${isConnected ? '✓' : '✗'}`);

      expect(isConnected).toBe(true);

      await agent.disconnect();
    }, 10000);
  });

  describe('Updates buffer during disconnect', () => {
    it('should queue updates locally when WebSocket is closed', async () => {
      console.log('\nWebSocket Disconnect Test - Local Buffering:');

      const agent = new CRDTAgent({
        agentId: 'buffer-agent',
        coordinatorUrl,
        reconnectInterval: 2000 // Long interval to keep disconnected
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Agent connected');

      // Close WebSocket
      const ws = (agent as any).ws;
      ws.close();

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  WebSocket closed');
      console.log('  Making updates while disconnected...');

      // Make updates while disconnected
      const testIssues = ['i-buffer-1', 'i-buffer-2', 'i-buffer-3'];
      for (const issueId of testIssues) {
        agent.updateIssue(issueId, {
          id: issueId,
          title: `Buffered ${issueId}`,
          content: 'Created while disconnected',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'buffer-agent',
          version: 1
        });
      }

      console.log(`  Created ${testIssues.length} issues while disconnected`);

      // Verify local state has updates
      const agentYdoc = (agent as any).ydoc;
      const issueMap = agentYdoc.getMap('issueUpdates');

      let localCount = 0;
      for (const issueId of testIssues) {
        if (issueMap.get(issueId)) {
          localCount++;
        }
      }

      console.log(`  Local state: ${localCount}/${testIssues.length} issues`);

      expect(localCount).toBe(testIssues.length);

      await agent.disconnect();
    });
  });

  describe('Buffered updates sync after reconnect', () => {
    it('should sync all buffered updates when reconnected', async () => {
      console.log('\nWebSocket Disconnect Test - Sync After Reconnect:');

      const agent = new CRDTAgent({
        agentId: 'sync-agent',
        coordinatorUrl,
        reconnectInterval: 500
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Agent connected');

      // Close WebSocket
      const ws = (agent as any).ws;
      ws.close();

      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  WebSocket closed');
      console.log('  Creating updates while disconnected...');

      // Create updates while disconnected
      const testIssues = ['i-sync-1', 'i-sync-2', 'i-sync-3', 'i-sync-4'];
      for (const issueId of testIssues) {
        agent.updateIssue(issueId, {
          id: issueId,
          title: `Sync Test ${issueId}`,
          content: 'Should sync after reconnect',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'sync-agent',
          version: 1
        });
      }

      console.log(`  Created ${testIssues.length} issues while disconnected`);
      console.log('  Waiting for reconnection and sync...');

      // Wait for reconnection and sync
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check coordinator state
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let syncedCount = 0;
      for (const issueId of testIssues) {
        const issue = issueMap.get(issueId);
        if (issue && issue.title === `Sync Test ${issueId}`) {
          syncedCount++;
        }
      }

      console.log(`  Synced ${syncedCount}/${testIssues.length} issues to coordinator`);

      expect(syncedCount).toBe(testIssues.length);

      await agent.disconnect();
    }, 10000);
  });

  describe('Multiple disconnect-reconnect cycles', () => {
    it('should handle repeated disconnect-reconnect cycles', async () => {
      console.log('\nWebSocket Disconnect Test - Multiple Cycles:');

      const agent = new CRDTAgent({
        agentId: 'cycle-agent',
        coordinatorUrl,
        reconnectInterval: 300
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Starting 3 disconnect-reconnect cycles...');

      for (let cycle = 0; cycle < 3; cycle++) {
        console.log(`\n  Cycle ${cycle + 1}:`);

        // Create an issue
        agent.updateIssue(`i-cycle-${cycle}`, {
          id: `i-cycle-${cycle}`,
          title: `Cycle ${cycle}`,
          content: `Created in cycle ${cycle}`,
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'cycle-agent',
          version: 1
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        console.log(`    Created issue i-cycle-${cycle}`);

        // Disconnect
        let ws = (agent as any).ws;
        ws.close();

        await new Promise(resolve => setTimeout(resolve, 200));

        console.log('    Disconnected');

        // Wait for reconnection with polling
        let attempts = 0;
        let isConnected = false;
        while (attempts < 20 && !isConnected) {
          await new Promise(resolve => setTimeout(resolve, 200));
          ws = (agent as any).ws;
          isConnected = ws && ws.readyState === 1;
          attempts++;
        }

        console.log(`    Reconnected: ${isConnected ? '✓' : '✗'} (took ${attempts * 200}ms)`);

        expect(isConnected).toBe(true);
      }

      // Wait for final sync
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify all issues synced
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let syncedCount = 0;
      for (let cycle = 0; cycle < 3; cycle++) {
        if (issueMap.get(`i-cycle-${cycle}`)) {
          syncedCount++;
        }
      }

      console.log(`\n  Final: ${syncedCount}/3 issues synced across all cycles`);

      expect(syncedCount).toBe(3);

      await agent.disconnect();
    }, 20000);
  });

  describe('Disconnect during active sync', () => {
    it('should handle disconnect during sync operation', async () => {
      console.log('\nWebSocket Disconnect Test - Disconnect During Sync:');

      const agent1 = new CRDTAgent({
        agentId: 'sync-source',
        coordinatorUrl
      });

      const agent2 = new CRDTAgent({
        agentId: 'sync-target',
        coordinatorUrl,
        reconnectInterval: 500
      });

      await Promise.all([agent1.connect(), agent2.connect()]);
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Both agents connected');

      // Agent1 creates several issues
      console.log('  Agent1 creating issues...');
      for (let i = 0; i < 5; i++) {
        agent1.updateIssue(`i-sync-${i}`, {
          id: `i-sync-${i}`,
          title: `Sync ${i}`,
          content: 'Data',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'sync-source',
          version: 1
        });

        // Disconnect agent2 mid-way through
        if (i === 2) {
          const ws2 = (agent2 as any).ws;
          ws2.close();
          console.log('  Agent2 disconnected mid-sync');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      console.log('  Agent1 finished creating issues');
      console.log('  Waiting for agent2 to reconnect and sync...');

      // Wait for agent2 to reconnect and sync
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify agent2 has all issues
      const agent2Ydoc = (agent2 as any).ydoc;
      const issueMap = agent2Ydoc.getMap('issueUpdates');

      let syncedCount = 0;
      for (let i = 0; i < 5; i++) {
        if (issueMap.get(`i-sync-${i}`)) {
          syncedCount++;
        }
      }

      console.log(`  Agent2 synced ${syncedCount}/5 issues after reconnection`);

      expect(syncedCount).toBe(5);

      await Promise.all([agent1.disconnect(), agent2.disconnect()]);
    }, 10000);
  });

  describe('Coordinator handles client disconnect gracefully', () => {
    it('should clean up resources when client disconnects', async () => {
      console.log('\nWebSocket Disconnect Test - Coordinator Cleanup:');

      const agents: CRDTAgent[] = [];

      // Create 3 agents
      for (let i = 0; i < 3; i++) {
        const agent = new CRDTAgent({
          agentId: `cleanup-agent-${i}`,
          coordinatorUrl
        });
        agents.push(agent);
        await agent.connect();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  3 agents connected');

      const wss = (coordinator as any).wss;
      const initialCount = wss.clients.size;
      console.log(`  Initial WebSocket clients: ${initialCount}`);

      // Disconnect all agents
      console.log('  Disconnecting all agents...');
      for (const agent of agents) {
        const ws = (agent as any).ws;
        ws.close();
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const finalCount = wss.clients.size;
      console.log(`  Final WebSocket clients: ${finalCount}`);

      // All clients should be cleaned up
      expect(finalCount).toBe(0);
    });
  });
});
