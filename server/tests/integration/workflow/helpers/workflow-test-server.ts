/**
 * Workflow Test Server
 *
 * Creates a real Express server instance with workflow routes for integration
 * and E2E testing. Provides full HTTP API access with configurable mock execution.
 */

import express, { Express, Request, Response, NextFunction } from "express";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

import { createWorkflowsRouter } from "../../../../src/routes/workflows.js";
import { createExecutionsRouter } from "../../../../src/routes/executions.js";
import { SequentialWorkflowEngine } from "../../../../src/workflow/engines/sequential-engine.js";
import { OrchestratorWorkflowEngine } from "../../../../src/workflow/engines/orchestrator-engine.js";
import type { IWorkflowEngine } from "../../../../src/workflow/workflow-engine.js";
import { ExecutionService } from "../../../../src/services/execution-service.js";
import { ExecutionLifecycleService } from "../../../../src/services/execution-lifecycle.js";
import { ExecutionLogsStore } from "../../../../src/services/execution-logs-store.js";
import { WorkflowWakeupService } from "../../../../src/workflow/services/wakeup-service.js";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import { WorkflowEventEmitter } from "../../../../src/workflow/workflow-event-emitter.js";
import type { Workflow, WorkflowSource, WorkflowConfig } from "@sudocode-ai/types";

import {
  createTestDatabase,
  createFileDatabase,
  createTestIssues,
  createTestSpecs,
  createIssueDependencies,
  type TestIssueData,
  type TestSpecData,
  type TestDependency,
} from "./workflow-test-setup.js";
import {
  MockExecutionService,
  createMockExecutionService,
  type MockExecutionServiceOptions,
} from "./mock-executor.js";

// =============================================================================
// Types
// =============================================================================

export interface TestServerOptions {
  /** Path to git repository (required for worktree operations) */
  repoPath: string;
  /** Project ID (auto-generated if not provided) */
  projectId?: string;
  /** Engine type to use */
  engineType?: "sequential" | "orchestrator";
  /** Use mock execution service instead of real one */
  mockExecutor?: boolean;
  /** Options for mock executor */
  mockExecutorOptions?: MockExecutionServiceOptions;
  /** Use file-based database (for subprocess tests) */
  dbPath?: string;
}

export interface TestServerApi {
  /** Create a new workflow */
  createWorkflow(
    source: WorkflowSource,
    config?: Partial<WorkflowConfig>,
    title?: string
  ): Promise<Workflow>;
  /** Get workflow by ID */
  getWorkflow(id: string): Promise<Workflow>;
  /** Get extended workflow status */
  getWorkflowStatus(id: string): Promise<any>;
  /** Start a workflow */
  startWorkflow(id: string): Promise<void>;
  /** Pause a workflow */
  pauseWorkflow(id: string): Promise<void>;
  /** Resume a workflow */
  resumeWorkflow(id: string): Promise<void>;
  /** Cancel a workflow */
  cancelWorkflow(id: string): Promise<void>;
  /** Execute an issue within a workflow */
  executeIssue(
    workflowId: string,
    params: {
      issue_id: string;
      worktree_mode: string;
      agent_type?: string;
      worktree_id?: string;
    }
  ): Promise<any>;
  /** Complete a workflow */
  completeWorkflow(
    id: string,
    summary: string,
    status?: "completed" | "failed"
  ): Promise<any>;
  /** Create escalation */
  escalate(
    workflowId: string,
    message: string,
    options?: string[]
  ): Promise<any>;
  /** Respond to escalation */
  respondToEscalation(
    workflowId: string,
    action: "approve" | "reject" | "custom",
    message?: string
  ): Promise<any>;
  /** Send notification */
  notify(
    workflowId: string,
    message: string,
    level?: "info" | "warning" | "error"
  ): Promise<any>;
  /** Get workflow events */
  getEvents(workflowId: string, limit?: number): Promise<any[]>;
  /** List all workflows */
  listWorkflows(params?: { status?: string; limit?: number }): Promise<any>;
  /** Delete a workflow */
  deleteWorkflow(id: string): Promise<void>;
}

