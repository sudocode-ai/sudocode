/**
 * Tests for Workflow Execution Flow
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LinearOrchestrator } from '../../linear-orchestrator.js';
import type { IResilientExecutor } from '../../../resilience/executor.js';
import type { ResilientExecutionResult } from '../../../resilience/types.js';
import type { WorkflowDefinition } from '../../types.js';

/**
 * Mock Resilient Executor for testing
 */
class MockResilientExecutor implements Partial<IResilientExecutor> {
  public executedTasks: any[] = [];
  public mockResults: ResilientExecutionResult[] = [];
  public currentResultIndex = 0;

  constructor(results?: Partial<ResilientExecutionResult>[]) {
    if (results) {
      this.mockResults = results.map((r, i) => ({
        taskId: r.taskId || `task-${i + 1}`,
        executionId: r.executionId || `exec-${i + 1}`,
        success: r.success ?? true,
        exitCode: r.exitCode ?? 0,
        output: r.output || `Output ${i + 1}`,
        startedAt: r.startedAt || new Date(),
        completedAt: r.completedAt || new Date(),
        duration: r.duration || 100,
        attempts: r.attempts || [],
        totalAttempts: r.totalAttempts || 1,
        finalAttempt: r.finalAttempt || {
          attemptNumber: 1,
          success: true,
          startedAt: new Date(),
          willRetry: false,
        },
      }));
    }
  }

  async executeTask(task: any, retryPolicy?: any): Promise<any> {
    this.executedTasks.push({ task, retryPolicy });

    if (this.mockResults.length > 0) {
      const result = this.mockResults[this.currentResultIndex];
      this.currentResultIndex++;
      return result;
    }

    // Default result
    return {
      taskId: 'task-1',
      executionId: 'exec-1',
      success: true,
      exitCode: 0,
      output: 'Test output',
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
  }

  executeTasks = async () => [];
  getCircuitBreaker = () => null;
  resetCircuitBreaker = () => {};
  getRetryMetrics = () => ({
    totalRetries: 0,
    successfulRetries: 0,
    failedRetries: 0,
    averageAttemptsToSuccess: 0,
    circuitBreakers: new Map(),
  });
  onRetryAttempt = () => {};
  onCircuitOpen = () => {};
}

/**
 * Helper to wait for workflow completion
 */
async function waitFor(
  predicate: () => boolean,
  timeout = 5000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Workflow Execution Flow', () => {
  let mockExecutor: MockResilientExecutor;
  let orchestrator: LinearOrchestrator;

  beforeEach(() => {
    mockExecutor = new MockResilientExecutor();
    orchestrator = new LinearOrchestrator(mockExecutor as any);
  });

  describe('startWorkflow', () => {
    it('should create and return execution ID', async () => {
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

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      assert.ok(executionId);
      assert.ok(executionId.startsWith('execution-'));

      // Execution should be stored
      const execution = orchestrator.getExecution(executionId);
      assert.ok(execution);
      assert.strictEqual(execution.workflowId, 'test-workflow');
    });

    it('should initialize execution with initial context', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [],
      };

      const initialContext = { testKey: 'testValue' };
      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { initialContext }
      );

      const execution = orchestrator.getExecution(executionId);
      assert.deepStrictEqual(execution?.context, initialContext);
    });

