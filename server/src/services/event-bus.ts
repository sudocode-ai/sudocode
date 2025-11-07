/**
 * Event Bus for project agent
 * Emits events for entity changes, executions, and filesystem updates
 */

import { EventEmitter } from "events";
import type Database from "better-sqlite3";
import {
  startServerWatcher,
  type ServerWatcherControl,
} from "./watcher.js";

/**
 * Event types emitted by the event bus
 */
export type EventType =
  | "filesystem:spec_created"
  | "filesystem:spec_updated"
  | "filesystem:issue_created"
  | "filesystem:issue_updated"
  | "execution:created"
  | "execution:started"
  | "execution:updated"
  | "execution:completed"
  | "execution:failed"
  | "execution:paused"
  | "execution:cancelled"
  | "issue:status_changed"
  | "relationship:created"
  | "feedback:created";

/**
 * Event payload for filesystem events
 */
export interface FilesystemEvent {
  type: "filesystem:spec_created" | "filesystem:spec_updated" | "filesystem:issue_created" | "filesystem:issue_updated";
  entityType: "spec" | "issue";
  entityId: string;
  filePath?: string;
  timestamp: string;
}

/**
 * Event payload for execution events
 */
export interface ExecutionEvent {
  type: "execution:created" | "execution:started" | "execution:updated" | "execution:completed" | "execution:failed" | "execution:paused" | "execution:cancelled";
  executionId: string;
  issueId?: string;
  status: string;
  timestamp: string;
}

/**
 * Event payload for issue events
 */
export interface IssueEvent {
  type: "issue:status_changed";
  issueId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: string;
}

/**
 * Event payload for relationship events
 */
export interface RelationshipEvent {
  type: "relationship:created";
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  relationshipType: string;
  timestamp: string;
}

/**
 * Event payload for feedback events
 */
export interface FeedbackEvent {
  type: "feedback:created";
  feedbackId: string;
  issueId: string;
  specId: string;
  timestamp: string;
}

/**
 * Union type for all event payloads
 */
export type EventPayload =
  | FilesystemEvent
  | ExecutionEvent
  | IssueEvent
  | RelationshipEvent
  | FeedbackEvent;

/**
 * Event handler function type
 */
export type EventHandler = (payload: EventPayload) => void | Promise<void>;

/**
 * Subscription handle
 */
export interface Subscription {
  unsubscribe: () => void;
}

/**
 * EventBus configuration
 */
export interface EventBusConfig {
  db: Database.Database;
  baseDir: string;
  debounceDelay?: number;
}

/**
 * EventBus class
 * Central hub for all events in the system
 */
export class EventBus extends EventEmitter {
  private db: Database.Database;
  private baseDir: string;
  private watcher: ServerWatcherControl | null = null;
  private initialized = false;

  constructor(config: EventBusConfig) {
    super();
    this.db = config.db;
    this.baseDir = config.baseDir;
  }

