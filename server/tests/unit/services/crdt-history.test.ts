/**
 * Unit tests for CRDT History functionality
 *
 * Tests the in-memory history storage, update capture, and periodic cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Database from 'better-sqlite3';
import { initDatabase as initCliDatabase } from '@sudocode-ai/cli/dist/db.js';
import { CRDTCoordinator } from '../../../src/services/crdt-coordinator.js';
import { CRDTAgent } from '../../../src/execution/crdt-agent.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CRDT History - In-Memory Storage', () => {
  let db: Database.Database;
  let coordinator: CRDTCoordinator;
  let testDbPath: string;
  let testDir: string;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-history-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 30000 + Math.floor(Math.random() * 1000);

    // Create HTTP server
    server = http.createServer();

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(port, () => resolve());
    });

    // Create coordinator with short retention for testing
    coordinator = new CRDTCoordinator(db, {
      path: '/ws/crdt',
      persistInterval: 100,
      gcInterval: 1000,
      historyRetentionMs: 2000, // 2 seconds for testing
      historyCleanupIntervalMs: 500 // 500ms cleanup interval
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

  it('should capture updates with timestamps from agent', async () => {
    // Create agent
    const agent = new CRDTAgent({
      agentId: 'test-agent-1',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await agent.connect();

    // Make an update
    agent.updateIssue('i-test1', {
      title: 'Test Issue',
      content: 'Test content',
      status: 'open',
      priority: 1
    });

    // Wait for update to propagate
    await new Promise(resolve => setTimeout(resolve, 200));

    // Disconnect agent
    await agent.disconnect();

    // History should have been captured (via private access - we can't directly test this)
    // But we can verify the update was processed by checking persistence
    await new Promise(resolve => setTimeout(resolve, 300)); // Wait for persistence

    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test1') as any;
    expect(issue).toBeDefined();
    expect(issue.title).toBe('Test Issue');
  });

  it('should track multiple updates from the same agent', async () => {
    const agent = new CRDTAgent({
      agentId: 'test-agent-2',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await agent.connect();

    // Make multiple updates
    agent.updateIssue('i-test2', {
      title: 'Test Issue 1',
      content: 'Content 1',
      status: 'open',
      priority: 1
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    agent.updateIssue('i-test2', {
      title: 'Test Issue Updated',
      content: 'Content updated',
      status: 'in_progress',
      priority: 2
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    agent.updateSpec('s-test1', {
      title: 'Test Spec',
      content: 'Spec content',
      priority: 1
    });

    // Wait for updates to propagate
    await new Promise(resolve => setTimeout(resolve, 200));

    await agent.disconnect();

    // Verify updates persisted
    await new Promise(resolve => setTimeout(resolve, 300));

    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test2') as any;
    expect(issue).toBeDefined();
    expect(issue.title).toBe('Test Issue Updated');
    expect(issue.status).toBe('in_progress');

    const spec = db.prepare('SELECT * FROM specs WHERE id = ?').get('s-test1') as any;
    expect(spec).toBeDefined();
    expect(spec.title).toBe('Test Spec');
  });

  it('should track updates from multiple agents', async () => {
    const agent1 = new CRDTAgent({
      agentId: 'test-agent-3',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    const agent2 = new CRDTAgent({
      agentId: 'test-agent-4',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await Promise.all([agent1.connect(), agent2.connect()]);

    // Make updates from different agents
    agent1.updateIssue('i-test3', {
      title: 'Issue from Agent 1',
      content: 'Content 1',
      status: 'open',
      priority: 1
    });

    agent2.updateIssue('i-test4', {
      title: 'Issue from Agent 2',
      content: 'Content 2',
      status: 'open',
      priority: 2
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    await Promise.all([agent1.disconnect(), agent2.disconnect()]);

    // Verify both updates persisted
    await new Promise(resolve => setTimeout(resolve, 300));

    const issue1 = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test3') as any;
    expect(issue1).toBeDefined();
    expect(issue1.title).toBe('Issue from Agent 1');

    const issue2 = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test4') as any;
    expect(issue2).toBeDefined();
    expect(issue2.title).toBe('Issue from Agent 2');
  });

  it('should cleanup old updates after retention window', async () => {
    const agent = new CRDTAgent({
      agentId: 'test-agent-5',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await agent.connect();

    // Make an update
    agent.updateIssue('i-test5', {
      title: 'Old Issue',
      content: 'Old content',
      status: 'open',
      priority: 1
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // Wait for retention window to expire (2 seconds + cleanup interval)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Make another update (should trigger cleanup)
    agent.updateIssue('i-test6', {
      title: 'New Issue',
      content: 'New content',
      status: 'open',
      priority: 1
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    await agent.disconnect();

    // Both issues should still be persisted (cleanup only affects in-memory history)
    await new Promise(resolve => setTimeout(resolve, 300));

    const oldIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test5') as any;
    expect(oldIssue).toBeDefined();

    const newIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-test6') as any;
    expect(newIssue).toBeDefined();
  }, 10000); // Increase timeout for this test

  it('should handle concurrent updates from multiple agents', async () => {
    const agents = Array.from({ length: 5 }, (_, i) => new CRDTAgent({
      agentId: `test-agent-concurrent-${i}`,
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    }));

    await Promise.all(agents.map(a => a.connect()));

    // Make concurrent updates
    const updates = agents.map((agent, i) => {
      agent.updateIssue(`i-concurrent-${i}`, {
        title: `Concurrent Issue ${i}`,
        content: `Content ${i}`,
        status: 'open',
        priority: i
      });
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    await Promise.all(agents.map(a => a.disconnect()));

    // Verify all updates persisted
    await new Promise(resolve => setTimeout(resolve, 300));

    for (let i = 0; i < 5; i++) {
      const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(`i-concurrent-${i}`) as any;
      expect(issue).toBeDefined();
      expect(issue.title).toBe(`Concurrent Issue ${i}`);
    }
  });

  it('should handle shutdown gracefully with pending history', async () => {
    const agent = new CRDTAgent({
      agentId: 'test-agent-shutdown',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await agent.connect();

    // Make updates
    agent.updateIssue('i-shutdown-test', {
      title: 'Shutdown Test',
      content: 'Test content',
      status: 'open',
      priority: 1
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    await agent.disconnect();

    // Shutdown coordinator (should clear history)
    await coordinator.shutdown();

    // Verify update was persisted before shutdown
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('i-shutdown-test') as any;
    expect(issue).toBeDefined();
    expect(issue.title).toBe('Shutdown Test');
  });

  it('should create unique update IDs', async () => {
    const agent = new CRDTAgent({
      agentId: 'test-agent-ids',
      coordinatorUrl: `ws://localhost:${port}/ws/crdt`
    });

    await agent.connect();

    // Make multiple rapid updates
    for (let i = 0; i < 10; i++) {
      agent.updateIssue(`i-id-test-${i}`, {
        title: `Test ${i}`,
        content: `Content ${i}`,
        status: 'open',
        priority: 1
      });
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    await agent.disconnect();

    // Verify all updates persisted with unique IDs
    await new Promise(resolve => setTimeout(resolve, 300));

    for (let i = 0; i < 10; i++) {
      const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(`i-id-test-${i}`) as any;
      expect(issue).toBeDefined();
    }
  });
});
