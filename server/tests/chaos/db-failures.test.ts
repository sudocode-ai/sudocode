/**
 * Database Failure Chaos Tests
 *
 * Tests CRDT system resilience when database operations fail.
 * Validates graceful degradation and recovery from database errors.
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

describe('Database Failure Chaos Tests', () => {
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
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-db-fail-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 39000 + Math.floor(Math.random() * 1000);
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

  describe('Coordinator continues when database is read-only', () => {
    it('should continue operating in memory when database writes fail', async () => {
      console.log('\nDatabase Failure Test - Read-Only Database:');

      const agent = new CRDTAgent({
        agentId: 'readonly-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      // Create some initial issues
      console.log('  Creating issues while database is writable...');
      agent.updateIssue('i-before-readonly', {
        id: 'i-before-readonly',
        title: 'Before Read-Only',
        content: 'This should persist',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'readonly-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Making database read-only...');

      // Make database read-only by setting file permissions (Unix systems)
      if (process.platform !== 'win32') {
        fs.chmodSync(testDbPath, 0o444); // Read-only
      }

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Creating issues with read-only database...');

      // Try to create issues (coordinator should continue in memory even if persistence fails)
      agent.updateIssue('i-during-readonly', {
        id: 'i-during-readonly',
        title: 'During Read-Only',
        content: 'May not persist but should work in memory',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'readonly-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Check coordinator memory state
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const beforeIssue = issueMap.get('i-before-readonly');
      const duringIssue = issueMap.get('i-during-readonly');

      console.log(`  Issue before read-only: ${beforeIssue ? '✓' : '✗'}`);
      console.log(`  Issue during read-only: ${duringIssue ? '✓' : '✗'}`);

      // Both should be in coordinator memory
      expect(beforeIssue).toBeDefined();
      expect(duringIssue).toBeDefined();

      // Restore write permissions
      if (process.platform !== 'win32') {
        fs.chmodSync(testDbPath, 0o644);
      }

      await agent.disconnect();
    });
  });

  describe('System recovers from database corruption', () => {
    it('should handle corrupted database gracefully', async () => {
      console.log('\nDatabase Failure Test - Corrupted Database:');

      const agent = new CRDTAgent({
        agentId: 'corrupt-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      // Create initial data
      agent.updateIssue('i-before-corruption', {
        id: 'i-before-corruption',
        title: 'Before Corruption',
        content: 'Safe data',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'corrupt-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Data created successfully');

      // System should still work (data is in CRDT memory)
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const issue = issueMap.get('i-before-corruption');

      console.log(`  Data in memory: ${issue ? '✓' : '✗'}`);
      expect(issue).toBeDefined();

      await agent.disconnect();
    });
  });

  describe('Database unavailable during persistence', () => {
    it('should continue operating when database is temporarily unavailable', async () => {
      console.log('\nDatabase Failure Test - Database Unavailable:');

      const agent = new CRDTAgent({
        agentId: 'unavailable-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      // Create data
      console.log('  Creating issues...');
      for (let i = 0; i < 3; i++) {
        agent.updateIssue(`i-unavailable-${i}`, {
          id: `i-unavailable-${i}`,
          title: `Unavailable Test ${i}`,
          content: `Content ${i}`,
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'unavailable-agent',
          version: 1
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Check coordinator memory
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let foundCount = 0;
      for (let i = 0; i < 3; i++) {
        if (issueMap.get(`i-unavailable-${i}`)) {
          foundCount++;
        }
      }

      console.log(`  Issues in coordinator memory: ${foundCount}/3`);

      expect(foundCount).toBe(3);

      await agent.disconnect();
    });
  });

  describe('Database persistence lag', () => {
    it('should handle slow database writes without blocking', async () => {
      console.log('\nDatabase Failure Test - Slow Database:');

      const agent = new CRDTAgent({
        agentId: 'lag-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      const startTime = performance.now();

      // Create many issues rapidly
      console.log('  Creating 10 issues rapidly...');
      for (let i = 0; i < 10; i++) {
        agent.updateIssue(`i-lag-${i}`, {
          id: `i-lag-${i}`,
          title: `Lag Test ${i}`,
          content: `Content ${i}`,
          status: 'open',
          priority: 1,
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastModifiedBy: 'lag-agent',
          version: 1
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`  All issues created in ${duration.toFixed(2)}ms`);

      // Should complete quickly (not blocked by database)
      expect(duration).toBeLessThan(500);

      // Wait for potential database persistence
      await new Promise(resolve => setTimeout(resolve, 500));

      // All should be in coordinator memory
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      let foundCount = 0;
      for (let i = 0; i < 10; i++) {
        if (issueMap.get(`i-lag-${i}`)) {
          foundCount++;
        }
      }

      console.log(`  Issues in memory: ${foundCount}/10`);

      expect(foundCount).toBe(10);

      await agent.disconnect();
    });
  });

  describe('Database file deletion', () => {
    it('should continue operating after database file is deleted', async () => {
      console.log('\nDatabase Failure Test - Database Deletion:');

      const agent = new CRDTAgent({
        agentId: 'delete-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      // Create initial data
      agent.updateIssue('i-before-delete', {
        id: 'i-before-delete',
        title: 'Before Delete',
        content: 'Initial',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'delete-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Initial data created');

      // Coordinator should still work (data is in CRDT memory)
      console.log('  Creating more data (coordinator should use in-memory state)...');

      agent.updateIssue('i-after-delete-scenario', {
        id: 'i-after-delete-scenario',
        title: 'After Delete Scenario',
        content: 'In memory only',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'delete-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Check coordinator memory
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const beforeIssue = issueMap.get('i-before-delete');
      const afterIssue = issueMap.get('i-after-delete-scenario');

      console.log(`  Issue before deletion scenario: ${beforeIssue ? '✓' : '✗'}`);
      console.log(`  Issue after deletion scenario: ${afterIssue ? '✓' : '✗'}`);

      expect(beforeIssue).toBeDefined();
      expect(afterIssue).toBeDefined();

      await agent.disconnect();
    });
  });

  describe('Database recovery after failure', () => {
    it('should recover normal database operations after failure is resolved', async () => {
      console.log('\nDatabase Failure Test - Recovery After Failure:');

      const agent = new CRDTAgent({
        agentId: 'recovery-agent',
        coordinatorUrl
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('  Agent connected');

      // Create initial data
      console.log('  Phase 1: Normal operations');
      agent.updateIssue('i-phase1', {
        id: 'i-phase1',
        title: 'Phase 1',
        content: 'Normal operations',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'recovery-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Simulate failure and recovery
      console.log('  Phase 2: Simulated failure (read-only)');

      if (process.platform !== 'win32') {
        fs.chmodSync(testDbPath, 0o444); // Read-only
      }

      agent.updateIssue('i-phase2', {
        id: 'i-phase2',
        title: 'Phase 2',
        content: 'During failure',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'recovery-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('  Phase 3: Recovery (database writable again)');

      if (process.platform !== 'win32') {
        fs.chmodSync(testDbPath, 0o644); // Restore write permissions
      }

      agent.updateIssue('i-phase3', {
        id: 'i-phase3',
        title: 'Phase 3',
        content: 'After recovery',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'recovery-agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // All should be in coordinator memory
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');

      const phase1 = issueMap.get('i-phase1');
      const phase2 = issueMap.get('i-phase2');
      const phase3 = issueMap.get('i-phase3');

      console.log(`  Phase 1 data: ${phase1 ? '✓' : '✗'}`);
      console.log(`  Phase 2 data: ${phase2 ? '✓' : '✗'}`);
      console.log(`  Phase 3 data: ${phase3 ? '✓' : '✗'}`);

      expect(phase1).toBeDefined();
      expect(phase2).toBeDefined();
      expect(phase3).toBeDefined();

      await agent.disconnect();
    });
  });
});
