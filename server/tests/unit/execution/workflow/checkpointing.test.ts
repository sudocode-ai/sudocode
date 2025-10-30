/**
 * Tests for Checkpointing and Resumption
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LinearOrchestrator } from '../../../../src/execution/workflow/linear-orchestrator.js';
import { InMemoryWorkflowStorage } from '../../../../src/execution/workflow/memory-storage.js';
import type { IResilientExecutor } from '../../../../src/execution/resilience/executor.js';
import type { ResilientExecutionResult } from '../../../../src/execution/resilience/types.js';
import type { WorkflowDefinition, WorkflowCheckpoint } from '../../../../src/execution/workflow/types.js';

/**
 * Mock Resilient Executor for testing
 */
class MockResilientExecutor implements Partial<IResilientExecutor> {
  public executedTasks: any[] = [];
  public mockResults: ResilientExecutionResult[] = [];
  public currentResultIndex = 0;
  public executionDelay = 0;

  constructor(results?: Partial<ResilientExecutionResult>[], delay = 0) {
    this.executionDelay = delay;
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

    // Add delay if configured
    if (this.executionDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.executionDelay));
    }

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

describe('Checkpointing and Resumption', () => {
  let mockExecutor: MockResilientExecutor;
  let storage: InMemoryWorkflowStorage;
  let orchestrator: LinearOrchestrator;

  beforeEach(() => {
    mockExecutor = new MockResilientExecutor();
    storage = new InMemoryWorkflowStorage();
    orchestrator = new LinearOrchestrator(mockExecutor as any, storage);
  });

  describe('checkpoint creation', () => {
    it('should create checkpoint at specified interval', async () => {
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
        { checkpointInterval: 2 }
      );

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const checkpoints = await storage.listCheckpoints();
      assert.ok(checkpoints.length > 0);
      assert.strictEqual(checkpoints[0].executionId, executionId);
    });

    it('should include complete execution state in checkpoint', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Step 1',
            outputMapping: { result1: 'output' },
          },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        {
          checkpointInterval: 1,
          initialContext: { testKey: 'testValue' },
        }
      );

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const checkpoint = await storage.loadCheckpoint(executionId);
      assert.ok(checkpoint);
      assert.strictEqual(checkpoint.workflowId, 'test-workflow');
      assert.strictEqual(checkpoint.executionId, executionId);
      assert.ok(checkpoint.state.currentStepIndex >= 0);
      assert.ok(checkpoint.state.stepResults.length > 0);
      assert.ok(checkpoint.state.context);
      assert.ok(checkpoint.createdAt);
    });

    it('should emit checkpoint event', async () => {
      let checkpointEmitted = false;
      let emittedCheckpoint: WorkflowCheckpoint | undefined;

      orchestrator.onCheckpoint((checkpoint) => {
        checkpointEmitted = true;
        emittedCheckpoint = checkpoint;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { checkpointInterval: 1 }
      );

      await waitFor(() => checkpointEmitted);

      assert.strictEqual(checkpointEmitted, true);
      assert.ok(emittedCheckpoint);
      assert.strictEqual(emittedCheckpoint?.executionId, executionId);
    });

    it('should not create checkpoint when interval not reached', async () => {
      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { checkpointInterval: 5 } // Interval higher than step count
      );

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      });

      const checkpoints = await storage.listCheckpoints();
      // Should not create checkpoint since we only have 2 steps and interval is 5
      assert.strictEqual(checkpoints.length, 0);
    });
  });

  describe('workflow resumption', () => {
    it('should resume workflow from checkpoint', async () => {
      // Use slow executor to allow time for pause
      mockExecutor = new MockResilientExecutor(undefined, 50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

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

      // Wait for first checkpoint
      await waitFor(() => storage.size() > 0, 2000);

      // Pause workflow
      await orchestrator.pauseWorkflow(executionId);

      // Wait a bit to ensure pause takes effect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Resume workflow
      await orchestrator.resumeWorkflow(executionId, { checkpointInterval: 1 });

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      }, 3000);

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.status, 'completed');
      assert.ok(execution?.stepResults.length === 3);
    });

    it('should continue from correct step index after resume', async () => {
      mockExecutor = new MockResilientExecutor(undefined, 50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

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

      // Wait for at least one checkpoint
      await waitFor(() => storage.size() > 0, 2000);

      // Pause workflow
      await orchestrator.pauseWorkflow(executionId);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check checkpoint state
      const checkpoint = await storage.loadCheckpoint(executionId);
      const resultsAtPause = checkpoint?.state.stepResults.length || 0;

      // Track tasks executed before resume
      const tasksBeforeResume = mockExecutor.executedTasks.length;

      // Resume workflow
      await orchestrator.resumeWorkflow(executionId);

      // Wait for completion
      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      }, 3000);

      const execution = orchestrator.getExecution(executionId);

      // Verify all steps completed
      assert.strictEqual(execution?.stepResults.length, 3);

      // Verify we didn't re-execute completed steps
      const tasksAfterResume = mockExecutor.executedTasks.length;
      const newTasksExecuted = tasksAfterResume - tasksBeforeResume;

      // Should only execute remaining steps
      assert.ok(newTasksExecuted <= 3 - resultsAtPause);
    });

    it('should preserve context across resume', async () => {
      mockExecutor = new MockResilientExecutor([
        { success: true, output: 'Result from step 1' },
        { success: true, output: 'Result from step 2' },
      ], 50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          {
            id: 'step-1',
            taskType: 'issue',
            prompt: 'Step 1',
            outputMapping: { result1: 'output' },
          },
          {
            id: 'step-2',
            taskType: 'issue',
            prompt: 'Step 2 with {{result1}}',
          },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { checkpointInterval: 1 }
      );

      // Wait for checkpoint after step 1
      await waitFor(() => {
        const checkpoint = storage._checkpoints.get(executionId);
        return Boolean(
          checkpoint && checkpoint.state.stepResults.length >= 1
        );
      }, 2000);

      // Pause and resume
      await orchestrator.pauseWorkflow(executionId);
      await new Promise((resolve) => setTimeout(resolve, 100));

      await orchestrator.resumeWorkflow(executionId);

      await waitFor(() => {
        const execution = orchestrator.getExecution(executionId);
        return execution?.status === 'completed';
      }, 3000);

      const execution = orchestrator.getExecution(executionId);
      assert.strictEqual(execution?.context.result1, 'Result from step 1');
    });

    it('should emit resume event', async () => {
      let resumeEmitted = false;
      let emittedExecutionId: string | undefined;

      orchestrator.onResume((executionId, _checkpoint) => {
        resumeEmitted = true;
        emittedExecutionId = executionId;
      });

      mockExecutor = new MockResilientExecutor(undefined, 50);
      orchestrator = new LinearOrchestrator(mockExecutor as any, storage);

      // Re-register handler after recreating orchestrator
      orchestrator.onResume((executionId) => {
        resumeEmitted = true;
        emittedExecutionId = executionId;
      });

      const workflow: WorkflowDefinition = {
        id: 'test-workflow',
        steps: [
          { id: 'step-1', taskType: 'issue', prompt: 'Step 1' },
          { id: 'step-2', taskType: 'issue', prompt: 'Step 2' },
        ],
      };

      const executionId = await orchestrator.startWorkflow(
        workflow,
        '/test',
        { checkpointInterval: 1 }
      );

      await waitFor(() => storage.size() > 0, 2000);
      await orchestrator.pauseWorkflow(executionId);
      await new Promise((resolve) => setTimeout(resolve, 100));

      await orchestrator.resumeWorkflow(executionId);

      assert.strictEqual(resumeEmitted, true);
      assert.strictEqual(emittedExecutionId, executionId);
    });

    it('should throw error when resuming without storage', async () => {
      const noStorageOrchestrator = new LinearOrchestrator(
        mockExecutor as any
      );

      await assert.rejects(
        async () => {
          await noStorageOrchestrator.resumeWorkflow('test-id');
        },
        {
          message: 'Cannot resume workflow: no storage configured',
        }
      );
    });

    it('should throw error when checkpoint not found', async () => {
      await assert.rejects(
        async () => {
          await orchestrator.resumeWorkflow('non-existent-id');
        },
        {
          message: 'No checkpoint found for execution non-existent-id',
        }
      );
    });
  });

  describe('InMemoryWorkflowStorage', () => {
    it('should store and retrieve checkpoints', async () => {
      const checkpoint: WorkflowCheckpoint = {
        workflowId: 'test-workflow',
        executionId: 'exec-1',
        definition: {
          id: 'test-workflow',
          steps: [],
        },
        state: {
          status: 'running',
          currentStepIndex: 1,
          context: { test: 'value' },
          stepResults: [],
          startedAt: new Date(),
        },
        createdAt: new Date(),
      };

      await storage.saveCheckpoint(checkpoint);

      const retrieved = await storage.loadCheckpoint('exec-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.executionId, 'exec-1');
      assert.strictEqual(retrieved.workflowId, 'test-workflow');
    });

    it('should list checkpoints', async () => {
      const checkpoint1: WorkflowCheckpoint = {
        workflowId: 'workflow-1',
        executionId: 'exec-1',
        definition: { id: 'workflow-1', steps: [] },
        state: {
          status: 'running',
          currentStepIndex: 0,
          context: {},
          stepResults: [],
          startedAt: new Date(),
        },
        createdAt: new Date(),
      };

      const checkpoint2: WorkflowCheckpoint = {
        workflowId: 'workflow-2',
        executionId: 'exec-2',
        definition: { id: 'workflow-2', steps: [] },
        state: {
          status: 'running',
          currentStepIndex: 0,
          context: {},
          stepResults: [],
          startedAt: new Date(),
        },
        createdAt: new Date(),
      };

      await storage.saveCheckpoint(checkpoint1);
      await storage.saveCheckpoint(checkpoint2);

      const all = await storage.listCheckpoints();
      assert.strictEqual(all.length, 2);

      const filtered = await storage.listCheckpoints('workflow-1');
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].workflowId, 'workflow-1');
    });

    it('should delete checkpoints', async () => {
      const checkpoint: WorkflowCheckpoint = {
        workflowId: 'test-workflow',
        executionId: 'exec-1',
        definition: { id: 'test-workflow', steps: [] },
        state: {
          status: 'running',
          currentStepIndex: 0,
          context: {},
          stepResults: [],
          startedAt: new Date(),
        },
        createdAt: new Date(),
      };

      await storage.saveCheckpoint(checkpoint);
      assert.strictEqual(storage.size(), 1);

      await storage.deleteCheckpoint('exec-1');
      assert.strictEqual(storage.size(), 0);

      const retrieved = await storage.loadCheckpoint('exec-1');
      assert.strictEqual(retrieved, null);
    });

    it('should clear all checkpoints', () => {
      storage._checkpoints.set('exec-1', {} as any);
      storage._checkpoints.set('exec-2', {} as any);
      assert.strictEqual(storage.size(), 2);

      storage.clear();
      assert.strictEqual(storage.size(), 0);
    });
  });
});
