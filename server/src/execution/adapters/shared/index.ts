/**
 * Shared adapter utilities
 *
 * @module execution/adapters/shared
 */

export { AgentConfigUtils } from './config-utils.js';
export {
  applyCursorPreset,
  applyCopilotPreset,
  applyCodexPreset,
  applyClaudeCodePreset,
  getRecommendedTimeouts,
  getRecommendedRetry,
  type ConfigProfile,
} from './config-presets.js';
