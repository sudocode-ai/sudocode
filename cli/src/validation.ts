/**
 * Validation utilities for sudocode CLI
 */

import type { RelationshipType, IssueStatus, FeedbackType } from "./types.js";

/**
 * Valid relationship type values for runtime validation.
 * This mirrors the RelationshipType union type defined in types.ts.
 *
 * Note: TypeScript types are erased at runtime, so we need this runtime
 * set to validate incoming string values. Keep this in sync with the
 * RelationshipType type definition.
 */
const VALID_RELATIONSHIP_TYPES = new Set<RelationshipType>([
  "blocks",
  "related",
  "discovered-from",
  "implements",
  "references",
  "depends-on",
]);

export function isValidRelationshipType(type: string): type is RelationshipType {
  return VALID_RELATIONSHIP_TYPES.has(type as RelationshipType);
}

export function getValidRelationshipTypes(): string[] {
  return Array.from(VALID_RELATIONSHIP_TYPES);
}

/**
 * Valid issue status values for runtime validation.
 * This mirrors the IssueStatus union type defined in types.ts.
 */
const VALID_ISSUE_STATUSES = new Set<IssueStatus>([
  "open",
  "in_progress",
  "blocked",
  "needs_review",
  "closed",
]);

export function isValidIssueStatus(status: string): status is IssueStatus {
  return VALID_ISSUE_STATUSES.has(status as IssueStatus);
}

export function getValidIssueStatuses(): string[] {
  return Array.from(VALID_ISSUE_STATUSES);
}

/**
 * Valid feedback type values for runtime validation.
 * This mirrors the FeedbackType union type defined in types.ts.
 */
const VALID_FEEDBACK_TYPES = new Set<FeedbackType>([
  "comment",
  "suggestion",
  "request",
]);

export function isValidFeedbackType(type: string): type is FeedbackType {
  return VALID_FEEDBACK_TYPES.has(type as FeedbackType);
}

export function getValidFeedbackTypes(): string[] {
  return Array.from(VALID_FEEDBACK_TYPES);
}
