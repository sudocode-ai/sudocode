/**
 * Service layer for Feedback API
 * Wraps CLI operations for managing issue feedback on specs
 */

import type Database from "better-sqlite3";
import type { IssueFeedback } from "@sudocode-ai/types";
import {
  createFeedback,
  getFeedback,
  updateFeedback,
  deleteFeedback,
  listFeedback,
  getFeedbackForSpec,
  getFeedbackForIssue,
  dismissFeedback,
  type CreateFeedbackInput,
  type UpdateFeedbackInput,
  type ListFeedbackOptions,
} from "@sudocode/cli/dist/operations/feedback.js";

/**
 * Create a new feedback entry
 */
export function createNewFeedback(
  db: Database.Database,
  input: CreateFeedbackInput
): IssueFeedback {
  return createFeedback(db, input);
}

/**
 * Get a specific feedback by ID
 */
export function getFeedbackById(
  db: Database.Database,
  id: string
): IssueFeedback | null {
  return getFeedback(db, id);
}

/**
 * Update an existing feedback entry
 */
export function updateExistingFeedback(
  db: Database.Database,
  id: string,
  input: UpdateFeedbackInput
): IssueFeedback {
  return updateFeedback(db, id, input);
}

/**
 * Delete a feedback entry
 */
export function deleteExistingFeedback(
  db: Database.Database,
  id: string
): boolean {
  return deleteFeedback(db, id);
}

/**
 * List feedback entries with optional filters
 */
export function getAllFeedback(
  db: Database.Database,
  options?: ListFeedbackOptions
): IssueFeedback[] {
  return listFeedback(db, options || {});
}

/**
 * Get all feedback for a specific spec
 */
export function getSpecFeedback(
  db: Database.Database,
  spec_id: string
): IssueFeedback[] {
  return getFeedbackForSpec(db, spec_id);
}

/**
 * Get all feedback for a specific issue
 */
export function getIssueFeedback(
  db: Database.Database,
  issue_id: string
): IssueFeedback[] {
  return getFeedbackForIssue(db, issue_id);
}

/**
 * Dismiss a feedback entry
 */
export function dismissExistingFeedback(
  db: Database.Database,
  id: string
): IssueFeedback {
  return dismissFeedback(db, id);
}
