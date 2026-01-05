/**
 * Type definitions for sudocode MCP server
 *
 * Core entity types are imported from the main sudocode package.
 * This file contains MCP-specific types and some forward-compatible types
 * for fields that may be added to the core package in the future.
 */

// Re-export core types from the main package
export type {
  Spec,
  Issue,
  Relationship,
  EntityType,
  RelationshipType,
  IssueStatus,
  FeedbackAnchor,
  FeedbackType,
  IssueFeedback as Feedback,
} from "@sudocode-ai/types";

// ============================================================================
// MCP-SPECIFIC TYPES
// These types are used by the MCP interface but may not be fully supported
// by the current CLI implementation. They represent forward-compatible
// features that may be added in the future.
// ============================================================================

/**
 * Issue type classification
 * NOTE: Not yet stored in database or supported by CLI filtering
 */
export type IssueType = "bug" | "feature" | "task" | "epic" | "chore";

/**
 * Spec status lifecycle
 * NOTE: Not yet stored in database or supported by CLI filtering
 */
export type SpecStatus = "draft" | "review" | "approved" | "deprecated";

/**
 * Spec type classification
 * NOTE: Not yet stored in database or supported by CLI filtering
 */
export type SpecType =
  | "architecture"
  | "api"
  | "database"
  | "feature"
  | "research";

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

export interface SudocodeClientConfig {
  workingDir?: string;
  cliPath?: string;
  dbPath?: string;
  syncOnStartup?: boolean;
}

/**
 * Configuration for the MCP server including scope settings.
 */
export interface SudocodeMCPServerConfig extends SudocodeClientConfig {
  /** Comma-separated scope string (default: "default") */
  scope?: string;
  /** Server URL for extended tools */
  serverUrl?: string;
  /** Project ID for API calls (auto-discovered if not provided) */
  projectId?: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class SudocodeError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "SudocodeError";
  }
}
