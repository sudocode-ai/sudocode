/**
 * AG-UI Event Adapter
 *
 * Transforms SPEC-007 output processing events into AG-UI protocol events.
 * This adapter subscribes to events from IOutputProcessor and emits standardized
 * AG-UI events that can be consumed by frontends via SSE or WebSocket transports.
 *
 * @module execution/output/ag-ui-adapter
 */

import {
  EventType,
  type RunStartedEvent,
  type RunFinishedEvent,
  type RunErrorEvent,
  type StepStartedEvent,
  type StepFinishedEvent,
  type ToolCallStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type TextMessageStartEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
  type CustomEvent,
  type State,
} from "@ag-ui/core";

import {
  IOutputProcessor,
  ToolCall,
  FileChange,
  ProcessingMetrics,
  ToolCallHandler,
  FileChangeHandler,
  ProgressHandler,
  ErrorHandler,
} from "./types.js";

/**
 * Event listener callback type
 *
 * Accepts any AG-UI event type from @ag-ui/core
 */
export type AgUiEventListener = (
  event:
    | RunStartedEvent
    | RunFinishedEvent
    | RunErrorEvent
    | StepStartedEvent
    | StepFinishedEvent
    | ToolCallStartEvent
    | ToolCallArgsEvent
    | ToolCallEndEvent
    | ToolCallResultEvent
    | TextMessageStartEvent
    | TextMessageContentEvent
    | TextMessageEndEvent
    | StateDeltaEvent
    | StateSnapshotEvent
    | CustomEvent
) => void;

/**
 * AgUiEventAdapter - Transforms SPEC-007 events to AG-UI events
 *
 * This adapter bridges the gap between the Output Processing Layer (SPEC-007)
 * and the AG-UI protocol (SPEC-009). It subscribes to output processor events
 * and emits corresponding AG-UI protocol events.
 *
 * @example
 * ```typescript
 * const adapter = new AgUiEventAdapter('run-123');
 * adapter.onEvent((event) => {
 *   console.log('AG-UI event:', event);
 *   // Send to SSE transport or WebSocket
 * });
 *
 * adapter.emitRunStarted({ model: 'claude-sonnet-4' });
 * ```
 */
export class AgUiEventAdapter {
  private runId: string;
  private threadId: string;
  private listeners: Set<AgUiEventListener> = new Set();
  private processor: IOutputProcessor | null = null;
  private currentState: any = {};
  private activeToolCalls: Map<
    string,
    { startTime: number; messageId: string }
  > = new Map();
  private messageCounter: number = 0;

  /**
   * Create a new AG-UI event adapter
   *
   * @param runId - Unique identifier for this execution run
   * @param threadId - Thread identifier (defaults to runId if not provided)
   */
  constructor(runId: string, threadId?: string) {
    this.runId = runId;
    this.threadId = threadId || runId;
  }

  /**
   * Connect to an output processor and subscribe to its events
   *
   * @param processor - The output processor to subscribe to
   */
  connectToProcessor(processor: IOutputProcessor): void {
    this.processor = processor;

    // Subscribe to all SPEC-007 events
    processor.onToolCall(this.handleToolCall.bind(this));
    processor.onFileChange(this.handleFileChange.bind(this));
    processor.onProgress(this.handleProgress.bind(this));
    processor.onError(this.handleError.bind(this));
    processor.onMessage(this.handleMessage.bind(this));
    processor.onUsage(this.handleUsage.bind(this));
  }

  /**
   * Register an event listener
   *
   * @param listener - Callback to invoke when AG-UI events are emitted
   */
  onEvent(listener: AgUiEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove an event listener
   *
   * @param listener - Callback to remove
   */
  offEvent(listener: AgUiEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit RUN_STARTED event
   *
   * @param metadata - Optional run metadata (model, config, etc.)
   */
  emitRunStarted(metadata?: Record<string, any>): void {
    const event: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
      timestamp: Date.now(),
      ...(metadata && { rawEvent: metadata }),
    };
    this.emit(event);
    this.emitStateSnapshot();
  }

  /**
   * Emit RUN_FINISHED event
   *
   * @param result - Optional result data
   */
  emitRunFinished(result?: any): void {
    const event: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
      timestamp: Date.now(),
      ...(result && { result }),
    };
    this.emit(event);
  }

  /**
   * Emit a state snapshot with current execution state
   */
  emitStateSnapshot(): void {
    const metrics = this.processor?.getMetrics();

    const event: StateSnapshotEvent = {
      type: EventType.STATE_SNAPSHOT,
      timestamp: Date.now(),
      snapshot: {
        ...this.currentState,
        ...(metrics && {
          totalMessages: metrics.totalMessages,
          toolCallCount: metrics.toolCalls.length,
          fileChangeCount: metrics.fileChanges.length,
          errorCount: metrics.errors.length,
          usage: {
            inputTokens: metrics.usage.inputTokens,
            outputTokens: metrics.usage.outputTokens,
            totalTokens: metrics.usage.totalTokens,
          },
        }),
      },
    };
    this.emit(event);
  }

