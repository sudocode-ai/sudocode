/**
 * Agent Crash Chaos Tests
 *
 * Tests CRDT system resilience when agents crash unexpectedly.
 * Validates that coordinator and other agents continue working correctly.
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

describe('Agent Crash Chaos Tests', () => {
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
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-agent-crash-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 36000 + Math.floor(Math.random() * 1000);
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

  describe('Coordinator continues after agent crash', () => {
    it('should remain operational when an agent crashes', async () => {
      console.log('\nAgent Crash Test - Coordinator Resilience:');

      const agent1 = new CRDTAgent({
        agentId: 'crash-agent-1',
        coordinatorUrl
      });

      const agent2 = new CRDTAgent({
        agentId: 'stable-agent',
        coordinatorUrl
      });

      await Promise.all([agent1.connect(), agent2.connect()]);
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Both agents connected');

      // Agent1 creates an issue
      agent1.updateIssue('i-before-crash', {
        id: 'i-before-crash',
        title: 'Before Crash',
        content: 'Created before agent crash',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'crash-agent-1',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Simulating agent1 crash (abrupt disconnect)...');

      // Simulate crash - close WebSocket without proper cleanup
      const ws1 = (agent1 as any).ws;
      if (ws1) {
        ws1.terminate(); // More abrupt than close()
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent1 crashed');
      console.log('  Testing if coordinator and agent2 still work...');

      // Agent2 should still be able to create issues
      agent2.updateIssue('i-after-crash', {
        id: 'i-after-crash',
        title: 'After Crash',
        content: 'Created after agent1 crashed',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'stable-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify coordinator has both issues
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const issueBefore = issueMap.get('i-before-crash');
      const issueAfter = issueMap.get('i-after-crash');

      console.log(`  Issue before crash: ${issueBefore ? '✓' : '✗'}`);
      console.log(`  Issue after crash: ${issueAfter ? '✓' : '✗'}`);

      expect(issueBefore).toBeDefined();
      expect(issueAfter).toBeDefined();
      expect(issueAfter.title).toBe('After Crash');

      await agent2.disconnect();
    });
  });

  describe('Other agents unaffected by crash', () => {
    it('should not impact other agents when one crashes', async () => {
      console.log('\nAgent Crash Test - Agent Isolation:');

      const agents: CRDTAgent[] = [];

      // Create 5 agents
      for (let i = 0; i < 5; i++) {
        const agent = new CRDTAgent({
          agentId: `isolation-agent-${i}`,
          coordinatorUrl
        });
        agents.push(agent);
        await agent.connect();
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  5 agents connected');

      // All agents create initial issues
      for (let i = 0; i < agents.length; i++) {
        agents[i].updateIssue(`i-initial-${i}`, {
          id: `i-initial-${i}`,
          title: `Initial ${i}`,
          content: 'Initial state',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: `isolation-agent-${i}`,
          version: 1
        });
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  All agents created initial issues');
      console.log('  Crashing agent 2 (middle agent)...');

      // Crash agent 2 (middle one)
      const ws2 = (agents[2] as any).ws;
      if (ws2) {
        ws2.terminate();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent 2 crashed');
      console.log('  Other agents creating new issues...');

      // Other agents (0, 1, 3, 4) should still work
      const activeAgentIndices = [0, 1, 3, 4];
      for (const i of activeAgentIndices) {
        agents[i].updateIssue(`i-after-crash-${i}`, {
          id: `i-after-crash-${i}`,
          title: `After Crash ${i}`,
          content: 'Created after agent 2 crashed',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: `isolation-agent-${i}`,
          version: 1
        });
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify coordinator has all issues
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let successCount = 0;
      for (const i of activeAgentIndices) {
        const issue = issueMap.get(`i-after-crash-${i}`);
        if (issue) {
          successCount++;
        }
      }

      console.log(`  ${successCount}/4 active agents successfully created issues after crash`);

      expect(successCount).toBe(4);

      // Cleanup active agents (skip crashed agent 2)
      await Promise.all(
        activeAgentIndices.map(i => agents[i].disconnect())
      );
    });
  });

  describe('Coordinator cleans up crashed agent', () => {
    it('should remove crashed agent from active connections', async () => {
      console.log('\nAgent Crash Test - Connection Cleanup:');

      const agent = new CRDTAgent({
        agentId: 'cleanup-test-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Agent connected');

      // Get initial client count
      const wss = (coordinator as any).wss;
      const initialClientCount = wss.clients.size;
      console.log(`  Initial WebSocket clients: ${initialClientCount}`);

      // Simulate crash
      const ws = (agent as any).ws;
      if (ws) {
        ws.terminate();
      }

      // Wait for coordinator to detect disconnection
      await new Promise(resolve => setTimeout(resolve, 500));

      const finalClientCount = wss.clients.size;
      console.log(`  Final WebSocket clients: ${finalClientCount}`);

      // Client count should decrease by 1
      expect(finalClientCount).toBe(initialClientCount - 1);
    });
  });

  describe('Data persisted before crash is not lost', () => {
    it('should preserve all data created before agent crash', async () => {
      console.log('\nAgent Crash Test - Data Preservation:');

      const agent = new CRDTAgent({
        agentId: 'persistence-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Creating issues before crash...');

      // Create multiple issues
      const testIssues = ['i-persist-1', 'i-persist-2', 'i-persist-3'];
      for (const issueId of testIssues) {
        agent.updateIssue(issueId, {
          id: issueId,
          title: `Persistence Test ${issueId}`,
          content: 'This should persist',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'persistence-agent',
          version: 1
        });
      }

      // Wait for persistence to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      console.log(`  Created ${testIssues.length} issues`);
      console.log('  Simulating agent crash...');

      // Crash agent
      const ws = (agent as any).ws;
      if (ws) {
        ws.terminate();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent crashed');
      console.log('  Checking data in coordinator and database...');

      // Check coordinator memory
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      let coordCount = 0;
      for (const issueId of testIssues) {
        if (issueMap.get(issueId)) {
          coordCount++;
        }
      }

      console.log(`  Coordinator: ${coordCount}/${testIssues.length} issues`);

      // Check database
      const stmt = db.prepare('SELECT COUNT(*) as count FROM issues WHERE id IN (?, ?, ?)');
      const result = stmt.get(...testIssues) as { count: number };

      console.log(`  Database: ${result.count}/${testIssues.length} issues`);

      expect(coordCount).toBe(testIssues.length);
      expect(result.count).toBe(testIssues.length);
    });
  });

  describe('Agent can reconnect after crash', () => {
    it('should allow crashed agent to reconnect with same ID', async () => {
      console.log('\nAgent Crash Test - Reconnection After Crash:');

      const agentId = 'reconnect-after-crash-agent';

      // First connection
      let agent = new CRDTAgent({
        agentId,
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('  Agent connected (first time)');

      // Create an issue
      agent.updateIssue('i-reconnect-crash', {
        id: 'i-reconnect-crash',
        title: 'Before Crash',
        content: 'Original',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: agentId,
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Simulating crash...');

      // Simulate crash
      const ws1 = (agent as any).ws;
      if (ws1) {
        ws1.terminate();
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent crashed');
      console.log('  Reconnecting with same agent ID...');

      // Reconnect with same ID
      agent = new CRDTAgent({
        agentId, // Same ID
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 300));

      const ws2 = (agent as any).ws;
      const isConnected = ws2 && ws2.readyState === 1; // OPEN

      console.log(`  Reconnection status: ${isConnected ? '✓' : '✗'}`);

      if (isConnected) {
        // Should be able to see previous data after sync
        const agentYdoc = (agent as any).ydoc;
        const issueMap = agentYdoc.getMap('issueUpdates');
        const issue = issueMap.get('i-reconnect-crash');

        console.log(`  Previous data visible: ${issue ? '✓' : '✗'}`);
        expect(issue).toBeDefined();
        expect(issue.title).toBe('Before Crash');

        // Should be able to create new data
        agent.updateIssue('i-after-reconnect', {
          id: 'i-after-reconnect',
          title: 'After Reconnect',
          content: 'New data',
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: agentId,
          version: 1
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify coordinator received it
        const coordYdoc = (coordinator as any).ydoc;
        const coordIssueMap = coordYdoc.getMap('issueUpdates');
        const newIssue = coordIssueMap.get('i-after-reconnect');

        console.log(`  New data synced: ${newIssue ? '✓' : '✗'}`);
        expect(newIssue).toBeDefined();
      }

      expect(isConnected).toBe(true);

      await agent.disconnect();
    }, 10000);
  });
});