export interface TestServer {
  /** Express application */
  app: Express;
  /** HTTP server */
  server: http.Server;
  /** Server port */
  port: number;
  /** Base URL for API calls */
  baseUrl: string;
  /** Database instance */
  db: Database.Database;
  /** Project ID */
  projectId: string;
  /** Workflow engine */
  workflowEngine: IWorkflowEngine;
  /** Execution service (mock or real) */
  executionService: ExecutionService | MockExecutionService;
  /** WebSocket server */
  wss: WebSocketServer;
  /** Received WebSocket messages */
  wsMessages: any[];
  /** API client with convenience methods */
  api: TestServerApi;
  /** Shutdown the server */
  shutdown(): Promise<void>;
}

// =============================================================================
// Test Server Creation
// =============================================================================

/**
 * Create a test server with workflow routes
 */
export async function createTestServer(
  options: TestServerOptions
): Promise<TestServer> {
  const projectId = options.projectId || `proj-${uuidv4().substring(0, 8)}`;

  // Create database
  const db = options.dbPath
    ? createFileDatabase(options.dbPath)
    : createTestDatabase();

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create services
  const lifecycleService = new ExecutionLifecycleService(db, options.repoPath);
  const logsStore = new ExecutionLogsStore(db);

  // Create execution service (mock or real)
  let executionService: ExecutionService | MockExecutionService;
  if (options.mockExecutor) {
    executionService = createMockExecutionService(
      db,
      projectId,
      options.repoPath,
      options.mockExecutorOptions
    );
  } else {
    executionService = new ExecutionService(
      db,
      projectId,
      options.repoPath,
      lifecycleService,
      undefined,
      logsStore
    );
  }

  // Create workflow engine
  let workflowEngine: IWorkflowEngine;
  if (options.engineType === "orchestrator") {
    // Create dependencies for orchestrator engine
    const eventEmitter = new WorkflowEventEmitter();
    const promptBuilder = new WorkflowPromptBuilder();
    const wakeupService = new WorkflowWakeupService({
      db,
      executionService: executionService as ExecutionService,
      promptBuilder,
      eventEmitter,
      config: { batchWindowMs: 100 }, // Short batch window for tests
    });

    workflowEngine = new OrchestratorWorkflowEngine({
      db,
      executionService: executionService as ExecutionService,
      lifecycleService,
      wakeupService,
      eventEmitter,
      config: {
        repoPath: options.repoPath,
        dbPath: options.dbPath || ":memory:",
        serverUrl: "http://localhost:3000",
        projectId,
      },
    });
  } else {
    workflowEngine = new SequentialWorkflowEngine(
      db,
      executionService as ExecutionService,
      lifecycleService,
      options.repoPath
    );
  }

  // Create mock project context middleware
  const mockProjectContext = (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    (req as any).project = {
      id: projectId,
      path: options.repoPath,
      db,
      workflowEngine,
      // Support both engine types - for tests we use the same engine for both
      sequentialWorkflowEngine: workflowEngine,
      orchestratorWorkflowEngine: workflowEngine,
      executionService,
      // Add getWorkflowEngine method for route compatibility
      getWorkflowEngine: (_engineType?: "sequential" | "orchestrator") => workflowEngine,
    };
    next();
  };

  // Mount workflow routes
  app.use("/api/workflows", mockProjectContext, createWorkflowsRouter());

  // Mount execution routes
  app.use("/api", mockProjectContext, createExecutionsRouter());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", projectId });
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ server });
  const wsMessages: any[] = [];

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        wsMessages.push(message);
      } catch {
        // Ignore invalid JSON
      }
    });
  });

  // Start server on random port
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const address = server.address() as { port: number };
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  // Create API client
  const api = createApiClient(baseUrl, projectId);

  // Create test server object
  const testServer: TestServer = {
    app,
    server,
    port,
    baseUrl,
    db,
    projectId,
    workflowEngine,
    executionService,
    wss,
    wsMessages,
    api,
    shutdown: async () => {
      // Close WebSocket connections
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });
      wss.close();

      // Close HTTP server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Close database
      try {
        db.close();
      } catch {
        // Ignore errors
      }

      // Remove file database if used
      if (options.dbPath && fs.existsSync(options.dbPath)) {
        try {
          fs.unlinkSync(options.dbPath);
        } catch {
          // Ignore errors
        }
      }
    },
  };

  return testServer;
}