  /**
   * Initialize the event bus and start watching filesystem
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error("EventBus already initialized");
    }

    console.log("[event-bus] Initializing event bus...");

    // Start filesystem watcher
    this.watcher = startServerWatcher({
      db: this.db,
      baseDir: this.baseDir,
      debounceDelay: 2000,
      syncJSONLToMarkdown: false,
      onFileChange: (info) => {
        this.handleFilesystemChange(info);
      },
    });

    this.initialized = true;
    console.log("[event-bus] Event bus initialized");
  }

  /**
   * Stop the event bus and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    console.log("[event-bus] Stopping event bus...");

    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }

    this.removeAllListeners();
    this.initialized = false;
    console.log("[event-bus] Event bus stopped");
  }

  /**
   * Subscribe to a specific event type
   */
  subscribe(eventType: EventType, handler: EventHandler): Subscription {
    this.on(eventType, handler);

    return {
      unsubscribe: () => {
        this.off(eventType, handler);
      },
    };
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(handler: EventHandler): Subscription {
    const wrappedHandler = (_eventType: string, payload: EventPayload) => {
      handler(payload);
    };

    this.on("*", wrappedHandler);

    return {
      unsubscribe: () => {
        this.off("*", wrappedHandler);
      },
    };
  }

  /**
   * Emit an event
   */
  emitEvent(eventType: EventType, payload: Omit<EventPayload, "type" | "timestamp">): void {
    const fullPayload: EventPayload = {
      ...payload,
      type: eventType,
      timestamp: new Date().toISOString(),
    } as EventPayload;

    // Emit to specific event type listeners
    this.emit(eventType, fullPayload);

    // Emit to wildcard listeners
    this.emit("*", eventType, fullPayload);

    console.log(`[event-bus] Emitted event: ${eventType}`, payload);
  }

  /**
   * Handle filesystem change events from watcher
   */
  private handleFilesystemChange(info: {
    filePath: string;
    event: "add" | "change" | "unlink";
    entityType?: "spec" | "issue";
    entityId?: string;
  }): void {
    const { event, entityType, entityId } = info;

    // Skip if we don't have entity info
    if (!entityType || !entityId || entityId === "*") {
      return;
    }

    // Map filesystem events to our event types
    let eventType: EventType;

    if (entityType === "spec") {
      if (event === "add") {
        eventType = "filesystem:spec_created";
      } else {
        eventType = "filesystem:spec_updated";
      }
    } else {
      if (event === "add") {
        eventType = "filesystem:issue_created";
      } else {
        eventType = "filesystem:issue_updated";
      }
    }

    this.emitEvent(eventType, {
      entityType,
      entityId,
      filePath: info.filePath,
    });
  }

  /**
   * Emit execution event
   */
  emitExecutionEvent(
    type: ExecutionEvent["type"],
    executionId: string,
    status: string,
    issueId?: string
  ): void {
    this.emitEvent(type, {
      executionId,
      issueId,
      status,
    });
  }

  /**
   * Emit issue status changed event
   */
  emitIssueStatusChanged(
    issueId: string,
    oldStatus: string,
    newStatus: string
  ): void {
    this.emitEvent("issue:status_changed", {
      issueId,
      oldStatus,
      newStatus,
    });
  }

  /**
   * Emit relationship created event
   */
  emitRelationshipCreated(
    fromId: string,
    fromType: string,
    toId: string,
    toType: string,
    relationshipType: string
  ): void {
    this.emitEvent("relationship:created", {
      fromId,
      fromType,
      toId,
      toType,
      relationshipType,
    });
  }

  /**
   * Emit feedback created event
   */
  emitFeedbackCreated(
    feedbackId: string,
    issueId: string,
    specId: string
  ): void {
    this.emitEvent("feedback:created", {
      feedbackId,
      issueId,
      specId,
    });
  }

  /**
   * Get event bus statistics
   */
  getStats(): {
    initialized: boolean;
    listenerCount: Record<string, number>;
  } {
    const stats: { initialized: boolean; listenerCount: Record<string, number> } = {
      initialized: this.initialized,
      listenerCount: {},
    };

    for (const eventName of this.eventNames()) {
      stats.listenerCount[eventName as string] = this.listenerCount(eventName);
    }

    return stats;
  }
}

/**
 * Singleton instance
 */
let eventBusInstance: EventBus | null = null;

/**
 * Get the global event bus instance
 */
export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    throw new Error("EventBus not initialized. Call createEventBus() first.");
  }
  return eventBusInstance;
}

/**
 * Create and initialize the global event bus
 */
export async function createEventBus(config: EventBusConfig): Promise<EventBus> {
  if (eventBusInstance) {
    throw new Error("EventBus already created");
  }

  eventBusInstance = new EventBus(config);
  await eventBusInstance.initialize();
  return eventBusInstance;
}

/**
 * Destroy the global event bus
 */
export async function destroyEventBus(): Promise<void> {
  if (eventBusInstance) {
    await eventBusInstance.stop();
    eventBusInstance = null;
  }
}
