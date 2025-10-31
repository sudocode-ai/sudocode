/**
 * LinearOrchestrator AG-UI Events Integration Tests
 *
 * Tests for AG-UI event emission during workflow execution.
 * Verifies that LinearOrchestrator correctly emits lifecycle events
 * (RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED)
 * through the AgUiEventAdapter.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LinearOrchestrator } from '../../../../src/execution/workflow/linear-orchestrator.js';
import { AgUiEventAdapter } from '../../../../src/execution/output/ag-ui-adapter.js';
import { EventType } from '@ag-ui/core';
import type { IResilientExecutor } from '../../../../src/execution/resilience/executor.js';
import type { ResilientExecutionResult } from '../../../../src/execution/resilience/types.js';
import type { WorkflowDefinition } from '../../../../src/execution/workflow/types.js';

describe('LinearOrchestrator AG-UI Events', () => {
  let mockExecutor: IResilientExecutor;
  let adapter: AgUiEventAdapter;
  let capturedEvents: any[];

  beforeEach(() => {
    // Create mock executor
    mockExecutor = {
      executeTask: async (): Promise<ResilientExecutionResult> => {
        return {
          taskId: 'task-1',
          executionId: 'exec-1',
          success: true,
          exitCode: 0,
          output: 'Step completed',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
          attempts: [],
          totalAttempts: 1,
          finalAttempt: {
            attemptNumber: 1,
            success: true,
            startedAt: new Date(),
            willRetry: false,
          },
        };
      },
      executeTasks: async () => [],
      getCircuitBreaker: () => null,
      resetCircuitBreaker: () => {},
      getRetryMetrics: () => ({
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageAttemptsToSuccess: 0,
        circuitBreakers: new Map(),
      }),
      onRetryAttempt: () => {},
      onCircuitOpen: () => {},
    } as IResilientExecutor;

    // Create adapter and capture events
    adapter = new AgUiEventAdapter('test-run-id');
    capturedEvents = [];
    adapter.onEvent((event) => {
      capturedEvents.push(event);
    });
  });

  it('should emit RUN_STARTED when workflow starts', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    // Find RUN_STARTED event
    const runStartedEvent = capturedEvents.find(
      (e) => e.type === EventType.RUN_STARTED
    );
    assert.ok(runStartedEvent, 'RUN_STARTED event should be emitted');
    assert.strictEqual(runStartedEvent.runId, 'test-run-id');
  });

  it('should emit STEP_STARTED for each workflow step', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step 1',
        },
        {
          id: 'step-2',
          taskType: 'spec',
          prompt: 'Test step 2',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    // Find all STEP_STARTED events
    const stepStartedEvents = capturedEvents.filter(
      (e) => e.type === EventType.STEP_STARTED
    );
    assert.strictEqual(
      stepStartedEvents.length,
      2,
      'Should emit STEP_STARTED for each step'
    );
    assert.strictEqual(stepStartedEvents[0].stepName, 'issue');
    assert.strictEqual(stepStartedEvents[1].stepName, 'spec');
  });

  it('should emit STEP_FINISHED for each completed step', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    // Find STEP_FINISHED event
    const stepFinishedEvent = capturedEvents.find(
      (e) => e.type === EventType.STEP_FINISHED
    );
    assert.ok(stepFinishedEvent, 'STEP_FINISHED event should be emitted');
    assert.strictEqual(stepFinishedEvent.stepName, 'step-1');
    assert.strictEqual(stepFinishedEvent.rawEvent?.status, 'success');
  });

  it('should emit RUN_FINISHED when workflow completes', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    // Find RUN_FINISHED event
    const runFinishedEvent = capturedEvents.find(
      (e) => e.type === EventType.RUN_FINISHED
    );
    assert.ok(runFinishedEvent, 'RUN_FINISHED event should be emitted');
    assert.strictEqual(runFinishedEvent.runId, 'test-run-id');
  });

  it('should emit RUN_ERROR when workflow fails', async () => {
    // Create failing executor
    const failingExecutor: IResilientExecutor = {
      executeTask: async (): Promise<ResilientExecutionResult> => {
        throw new Error('Execution failed');
      },
      executeTasks: async () => [],
      getCircuitBreaker: () => null,
      resetCircuitBreaker: () => {},
      getRetryMetrics: () => ({
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageAttemptsToSuccess: 0,
        circuitBreakers: new Map(),
      }),
      onRetryAttempt: () => {},
      onCircuitOpen: () => {},
    } as IResilientExecutor;

    const orchestrator = new LinearOrchestrator(
      failingExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    try {
      await orchestrator.startWorkflow(workflow, '/test');
      assert.fail('Should have thrown an error');
    } catch (error) {
      // Expected error
    }

    // Find RUN_ERROR event
    const runErrorEvent = capturedEvents.find(
      (e) => e.type === EventType.RUN_ERROR
    );
    assert.ok(runErrorEvent, 'RUN_ERROR event should be emitted');
    assert.strictEqual(runErrorEvent.message, 'Execution failed');
  });

  it('should emit STEP_FINISHED with error status when step fails', async () => {
    // Create executor that fails on first call
    let callCount = 0;
    const partiallyFailingExecutor: IResilientExecutor = {
      executeTask: async (): Promise<ResilientExecutionResult> => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Step failed');
        }
        return {
          taskId: 'task-1',
          executionId: 'exec-1',
          success: true,
          exitCode: 0,
          output: 'Success',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
          attempts: [],
          totalAttempts: 1,
          finalAttempt: {
            attemptNumber: 1,
            success: true,
            startedAt: new Date(),
            willRetry: false,
          },
        };
      },
      executeTasks: async () => [],
      getCircuitBreaker: () => null,
      resetCircuitBreaker: () => {},
      getRetryMetrics: () => ({
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageAttemptsToSuccess: 0,
        circuitBreakers: new Map(),
      }),
      onRetryAttempt: () => {},
      onCircuitOpen: () => {},
    } as IResilientExecutor;

    const orchestrator = new LinearOrchestrator(
      partiallyFailingExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    try {
      await orchestrator.startWorkflow(workflow, '/test');
    } catch (error) {
      // Expected error
    }

    // Find STEP_FINISHED event with error status
    const stepFinishedEvent = capturedEvents.find(
      (e) =>
        e.type === EventType.STEP_FINISHED &&
        e.rawEvent?.status === 'error'
    );
    assert.ok(
      stepFinishedEvent,
      'STEP_FINISHED event with error status should be emitted'
    );
  });

  it('should emit events in correct order', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    // Filter to lifecycle events only
    const lifecycleEvents = capturedEvents.filter((e) =>
      [
        EventType.RUN_STARTED,
        EventType.STEP_STARTED,
        EventType.STEP_FINISHED,
        EventType.RUN_FINISHED,
      ].includes(e.type)
    );

    // Verify order
    assert.ok(lifecycleEvents.length >= 4, 'Should have at least 4 lifecycle events');

    // Find positions of each event type
    const runStartedIndex = lifecycleEvents.findIndex(
      (e) => e.type === EventType.RUN_STARTED
    );
    const stepStartedIndex = lifecycleEvents.findIndex(
      (e) => e.type === EventType.STEP_STARTED
    );
    const stepFinishedIndex = lifecycleEvents.findIndex(
      (e) => e.type === EventType.STEP_FINISHED
    );
    const runFinishedIndex = lifecycleEvents.findIndex(
      (e) => e.type === EventType.RUN_FINISHED
    );

    assert.ok(
      runStartedIndex < stepStartedIndex,
      'RUN_STARTED should come before STEP_STARTED'
    );
    assert.ok(
      stepStartedIndex < stepFinishedIndex,
      'STEP_STARTED should come before STEP_FINISHED'
    );
    assert.ok(
      stepFinishedIndex < runFinishedIndex,
      'STEP_FINISHED should come before RUN_FINISHED'
    );
  });

  it('should work without adapter (backward compatibility)', async () => {
    const orchestrator = new LinearOrchestrator(mockExecutor);

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    // Should not throw even without adapter
    await orchestrator.startWorkflow(workflow, '/test');
  });

  it('should include workflow metadata in RUN_STARTED rawEvent', async () => {
    const orchestrator = new LinearOrchestrator(
      mockExecutor,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow-123',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    const runStartedEvent = capturedEvents.find(
      (e) => e.type === EventType.RUN_STARTED
    );
    assert.ok(runStartedEvent);
    assert.ok(runStartedEvent.rawEvent);
    assert.strictEqual(
      runStartedEvent.rawEvent.workflowId,
      'test-workflow-123'
    );
  });

  it('should include step output in STEP_FINISHED rawEvent', async () => {
    const outputData = 'test-output-string';
    const executorWithOutput: IResilientExecutor = {
      executeTask: async (): Promise<ResilientExecutionResult> => {
        return {
          taskId: 'task-1',
          executionId: 'exec-1',
          success: true,
          exitCode: 0,
          output: outputData,
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
          attempts: [],
          totalAttempts: 1,
          finalAttempt: {
            attemptNumber: 1,
            success: true,
            startedAt: new Date(),
            willRetry: false,
          },
        };
      },
      executeTasks: async () => [],
      getCircuitBreaker: () => null,
      resetCircuitBreaker: () => {},
      getRetryMetrics: () => ({
        totalRetries: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageAttemptsToSuccess: 0,
        circuitBreakers: new Map(),
      }),
      onRetryAttempt: () => {},
      onCircuitOpen: () => {},
    } as IResilientExecutor;

    const orchestrator = new LinearOrchestrator(
      executorWithOutput,
      undefined,
      adapter
    );

    const workflow: WorkflowDefinition = {
      id: 'test-workflow',
      steps: [
        {
          id: 'step-1',
          taskType: 'issue',
          prompt: 'Test step',
        },
      ],
    };

    await orchestrator.startWorkflow(workflow, '/test');

    const stepFinishedEvent = capturedEvents.find(
      (e) => e.type === EventType.STEP_FINISHED
    );
    assert.ok(stepFinishedEvent);
    assert.ok(stepFinishedEvent.rawEvent);
    assert.deepStrictEqual(stepFinishedEvent.rawEvent.output, outputData);
  });
});
