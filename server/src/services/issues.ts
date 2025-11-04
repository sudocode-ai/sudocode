/**
 * Issues service - wraps CLI operations for API use
 */

import type Database from "better-sqlite3";
import {
  getIssue,
  listIssues,
  createIssue,
  updateIssue,
  deleteIssue,
  type CreateIssueInput,
  type UpdateIssueInput,
  type ListIssuesOptions,
} from "@sudocode-ai/cli/dist/operations/index.js";
import type { Issue } from "@sudocode-ai/types";

/**
 * Get all issues with optional filtering
 */
export function getAllIssues(
  db: Database.Database,
  options?: ListIssuesOptions
): Issue[] {
  return listIssues(db, options || {});
}

/**
 * Get a single issue by ID
 */
export function getIssueById(db: Database.Database, id: string): Issue | null {
  return getIssue(db, id);
}

/**
 * Create a new issue
 */
export function createNewIssue(
  db: Database.Database,
  input: CreateIssueInput
): Issue {
  return createIssue(db, input);
}

/**
 * Update an existing issue
 */
export function updateExistingIssue(
  db: Database.Database,
  id: string,
  input: UpdateIssueInput
): Issue {
  return updateIssue(db, id, input);
}

/**
 * Delete an issue
 */
export function deleteExistingIssue(
  db: Database.Database,
  id: string
): boolean {
  return deleteIssue(db, id);
}