  /**
   * Handle tool call events from SPEC-007
   *
   * Transforms a single ToolCall into a sequence of AG-UI events:
   * - TOOL_CALL_START (when tool is invoked)
   * - TOOL_CALL_ARGS (with input parameters)
   * - TOOL_CALL_END (when tool completes)
   * - TOOL_CALL_RESULT (with result/error)
   */
  private handleToolCall: ToolCallHandler = (toolCall: ToolCall) => {
    const toolCallId = toolCall.id;
    const timestamp = Date.now();

    // Check if this is a new tool call or an update to existing one
    if (!this.activeToolCalls.has(toolCallId)) {
      // New tool call - emit START and ARGS
      const messageId = `msg-${this.messageCounter++}`;
      this.activeToolCalls.set(toolCallId, {
        startTime: Date.now(),
        messageId,
      });

      const startEvent: ToolCallStartEvent = {
        type: EventType.TOOL_CALL_START,
        timestamp,
        toolCallId,
        toolCallName: toolCall.name,
      };
      this.emit(startEvent);

      const argsEvent: ToolCallArgsEvent = {
        type: EventType.TOOL_CALL_ARGS,
        timestamp,
        toolCallId,
        delta: JSON.stringify(toolCall.input),
      };
      this.emit(argsEvent);
    }

    // If tool call is complete (success or error), emit END and RESULT
    if (toolCall.status === "success" || toolCall.status === "error") {
      const toolInfo = this.activeToolCalls.get(toolCallId);
      const duration = toolInfo ? Date.now() - toolInfo.startTime : undefined;

      const endEvent: ToolCallEndEvent = {
        type: EventType.TOOL_CALL_END,
        timestamp,
        toolCallId,
        ...(duration !== undefined && { rawEvent: { duration } }),
      };
      this.emit(endEvent);

      if (toolInfo) {
        const resultEvent: ToolCallResultEvent = {
          type: EventType.TOOL_CALL_RESULT,
          timestamp,
          messageId: toolInfo.messageId,
          toolCallId,
          content:
            toolCall.status === "success"
              ? typeof toolCall.result === "string"
                ? toolCall.result
                : JSON.stringify(toolCall.result)
              : toolCall.error || "Tool call failed",
        };
        this.emit(resultEvent);
      }

      this.activeToolCalls.delete(toolCallId);

      // Emit state delta with updated tool call count
      this.emitStateDelta({
        toolCallCount: this.processor?.getToolCalls().length || 0,
      });
    }
  };

  /**
   * Handle file change events from SPEC-007
   *
   * Transforms FileChange into a CUSTOM event with file operation details
   */
  private handleFileChange: FileChangeHandler = (fileChange: FileChange) => {
    const event: CustomEvent = {
      type: EventType.CUSTOM,
      timestamp: Date.now(),
      name: "file_change",
      value: {
        path: fileChange.path,
        operation: fileChange.operation,
        toolCallId: fileChange.toolCallId,
        changes: fileChange.changes,
      },
    };
    this.emit(event);

    // Emit state delta with updated file change count
    this.emitStateDelta({
      fileChangeCount: this.processor?.getFileChanges().length || 0,
    });
  };

  /**
   * Handle progress updates from SPEC-007
   *
   * Transforms ProcessingMetrics into STATE_DELTA events
   */
  private handleProgress: ProgressHandler = (metrics: ProcessingMetrics) => {
    this.emitStateDelta({
      totalMessages: metrics.totalMessages,
      toolCallCount: metrics.toolCalls.length,
      fileChangeCount: metrics.fileChanges.length,
      errorCount: metrics.errors.length,
      usage: {
        inputTokens: metrics.usage.inputTokens,
        outputTokens: metrics.usage.outputTokens,
        totalTokens: metrics.usage.totalTokens,
      },
    });
  };

  /**
   * Handle error events from SPEC-007
   *
   * Transforms errors into RUN_ERROR events
   */
  private handleError: ErrorHandler = (error: {
    message: string;
    timestamp: Date;
    details?: any;
  }) => {
    const event: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      timestamp: error.timestamp.getTime(),
      message: error.message,
      ...(error.details && { rawEvent: { details: error.details } }),
    };
    this.emit(event);

