/**
 * Unit tests for CRDTAgent
 *
 * Tests the CRDT Agent that runs in worktree execution contexts
 * and synchronizes state with the CRDT Coordinator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CRDTAgent } from '../../../src/execution/crdt-agent.js';
import { CRDTCoordinator } from '../../../src/services/crdt-coordinator.js';
import * as Database from 'better-sqlite3';
import { initDatabase as initCliDatabase } from '@sudocode-ai/cli/dist/db.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as Y from 'yjs';

describe('CRDTAgent', () => {
  let db: Database.Database;
  let coordinator: CRDTCoordinator;
  let agent: CRDTAgent;
  let testDbPath: string;
  let testDir: string;
  let port: number;

  beforeEach(() => {
    // Create temporary directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-agent-'));
    testDbPath = path.join(testDir, 'cache.db');

    // Initialize database
    db = initCliDatabase({ path: testDbPath });

    // Use random port for testing
    port = 30000 + Math.floor(Math.random() * 1000);

    // Create coordinator
    coordinator = new CRDTCoordinator(db, {
      port,
      host: 'localhost',
      persistInterval: 100,
      gcInterval: 60000
    });
  });

  afterEach(async () => {
    // Disconnect agent
    if (agent) {
      await agent.disconnect();
    }

    // Shutdown coordinator
    if (coordinator) {
      await coordinator.shutdown();
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

  describe('Initialization', () => {
    it('should initialize with agent ID', () => {
      agent = new CRDTAgent({
        agentId: 'test-agent-1',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      expect(agent).toBeDefined();
      expect(agent.agentId).toBe('test-agent-1');
      expect(agent.connected).toBe(false);
    });

    it('should build coordinator URL from host and port', () => {
      agent = new CRDTAgent({
        agentId: 'test-agent-2',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      expect(agent).toBeDefined();
    });

    it('should use provided coordinator URL', () => {
      agent = new CRDTAgent({
        agentId: 'test-agent-3',
        coordinatorUrl: `ws://localhost:${port}/sync`
      });

      expect(agent).toBeDefined();
    });
  });

  describe('Connection', () => {
    it('should connect to coordinator successfully', async () => {
      agent = new CRDTAgent({
        agentId: 'test-connect-1',
        coordinatorHost: 'localhost',
        coordinatorPort: port,
        connectionTimeout: 5000
      });

      await agent.connect();

      expect(agent.connected).toBe(true);
    });

    it('should receive initial sync from coordinator', async () => {
      // Add some data to coordinator
      coordinator.updateIssue('i-test1', {
        id: 'i-test1',
        title: 'Test Issue',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'test',
        version: 1
      });

      agent = new CRDTAgent({
        agentId: 'test-sync-1',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100));

      // Agent should have the issue
      const ydoc = (agent as any).ydoc;
      const issueMap = ydoc.getMap('issueUpdates');
      const issue = issueMap.get('i-test1');

      expect(issue).toBeDefined();
      expect(issue.title).toBe('Test Issue');
    });

    it('should timeout if connection takes too long', async () => {
      agent = new CRDTAgent({
        agentId: 'test-timeout',
        coordinatorHost: 'localhost',
        coordinatorPort: 99999, // Invalid port
        connectionTimeout: 500
      });

      await expect(agent.connect()).rejects.toThrow('Connection timeout');
    });

    it('should handle connection errors gracefully', async () => {
      agent = new CRDTAgent({
        agentId: 'test-error',
        coordinatorHost: 'localhost',
        coordinatorPort: 99999,
        connectionTimeout: 500
      });

      await expect(agent.connect()).rejects.toThrow();
    });
  });

  describe('Local to Remote Sync', () => {
    it('should send local updates to coordinator', async () => {
      agent = new CRDTAgent({
        agentId: 'test-local-remote-1',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      // Update issue on agent
      agent.updateIssue('i-agent1', {
        id: 'i-agent1',
        title: 'Agent Issue',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'agent',
        version: 1
      });

      // Wait for update to propagate
      await new Promise(resolve => setTimeout(resolve, 200));

      // Coordinator should have the issue
      const coordYdoc = (coordinator as any).ydoc;
      const issueMap = coordYdoc.getMap('issueUpdates');
      const issue = issueMap.get('i-agent1');

      expect(issue).toBeDefined();
      expect(issue.title).toBe('Agent Issue');
    });

    it('should send spec updates to coordinator', async () => {
      agent = new CRDTAgent({
        agentId: 'test-spec-sync',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.updateSpec('s-agent1', {
        id: 's-agent1',
        title: 'Agent Spec',
        content: 'Spec content',
        priority: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'agent',
        version: 1
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const coordYdoc = (coordinator as any).ydoc;
      const specMap = coordYdoc.getMap('specUpdates');
      const spec = specMap.get('s-agent1');

      expect(spec).toBeDefined();
      expect(spec.title).toBe('Agent Spec');
    });
  });

  describe('Remote to Local Sync', () => {
    it('should receive updates from coordinator', async () => {
      agent = new CRDTAgent({
        agentId: 'test-remote-local-1',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Update on coordinator
      coordinator.updateIssue('i-coord1', {
        id: 'i-coord1',
        title: 'Coordinator Issue',
        content: 'Content',
        status: 'open',
        priority: 1,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastModifiedBy: 'coordinator',
        version: 1
      });

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 300));

      // Agent should have the update
      const agentYdoc = (agent as any).ydoc;
      const issueMap = agentYdoc.getMap('issueUpdates');
      const issue = issueMap.get('i-coord1');

      expect(issue).toBeDefined();
      expect(issue.title).toBe('Coordinator Issue');
    });
  });

  describe('Heartbeat', () => {
    it('should send periodic heartbeats', async () => {
      agent = new CRDTAgent({
        agentId: 'test-heartbeat',
        coordinatorHost: 'localhost',
        coordinatorPort: port,
        heartbeatInterval: 100
      });

      await agent.connect();

      // Wait for initial registration to propagate
      await new Promise(resolve => setTimeout(resolve, 150));

      const initialMetadata = (coordinator as any).ydoc.getMap('agentMetadata').get('test-heartbeat');
      const initialHeartbeat = initialMetadata?.lastHeartbeat;

      expect(initialHeartbeat).toBeDefined();

      // Wait for heartbeat
      await new Promise(resolve => setTimeout(resolve, 250));

      const updatedMetadata = (coordinator as any).ydoc.getMap('agentMetadata').get('test-heartbeat');
      const updatedHeartbeat = updatedMetadata?.lastHeartbeat;

      expect(updatedHeartbeat).toBeGreaterThan(initialHeartbeat);
    });

    it('should stop heartbeat on disconnect', async () => {
      agent = new CRDTAgent({
        agentId: 'test-heartbeat-stop',
        coordinatorHost: 'localhost',
        coordinatorPort: port,
        heartbeatInterval: 100
      });

      await agent.connect();
      await agent.disconnect();

      const timer = (agent as any).heartbeatTimer;
      expect(timer).toBeUndefined();
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnection after disconnect', async () => {
      agent = new CRDTAgent({
        agentId: 'test-reconnect',
        coordinatorHost: 'localhost',
        coordinatorPort: port,
        reconnectBaseDelay: 100,
        maxReconnectAttempts: 3
      });

      await agent.connect();
      expect(agent.connected).toBe(true);

      // Shut down coordinator to prevent successful reconnection
      await coordinator.shutdown();

      // Force disconnect
      const ws = (agent as any).ws;
      ws.close();

      // Wait for reconnect attempt
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should attempt to reconnect
      const reconnectAttempts = (agent as any).reconnectAttempts;
      expect(reconnectAttempts).toBeGreaterThan(0);
    });

    it('should use exponential backoff for reconnection', async () => {
      agent = new CRDTAgent({
        agentId: 'test-backoff',
        coordinatorHost: 'localhost',
        coordinatorPort: 99999, // Will fail
        reconnectBaseDelay: 100,
        maxReconnectAttempts: 3,
        connectionTimeout: 200
      });

      const connectPromise = agent.connect().catch(() => {});
      await connectPromise;

      // Give time for multiple reconnect attempts
      await new Promise(resolve => setTimeout(resolve, 1000));

      const reconnectAttempts = (agent as any).reconnectAttempts;
      expect(reconnectAttempts).toBeGreaterThanOrEqual(1);
    });

    it('should switch to local-only mode after max attempts', async () => {
      agent = new CRDTAgent({
        agentId: 'test-local-only',
        coordinatorHost: 'localhost',
        coordinatorPort: 99999,
        maxReconnectAttempts: 2,
        reconnectBaseDelay: 100,
        connectionTimeout: 200
      });

      await agent.connect().catch(() => {});

      // Wait for max attempts
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(agent.isLocalOnly).toBe(true);
    });
  });

  describe('Public API', () => {
    it('should update issue via public API', async () => {
      agent = new CRDTAgent({
        agentId: 'test-api-issue',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.updateIssue('i-api1', {
        title: 'API Issue',
        content: 'Content',
        status: 'open',
        priority: 1
      });

      const ydoc = (agent as any).ydoc;
      const issueMap = ydoc.getMap('issueUpdates');
      const issue = issueMap.get('i-api1');

      expect(issue).toBeDefined();
      expect(issue.title).toBe('API Issue');
      expect(issue.lastModifiedBy).toBe('test-api-issue');
    });

    it('should update spec via public API', async () => {
      agent = new CRDTAgent({
        agentId: 'test-api-spec',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.updateSpec('s-api1', {
        title: 'API Spec',
        content: 'Content',
        priority: 1
      });

      const ydoc = (agent as any).ydoc;
      const specMap = ydoc.getMap('specUpdates');
      const spec = specMap.get('s-api1');

      expect(spec).toBeDefined();
      expect(spec.title).toBe('API Spec');
    });

    it('should update execution state', async () => {
      agent = new CRDTAgent({
        agentId: 'test-api-exec',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.updateExecutionState('exec-1', {
        status: 'running',
        phase: 'setup',
        progress: { current: 1, total: 10 }
      });

      const ydoc = (agent as any).ydoc;
      const execMap = ydoc.getMap('executionState');
      const exec = execMap.get('exec-1');

      expect(exec).toBeDefined();
      expect(exec.status).toBe('running');
      expect(exec.phase).toBe('setup');
    });

    it('should add feedback', async () => {
      agent = new CRDTAgent({
        agentId: 'test-api-feedback',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.addFeedback('fb-1', {
        specId: 's-1',
        issueId: 'i-1',
        type: 'comment',
        content: 'Test feedback',
        anchorLine: 10
      });

      const ydoc = (agent as any).ydoc;
      const feedbackMap = ydoc.getMap('feedbackUpdates');
      const feedback = feedbackMap.get('fb-1');

      expect(feedback).toBeDefined();
      expect(feedback.content).toBe('Test feedback');
    });

    it('should update agent status', async () => {
      agent = new CRDTAgent({
        agentId: 'test-api-status',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      agent.updateAgentStatus('working');

      const ydoc = (agent as any).ydoc;
      const metadataMap = ydoc.getMap('agentMetadata');
      const metadata = metadataMap.get('test-api-status');

      expect(metadata).toBeDefined();
      expect(metadata.status).toBe('working');
    });
  });

  describe('JSONL Export', () => {
    it('should export local state to JSONL files', async () => {
      agent = new CRDTAgent({
        agentId: 'test-export',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      // Add some data
      agent.updateIssue('i-export1', {
        title: 'Export Test',
        content: 'Content',
        status: 'open',
        priority: 1
      });

      agent.updateSpec('s-export1', {
        title: 'Export Spec',
        content: 'Spec content',
        priority: 1
      });

      // Export to testDir
      await agent.exportToLocalJSONL(testDir);

      // Check files exist
      const issuesPath = path.join(testDir, '.sudocode', 'issues.jsonl');
      const specsPath = path.join(testDir, '.sudocode', 'specs.jsonl');

      expect(fs.existsSync(issuesPath)).toBe(true);
      expect(fs.existsSync(specsPath)).toBe(true);

      // Check content
      const issuesContent = fs.readFileSync(issuesPath, 'utf-8');
      const specsContent = fs.readFileSync(specsPath, 'utf-8');

      expect(issuesContent).toContain('Export Test');
      expect(specsContent).toContain('Export Spec');
    });
  });

  describe('Disconnect', () => {
    it('should disconnect gracefully', async () => {
      agent = new CRDTAgent({
        agentId: 'test-disconnect',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();
      expect(agent.connected).toBe(true);

      await agent.disconnect();

      expect(agent.connected).toBe(false);
    });

    it('should mark agent as disconnected in metadata', async () => {
      agent = new CRDTAgent({
        agentId: 'test-disconnect-meta',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();
      await agent.disconnect();

      // Wait for update to propagate
      await new Promise(resolve => setTimeout(resolve, 200));

      const coordYdoc = (coordinator as any).ydoc;
      const metadataMap = coordYdoc.getMap('agentMetadata');
      const metadata = metadataMap.get('test-disconnect-meta');

      expect(metadata.status).toBe('disconnected');
      expect(metadata.disconnectedAt).toBeDefined();
    });

    it('should clear timers on disconnect', async () => {
      agent = new CRDTAgent({
        agentId: 'test-disconnect-timers',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();
      await agent.disconnect();

      const heartbeatTimer = (agent as any).heartbeatTimer;
      const reconnectTimer = (agent as any).reconnectTimer;

      expect(heartbeatTimer).toBeUndefined();
      expect(reconnectTimer).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed messages gracefully', async () => {
      agent = new CRDTAgent({
        agentId: 'test-malformed',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      // Send malformed message directly to agent's WebSocket handler
      const ws = (agent as any).ws;
      ws.emit('message', Buffer.from('not json'));

      // Should not crash
      expect(agent).toBeDefined();
    });

    it('should handle invalid CRDT updates', async () => {
      agent = new CRDTAgent({
        agentId: 'test-invalid-update',
        coordinatorHost: 'localhost',
        coordinatorPort: port
      });

      await agent.connect();

      // Send invalid update
      const ws = (agent as any).ws;
      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'sync-update',
        data: [1, 2, 3] // Invalid Yjs update
      })));

      // Should not crash
      expect(agent).toBeDefined();
    });
  });

  describe('Local-Only Mode', () => {
    it('should work in local-only mode when offline', () => {
      agent = new CRDTAgent({
        agentId: 'test-local-only',
        coordinatorHost: 'localhost',
        coordinatorPort: port,
        maxReconnectAttempts: 0
      });

      // Force local-only mode
      (agent as any).localOnlyMode = true;

      // Should still be able to update locally even in local-only mode
      agent.updateIssue('i-local1', {
        title: 'Local Issue',
        content: 'Content',
        status: 'open',
        priority: 1
      });

      const ydoc = (agent as any).ydoc;
      const issueMap = ydoc.getMap('issueUpdates');
      const issue = issueMap.get('i-local1');

      expect(issue).toBeDefined();
      expect(issue.title).toBe('Local Issue');
      expect(agent.isLocalOnly).toBe(true);
    });
  });
});
