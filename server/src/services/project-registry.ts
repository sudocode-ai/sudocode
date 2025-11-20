import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import type { ProjectInfo, ProjectsConfig, ProjectError, Result } from '../types/project.js'
import { Ok, Err } from '../types/project.js'

function getDefaultConfig(): ProjectsConfig {
  return {
    version: 1,
    projects: {},
    recentProjects: [],
    settings: {
      maxRecentProjects: 10,
      autoOpenLastProject: false,
    },
  }
}

/**
 * ProjectRegistry manages the persistent storage of registered projects.
 *
 * Configuration is stored at ~/.config/sudocode/projects.json and includes:
 * - Registered projects with metadata
 * - Recent projects list
 * - User settings
 */
export class ProjectRegistry {
  private configPath: string
  private config: ProjectsConfig

  /**
   * Create a new ProjectRegistry instance
   * @param configPath - Optional custom config file path (defaults to ~/.config/sudocode/projects.json)
   */
  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath()
    this.config = getDefaultConfig()
  }

  /**
   * Get the default config file path following XDG Base Directory specification
   */
  private getDefaultConfigPath(): string {
    const configDir =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config', 'sudocode')
    return path.join(configDir, 'projects.json')
  }

  /**
   * Load configuration from disk. Creates default config if file doesn't exist.
   * @throws {Error} If config file is corrupted or unreadable
   */
  async load(): Promise<Result<void, ProjectError>> {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath)
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }

      // Load existing config or create default
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8')
        try {
          this.config = JSON.parse(data)

          // Validate config structure
          if (!this.config.version || !this.config.projects || !this.config.settings) {
            throw new Error('Invalid config structure')
          }
        } catch (parseError) {
          // Config is corrupted, backup and create fresh
          const backupPath = `${this.configPath}.backup.${Date.now()}`
          fs.copyFileSync(this.configPath, backupPath)
          console.warn(`Corrupted config backed up to: ${backupPath}`)

          this.config = getDefaultConfig()
          await this.save()
        }
      } else {
        // Create default config
        await this.save()
      }

      return Ok(undefined)
    } catch (error: any) {
      if (error.code === 'EACCES') {
        return Err({
          type: 'PERMISSION_DENIED',
          path: this.configPath,
        })
      }
      return Err({
        type: 'UNKNOWN',
        message: error.message,
      })
    }
  }

  /**
   * Save configuration to disk atomically (write to temp file, then rename)
   */
  async save(): Promise<Result<void, ProjectError>> {
    try {
      const tempPath = `${this.configPath}.tmp`
      const data = JSON.stringify(this.config, null, 2)

      // Write to temp file
      fs.writeFileSync(tempPath, data, 'utf-8')

      // Atomic rename
      fs.renameSync(tempPath, this.configPath)

      return Ok(undefined)
    } catch (error: any) {
      if (error.code === 'EACCES') {
        return Err({
          type: 'PERMISSION_DENIED',
          path: this.configPath,
        })
      }
      return Err({
        type: 'UNKNOWN',
        message: error.message,
      })
    }
  }

  /**
   * Generate a deterministic, human-readable project ID from path
   * Format: <repo-name>-<8-char-hash>
   * Example: sudocode-a1b2c3d4
   */
  generateProjectId(projectPath: string): string {
    // Extract repo name from path
    const repoName = path.basename(projectPath)

    // Create URL-safe version of repo name
    const safeName = repoName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') // Remove leading/trailing dashes
      .slice(0, 32)

    // Generate short hash for uniqueness
    const hash = crypto
      .createHash('sha256')
      .update(projectPath)
      .digest('hex')
      .slice(0, 8)

    return `${safeName}-${hash}`
  }

  /**
   * Register a new project or update existing one
   * @param projectPath - Absolute path to project root directory
   * @returns ProjectInfo for the registered project
   */
  registerProject(projectPath: string): ProjectInfo {
    const projectId = this.generateProjectId(projectPath)
    const sudocodeDir = path.join(projectPath, '.sudocode')
    const now = new Date().toISOString()

    // Check if project already exists
    const existing = this.config.projects[projectId]
    if (existing) {
      // Update existing project
      existing.lastOpenedAt = now
      this.addToRecent(projectId)
      return existing
    }

    // Create new project info
    const projectInfo: ProjectInfo = {
      id: projectId,
      name: path.basename(projectPath),
      path: projectPath,
      sudocodeDir,
      registeredAt: now,
      lastOpenedAt: now,
      favorite: false,
    }

    this.config.projects[projectId] = projectInfo
    this.addToRecent(projectId)

    return projectInfo
  }

  /**
   * Unregister a project (remove from registry)
   * @param projectId - Project ID to remove
   * @returns true if project was removed, false if not found
   */
  unregisterProject(projectId: string): boolean {
    if (!this.config.projects[projectId]) {
      return false
    }

    delete this.config.projects[projectId]

    // Remove from recent projects
    this.config.recentProjects = this.config.recentProjects.filter(
      (id) => id !== projectId
    )

    return true
  }

  /**
   * Get project info by ID
   */
  getProject(projectId: string): ProjectInfo | null {
    return this.config.projects[projectId] || null
  }

  /**
   * Get all registered projects
   */
  getAllProjects(): ProjectInfo[] {
    return Object.values(this.config.projects)
  }

  /**
   * Update the lastOpenedAt timestamp for a project
   */
  updateLastOpened(projectId: string): void {
    const project = this.config.projects[projectId]
    if (project) {
      project.lastOpenedAt = new Date().toISOString()
    }
  }

  /**
   * Add a project to the recent projects list
   * Maintains the list at maxRecentProjects size with most recent first
   */
  addToRecent(projectId: string): void {
    // Remove if already in list
    this.config.recentProjects = this.config.recentProjects.filter(
      (id) => id !== projectId
    )

    // Add to front
    this.config.recentProjects.unshift(projectId)

    // Trim to max size
    const maxRecent = this.config.settings.maxRecentProjects
    if (this.config.recentProjects.length > maxRecent) {
      this.config.recentProjects = this.config.recentProjects.slice(0, maxRecent)
    }
  }

  /**
   * Get recent projects (ordered by most recent first)
   */
  getRecentProjects(): ProjectInfo[] {
    return this.config.recentProjects
      .map((id) => this.config.projects[id])
      .filter((p): p is ProjectInfo => p !== undefined)
  }

  /**
   * Toggle favorite status for a project
   */
  toggleFavorite(projectId: string): boolean {
    const project = this.config.projects[projectId]
    if (!project) {
      return false
    }

    project.favorite = !project.favorite
    return true
  }

  /**
   * Get all favorite projects
   */
  getFavoriteProjects(): ProjectInfo[] {
    return Object.values(this.config.projects).filter((p) => p.favorite)
  }

  /**
   * Update user settings
   */
  updateSettings(settings: Partial<ProjectsConfig['settings']>): void {
    this.config.settings = {
      ...this.config.settings,
      ...settings,
    }
  }

  /**
   * Get current settings
   */
  getSettings(): ProjectsConfig['settings'] {
    return { ...this.config.settings }
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath
  }
}