// =============================================================================
// API Client
// =============================================================================

function createApiClient(baseUrl: string, projectId: string): TestServerApi {
  const headers = {
    "Content-Type": "application/json",
    "X-Project-ID": projectId,
  };

  async function request(
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText,
      }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const json = await response.json();
      return json.data !== undefined ? json.data : json;
    }

    return null;
  }

  return {
    async createWorkflow(source, config) {
      return request("POST", "/api/workflows", { source, config });
    },

    async getWorkflow(id) {
      return request("GET", `/api/workflows/${id}`);
    },

    async getWorkflowStatus(id) {
      return request("GET", `/api/workflows/${id}/status`);
    },

    async startWorkflow(id) {
      return request("POST", `/api/workflows/${id}/start`);
    },

    async pauseWorkflow(id) {
      return request("POST", `/api/workflows/${id}/pause`);
    },

    async resumeWorkflow(id) {
      return request("POST", `/api/workflows/${id}/resume`);
    },

    async cancelWorkflow(id) {
      return request("POST", `/api/workflows/${id}/cancel`);
    },

    async executeIssue(workflowId, params) {
      return request("POST", `/api/workflows/${workflowId}/execute`, params);
    },

    async completeWorkflow(id, summary, status = "completed") {
      return request("POST", `/api/workflows/${id}/complete`, {
        summary,
        status,
      });
    },

    async escalate(workflowId, message, options) {
      return request("POST", `/api/workflows/${workflowId}/escalate`, {
        message,
        options,
      });
    },

    async respondToEscalation(workflowId, action, message) {
      return request(
        "POST",
        `/api/workflows/${workflowId}/escalation/respond`,
        { action, message }
      );
    },

    async notify(workflowId, message, level = "info") {
      return request("POST", `/api/workflows/${workflowId}/notify`, {
        message,
        level,
      });
    },

    async getEvents(workflowId, limit = 100) {
      return request(
        "GET",
        `/api/workflows/${workflowId}/events?limit=${limit}`
      );
    },

    async listWorkflows(params = {}) {
      const query = new URLSearchParams();
      if (params.status) query.set("status", params.status);
      if (params.limit) query.set("limit", String(params.limit));
      const queryStr = query.toString();
      return request("GET", `/api/workflows${queryStr ? `?${queryStr}` : ""}`);
    },

    async deleteWorkflow(id) {
      return request("DELETE", `/api/workflows/${id}`);
    },
  };
}

// =============================================================================
// Test Setup Helpers
// =============================================================================

/**
 * Create a complete test environment with server and test data
 */
export async function createTestEnvironment(options: {
  repoPath: string;
  issues?: TestIssueData[];
  specs?: TestSpecData[];
  dependencies?: TestDependency[];
  serverOptions?: Partial<TestServerOptions>;
}): Promise<TestServer> {
  const server = await createTestServer({
    repoPath: options.repoPath,
    mockExecutor: true,
    ...options.serverOptions,
  });

  // Create test data
  if (options.specs && options.specs.length > 0) {
    createTestSpecs(server.db, options.specs);
  }

  if (options.issues && options.issues.length > 0) {
    createTestIssues(server.db, options.issues);
  }

  if (options.dependencies && options.dependencies.length > 0) {
    createIssueDependencies(server.db, options.dependencies);
  }

  return server;
}

// =============================================================================
// Exports
// =============================================================================

export {
  createTestDatabase,
  createFileDatabase,
  createTestIssues,
  createTestSpecs,
  createIssueDependencies,
  MockExecutionService,
  createMockExecutionService,
};
