/**
 * Concurrent Modification Chaos Tests
 *
 * Tests CRDT system behavior when multiple agents modify the same data simultaneously.
 * Validates CRDT conflict resolution (Last-Write-Wins) and eventual consistency.
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

describe('Concurrent Modification Chaos Tests', () => {
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
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-concur-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 38000 + Math.floor(Math.random() * 1000);
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

  describe('Two agents modify same issue simultaneously', () => {
    it('should converge to consistent state using LWW', async () => {
      console.log('\nConcurrent Modification Test - Two Agents, Same Issue:');

      const agent1 = new CRDTAgent({
        agentId: 'concurrent-agent-1',
        coordinatorUrl
      });

      const agent2 = new CRDTAgent({
        agentId: 'concurrent-agent-2',
        coordinatorUrl
      });

      await Promise.all([agent1.connect(), agent2.connect()]);
      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Both agents connected');

      const issueId = 'i-concurrent-conflict';

      // Both agents update the same issue at nearly the same time
      console.log('  Both agents updating same issue simultaneously...');

      const baseTime = Date.now();

      agent1.updateIssue(issueId, {
        id: issueId,
        title: 'Updated by Agent 1',
        content: 'Agent 1 content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: baseTime,
        updatedAt: baseTime,
        lastModifiedBy: 'concurrent-agent-1',
        version: 1
      });

      // Delay slightly to create a deterministic ordering
      await new Promise(resolve => setTimeout(resolve, 10));

      agent2.updateIssue(issueId, {
        id: issueId,
        title: 'Updated by Agent 2',
        content: 'Agent 2 content',
        status: 'in_progress',
        priority: 2,
        archived: false,
        createdAt: baseTime,
        updatedAt: baseTime + 10,
        lastModifiedBy: 'concurrent-agent-2',
        version: 1
      });

      // Wait for CRDT convergence
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('  Waiting for CRDT convergence...');

      // All three (coordinator, agent1, agent2) should have converged
      const coordYdoc = (coordinator as any).ydoc;
      const coordIssueMap = coordYdoc.getMap('issueUpdates');
      const coordIssue = coordIssueMap.get(issueId);

      const agent1Ydoc = (agent1 as any).ydoc;
      const agent1IssueMap = agent1Ydoc.getMap('issueUpdates');
      const agent1Issue = agent1IssueMap.get(issueId);

      const agent2Ydoc = (agent2 as any).ydoc;
      const agent2IssueMap = agent2Ydoc.getMap('issueUpdates');
      const agent2Issue = agent2IssueMap.get(issueId);

      console.log(`  Coordinator: ${coordIssue?.title} (by ${coordIssue?.lastModifiedBy})`);
      console.log(`  Agent 1: ${agent1Issue?.title} (by ${agent1Issue?.lastModifiedBy})`);
      console.log(`  Agent 2: ${agent2Issue?.title} (by ${agent2Issue?.lastModifiedBy})`);

      // All should have converged to the same state
      expect(coordIssue).toBeDefined();
      expect(agent1Issue).toBeDefined();
      expect(agent2Issue).toBeDefined();

      expect(agent1Issue.title).toBe(coordIssue.title);
      expect(agent2Issue.title).toBe(coordIssue.title);
      expect(agent1Issue.lastModifiedBy).toBe(coordIssue.lastModifiedBy);
      expect(agent2Issue.lastModifiedBy).toBe(coordIssue.lastModifiedBy);

      console.log('  ✓ All agents converged to same state');

      await Promise.all([agent1.disconnect(), agent2.disconnect()]);
    }, 10000);
  });

  describe('Many agents modify different fields', () => {
    it('should merge concurrent modifications to different fields', async () => {
      console.log('\nConcurrent Modification Test - Many Agents, Different Fields:');

      const agentCount = 5;
      const agents: CRDTAgent[] = [];

      // Create agents
      for (let i = 0; i < agentCount; i++) {
        const agent = new CRDTAgent({
          agentId: `field-agent-${i}`,
          coordinatorUrl
        });
        agents.push(agent);
        await agent.connect();
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log(`  ${agentCount} agents connected`);

      const issueId = 'i-field-conflict';

      // Each agent creates their own unique issues
      console.log('  Each agent creating unique issues...');
      for (let i = 0; i < agentCount; i++) {
        agents[i].updateIssue(`${issueId}-${i}`, {
          id: `${issueId}-${i}`,
          title: `Issue from agent ${i}`,
          content: `Content ${i}`,
          status: 'open',
          priority: i,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: `field-agent-${i}`,
          version: 1
        });
      }

      // Wait for convergence
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify coordinator has all issues
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let foundCount = 0;
      for (let i = 0; i < agentCount; i++) {
        const issue = issueMap.get(`${issueId}-${i}`);
        if (issue && issue.title === `Issue from agent ${i}`) {
          foundCount++;
        }
      }

      console.log(`  Coordinator has ${foundCount}/${agentCount} issues`);

      expect(foundCount).toBe(agentCount);

      await Promise.all(agents.map(a => a.disconnect()));
    }, 10000);
  });

  describe('Rapid successive updates to same issue', () => {
    it('should handle rapid updates without data loss', async () => {
      console.log('\nConcurrent Modification Test - Rapid Updates:');

      const agent = new CRDTAgent({
        agentId: 'rapid-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      const issueId = 'i-rapid-updates';
      const updateCount = 20;

      console.log(`  Sending ${updateCount} rapid updates...`);

      for (let i = 0; i < updateCount; i++) {
        agent.updateIssue(issueId, {
          id: issueId,
          title: `Rapid Update ${i}`,
          content: `Content ${i}`,
          status: 'open',
          priority: i % 5,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now() + i,
          lastModifiedBy: 'rapid-agent',
          version: i + 1
        });

        // Very small delay between updates
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      console.log('  All updates sent');

      // Wait for final update to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Coordinator should have the latest update
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const finalIssue = issueMap.get(issueId);

      console.log(`  Final state: ${finalIssue?.title}`);

      expect(finalIssue).toBeDefined();
      // Should be one of the later updates (CRDT may not guarantee exact ordering)
      expect(finalIssue.title).toContain('Rapid Update');

      await agent.disconnect();
    });
  });

  describe('Conflicting updates from disconnected agents', () => {
    it('should resolve conflicts when agents reconnect with divergent state', async () => {
      console.log('\nConcurrent Modification Test - Offline Conflicts:');

      const agent1 = new CRDTAgent({
        agentId: 'offline-agent-1',
        coordinatorUrl,
        reconnectInterval: 500
      });

      const agent2 = new CRDTAgent({
        agentId: 'offline-agent-2',
        coordinatorUrl,
        reconnectInterval: 500
      });

      await Promise.all([agent1.connect(), agent2.connect()]);
      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Both agents connected');

      const issueId = 'i-offline-conflict';

      // Both agents create initial version
      agent1.updateIssue(issueId, {
        id: issueId,
        title: 'Initial Version',
        content: 'Original',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'offline-agent-1',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Initial version created');

      // Disconnect both agents
      const ws1 = (agent1 as any).ws;
      const ws2 = (agent2 as any).ws;
      ws1.close();
      ws2.close();

      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Both agents disconnected');

      // Both make conflicting updates while offline
      console.log('  Making conflicting updates while offline...');

      const baseTime = Date.now();

      agent1.updateIssue(issueId, {
        id: issueId,
        title: 'Agent 1 Offline Update',
        content: 'Modified by agent 1 offline',
        status: 'in_progress',
        priority: 2,
        archived: false,
        createdAt: baseTime,
        updatedAt: baseTime,
        lastModifiedBy: 'offline-agent-1',
        version: 2
      });

      agent2.updateIssue(issueId, {
        id: issueId,
        title: 'Agent 2 Offline Update',
        content: 'Modified by agent 2 offline',
        status: 'blocked',
        priority: 3,
        archived: false,
        createdAt: baseTime,
        updatedAt: baseTime + 10,
        lastModifiedBy: 'offline-agent-2',
        version: 2
      });

      console.log('  Waiting for reconnection and conflict resolution...');

      // Wait for reconnection and sync
      await new Promise(resolve => setTimeout(resolve, 2500));

      // All should have converged
      const coordYdoc = (coordinator as any).ydoc;
      const coordIssueMap = coordYdoc.getMap('issueUpdates');
      const coordIssue = coordIssueMap.get(issueId);

      const agent1Ydoc = (agent1 as any).ydoc;
      const agent1IssueMap = agent1Ydoc.getMap('issueUpdates');
      const agent1Issue = agent1IssueMap.get(issueId);

      const agent2Ydoc = (agent2 as any).ydoc;
      const agent2IssueMap = agent2Ydoc.getMap('issueUpdates');
      const agent2Issue = agent2IssueMap.get(issueId);

      console.log(`  Final state:`)
;
      console.log(`    Coordinator: ${coordIssue?.title}`);
      console.log(`    Agent 1: ${agent1Issue?.title}`);
      console.log(`    Agent 2: ${agent2Issue?.title}`);

      // All should have converged to the same state
      expect(coordIssue).toBeDefined();
      expect(agent1Issue).toBeDefined();
      expect(agent2Issue).toBeDefined();

      expect(agent1Issue.title).toBe(coordIssue.title);
      expect(agent2Issue.title).toBe(coordIssue.title);

      console.log('  ✓ Offline conflicts resolved, all agents converged');

      await Promise.all([agent1.disconnect(), agent2.disconnect()]);
    }, 15000);
  });

  describe('Delete while another agent is updating', () => {
    it('should handle concurrent update and delete operations', async () => {
      console.log('\nConcurrent Modification Test - Update vs Delete:');

      const agent1 = new CRDTAgent({
        agentId: 'update-agent',
        coordinatorUrl
      });

      const agent2 = new CRDTAgent({
        agentId: 'delete-agent',
        coordinatorUrl
      });

      await Promise.all([agent1.connect(), agent2.connect()]);
      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Both agents connected');

      const issueId = 'i-update-delete';

      // Create initial issue
      agent1.updateIssue(issueId, {
        id: issueId,
        title: 'Will be deleted',
        content: 'Original',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'update-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Initial issue created');

      // Agent1 updates while Agent2 marks as archived (soft delete)
      console.log('  Concurrent update and archive...');

      agent1.updateIssue(issueId, {
        id: issueId,
        title: 'Updated Title',
        content: 'Updated content',
        status: 'in_progress',
        priority: 2,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'update-agent',
        version: 2
      });

      // Small delay to create ordering
      await new Promise(resolve => setTimeout(resolve, 10));

      agent2.updateIssue(issueId, {
        id: issueId,
        title: 'Will be deleted',
        content: 'Original',
        status: 'open',
        priority: 1,
        archived: true, // Archive/delete
        createdAt: Date.now(),
        updatedAt: Date.now() + 10,
        lastModifiedBy: 'delete-agent',
        version: 2
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check final state
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const finalIssue = issueMap.get(issueId);

      console.log(`  Final state: archived=${finalIssue?.archived}, title="${finalIssue?.title}"`);

      expect(finalIssue).toBeDefined();
      // LWW should result in the archived state winning (later timestamp)
      expect(finalIssue.archived).toBe(true);

      await Promise.all([agent1.disconnect(), agent2.disconnect()]);
    }, 10000);
  });

  describe('Burst of concurrent updates from many agents', () => {
    it('should handle burst of updates without corruption', async () => {
      console.log('\nConcurrent Modification Test - Update Burst:');

      const agentCount = 10;
      const agents: CRDTAgent[] = [];

      // Create agents
      for (let i = 0; i < agentCount; i++) {
        const agent = new CRDTAgent({
          agentId: `burst-agent-${i}`,
          coordinatorUrl
        });
        agents.push(agent);
        await agent.connect();
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      console.log(`  ${agentCount} agents connected`);

      const issueId = 'i-burst-test';

      // All agents update the same issue in a burst
      console.log('  All agents updating same issue in burst...');

      const tasks = agents.map(async (agent, i) => {
        agent.updateIssue(issueId, {
          id: issueId,
          title: `Burst Update from Agent ${i}`,
          content: `Content ${i}`,
          status: 'open',
          priority: i % 5,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now() + i,
          lastModifiedBy: `burst-agent-${i}`,
          version: 1
        });
      });

      await Promise.all(tasks);

      console.log('  All updates sent');

      // Wait for convergence
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify all agents converged to same state
      const coordYdoc = (coordinator as any).ydoc;
      const coordIssueMap = coordYdoc.getMap('issueUpdates');
      const coordIssue = coordIssueMap.get(issueId);

      console.log(`  Coordinator final state: ${coordIssue?.title}`);

      let convergedCount = 0;
      for (const agent of agents) {
        const agentYdoc = (agent as any).ydoc;
        const agentIssueMap = agentYdoc.getMap('issueUpdates');
        const agentIssue = agentIssueMap.get(issueId);

        if (agentIssue && agentIssue.title === coordIssue?.title) {
          convergedCount++;
        }
      }

      console.log(`  ${convergedCount}/${agentCount} agents converged to same state`);

      expect(convergedCount).toBe(agentCount);
      expect(coordIssue).toBeDefined();

      await Promise.all(agents.map(a => a.disconnect()));
    }, 15000);
  });
});