    it('should start workflow execution in background', async () => {
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

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait for workflow to complete
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'completed');
      assert.strictEqual(mockExecutor.executedTasks.length, 1);
    });
  });

  describe('_executeWorkflow', () => {
    it('should execute steps sequentially', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step',
          },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.stepResults.length, 2);
      assert.strictEqual(mockExecutor.executedTasks.length, 2);
      assert.strictEqual(
        mockExecutor.executedTasks[0].task.prompt,
        'First step'
      );
      assert.strictEqual(
        mockExecutor.executedTasks[1].task.prompt,
        'Second step'
      );
    });

    it('should check dependencies before executing steps', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: false, exitCode: 1 }, // step-1 fails
        { success: true }, // step-2 should not execute
      ]);
      orchestrator = new LinearOrchestrator(mockExecutor as any);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step',
            dependencies: ['step-1'],
          },
        ],
        config: {
          continueOnStepFailure: true,
        },
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      // Only first step should have executed
      assert.strictEqual(mockExecutor.executedTasks.length, 1);
    });

    it('should evaluate step conditions', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
            condition: '{{shouldRun}}',
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step',
          },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { initialContext: { shouldRun: false } }
      );

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      // Only second step should have executed
      assert.strictEqual(mockExecutor.executedTasks.length, 1);
      assert.strictEqual(
        mockExecutor.executedTasks[0].task.prompt,
        'Second step'
      );
    });

    it('should fail workflow on step failure when continueOnStepFailure=false', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: false, exitCode: 1, output: 'Failed' },
      ]);
      orchestrator = new LinearOrchestrator(mockExecutor as any);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step',
          },
        ],
        config: {
          continueOnStepFailure: false,
        },
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'failed';
      });

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'failed');
      assert.strictEqual(mockExecutor.executedTasks.length, 1);
    });

    it('should continue on step failure when continueOnStepFailure=true', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: false, exitCode: 1 },
        { success: true },
      ]);
      orchestrator = new LinearOrchestrator(mockExecutor as any);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step',
          },
        ],
        config: {
          continueOnStepFailure: true,
        },
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'completed');
      assert.strictEqual(mockExecutor.executedTasks.length, 2);
    });

    it('should apply output mapping and pass context between steps', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: true, output: 'Result from step 1' },
        { success: true },
      ]);
      orchestrator = new LinearOrchestrator(mockExecutor as any);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'First step',
            outputMapping: {
              result1: 'output',
            },
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Second step with {{result1}}',
          },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      // Check that context was updated
      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.context.result1, 'Result from step 1');

      // Check that second step received the context
      assert.strictEqual(
        mockExecutor.executedTasks[1].task.prompt,
        'Second step with Result from step 1'
      );
    });
  });

  describe('event emission', () => {
    it('should emit workflow start event', async () => {
      let startEventEmitted = false;
      let emittedWorkflowId: string | undefined;

      orchestrator.onWorkflowStart((_executionId, workflowId) => {
        startEventEmitted = true;
        emittedWorkflowId = workflowId;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Test',
          },
        ],
      };

      await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => startEventEmitted);

      assert.strictEqual(startEventEmitted, true);
      assert.strictEqual(emittedWorkflowId, 'test-workflow');
    });

    it('should emit step start and complete events', async () => {
      const stepEvents: string[] = [];

      orchestrator.onStepStart((_executionId, stepId) => {
        stepEvents.push(`start:${stepId}`);
      });

      orchestrator.onStepComplete((_executionId, stepId) => {
        stepEvents.push(`complete:${stepId}`);
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Test',
          },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      assert.deepStrictEqual(stepEvents, ['start:step-1', 'complete:step-1']);
    });

    it('should emit workflow complete event', async () => {
      let completeEventEmitted = false;
      let resultSuccess: boolean | undefined;

      orchestrator.onWorkflowComplete((_executionId, result) => {
        completeEventEmitted = true;
        resultSuccess = result.success;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Test',
          },
        ],
      };

      await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => completeEventEmitted);

      assert.strictEqual(completeEventEmitted, true);
      assert.strictEqual(resultSuccess, true);
    });

    it('should emit workflow failed event on error', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: false, exitCode: 1 },
      ]);
      orchestrator = new LinearOrchestrator(mockExecutor as any);

      let failedEventEmitted = false;

      orchestrator.onWorkflowFailed((_executionId, _error) => {
        failedEventEmitted = true;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Test',
          },
        ],
        config: {
          continueOnStepFailure: false,
        },
      };

      await orchestrator.startWorkflow(workflow, '/test');

      await waitFor(() => failedEventEmitted);

      assert.strictEqual(failedEventEmitted, true);
    });
  });

  describe('pause and cancel', () => {
    it('should pause workflow execution', async () => {
      // Use slower mock to allow time for pause
      let resolveExecution: any;
      const slowExecutor = {
        executeTask: async () => {
          await new Promise((resolve) => {
            resolveExecution = resolve;
            setTimeout(resolve, 1000);
          });
          return mockExecutor.executeTask({}, undefined);
        },
      };

      orchestrator = new LinearOrchestrator(slowExecutor as any);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Test' },
          { id: 'step-2', taskType: 'issue', prompt: 'Test' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait a bit then pause
      await new Promise((resolve) => setTimeout(resolve, 100));
      await orchestrator.pauseWorkflow(executionId);

      // Resolve the pending task
      if (resolveExecution) resolveExecution();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'paused');
    });

    it('should cancel workflow execution', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Test' },
          { id: 'step-2', taskType: 'issue', prompt: 'Test' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Cancel immediately
      await orchestrator.cancelWorkflow(executionId);

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'cancelled');
    });
  });
});
