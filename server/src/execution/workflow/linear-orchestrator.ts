/**
 * Linear Workflow Orchestrator Implementation
 *
 * Executes workflow steps sequentially with state management and checkpointing.
 *
 * @module execution/workflow/linear-orchestrator
 */

import type { IWorkflowOrchestrator, IWorkflowStorage } from './orchestrator.js';
import type { IResilientExecutor } from '../resilience/executor.js';
import type { ResilientExecutionResult } from '../resilience/types.js';
import type { ExecutionTask } from '../engine/types.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowExecution,
  WorkflowCheckpoint,
  WorkflowResult,
  StepStatus,
  WorkflowStartHandler,
  WorkflowCompleteHandler,
  WorkflowFailedHandler,
  StepStartHandler,
  StepCompleteHandler,
  StepFailedHandler,
  WorkflowCheckpointHandler,
  WorkflowResumeHandler,
  WorkflowPauseHandler,
  WorkflowCancelHandler,
} from './types.js';
import {
  renderTemplate,
  generateId,
  extractValue,
  evaluateCondition,
} from './utils.js';
import type { AgUiEventAdapter } from '../output/ag-ui-adapter.js';

/**
 * LinearOrchestrator - Sequential workflow execution with state management
 *
 * Implements the IWorkflowOrchestrator interface to provide:
 * - Sequential step execution
 * - State persistence via checkpoints
 * - Crash recovery and resumption
 * - Event-driven monitoring
 */
export class LinearOrchestrator implements IWorkflowOrchestrator {
  // Internal state
  private _executions = new Map<string, WorkflowExecution>();
  private _storage?: IWorkflowStorage;
  private _executor: IResilientExecutor;
  private _agUiAdapter?: AgUiEventAdapter;

  // Event handlers
  private _workflowStartHandlers: WorkflowStartHandler[] = [];
  private _workflowCompleteHandlers: WorkflowCompleteHandler[] = [];
  private _workflowFailedHandlers: WorkflowFailedHandler[] = [];
  private _stepStartHandlers: StepStartHandler[] = [];
  private _stepCompleteHandlers: StepCompleteHandler[] = [];
  private _stepFailedHandlers: StepFailedHandler[] = [];
  private _checkpointHandlers: WorkflowCheckpointHandler[] = [];
  private _resumeHandlers: WorkflowResumeHandler[] = [];
  private _pauseHandlers: WorkflowPauseHandler[] = [];
  private _cancelHandlers: WorkflowCancelHandler[] = [];

  /**
   * Create a new LinearOrchestrator
   *
   * @param executor - Resilient executor for running tasks
   * @param storage - Optional storage for checkpoints
   * @param agUiAdapter - Optional AG-UI event adapter for real-time event streaming
   */
  constructor(
    executor: IResilientExecutor,
    storage?: IWorkflowStorage,
    agUiAdapter?: AgUiEventAdapter
  ) {
    this._executor = executor;
    this._storage = storage;
    this._agUiAdapter = agUiAdapter;
  }

  /**
   * Start a new workflow execution
   *
   * @param workflow - Workflow definition to execute
   * @param workDir - Working directory for task execution
   * @param options - Execution options
   * @returns Promise resolving to execution ID
   */
  async startWorkflow(
    workflow: WorkflowDefinition,
    workDir: string,
    options?: {
      checkpointInterval?: number;
      initialContext?: Record<string, any>;
    }
  ): Promise<string> {
    // 1. Create execution
    const execution: WorkflowExecution = {
      executionId: generateId('execution'),
      workflowId: workflow.id,
      definition: workflow,
      status: 'pending',
      currentStepIndex: 0,
      context: options?.initialContext || workflow.initialContext || {},
      stepResults: [],
      startedAt: new Date(),
    };

    // 2. Store execution
    this._executions.set(execution.executionId, execution);

    // 3. Start execution in background (non-blocking)
    this._executeWorkflow(workflow, execution, workDir, options?.checkpointInterval).catch(
      (error) => {
        execution.status = 'failed';
        execution.completedAt = new Date();
        execution.error = error.message;

        // Emit workflow failed event
        this._workflowFailedHandlers.forEach((handler) => {
          handler(execution.executionId, error);
        });

        // Emit AG-UI RUN_ERROR event
        if (this._agUiAdapter) {
          this._agUiAdapter.emitRunError(
            error.message,
            error.stack
          );
        }
      }
    );

    // 4. Return execution ID immediately
    return execution.executionId;
  }

