/**
 * Workflow System Module
 *
 * Provides multi-issue orchestration capabilities for sudocode.
 */

// Dependency analysis
export {
  analyzeDependencies,
  buildDependencyGraph,
  topologicalSort,
  findParallelGroups,
} from "./dependency-analyzer.js";
