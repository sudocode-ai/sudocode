/**
 * Integration tests for ProjectAgentExecutor
 *
 * Tests the full lifecycle and behavior of the project agent executor:
 * - Start/stop lifecycle
 * - Event listening and handling
 * - Periodic analysis
 * - Metrics tracking
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  ProjectAgentExecutor,
  initProjectAgentExecutor,
  getProjectAgentExecutor,
  destroyProjectAgentExecutor,
} from "../../src/services/project-agent-executor.js";
import { createEventBus, destroyEventBus, getEventBus } from "../../src/services/event-bus.js";
import { getRunningProjectAgentExecution } from "../../src/services/project-agent-db.js";
import type { ProjectAgentConfig } from "@sudocode-ai/types";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { initDatabase } from "../../src/services/db.js";

describe("ProjectAgentExecutor Integration", () => {
  let db: Database.Database;
  let tmpDir: string;
  let eventBus: any;
  let mockExecutionService: any;

  beforeEach(async () => {
    // Create temporary directory for test database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-agent-executor-test-"));
    const dbPath = path.join(tmpDir, "test.db");

    // Initialize database
    db = initDatabase({ path: dbPath });

    // Initialize EventBus
    eventBus = await createEventBus({
      db,
      baseDir: tmpDir,
      debounceDelay: 100,
    });

    // Mock ExecutionService
    mockExecutionService = {
      createExecution: vi.fn().mockResolvedValue({
        id: "exec_test_123",
        status: "running",
      }),
      pauseExecution: vi.fn().mockResolvedValue(undefined),
      resumeExecution: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    // Cleanup
    try {
      await destroyProjectAgentExecutor();
    } catch {
      // Ignore if not initialized
    }

    if (eventBus) {
      await destroyEventBus();
    }
    if (db) {
      db.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Initialization and Lifecycle", () => {
    it("should initialize and start project agent executor", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: {
          enabled: false,
          allowedActions: [],
        },
        monitoring: {
          watchExecutions: true,
          checkInterval: 60000,
          stalledExecutionThreshold: 3600000,
        },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      expect(executor).toBeDefined();
      expect(executor.isRunning()).toBe(false);

      const execution = await executor.start();
      expect(execution).toBeDefined();
      expect(execution.status).toBe("running");
      expect(execution.mode).toBe("monitoring");
      expect(executor.isRunning()).toBe(true);

      await executor.stop();
      expect(executor.isRunning()).toBe(false);
    });

    it("should prevent multiple project agents from running", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor1 = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor1.start();

      // Destroy first executor but leave execution record
      await destroyProjectAgentExecutor();

      // Try to initialize and start second executor
      const executor2 = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      await expect(executor2.start()).rejects.toThrow("already running");
    });

    it("should throw error when starting already running executor", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      await expect(executor.start()).rejects.toThrow("already running");

      await executor.stop();
    });

    it("should throw error when stopping not running executor", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      await expect(executor.stop()).rejects.toThrow("not running");
    });

    it("should create execution record in database", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = getRunningProjectAgentExecution(db);
      expect(execution).toBeDefined();
      expect(execution?.status).toBe("running");
      expect(execution?.mode).toBe("monitoring");

      await executor.stop();

      const stoppedExecution = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;
      expect(stoppedExecution.status).toBe("stopped");
    });

    it("should get current execution", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      expect(executor.getExecution()).toBeNull();

      await executor.start();

      const execution = executor.getExecution();
      expect(execution).toBeDefined();
      expect(execution?.status).toBe("running");

      await executor.stop();
    });
  });

  describe("Event Handling", () => {
    it("should listen to and process events", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      expect(execution).toBeDefined();

      const eventsBefore = execution!.events_processed;

      // Emit some events
      eventBus.emitEvent("issue:status_changed", {
        entityType: "issue",
        entityId: "issue_123",
        oldStatus: "open",
        newStatus: "ready",
      });

      eventBus.emitEvent("spec:created", {
        entityType: "spec",
        entityId: "spec_456",
      });

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check that events were processed
      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(executionAfter.events_processed).toBeGreaterThan(eventsBefore);

      await executor.stop();
    });

    it("should increment events_processed metric", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();
      expect(execution?.events_processed).toBe(0);

      // Emit multiple events
      for (let i = 0; i < 5; i++) {
        eventBus.emitEvent("issue:status_changed", {
          entityType: "issue",
          entityId: `issue_${i}`,
        });
      }

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 200));

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      expect(executionAfter.events_processed).toBeGreaterThanOrEqual(5);

      await executor.stop();
    });

    it("should stop listening to events after stop", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();

      await executor.stop();

      const eventsBeforeStop = db
        .prepare("SELECT events_processed FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      // Emit events after stop
      eventBus.emitEvent("issue:created", {
        entityType: "issue",
        entityId: "issue_789",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const eventsAfterStop = db
        .prepare("SELECT events_processed FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      // Events should not increase after stop
      expect(eventsAfterStop.events_processed).toBe(eventsBeforeStop.events_processed);
    });
  });

  describe("Periodic Analysis", () => {
    it("should perform initial analysis on start", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      // Mock CLI client
      (executor as any).cliClient = {
        exec: vi.fn().mockResolvedValue({ issues: [] }),
      };

      await executor.start();

      // CLI should have been called for initial analysis
      expect((executor as any).cliClient.exec).toHaveBeenCalled();

      await executor.stop();
    });

    it("should run periodic analysis at configured interval", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: {
          watchExecutions: true,
          checkInterval: 100, // Very short interval for testing
          stalledExecutionThreshold: 3600000,
        },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      // Mock CLI client
      const mockExec = vi.fn().mockResolvedValue({ issues: [] });
      (executor as any).cliClient = { exec: mockExec };

      await executor.start();

      const callCountBefore = mockExec.mock.calls.length;

      // Wait for at least one periodic check
      await new Promise((resolve) => setTimeout(resolve, 250));

      const callCountAfter = mockExec.mock.calls.length;

      // Should have made additional calls
      expect(callCountAfter).toBeGreaterThan(callCountBefore);

      await executor.stop();
    });

    it("should stop periodic analysis after stop", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: {
          watchExecutions: true,
          checkInterval: 100,
          stalledExecutionThreshold: 3600000,
        },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      const mockExec = vi.fn().mockResolvedValue({ issues: [] });
      (executor as any).cliClient = { exec: mockExec };

      await executor.start();
      await new Promise((resolve) => setTimeout(resolve, 150));

      await executor.stop();

      const callCountAfterStop = mockExec.mock.calls.length;

      // Wait to ensure no more calls are made
      await new Promise((resolve) => setTimeout(resolve, 200));

      const finalCallCount = mockExec.mock.calls.length;

      // Should not increase after stop
      expect(finalCallCount).toBe(callCountAfterStop);
    });
  });

  describe("Global Singleton", () => {
    it("should throw error when getting uninitialized executor", () => {
      expect(() => getProjectAgentExecutor()).toThrow("not initialized");
    });

    it("should throw error when initializing twice", () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      expect(() => initProjectAgentExecutor(db, tmpDir, config, mockExecutionService)).toThrow(
        "already initialized"
      );
    });

    it("should get global executor after initialization", () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      const globalExecutor = getProjectAgentExecutor();

      expect(globalExecutor).toBe(executor);
    });

    it("should destroy global executor", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      await destroyProjectAgentExecutor();

      // Should not be able to get executor anymore
      expect(() => getProjectAgentExecutor()).toThrow("not initialized");
    });

    it("should stop running executor when destroying", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      expect(executor.isRunning()).toBe(true);

      await destroyProjectAgentExecutor();

      // Executor should have been stopped
      expect(executor.isRunning()).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should handle CLI errors gracefully during analysis", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);

      // Mock CLI client to throw error
      (executor as any).cliClient = {
        exec: vi.fn().mockRejectedValue(new Error("CLI error")),
      };

      // Should not throw error, just log it
      await expect(executor.start()).resolves.toBeDefined();

      await executor.stop();
    });

    it("should continue processing events after event handler error", async () => {
      const config: ProjectAgentConfig = {
        useWorktree: false,
        mode: "monitoring",
        autoApprove: { enabled: false, allowedActions: [] },
        monitoring: { watchExecutions: true, checkInterval: 60000, stalledExecutionThreshold: 3600000 },
      };

      const executor = initProjectAgentExecutor(db, tmpDir, config, mockExecutionService);
      await executor.start();

      const execution = executor.getExecution();

      // Emit event that might cause error (but shouldn't crash)
      eventBus.emitEvent("filesystem:spec_created", {
        entityType: "spec",
        entityId: "spec_error",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be running
      expect(executor.isRunning()).toBe(true);

      // Emit another event to verify still processing
      eventBus.emitEvent("issue:created", {
        entityType: "issue",
        entityId: "issue_123",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const executionAfter = db
        .prepare("SELECT * FROM project_agent_executions WHERE id = ?")
        .get(execution!.id) as any;

      // Should have processed both events
      expect(executionAfter.events_processed).toBeGreaterThanOrEqual(2);

      await executor.stop();
    });
  });
});
