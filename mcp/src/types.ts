/**
 * Type definitions for sudocode MCP server
 */

// sudocode entity types
export type SpecStatus = "draft" | "review" | "approved" | "deprecated";
export type SpecType =
  | "architecture"
  | "api"
  | "database"
  | "feature"
  | "research";

export type IssueStatus = "open" | "in_progress" | "blocked" | "closed";
export type IssueType = "bug" | "feature" | "task" | "epic" | "chore";

export type RelationshipType =
  | "blocks"
  | "implements"
  | "references"
  | "depends-on"
  | "parent-child"
  | "discovered-from"
  | "related";

export type FeedbackType =
  | "ambiguity"
  | "missing_requirement"
  | "technical_constraint"
  | "suggestion"
  | "question";

export type FeedbackStatus = "open" | "acknowledged" | "resolved" | "wont_fix";

// Entity interfaces
export interface Spec {
  id: string;
  title: string;
  file_path: string;
  content: string;
  type: SpecType;
  status: SpecStatus;
  priority: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  parent_id: string | null;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  content: string;
  status: IssueStatus;
  priority: number;
  issue_type: IssueType;
  assignee: string | null;
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  created_by: string;
  parent_id: string | null;
}

export interface Relationship {
  from_id: string;
  from_type: "spec" | "issue";
  to_id: string;
  to_type: "spec" | "issue";
  relationship_type: RelationshipType;
  created_at: string;
  created_by: string;
}

export interface Feedback {
  id: string;
  issue_id: string;
  spec_id: string;
  feedback_type: FeedbackType;
  content: string;
  agent: string;
  anchor: FeedbackAnchor;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
  resolution: string | null;
}

export interface FeedbackAnchor {
  section_heading?: string;
  section_level?: number;
  line_number?: number;
  line_offset?: number;
  text_snippet?: string;
  context_before?: string;
  context_after?: string;
  content_hash?: string;
  anchor_status: "valid" | "relocated" | "stale";
  last_verified_at?: string;
  original_location?: {
    line_number: number;
    section_heading?: string;
  };
}

// Client configuration
export interface SudocodeClientConfig {
  workingDir?: string;
  cliPath?: string;
  dbPath?: string;
}

// Custom error type
export class SudocodeError extends Error {
  constructor(message: string, public exitCode: number, public stderr: string) {
    super(message);
    this.name = "SudocodeError";
  }
}
