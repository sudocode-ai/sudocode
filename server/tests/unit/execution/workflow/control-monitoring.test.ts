/**
 * Tests for Control and Monitoring Methods
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LinearOrchestrator } from '../../../../src/execution/workflow/linear-orchestrator.js';
import { InMemoryWorkflowStorage } from '../../../../src/execution/workflow/memory-storage.js';
import type { IResilientExecutor } from '../../../../src/execution/resilience/executor.js';
import type { WorkflowDefinition } from '../../../../src/execution/workflow/types.js';

/**
 * Mock Resilient Executor for testing
 */
class MockResilientExecutor implements Partial<IResilientExecutor> {
  public executedTasks: any[] = [];
  public executionDelay = 0;

  constructor(delay = 0) {
    this.executionDelay = delay;
  }

  async executeTask(task: any, retryPolicy?: any): Promise<any> {
    this.executedTasks.push({ task, retryPolicy });

    // Add delay if configured
    if (this.executionDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.executionDelay));
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
 * Helper to wait for condition
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

describe('Control and Monitoring Methods', () => {
  let mockExecutor: MockResilientExecutor;
  let storage: InMemoryWorkflowStorage;
  let orchestrator: LinearOrchestrator;

  beforeEach(() => {
    mockExecutor = new MockResilientExecutor();
    storage = new InMemoryWorkflowStorage();
    orchestrator = new LinearOrchestrator(mockExecutor as any, storage);
  });

  describe('waitForWorkflow', () => {
    it('should wait for workflow to complete', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');
      const execution = await orchestrator.waitForWorkflow(executionId);

      assert.strictEqual(execution.status, 'completed');
      assert.strictEqual(execution.stepResults.length, 2);
    });

    it('should return immediately if already completed', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      // Now waitForWorkflow should return immediately
      const startTime = Date.now();
      const execution = await orchestrator.waitForWorkflow(executionId);
      const duration = Date.now() - startTime;

      assert.strictEqual(execution.status, 'completed');
      assert.ok(duration < 100); // Should be nearly instant
    });

    it('should throw error if execution not found', async () => {
      await assert.rejects(
        async () => {
          await orchestrator.waitForWorkflow('non-existent-id');
        },
        {
          message: 'Workflow execution non-existent-id not found',
        }
      );
    });

    it('should wait for failed workflow', async () => {
      mockExecutor = new MockResilientExecutor();
      mockExecutor.executeTask = async () => {
        return {
          taskId: 'task-1',
          executionId: 'exec-1',
          success: false,
          exitCode: 1,
          output: '',
          error: 'Task failed',
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
          attempts: [],
          totalAttempts: 1,
          finalAttempt: {
            attemptNumber: 1,
            success: false,
            startedAt: new Date(),
            willRetry: false,
          },
        };
      };

      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
        config: { continueOnStepFailure: false },
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');
      const execution = await orchestrator.waitForWorkflow(executionId);

      assert.strictEqual(execution.status, 'failed');
    });
  });

