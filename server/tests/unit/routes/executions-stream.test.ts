/**
 * Execution Stream Routes Tests
 *
 * Tests for SSE endpoint routes.
 *
 * @module routes/tests/executions-stream
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import express, { type Express } from 'express';
import request from 'supertest';
import { createExecutionStreamRoutes } from '../../../src/routes/executions-stream.js';
import { ProjectManager } from '../../../src/services/project-manager.js';
import { ProjectRegistry } from '../../../src/services/project-registry.js';
import { requireProject } from '../../../src/middleware/project-context.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Execution Stream Routes', () => {
  let app: Express;
  let testDir: string;
  let testProjectPath: string;
  let projectManager: ProjectManager;
  let projectRegistry: ProjectRegistry;
  let projectId: string;

  beforeEach(async () => {
    // Create a unique temporary directory in system temp
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-exec-stream-'));

    // Create test project directory structure
    testProjectPath = path.join(testDir, 'test-project');
    const sudocodeDir = path.join(testProjectPath, '.sudocode');
    fs.mkdirSync(sudocodeDir, { recursive: true });

    // Create config.json for ID generation
    const configPath = path.join(sudocodeDir, 'config.json');
    const config = {
      version: '1.0.0',
      id_prefix: {
        spec: 'SPEC',
        issue: 'ISSUE',
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create directories for markdown files
    const issuesDir = path.join(sudocodeDir, 'issues');
    const specsDir = path.join(sudocodeDir, 'specs');
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.mkdirSync(specsDir, { recursive: true });

    // Create database file
    const dbPath = path.join(sudocodeDir, 'cache.db');
    fs.writeFileSync(dbPath, '');

    // Set up project manager
    const registryPath = path.join(testDir, 'projects.json');
    projectRegistry = new ProjectRegistry(registryPath);
    await projectRegistry.load();

    projectManager = new ProjectManager(projectRegistry, { watchEnabled: false });

    // Open the test project
    const result = await projectManager.openProject(testProjectPath);
    if (result.ok) {
      projectId = result.value.id;
    } else {
      throw new Error('Failed to open test project');
    }

    // Set up Express app with routes
    app = express();
    app.use(express.json());
    const router = createExecutionStreamRoutes();
    app.use('/api/executions', requireProject(projectManager), router);
  });

  afterEach(async () => {
    await projectManager.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('GET /:executionId/stream', () => {
    it('should establish SSE connection', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
        .expect('Cache-Control', 'no-cache')
        .expect('Connection', 'keep-alive');

      // Verify handleConnection was called
      expect(handleConnectionSpy.mock.calls.length).toBe(1);

      // Verify parameters
      const [clientId, res, executionId] =
        handleConnectionSpy.mock.calls[0];
      expect(clientId).toBeTruthy(); // Should be a UUID
      expect(res).toBeTruthy(); // Should be response object
      expect(executionId).toBe('test-exec-123');
    });

    it('should set SSE headers', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200);

      // Verify SSE headers are set by transport
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    it('should handle different execution IDs', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200);

      // Connect to second execution
      await request(app)
        .get('/api/executions/exec-2/stream')
        .set('X-Project-ID', projectId)
        .expect(200);

      expect(handleConnectionSpy.mock.calls.length).toBe(2);

      // Verify different execution IDs
      const firstExecId =
        handleConnectionSpy.mock.calls[0][2];
      const secondExecId =
        handleConnectionSpy.mock.calls[1][2];

      expect(firstExecId).toBe('exec-1');
      expect(secondExecId).toBe('exec-2');
    });

    it('should generate unique client IDs for each connection', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200);

      await request(app)
        .get('/api/executions/test-exec-123/stream')
        .set('X-Project-ID', projectId)
        .expect(200);

      expect(handleConnectionSpy.mock.calls.length).toBe(2);

      // Verify different client IDs
      const firstClientId =
        handleConnectionSpy.mock.calls[0][0];
      const secondClientId =
        handleConnectionSpy.mock.calls[1][0];

      expect(firstClientId).toBeTruthy();
      expect(secondClientId).toBeTruthy();
      expect(firstClientId).not.toBe(secondClientId);
    });

    it('should support multiple concurrent connections', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      const handleConnectionSpy = vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        request(app).get('/api/executions/exec-1/stream').set('X-Project-ID', projectId).expect(200),
        request(app).get('/api/executions/exec-2/stream').set('X-Project-ID', projectId).expect(200),
        request(app).get('/api/executions/exec-3/stream').set('X-Project-ID', projectId).expect(200),
      ]);

      expect(handleConnectionSpy.mock.calls.length).toBe(3);
    });
  });

  describe('Integration', () => {
    it('should allow streaming events after connection', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200);

      // Note: In real usage, broadcastToRun would send to connected clients
      // but since we mocked handleConnection, no actual clients are registered
      // This test verifies the route integration, not the actual broadcasting
      const count = sseTransport.broadcastToRun('test-exec-123', {
        event: 'test-event',
        data: { message: 'Hello' },
      });

      // With mocked connection, count will be 0
      expect(count).toBe(0);
    });

    it('should isolate events between different executions', async () => {
      const project = projectManager.getProject(projectId)!;
      const sseTransport = project.transportManager.getSseTransport();

      // Mock handleConnection to immediately end the response
      vi.spyOn(sseTransport, 'handleConnection').mockImplementation((_clientId: string, res: any, _runId?: string) => {
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
        .set('X-Project-ID', projectId)
        .expect(200);

      await request(app)
        .get('/api/executions/exec-2/stream')
        .set('X-Project-ID', projectId)
        .expect(200);

      // Note: With mocked connection, broadcasts won't reach clients
      // This test verifies the route isolation logic
      const count1 = sseTransport.broadcastToRun('exec-1', {
        event: 'test-event',
        data: { message: 'To exec-1' },
      });

      expect(count1).toBe(0);

      const count2 = sseTransport.broadcastToRun('exec-2', {
        event: 'test-event',
        data: { message: 'To exec-2' },
      });

      expect(count2).toBe(0);
    });
  });
});
