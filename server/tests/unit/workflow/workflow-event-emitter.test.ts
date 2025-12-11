/**
 * Unit tests for WorkflowEventEmitter
 *
 * Tests the typed event emitter used for workflow lifecycle events.
 * Uses Set<WorkflowEventListener> pattern (not Node.js EventEmitter).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkflowEventEmitter,
  WorkflowEventType,
  createStepStartedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepSkippedEvent,
  createWorkflowStartedEvent,
  createWorkflowPausedEvent,
  createWorkflowResumedEvent,
  createWorkflowCompletedEvent,
  createWorkflowFailedEvent,
  createWorkflowCancelledEvent,
  type WorkflowEventPayload,
  type WorkflowEventListener,
} from "../../../src/workflow/workflow-event-emitter.js";
import type { Workflow, WorkflowStep } from "@sudocode-ai/types";

// =============================================================================
// Test Data Factories
// =============================================================================

function createTestStep(overrides?: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "step-test",
    issueId: "i-test",
    index: 0,
    dependencies: [],
    status: "pending",
    ...overrides,
  };
}

function createTestWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-test",
    title: "Test Workflow",
    source: { type: "issues", issueIds: ["i-1"] },
    status: "pending",
    steps: [createTestStep()],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
      parallelism: "sequential",
      maxConcurrency: 1,
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// WorkflowEventEmitter Tests
// =============================================================================

describe("WorkflowEventEmitter", () => {
  let emitter: WorkflowEventEmitter;

  beforeEach(() => {
    emitter = new WorkflowEventEmitter();
  });

  describe("on()", () => {
    it("should add a listener", () => {
      const listener = vi.fn();

      emitter.on(listener);

      expect(emitter.listenerCount).toBe(1);
    });

    it("should return an unsubscribe function", () => {
      const listener = vi.fn();

      const unsubscribe = emitter.on(listener);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should allow adding multiple listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      emitter.on(listener1);
      emitter.on(listener2);
      emitter.on(listener3);

      expect(emitter.listenerCount).toBe(3);
    });

    it("should not add duplicate listeners", () => {
      const listener = vi.fn();

      emitter.on(listener);
      emitter.on(listener);

      expect(emitter.listenerCount).toBe(1);
    });
  });

  describe("off()", () => {
    it("should remove a listener", () => {
      const listener = vi.fn();
      emitter.on(listener);
      expect(emitter.listenerCount).toBe(1);

      emitter.off(listener);

      expect(emitter.listenerCount).toBe(0);
    });

    it("should do nothing if listener not found", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on(listener1);

      emitter.off(listener2);

      expect(emitter.listenerCount).toBe(1);
    });
  });

  describe("unsubscribe function", () => {
    it("should remove the listener when called", () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on(listener);
      expect(emitter.listenerCount).toBe(1);

      unsubscribe();

      expect(emitter.listenerCount).toBe(0);
    });

    it("should be safe to call multiple times", () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on(listener);

      unsubscribe();
      unsubscribe();
      unsubscribe();

      expect(emitter.listenerCount).toBe(0);
    });
  });

  describe("emit()", () => {
    it("should notify all listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on(listener1);
      emitter.on(listener2);

      const event: WorkflowEventPayload = {
        type: "workflow_started",
        workflowId: "wf-test",
        workflow: createTestWorkflow(),
        timestamp: Date.now(),
      };

      emitter.emit(event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it("should not error with no listeners", () => {
      const event: WorkflowEventPayload = {
        type: "workflow_started",
        workflowId: "wf-test",
        workflow: createTestWorkflow(),
        timestamp: Date.now(),
      };

      expect(() => emitter.emit(event)).not.toThrow();
    });

    it("should continue emitting if a listener throws", () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });
      const successListener = vi.fn();

      emitter.on(errorListener);
      emitter.on(successListener);

      const event: WorkflowEventPayload = {
        type: "workflow_started",
        workflowId: "wf-test",
        workflow: createTestWorkflow(),
        timestamp: Date.now(),
      };

      // Should not throw
      emitter.emit(event);

      // Both listeners should have been called
      expect(errorListener).toHaveBeenCalledTimes(1);
      expect(successListener).toHaveBeenCalledTimes(1);
    });

    it("should allow listener to unsubscribe during emit", () => {
      const events: string[] = [];
      let unsubscribe: () => void;

      const selfRemovingListener = vi.fn().mockImplementation(() => {
        events.push("selfRemoving");
        unsubscribe();
      });
      const normalListener = vi.fn().mockImplementation(() => {
        events.push("normal");
      });

      unsubscribe = emitter.on(selfRemovingListener);
      emitter.on(normalListener);

      const event: WorkflowEventPayload = {
        type: "workflow_paused",
        workflowId: "wf-test",
        timestamp: Date.now(),
      };

      emitter.emit(event);

      // Both should have been called once
      expect(selfRemovingListener).toHaveBeenCalledTimes(1);
      expect(normalListener).toHaveBeenCalledTimes(1);

      // Self-removing listener should be gone
      expect(emitter.listenerCount).toBe(1);

      // Emit again - only normal listener should be called
      emitter.emit(event);
      expect(selfRemovingListener).toHaveBeenCalledTimes(1);
      expect(normalListener).toHaveBeenCalledTimes(2);
    });
  });

  describe("removeAllListeners()", () => {
    it("should remove all listeners", () => {
      emitter.on(vi.fn());
      emitter.on(vi.fn());
      emitter.on(vi.fn());
      expect(emitter.listenerCount).toBe(3);

      emitter.removeAllListeners();

      expect(emitter.listenerCount).toBe(0);
    });

    it("should be safe to call with no listeners", () => {
      expect(() => emitter.removeAllListeners()).not.toThrow();
      expect(emitter.listenerCount).toBe(0);
    });
  });

  describe("listenerCount", () => {
    it("should return 0 for new emitter", () => {
      expect(emitter.listenerCount).toBe(0);
    });

    it("should track additions and removals", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      expect(emitter.listenerCount).toBe(0);

      emitter.on(listener1);
      expect(emitter.listenerCount).toBe(1);

      emitter.on(listener2);
      expect(emitter.listenerCount).toBe(2);

      emitter.off(listener1);
      expect(emitter.listenerCount).toBe(1);

      emitter.off(listener2);
      expect(emitter.listenerCount).toBe(0);
    });
  });
});

// =============================================================================
// WorkflowEventType Constants Tests
// =============================================================================

describe("WorkflowEventType", () => {
  it("should have correct step event types", () => {
    expect(WorkflowEventType.STEP_STARTED).toBe("step_started");
    expect(WorkflowEventType.STEP_COMPLETED).toBe("step_completed");
    expect(WorkflowEventType.STEP_FAILED).toBe("step_failed");
    expect(WorkflowEventType.STEP_SKIPPED).toBe("step_skipped");
  });

  it("should have correct workflow event types", () => {
    expect(WorkflowEventType.WORKFLOW_STARTED).toBe("workflow_started");
    expect(WorkflowEventType.WORKFLOW_PAUSED).toBe("workflow_paused");
    expect(WorkflowEventType.WORKFLOW_RESUMED).toBe("workflow_resumed");
    expect(WorkflowEventType.WORKFLOW_COMPLETED).toBe("workflow_completed");
    expect(WorkflowEventType.WORKFLOW_FAILED).toBe("workflow_failed");
    expect(WorkflowEventType.WORKFLOW_CANCELLED).toBe("workflow_cancelled");
  });
});

// =============================================================================
// Event Factory Functions Tests
// =============================================================================

describe("Event Factory Functions", () => {
  const mockStep = createTestStep({ id: "step-123", issueId: "i-456" });
  const mockWorkflow = createTestWorkflow({ id: "wf-789" });

  describe("createStepStartedEvent()", () => {
    it("should create a step started event", () => {
      const event = createStepStartedEvent("wf-test", mockStep);

      expect(event.type).toBe("step_started");
      expect(event.workflowId).toBe("wf-test");
      expect(event.step).toBe(mockStep);
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createStepCompletedEvent()", () => {
    it("should create a step completed event", () => {
      const event = createStepCompletedEvent("wf-test", mockStep, "exec-123");

      expect(event.type).toBe("step_completed");
      expect(event.workflowId).toBe("wf-test");
      expect(event.step).toBe(mockStep);
      expect(event.executionId).toBe("exec-123");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createStepFailedEvent()", () => {
    it("should create a step failed event", () => {
      const event = createStepFailedEvent(
        "wf-test",
        mockStep,
        "Something went wrong"
      );

      expect(event.type).toBe("step_failed");
      expect(event.workflowId).toBe("wf-test");
      expect(event.step).toBe(mockStep);
      expect(event.error).toBe("Something went wrong");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createStepSkippedEvent()", () => {
    it("should create a step skipped event", () => {
      const event = createStepSkippedEvent(
        "wf-test",
        mockStep,
        "User requested skip"
      );

      expect(event.type).toBe("step_skipped");
      expect(event.workflowId).toBe("wf-test");
      expect(event.step).toBe(mockStep);
      expect(event.reason).toBe("User requested skip");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowStartedEvent()", () => {
    it("should create a workflow started event", () => {
      const event = createWorkflowStartedEvent("wf-test", mockWorkflow);

      expect(event.type).toBe("workflow_started");
      expect(event.workflowId).toBe("wf-test");
      expect(event.workflow).toBe(mockWorkflow);
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowPausedEvent()", () => {
    it("should create a workflow paused event", () => {
      const event = createWorkflowPausedEvent("wf-test");

      expect(event.type).toBe("workflow_paused");
      expect(event.workflowId).toBe("wf-test");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowResumedEvent()", () => {
    it("should create a workflow resumed event", () => {
      const event = createWorkflowResumedEvent("wf-test");

      expect(event.type).toBe("workflow_resumed");
      expect(event.workflowId).toBe("wf-test");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowCompletedEvent()", () => {
    it("should create a workflow completed event", () => {
      const event = createWorkflowCompletedEvent("wf-test", mockWorkflow);

      expect(event.type).toBe("workflow_completed");
      expect(event.workflowId).toBe("wf-test");
      expect(event.workflow).toBe(mockWorkflow);
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowFailedEvent()", () => {
    it("should create a workflow failed event", () => {
      const event = createWorkflowFailedEvent("wf-test", "Fatal error occurred");

      expect(event.type).toBe("workflow_failed");
      expect(event.workflowId).toBe("wf-test");
      expect(event.error).toBe("Fatal error occurred");
      expect(typeof event.timestamp).toBe("number");
    });
  });

  describe("createWorkflowCancelledEvent()", () => {
    it("should create a workflow cancelled event", () => {
      const event = createWorkflowCancelledEvent("wf-test");

      expect(event.type).toBe("workflow_cancelled");
      expect(event.workflowId).toBe("wf-test");
      expect(typeof event.timestamp).toBe("number");
    });
  });
});

// =============================================================================
// Type-Safe Event Handling Tests
// =============================================================================

describe("Type-Safe Event Handling", () => {
  it("should allow discriminated union pattern for event handling", () => {
    const emitter = new WorkflowEventEmitter();
    const handledEvents: string[] = [];

    const listener: WorkflowEventListener = (event) => {
      switch (event.type) {
        case "step_started":
          handledEvents.push(`step_started:${event.step.id}`);
          break;
        case "step_completed":
          handledEvents.push(`step_completed:${event.executionId}`);
          break;
        case "step_failed":
          handledEvents.push(`step_failed:${event.error}`);
          break;
        case "step_skipped":
          handledEvents.push(`step_skipped:${event.reason}`);
          break;
        case "workflow_started":
          handledEvents.push(`workflow_started:${event.workflow.id}`);
          break;
        case "workflow_paused":
          handledEvents.push("workflow_paused");
          break;
        case "workflow_resumed":
          handledEvents.push("workflow_resumed");
          break;
        case "workflow_completed":
          handledEvents.push(`workflow_completed:${event.workflow.id}`);
          break;
        case "workflow_failed":
          handledEvents.push(`workflow_failed:${event.error}`);
          break;
        case "workflow_cancelled":
          handledEvents.push("workflow_cancelled");
          break;
      }
    };

    emitter.on(listener);

    const step = createTestStep({ id: "step-abc" });
    const workflow = createTestWorkflow({ id: "wf-xyz" });

    emitter.emit(createStepStartedEvent("wf-1", step));
    emitter.emit(createStepCompletedEvent("wf-1", step, "exec-999"));
    emitter.emit(createStepFailedEvent("wf-1", step, "Oops"));
    emitter.emit(createStepSkippedEvent("wf-1", step, "Manual skip"));
    emitter.emit(createWorkflowStartedEvent("wf-1", workflow));
    emitter.emit(createWorkflowPausedEvent("wf-1"));
    emitter.emit(createWorkflowResumedEvent("wf-1"));
    emitter.emit(createWorkflowCompletedEvent("wf-1", workflow));
    emitter.emit(createWorkflowFailedEvent("wf-1", "Big error"));
    emitter.emit(createWorkflowCancelledEvent("wf-1"));

    expect(handledEvents).toEqual([
      "step_started:step-abc",
      "step_completed:exec-999",
      "step_failed:Oops",
      "step_skipped:Manual skip",
      "workflow_started:wf-xyz",
      "workflow_paused",
      "workflow_resumed",
      "workflow_completed:wf-xyz",
      "workflow_failed:Big error",
      "workflow_cancelled",
    ]);
  });
});