  describe('pauseWorkflow', () => {
    it('should create checkpoint when pausing', async () => {
      mockExecutor = new MockResilientExecutor(50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait a bit for execution to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Pause workflow
      await orchestrator.pauseWorkflow(executionId);

      // Verify checkpoint was created
      const checkpoints = await storage.listCheckpoints();
      assert.ok(checkpoints.length > 0);

      const checkpoint = checkpoints.find((cp) => cp.executionId === executionId);
      assert.ok(checkpoint);
      assert.strictEqual(checkpoint.state.status, 'paused');
    });

    it('should emit pause event', async () => {
      let pauseEmitted = false;
      let emittedExecutionId: string | undefined;

      orchestrator.onPause((executionId) => {
        pauseEmitted = true;
        emittedExecutionId = executionId;
      });

      mockExecutor = new MockResilientExecutor(50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      // Re-register handler
      orchestrator.onPause((executionId) => {
        pauseEmitted = true;
        emittedExecutionId = executionId;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await new Promise((resolve) => setTimeout(resolve, 100));
      await orchestrator.pauseWorkflow(executionId);

      assert.strictEqual(pauseEmitted, true);
      assert.strictEqual(emittedExecutionId, executionId);
    });

    it('should throw error when pausing non-running workflow', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      // Try to pause completed workflow
      await assert.rejects(
        async () => {
          await orchestrator.pauseWorkflow(executionId);
        },
        {
          message: 'Cannot pause workflow in completed state',
        }
      );
    });
  });

  describe('cancelWorkflow', () => {
    it('should create final checkpoint when cancelling', async () => {
      mockExecutor = new MockResilientExecutor(50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait a bit for execution to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cancel workflow
      await orchestrator.cancelWorkflow(executionId);

      // Verify checkpoint was created
      const checkpoints = await storage.listCheckpoints();
      assert.ok(checkpoints.length > 0);

      const checkpoint = checkpoints.find((cp) => cp.executionId === executionId);
      assert.ok(checkpoint);
      assert.strictEqual(checkpoint.state.status, 'cancelled');
    });

    it('should emit cancel event', async () => {
      let cancelEmitted = false;
      let emittedExecutionId: string | undefined;

      mockExecutor = new MockResilientExecutor(50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      orchestrator.onCancel((executionId) => {
        cancelEmitted = true;
        emittedExecutionId = executionId;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      await new Promise((resolve) => setTimeout(resolve, 100));
      await orchestrator.cancelWorkflow(executionId);

      assert.strictEqual(cancelEmitted, true);
      assert.strictEqual(emittedExecutionId, executionId);
    });

    it('should stop workflow execution', async () => {
      mockExecutor = new MockResilientExecutor(100);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Cancel immediately
      await orchestrator.cancelWorkflow(executionId);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 200));

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'cancelled');

      // Should not have executed all steps
      assert.ok(execution.stepResults.length < 3);
    });
  });

  describe('listCheckpoints', () => {
    it('should list all checkpoints', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { checkpointInterval: 1 }
      );

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const checkpoints = await orchestrator.listCheckpoints();
      assert.ok(checkpoints.length > 0);
    });

    it('should filter checkpoints by workflowId', async () => {
      const workflow1: WorkflowDefinition = {
        id: 'workflow-1',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
      };

      const workflow2: WorkflowDefinition = {
        id: 'workflow-2',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
      };

      await orchestrator.startWorkflow(workflow1, '/test', {
        checkpointInterval: 1,
      });
      await orchestrator.startWorkflow(workflow2, '/test', {
        checkpointInterval: 1,
      });

      // Wait for both to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const checkpoints1 = await orchestrator.listCheckpoints('workflow-1');
      const checkpoints2 = await orchestrator.listCheckpoints('workflow-2');

      assert.ok(checkpoints1.every((cp) => cp.workflowId === 'workflow-1'));
      assert.ok(checkpoints2.every((cp) => cp.workflowId === 'workflow-2'));
    });

    it('should return empty array when no storage configured', async () => {
      const noStorageOrchestrator = new LinearOrchestrator(
        mockExecutor as any
      );

      const checkpoints = await noStorageOrchestrator.listCheckpoints();
      assert.strictEqual(checkpoints.length, 0);
    });
  });

  describe('getStepStatus', () => {
    it('should return correct status for completed step', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const step1Status = orchestrator.getStepStatus(executionId, 'step-1');
      assert.ok(step1Status);
      assert.strictEqual(step1Status.status, 'completed');
      assert.ok(step1Status.result);
    });

    it('should return correct status for pending step', async () => {
      mockExecutor = new MockResilientExecutor(100);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
          { id: 'step-3', taskType: 'issue', prompt: 'Step 3' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      // Check step 3 status immediately (should be pending)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const step3Status = orchestrator.getStepStatus(executionId, 'step-3');
      assert.ok(step3Status);
      assert.strictEqual(step3Status.status, 'pending');
    });

    it('should return null for non-existent execution', () => {
      const status = orchestrator.getStepStatus('non-existent-id', 'step-1');
      assert.strictEqual(status, null);
    });

    it('should return null for non-existent step', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [{ id: 'step-1', taskType: 'issue', prompt: 'Step 1' }],
      };

      const executionId = await orchestrator.startWorkflow(workflow, '/test');

      const status = orchestrator.getStepStatus(
        executionId,
        'non-existent-step'
      );
      assert.strictEqual(status, null);
    });
  });
});