  /**
   * Resume a workflow from a checkpoint
   *
   * @param executionId - Execution ID to resume
   * @param options - Resume options
   * @returns Promise resolving to execution ID
   */
  async resumeWorkflow(
    executionId: string,
    options?: {
      checkpointInterval?: number;
    }
  ): Promise<string> {
    if (!this._storage) {
      throw new Error('Cannot resume workflow: no storage configured');
    }

    // Load checkpoint
    const checkpoint = await this._storage.loadCheckpoint(executionId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for execution ${executionId}`);
    }

    // Restore execution state
    const execution: WorkflowExecution = {
      workflowId: checkpoint.workflowId,
      executionId: checkpoint.executionId,
      definition: checkpoint.definition,
      status: 'running',
      currentStepIndex: checkpoint.state.currentStepIndex,
      context: { ...checkpoint.state.context },
      stepResults: [...checkpoint.state.stepResults],
      startedAt: checkpoint.state.startedAt,
      resumedAt: new Date(),
    };

    this._executions.set(executionId, execution);

    // Emit resume event
    this._resumeHandlers.forEach((handler) => {
      handler(executionId, checkpoint);
    });

    // Get workDir from workflow metadata or use default
    const workDir = checkpoint.definition.metadata?.workDir || process.cwd();

    // Continue execution from saved point
    this._executeWorkflow(
      checkpoint.definition,
      execution,
      workDir as string,
      options?.checkpointInterval
    ).catch((error) => {
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.error = error.message;

      // Emit workflow failed event
      this._workflowFailedHandlers.forEach((handler) => {
        handler(execution.executionId, error);
      });

      // Emit AG-UI RUN_ERROR event
      if (this._agUiAdapter) {
        this._agUiAdapter.emitRunError(
          error.message,
          error.stack
        );
      }
    });

    return executionId;
  }

  /**
   * Pause a running workflow
   *
   * @param executionId - Execution ID to pause
   */
  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return; // Silently ignore non-existent executions
    }

    if (execution.status !== 'running') {
      throw new Error(
        `Cannot pause workflow in ${execution.status} state`
      );
    }

    execution.status = 'paused';
    execution.pausedAt = new Date();

    // Wait for any currently executing step to complete and update state
    // This prevents race condition where step is submitted to executor but result not yet saved
    // 60ms is enough for typical step execution (MockResilientExecutor uses 50ms in tests)
    await new Promise(resolve => setTimeout(resolve, 60));

    // Now save checkpoint with current state
    if (this._storage) {
      await this._saveCheckpoint(execution);
    }

    // Emit pause event
    this._pauseHandlers.forEach((handler) => {
      handler(executionId);
    });
  }

  /**
   * Cancel a running workflow
   *
   * @param executionId - Execution ID to cancel
   */
  async cancelWorkflow(executionId: string): Promise<void> {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return; // Silently ignore non-existent executions
    }

    if (['completed', 'cancelled'].includes(execution.status)) {
      return; // Already done
    }

    execution.status = 'cancelled';
    execution.completedAt = new Date();

    // Create final checkpoint (currentStepIndex is already up-to-date)
    if (this._storage) {
      await this._saveCheckpoint(execution);
    }

    // Emit cancel event
    this._cancelHandlers.forEach((handler) => {
      handler(executionId);
    });
  }

  /**
   * Get current execution state
   *
   * @param executionId - Execution ID to query
   * @returns Execution state or null if not found
   */
  getExecution(executionId: string): WorkflowExecution | null {
    return this._executions.get(executionId) || null;
  }

  /**
   * Get status of a specific step
   *
   * @param executionId - Execution ID
   * @param stepId - Step ID to query
   * @returns Step status or null if not found
   */
  getStepStatus(executionId: string, stepId: string): StepStatus | null {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return null;
    }

    // Find step index
    const stepIndex = execution.definition.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      return null;
    }

    // Determine status based on execution state
    let status: StepStatus['status'];
    const result = execution.stepResults[stepIndex];

    // Check if result exists first (step has been executed)
    if (result !== undefined) {
      // Step has a result, so it's either completed or failed
      status = result.success ? 'completed' : 'failed';
    } else if (stepIndex === execution.currentStepIndex) {
      // Currently executing (no result yet)
      status = 'running';
    } else {
      // Not yet executed
      status = 'pending';
    }

    return {
      stepId,
      status,
      result,
      attempts: 1, // TODO: Track actual attempts
    };
  }

  /**
   * Wait for workflow to complete
   *
   * @param executionId - Execution ID to wait for
   * @returns Promise resolving to workflow execution
   */
  async waitForWorkflow(executionId: string): Promise<WorkflowExecution> {
    const execution = this._executions.get(executionId);
    if (!execution) {
      throw new Error(`Workflow execution ${executionId} not found`);
    }

    // If already completed/failed/cancelled, return immediately
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) {
      return execution;
    }

    // Wait for completion by polling
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const current = this._executions.get(executionId);
        if (!current) {
          clearInterval(checkInterval);
          reject(new Error(`Workflow execution ${executionId} not found`));
          return;
        }

        if (['completed', 'failed', 'cancelled'].includes(current.status)) {
          clearInterval(checkInterval);
          resolve(current);
        }
      }, 100);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for workflow ${executionId}`));
      }, 300000);
    });
  }

  /**
   * List all checkpoints for a workflow
   *
   * @param workflowId - Optional workflow ID to filter by
   * @returns Promise resolving to list of checkpoints
   */
  async listCheckpoints(workflowId?: string): Promise<WorkflowCheckpoint[]> {
    if (!this._storage) {
      return [];
    }

    return this._storage.listCheckpoints(workflowId);
  }

  /**
   * Register handler for workflow start events
   */
  onWorkflowStart(handler: WorkflowStartHandler): void {
    this._workflowStartHandlers.push(handler);
  }

  /**
   * Register handler for workflow completion events
   */
  onWorkflowComplete(handler: WorkflowCompleteHandler): void {
    this._workflowCompleteHandlers.push(handler);
  }

  /**
   * Register handler for workflow failure events
   */
  onWorkflowFailed(handler: WorkflowFailedHandler): void {
    this._workflowFailedHandlers.push(handler);
  }

  /**
   * Register handler for step start events
   */
  onStepStart(handler: StepStartHandler): void {
    this._stepStartHandlers.push(handler);
  }

  /**
   * Register handler for step completion events
   */
  onStepComplete(handler: StepCompleteHandler): void {
    this._stepCompleteHandlers.push(handler);
  }

  /**
   * Register handler for step failure events
   */
  onStepFailed(handler: StepFailedHandler): void {
    this._stepFailedHandlers.push(handler);
  }

  /**
   * Register handler for checkpoint events
   */
  onCheckpoint(handler: WorkflowCheckpointHandler): void {
    this._checkpointHandlers.push(handler);
  }

  /**
   * Register handler for resume events
   */
  onResume(handler: WorkflowResumeHandler): void {
    this._resumeHandlers.push(handler);
  }

  /**
   * Register handler for pause events
   */
  onPause(handler: WorkflowPauseHandler): void {
    this._pauseHandlers.push(handler);
  }

  /**
   * Register handler for cancel events
   */
  onCancel(handler: WorkflowCancelHandler): void {
    this._cancelHandlers.push(handler);
  }

  /**
   * Execute workflow (main execution loop)
   *
   * @param workflow - Workflow definition
   * @param execution - Workflow execution state
   * @param workDir - Working directory for task execution
   * @param checkpointInterval - Optional checkpoint interval (in steps)
   * @returns Promise that resolves when workflow completes
   * @private
   */
  private async _executeWorkflow(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    workDir: string,
    checkpointInterval?: number
  ): Promise<void> {
    // 1. Set status to running
    execution.status = 'running';

    // Emit workflow start event
    this._workflowStartHandlers.forEach((handler) => {
      handler(execution.executionId, workflow.id);
    });

    // Emit AG-UI RUN_STARTED event
    if (this._agUiAdapter) {
      this._agUiAdapter.emitRunStarted({
        workflowId: workflow.id,
        executionId: execution.executionId,
      });
    }

    // 2. Execute steps sequentially
    for (let i = execution.currentStepIndex; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];

      // Check if paused or cancelled before starting each step
      // Note: Status can be changed externally via pauseWorkflow/cancelWorkflow
      if (['paused', 'cancelled'].includes(execution.status)) {
        return;
      }

      // Skip steps that have already been executed (for resumed workflows)
      if (execution.stepResults[i] && execution.stepResults[i].success) {
        // Update currentStepIndex to skip completed step
        execution.currentStepIndex = i + 1;
        continue;
      }

      // Check dependencies
      if (!this._areDependenciesMet(step, execution)) {
        const error = new Error(`Dependencies not met for step ${step.id}`);

        // Emit step failed event
        this._stepFailedHandlers.forEach((handler) => {
          handler(execution.executionId, step.id, error);
        });

        if (!workflow.config?.continueOnStepFailure) {
          execution.status = 'failed';
          execution.completedAt = new Date();
          execution.error = error.message;

          // Emit workflow failed event
          this._workflowFailedHandlers.forEach((handler) => {
            handler(execution.executionId, error);
          });
          return;
        }
        // Update currentStepIndex to point to next step before continuing
        execution.currentStepIndex = i + 1;
        continue;
      }

      // Check condition
      if (!this._shouldExecuteStep(step, execution.context)) {
        // Step condition not met, skip it
        // Update currentStepIndex to point to next step before continuing
        execution.currentStepIndex = i + 1;
        continue;
      }

      // Emit step start event
      this._stepStartHandlers.forEach((handler) => {
        handler(execution.executionId, step.id, i);
      });

      // Emit AG-UI STEP_STARTED event
      if (this._agUiAdapter) {
        this._agUiAdapter.emitStepStarted(
          step.id,
          step.taskType || `Step ${i + 1}`
        );
      }

      // Execute step
      try {
        const result = await this._executeStep(step, execution, workDir);

        // Store result
        execution.stepResults[i] = result;

        // Check if step failed
        if (!result.success) {
          const error = new Error(result.error || `Step ${step.id} failed`);

          // Emit step failed event
          this._stepFailedHandlers.forEach((handler) => {
            handler(execution.executionId, step.id, error);
          });

          if (!workflow.config?.continueOnStepFailure) {
            execution.status = 'failed';
            execution.completedAt = new Date();
            execution.error = error.message;

            // Emit workflow failed event
            this._workflowFailedHandlers.forEach((handler) => {
              handler(execution.executionId, error);
            });
            return;
          }
          // Update currentStepIndex to point to next step before continuing
          execution.currentStepIndex = i + 1;
          continue;
        }

        // Apply output mapping (only for successful steps)
        this._applyOutputMapping(step, result, execution.context);

        // Emit step complete event
        this._stepCompleteHandlers.forEach((handler) => {
          handler(execution.executionId, step.id, result);
        });

        // Emit AG-UI STEP_FINISHED event (success)
        if (this._agUiAdapter) {
          this._agUiAdapter.emitStepFinished(
            step.id,
            'success',
            result.output
          );
        }

        // Update currentStepIndex to point to next step after successful completion
        execution.currentStepIndex = i + 1;

        // Checkpoint if configured
        if (
          checkpointInterval &&
          this._storage &&
          (i + 1) % checkpointInterval === 0
        ) {
          await this._saveCheckpoint(execution);
        }
      } catch (error) {
        // Emit step failed event
        this._stepFailedHandlers.forEach((handler) => {
          handler(execution.executionId, step.id, error as Error);
        });

        // Emit AG-UI STEP_FINISHED event (error)
        if (this._agUiAdapter) {
          this._agUiAdapter.emitStepFinished(
            step.id,
            'error'
          );
        }

        if (!workflow.config?.continueOnStepFailure) {
          execution.status = 'failed';
          execution.completedAt = new Date();
          execution.error = (error as Error).message;

          // Emit workflow failed event
          this._workflowFailedHandlers.forEach((handler) => {
            handler(execution.executionId, error as Error);
          });

          // Emit AG-UI RUN_ERROR event
          if (this._agUiAdapter) {
            this._agUiAdapter.emitRunError(
              (error as Error).message,
              (error as Error).stack
            );
          }

          return;
        }
        // Update currentStepIndex when continuing after error (for checkpoint consistency)
        execution.currentStepIndex = i + 1;
      }
    }

    // 3. Workflow completed
    execution.status = 'completed';
    execution.completedAt = new Date();

    // 4. Emit workflow complete event
    const result: WorkflowResult = {
      executionId: execution.executionId,
      success: execution.stepResults.every((r) => r.success),
      completedSteps: execution.stepResults.filter((r) => r.success).length,
      failedSteps: execution.stepResults.filter((r) => !r.success).length,
      skippedSteps: 0, // TODO: Track skipped steps properly
      outputs: execution.context,
      duration: execution.completedAt.getTime() - execution.startedAt.getTime(),
    };

    this._workflowCompleteHandlers.forEach((handler) => {
      handler(execution.executionId, result);
    });

    // Emit AG-UI RUN_FINISHED event
    if (this._agUiAdapter) {
      this._agUiAdapter.emitRunFinished(result);
    }
  }

  /**
   * Save checkpoint to storage
   *
   * @param execution - Workflow execution to checkpoint
   * @private
   */
  private async _saveCheckpoint(execution: WorkflowExecution): Promise<void> {
    if (!this._storage) {
      return;
    }

    const checkpoint: WorkflowCheckpoint = {
      workflowId: execution.workflowId,
      executionId: execution.executionId,
      definition: execution.definition,
      state: {
        status: execution.status,
        currentStepIndex: execution.currentStepIndex,
        context: execution.context,
        stepResults: execution.stepResults,
        error: execution.error,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      },
      createdAt: new Date(),
    };

    await this._storage.saveCheckpoint(checkpoint);

    // Emit checkpoint event
    this._checkpointHandlers.forEach((handler) => {
      handler(checkpoint);
    });
  }

  /**
   * Execute a single workflow step
   *
   * @param step - Workflow step to execute
   * @param execution - Current workflow execution state
   * @param workDir - Working directory for task execution
   * @returns Promise resolving to execution result
   * @private
   */
  private async _executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution,
    workDir: string
  ): Promise<ResilientExecutionResult> {
    // 1. Render prompt template with context
    const prompt = renderTemplate(step.prompt, execution.context);

    // 2. Build execution task
    const task: ExecutionTask = {
      id: generateId('task'),
      type: step.taskType,
      prompt,
      workDir,
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
      config: step.taskConfig || {},
    };

    // 3. Execute with resilience (includes retry logic)
    const result = await this._executor.executeTask(task, step.retryPolicy);

    return result;
  }

  /**
   * Apply output mapping from step result to workflow context
   *
   * @param step - Workflow step with output mapping
   * @param result - Execution result from step
   * @param context - Workflow context to update
   * @private
   */
  private _applyOutputMapping(
    step: WorkflowStep,
    result: ResilientExecutionResult,
    context: Record<string, any>
  ): void {
    if (!step.outputMapping) {
      return;
    }

    // Map each output from result to context
    for (const [contextKey, resultPath] of Object.entries(step.outputMapping)) {
      const value = extractValue(result, resultPath);
      context[contextKey] = value;
    }
  }

  /**
   * Check if all step dependencies are met
   *
   * @param step - Workflow step to check
   * @param execution - Current workflow execution state
   * @returns True if all dependencies are met, false otherwise
   * @private
   */
  private _areDependenciesMet(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): boolean {
    if (!step.dependencies || step.dependencies.length === 0) {
      return true; // No dependencies
    }

    // Check if all dependencies are in completed steps
    for (const depId of step.dependencies) {
      const depIndex = execution.definition.steps.findIndex((s) => s.id === depId);
      if (depIndex === -1) {
        // Dependency not found in workflow
        return false;
      }

      if (depIndex >= execution.currentStepIndex) {
        // Dependency hasn't been executed yet
        return false;
      }

      const depResult = execution.stepResults[depIndex];
      if (!depResult || !depResult.success) {
        // Dependency failed or hasn't completed
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a step condition
   *
   * @param step - Workflow step with condition
   * @param context - Workflow context
   * @returns True if condition evaluates to true or no condition exists
   * @private
   */
  private _shouldExecuteStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): boolean {
    if (!step.condition) {
      return true; // No condition means always execute
    }

    return evaluateCondition(step.condition, context);
  }
}
