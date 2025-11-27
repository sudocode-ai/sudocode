/**
 * File search service exports
 *
 * Provides file search capabilities with pluggable strategies.
 */

// Strategy interface and types
export type {
  FileSearchStrategy,
  FileSearchOptions,
  FileSearchResult,
} from "./strategy.js"

// Registry for managing strategies
export {
  FileSearchStrategyRegistry,
  fileSearchRegistry,
  type StrategyType,
} from "./registry.js"

// Strategies
export { GitLsFilesStrategy } from "./git-ls-files-strategy.js"