    // Emit state delta with updated error count
    this.emitStateDelta({
      errorCount: this.processor?.getMetrics().errors.length || 0,
    });
  };

  /**
   * Handle message events
   *
   * Transforms text messages into TEXT_MESSAGE_* AG-UI events.
   * For now, we emit the full message content in a single event.
   */
  private handleMessage: import("./types.js").MessageHandler = (
    message: import("./types.js").OutputMessage
  ) => {
    if (message.type !== "text") return;

    const messageId = `msg-${this.messageCounter++}`;
    const timestamp = Date.now();

    // Emit TEXT_MESSAGE_START
    const startEvent: TextMessageStartEvent = {
      type: EventType.TEXT_MESSAGE_START,
      timestamp,
      messageId,
      role: "assistant",
    };
    this.emit(startEvent);

    // Emit TEXT_MESSAGE_CONTENT with the full message
    const contentEvent: TextMessageContentEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp,
      messageId,
      delta: message.content,
    };
    this.emit(contentEvent);

    // Emit TEXT_MESSAGE_END
    const endEvent: TextMessageEndEvent = {
      type: EventType.TEXT_MESSAGE_END,
      timestamp,
      messageId,
    };
    this.emit(endEvent);
  };

  /**
   * Handle usage metric updates
   *
   * Transforms usage metrics into CUSTOM usage events and updates state.
   */
  private handleUsage: import("./types.js").UsageHandler = (
    usage: import("./types.js").UsageMetrics
  ) => {
    const timestamp = Date.now();

    // Emit USAGE event as CUSTOM event
    const usageEvent: CustomEvent = {
      type: EventType.CUSTOM,
      timestamp,
      name: "USAGE_UPDATE",
      value: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheTokens: usage.cacheTokens,
        totalTokens: usage.totalTokens,
        cost: usage.cost,
        provider: usage.provider,
        model: usage.model,
      },
    };
    this.emit(usageEvent);

    // Update state with latest usage
    this.emitStateDelta({
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      },
    });
  };

  /**
   * Emit a state delta with partial state updates
   *
   * @param updates - Partial state updates to apply
   */
  private emitStateDelta(updates: Record<string, any>): void {
    // Update current state
    this.currentState = { ...this.currentState, ...updates };

    // Convert updates to JSON Patch operations
    const delta = Object.entries(updates).map(([key, value]) => ({
      op: "replace" as const,
      path: `/${key}`,
      value,
    }));

    const event: StateDeltaEvent = {
      type: EventType.STATE_DELTA,
      timestamp: Date.now(),
      delta,
    };
    this.emit(event);
  }

  /**
   * Emit an AG-UI event to all registered listeners
   *
   * @param event - The event to emit
   */
  private emit(
    event:
      | RunStartedEvent
      | RunFinishedEvent
      | RunErrorEvent
      | StepStartedEvent
      | StepFinishedEvent
      | ToolCallStartEvent
      | ToolCallArgsEvent
      | ToolCallEndEvent
      | ToolCallResultEvent
      | TextMessageStartEvent
      | TextMessageContentEvent
      | TextMessageEndEvent
      | StateDeltaEvent
      | StateSnapshotEvent
      | CustomEvent
  ): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in AG-UI event listener:", error);
      }
    });
  }

  /**
   * Emit STEP_STARTED event for workflow step execution
   *
   * @param stepId - Unique identifier for the step (stored in rawEvent)
   * @param stepName - Human-readable name of the step
   */
  emitStepStarted(stepId: string, stepName: string): void {
    const event: StepStartedEvent = {
      type: EventType.STEP_STARTED,
      timestamp: Date.now(),
      stepName,
      rawEvent: {
        runId: this.runId,
        stepId,
      },
    };
    this.emit(event);
  }

  /**
   * Emit STEP_FINISHED event for workflow step completion
   *
   * @param stepId - Unique identifier for the step (stored in rawEvent)
   * @param status - Status of the step ('success' or 'error', stored in rawEvent)
   * @param output - Optional output data from the step (stored in rawEvent)
   */
  emitStepFinished(
    stepId: string,
    status: "success" | "error",
    output?: any
  ): void {
    const event: StepFinishedEvent = {
      type: EventType.STEP_FINISHED,
      timestamp: Date.now(),
      stepName: stepId, // Use stepId as stepName for now
      rawEvent: {
        runId: this.runId,
        stepId,
        status,
        ...(output && { output }),
      },
    };
    this.emit(event);
  }

  /**
   * Emit RUN_ERROR event when workflow execution fails
   *
   * @param message - Error message
   * @param stack - Optional error stack trace
   * @param code - Optional error code
   */
  emitRunError(message: string, stack?: string, code?: string): void {
    const event: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      timestamp: Date.now(),
      message,
      ...(code && { code }),
      ...(stack && { rawEvent: { stack } }),
    };
    this.emit(event);
  }

  /**
   * Get current adapter state
   *
   * @returns Current state object
   */
  getState(): State {
    return { ...this.currentState };
  }

  /**
   * Get the run ID
   *
   * @returns The run ID this adapter is tracking
   */
  getRunId(): string {
    return this.runId;
  }
}
