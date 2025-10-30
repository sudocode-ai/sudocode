/**
 * AG-UI Integration Helpers
 *
 * Factory functions and helpers to wire SPEC-007 output processing with SPEC-009 AG-UI streaming.
 * Simplifies the integration between ClaudeCodeOutputProcessor and AgUiEventAdapter.
 *
 * @module execution/output/ag-ui-integration
 */

import { ClaudeCodeOutputProcessor } from './claude-code-output-processor.js';
import { AgUiEventAdapter } from './ag-ui-adapter.js';
import type { IOutputProcessor } from './types.js';

/**
 * AG-UI System containing processor and adapter
 *
 * The processor handles parsing Claude Code output and emitting events.
 * The adapter transforms those events into AG-UI protocol events.
 */
export interface AgUiSystem {
  /** Output processor for parsing Claude Code stream-json */
  processor: IOutputProcessor;
  /** AG-UI event adapter for broadcasting events */
  adapter: AgUiEventAdapter;
}

/**
 * Create a complete AG-UI system with processor and adapter pre-wired
 *
 * This is the recommended way to create an AG-UI streaming system.
 * It automatically:
 * - Creates a ClaudeCodeOutputProcessor
 * - Creates an AgUiEventAdapter with the provided runId
 * - Wires the processor to emit events through the adapter
 *
 * @param runId - Unique identifier for this execution run
 * @param threadId - Optional thread ID (defaults to runId)
 * @returns Complete AG-UI system ready to process output
 *
 * @example
 * ```typescript
 * const { processor, adapter } = createAgUiSystem('run-123');
 *
 * // Wire adapter to transport for SSE streaming
 * transportManager.connectAdapter(adapter, 'run-123');
 *
 * // Process Claude Code output
 * await processor.processLine('{"type":"assistant",...}');
 *
 * // Events automatically flow: processor -> adapter -> transport -> SSE clients
 * ```
 */
export function createAgUiSystem(
  runId: string,
  threadId?: string
): AgUiSystem {
  const processor = new ClaudeCodeOutputProcessor();
  const adapter = new AgUiEventAdapter(runId, threadId);

  // Wire processor events to adapter
  adapter.connectToProcessor(processor);

  return { processor, adapter };
}

/**
 * Manually wire an output processor to an AG-UI adapter
 *
 * Use this when you need more control over processor/adapter creation.
 * This function handles all the event handler registration.
 *
 * @param processor - Output processor to wire
 * @param adapter - AG-UI adapter to receive events
 *
 * @example
 * ```typescript
 * const processor = new ClaudeCodeOutputProcessor();
 * const adapter = new AgUiEventAdapter('run-123');
 *
 * // Manually wire them together
 * wireManually(processor, adapter);
 *
 * // Now processor events will flow to adapter
 * ```
 */
export function wireManually(
  processor: IOutputProcessor,
  adapter: AgUiEventAdapter
): void {
  adapter.connectToProcessor(processor);
}

/**
 * Create an AG-UI system with custom processor implementation
 *
 * Use this when you have a custom output processor that implements IOutputProcessor.
 * The processor will be wired to a new AgUiEventAdapter.
 *
 * @param processor - Custom output processor implementation
 * @param runId - Unique identifier for this execution run
 * @param threadId - Optional thread ID (defaults to runId)
 * @returns AG-UI system with your custom processor
 *
 * @example
 * ```typescript
 * class CustomProcessor implements IOutputProcessor {
 *   // ... your implementation
 * }
 *
 * const processor = new CustomProcessor();
 * const { processor, adapter } = createAgUiSystemWithProcessor(
 *   processor,
 *   'run-123'
 * );
 * ```
 */
export function createAgUiSystemWithProcessor(
  processor: IOutputProcessor,
  runId: string,
  threadId?: string
): AgUiSystem {
  const adapter = new AgUiEventAdapter(runId, threadId);
  adapter.connectToProcessor(processor);

  return { processor, adapter };
}
