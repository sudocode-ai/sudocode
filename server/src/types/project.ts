/**
 * Project-related types for multi-project server support
 */

export interface ProjectInfo {
  /** Unique project identifier (deterministic hash-based) */
  id: string
  /** Human-readable project name (derived from repository name) */
  name: string
  /** Absolute path to the project root directory */
  path: string
  /** Absolute path to the .sudocode directory */
  sudocodeDir: string
  /** ISO timestamp when project was first registered */
  registeredAt: string
  /** ISO timestamp when project was last opened */
  lastOpenedAt: string
  /** Whether this project is marked as favorite */
  favorite: boolean
}

export interface ProjectsConfig {
  /** Config schema version for future migrations */
  version: number
  /** Map of project ID to project info */
  projects: Record<string, ProjectInfo>
  /** Ordered list of recently opened project IDs (most recent first) */
  recentProjects: string[]
  /** User settings for project management */
  settings: {
    /** Maximum number of projects to keep in recent list */
    maxRecentProjects: number
    /** Whether to automatically open the last opened project on server start */
    autoOpenLastProject: boolean
  }
}

export type ProjectError =
  | { type: 'PATH_NOT_FOUND'; path: string }
  | { type: 'INVALID_PROJECT'; message: string }
  | { type: 'PERMISSION_DENIED'; path: string }
  | { type: 'CONFIG_CORRUPTED'; message: string }
  | { type: 'UNKNOWN'; message: string }

export interface Result<T, E> {
  ok: boolean
  value?: T
  error?: E
}

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
