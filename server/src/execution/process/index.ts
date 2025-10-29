/**
 * Process Layer - Public API
 *
 * Barrel export for the Process Layer (Layer 1) of the execution system.
 * Exports all public types, interfaces, and implementations.
 *
 * @module execution/process
 */

// Core types
export type {
  ProcessStatus,
  ProcessConfig,
  ManagedProcess,
  OutputHandler,
  ErrorHandler,
  ProcessMetrics,
} from './types.js';

// Interface
export type { IProcessManager } from './manager.js';

// Implementations
export { SimpleProcessManager } from './simple-manager.js';

// Utilities
export {
  generateId,
  formatDuration,
  isValidSignal,
  formatProcessError,
} from './utils.js';

// Configuration Builders
export { buildClaudeConfig } from './builders/claude.js';
export type { ClaudeCodeConfig } from './builders/claude.js';
