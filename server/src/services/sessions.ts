/**
 * Sessions service - wraps CLI operations for API use
 */

import type Database from "better-sqlite3";
import {
  getSession,
  getSessionBySessionId,
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  type CreateSessionInput,
  type UpdateSessionInput,
  type ListSessionsOptions,
} from "@sudocode-ai/cli/dist/operations/index.js";
import type { Session } from "@sudocode-ai/types";

/**
 * Get all sessions with optional filtering
 */
export function getAllSessions(
  db: Database.Database,
  options?: ListSessionsOptions
): Session[] {
  return listSessions(db, options || {});
}

/**
 * Get a single session by ID
 */
export function getSessionById(db: Database.Database, id: string): Session | null {
  return getSession(db, id);
}

/**
 * Get a single session by Claude session_id
 */
export function getSessionByClaudeSessionId(
  db: Database.Database,
  sessionId: string
): Session | null {
  return getSessionBySessionId(db, sessionId);
}

/**
 * Create a new session
 */
export function createNewSession(
  db: Database.Database,
  input: CreateSessionInput
): Session {
  return createSession(db, input);
}

/**
 * Update an existing session
 */
export function updateExistingSession(
  db: Database.Database,
  id: string,
  input: UpdateSessionInput
): Session {
  return updateSession(db, id, input);
}

/**
 * Delete a session
 */
export function deleteExistingSession(db: Database.Database, id: string): boolean {
  return deleteSession(db, id);
}
