/**
 * EventBus Unit Tests
 * Tests for the event bus implementation
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { EventBus } from "../../src/services/event-bus.js";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

describe("EventBus", () => {
  let eventBus: EventBus;
  let db: Database.Database;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory and database
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eventbus-test-"));
    const dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);

    // Create minimal table structure for testing
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    eventBus = new EventBus({
      db,
      baseDir: tempDir,
      debounceDelay: 100, // Short delay for testing
    });
  });

  afterEach(async () => {
    if (eventBus) {
      await eventBus.stop();
    }
    if (db) {
      db.close();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    test("should initialize successfully", async () => {
      await eventBus.initialize();
      const stats = eventBus.getStats();
      expect(stats.initialized).toBe(true);
    });

    test("should throw error when initializing twice", async () => {
      await eventBus.initialize();
      await expect(eventBus.initialize()).rejects.toThrow("already initialized");
    });

    test("should stop successfully", async () => {
      await eventBus.initialize();
      await eventBus.stop();
      const stats = eventBus.getStats();
      expect(stats.initialized).toBe(false);
    });
  });

  describe("event subscription", () => {
    beforeEach(async () => {
      await eventBus.initialize();
    });

    test("should subscribe to specific event type", () => {
      const handler = vi.fn();
      const subscription = eventBus.subscribe("execution:created", handler);

      expect(subscription).toBeDefined();
      expect(subscription.unsubscribe).toBeInstanceOf(Function);

      subscription.unsubscribe();
    });

    test("should subscribe to all events", () => {
      const handler = vi.fn();
      const subscription = eventBus.subscribeAll(handler);

      expect(subscription).toBeDefined();
      expect(subscription.unsubscribe).toBeInstanceOf(Function);

      subscription.unsubscribe();
    });

    test("should receive events after subscription", async () => {
      const handler = vi.fn();
      eventBus.subscribe("execution:created", handler);

      eventBus.emitEvent("execution:created", {
        executionId: "exec_123",
        status: "pending",
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "execution:created",
          executionId: "exec_123",
          status: "pending",
          timestamp: expect.any(String),
        })
      );
    });

    test("should unsubscribe successfully", async () => {
      const handler = vi.fn();
      const subscription = eventBus.subscribe("execution:created", handler);

      eventBus.emitEvent("execution:created", {
        executionId: "exec_123",
        status: "pending",
      });

      expect(handler).toHaveBeenCalledTimes(1);

      subscription.unsubscribe();

      eventBus.emitEvent("execution:created", {
        executionId: "exec_456",
        status: "pending",
      });

      // Should still be 1 after unsubscribe
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("event emission", () => {
    beforeEach(async () => {
      await eventBus.initialize();
    });

    test("should emit execution events", async () => {
      const handler = vi.fn();
      eventBus.subscribe("execution:created", handler);

      eventBus.emitExecutionEvent("execution:created", "exec_123", "pending", "ISS-42");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "execution:created",
          executionId: "exec_123",
          status: "pending",
          issueId: "ISS-42",
        })
      );
    });

    test("should emit issue status changed events", async () => {
      const handler = vi.fn();
      eventBus.subscribe("issue:status_changed", handler);

      eventBus.emitIssueStatusChanged("ISS-42", "open", "in_progress");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "issue:status_changed",
          issueId: "ISS-42",
          oldStatus: "open",
          newStatus: "in_progress",
        })
      );
    });

    test("should emit relationship created events", async () => {
      const handler = vi.fn();
      eventBus.subscribe("relationship:created", handler);

      eventBus.emitRelationshipCreated("ISS-42", "issue", "ISS-43", "issue", "blocks");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "relationship:created",
          fromId: "ISS-42",
          fromType: "issue",
          toId: "ISS-43",
          toType: "issue",
          relationshipType: "blocks",
        })
      );
    });

    test("should emit feedback created events", async () => {
      const handler = vi.fn();
      eventBus.subscribe("feedback:created", handler);

      eventBus.emitFeedbackCreated("feed_123", "ISS-42", "SPEC-5");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "feedback:created",
          feedbackId: "feed_123",
          issueId: "ISS-42",
          specId: "SPEC-5",
        })
      );
    });
  });

  describe("wildcard subscription", () => {
    beforeEach(async () => {
      await eventBus.initialize();
    });

    test("should receive all events with wildcard subscription", async () => {
      const handler = vi.fn();
      eventBus.subscribeAll(handler);

      eventBus.emitExecutionEvent("execution:created", "exec_123", "pending");
      eventBus.emitIssueStatusChanged("ISS-42", "open", "in_progress");
      eventBus.emitRelationshipCreated("ISS-42", "issue", "ISS-43", "issue", "blocks");

      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe("statistics", () => {
    test("should return correct statistics before initialization", () => {
      const stats = eventBus.getStats();
      expect(stats.initialized).toBe(false);
      expect(stats.listenerCount).toEqual({});
    });

    test("should return correct statistics after subscriptions", async () => {
      await eventBus.initialize();

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.subscribe("execution:created", handler1);
      eventBus.subscribe("execution:created", handler2);
      eventBus.subscribe("issue:status_changed", handler1);

      const stats = eventBus.getStats();
      expect(stats.initialized).toBe(true);
      expect(stats.listenerCount["execution:created"]).toBe(2);
      expect(stats.listenerCount["issue:status_changed"]).toBe(1);
    });
  });
});

describe("EventBus singleton", () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eventbus-singleton-test-"));
    const dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(async () => {
    // Ensure we destroy the singleton between tests
    const { destroyEventBus } = await import("../../src/services/event-bus.js");
    await destroyEventBus();

    if (db) {
      db.close();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should create singleton instance", async () => {
    const { createEventBus, getEventBus } = await import("../../src/services/event-bus.js");

    const eventBus1 = await createEventBus({
      db,
      baseDir: tempDir,
    });

    const eventBus2 = getEventBus();

    expect(eventBus1).toBe(eventBus2);
  });

  test("should throw error when getting singleton before creation", async () => {
    const { getEventBus } = await import("../../src/services/event-bus.js");

    expect(() => getEventBus()).toThrow("not initialized");
  });

  test("should throw error when creating singleton twice", async () => {
    const { createEventBus } = await import("../../src/services/event-bus.js");

    await createEventBus({
      db,
      baseDir: tempDir,
    });

    await expect(createEventBus({
      db,
      baseDir: tempDir,
    })).rejects.toThrow("already created");
  });
});
