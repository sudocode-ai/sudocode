/**
 * Project-related types for multi-project frontend support
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

export interface OpenProjectInfo extends ProjectInfo {
  /** Summary information about the open project */
  openedAt: string
  activeExecutions: number
}

export interface ValidateProjectRequest {
  path: string
}

export interface ValidateProjectResponse {
  valid: boolean
  error?: string
}

export interface OpenProjectRequest {
  path: string
}

export interface InitProjectRequest {
  path: string
  name?: string
}
