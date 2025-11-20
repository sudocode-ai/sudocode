import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ProjectRegistry } from '../../../src/services/project-registry.js'
import type { ProjectsConfig } from '../../../src/types/project.js'

describe('ProjectRegistry', () => {
  let tempDir: string
  let configPath: string
  let registry: ProjectRegistry

  beforeEach(() => {
    // Create a unique temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `sudocode-test-`))
    configPath = path.join(tempDir, 'projects.json')
    registry = new ProjectRegistry(configPath)
  })

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('initialization', () => {
    it('should create config directory if it does not exist', async () => {
      const result = await registry.load()
      expect(result.ok).toBe(true)
      expect(fs.existsSync(path.dirname(configPath))).toBe(true)
    })

    it('should create default config file on first load', async () => {
      const result = await registry.load()
      expect(result.ok).toBe(true)
      expect(fs.existsSync(configPath)).toBe(true)

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectsConfig
      expect(config.version).toBe(1)
      expect(config.projects).toEqual({})
      expect(config.recentProjects).toEqual([])
      expect(config.settings.maxRecentProjects).toBe(10)
    })

    it('should load existing config file', async () => {
      // Create a config file
      const existingConfig: ProjectsConfig = {
        version: 1,
        projects: {
          'test-12345678': {
            id: 'test-12345678',
            name: 'test',
            path: '/path/to/test',
            sudocodeDir: '/path/to/test/.sudocode',
            registeredAt: '2025-01-01T00:00:00.000Z',
            lastOpenedAt: '2025-01-01T00:00:00.000Z',
            favorite: false,
          },
        },
        recentProjects: ['test-12345678'],
        settings: {
          maxRecentProjects: 10,
          autoOpenLastProject: false,
        },
      }
      fs.writeFileSync(configPath, JSON.stringify(existingConfig))

      const result = await registry.load()
      expect(result.ok).toBe(true)

      const project = registry.getProject('test-12345678')
      expect(project).not.toBeNull()
      expect(project?.name).toBe('test')
    })

    it('should handle corrupted config file gracefully', async () => {
      // Write invalid JSON
      fs.writeFileSync(configPath, 'invalid json{{{')

      const result = await registry.load()
      expect(result.ok).toBe(true)

      // Should create backup
      const backupFiles = fs.readdirSync(tempDir).filter((f) => f.includes('backup'))
      expect(backupFiles.length).toBe(1)

      // Should have fresh config
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectsConfig
      expect(config.projects).toEqual({})
    })
  })

  describe('generateProjectId', () => {
    it('should generate deterministic project IDs', () => {
      const path1 = '/Users/alex/repos/sudocode'
      const id1 = registry.generateProjectId(path1)
      const id2 = registry.generateProjectId(path1)

      expect(id1).toBe(id2)
    })

    it('should generate unique IDs for different paths', () => {
      const path1 = '/Users/alex/repos/sudocode'
      const path2 = '/Users/alex/repos/other-repo'

      const id1 = registry.generateProjectId(path1)
      const id2 = registry.generateProjectId(path2)

      expect(id1).not.toBe(id2)
    })

    it('should generate URL-safe IDs', () => {
      const pathWithSpaces = '/Users/alex/My Projects/Some App'
      const id = registry.generateProjectId(pathWithSpaces)

      // Should not contain spaces or special characters except dash
      expect(id).toMatch(/^[a-z0-9-]+$/)
    })

    it('should include repo name in ID', () => {
      const projectPath = '/Users/alex/repos/my-awesome-project'
      const id = registry.generateProjectId(projectPath)

      expect(id).toContain('my-awesome-project')
    })

    it('should append hash to prevent collisions', () => {
      const projectPath = '/Users/alex/repos/sudocode'
      const id = registry.generateProjectId(projectPath)

      // Format should be: <name>-<8-char-hash>
      const parts = id.split('-')
      const hash = parts[parts.length - 1]
      expect(hash).toHaveLength(8)
      expect(hash).toMatch(/^[a-f0-9]{8}$/)
    })
  })

  describe('registerProject', () => {
    it('should register a new project', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      const projectInfo = registry.registerProject(projectPath)

      expect(projectInfo.id).toBeTruthy()
      expect(projectInfo.name).toBe('test-project')
      expect(projectInfo.path).toBe(projectPath)
      expect(projectInfo.sudocodeDir).toBe(path.join(projectPath, '.sudocode'))
      expect(projectInfo.registeredAt).toBeTruthy()
      expect(projectInfo.favorite).toBe(false)
    })

    it('should update lastOpenedAt for existing project', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      const project1 = registry.registerProject(projectPath)
      const timestamp1 = project1.lastOpenedAt

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 100))

      const project2 = registry.registerProject(projectPath)

      expect(project1.id).toBe(project2.id)
      expect(project2.lastOpenedAt).not.toBe(timestamp1)
      expect(new Date(project2.lastOpenedAt).getTime()).toBeGreaterThan(
        new Date(timestamp1).getTime()
      )
    })

    it('should add project to recent list on registration', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      registry.registerProject(projectPath)

      const recent = registry.getRecentProjects()
      expect(recent).toHaveLength(1)
      expect(recent[0].path).toBe(projectPath)
    })
  })

  describe('unregisterProject', () => {
    it('should remove project from registry', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      const project = registry.registerProject(projectPath)

      const removed = registry.unregisterProject(project.id)
      expect(removed).toBe(true)

      const retrieved = registry.getProject(project.id)
      expect(retrieved).toBeNull()
    })

    it('should remove project from recent list', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      const project = registry.registerProject(projectPath)

      registry.unregisterProject(project.id)

      const recent = registry.getRecentProjects()
      expect(recent).toHaveLength(0)
    })

    it('should return false for non-existent project', async () => {
      await registry.load()

      const removed = registry.unregisterProject('non-existent-id')
      expect(removed).toBe(false)
    })
  })

  describe('getProject and getAllProjects', () => {
    it('should retrieve project by ID', async () => {
      await registry.load()

      const projectPath = '/Users/alex/repos/test-project'
      const registered = registry.registerProject(projectPath)

      const retrieved = registry.getProject(registered.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(registered.id)
      expect(retrieved?.path).toBe(projectPath)
    })

    it('should return null for non-existent project', async () => {
      await registry.load()

      const retrieved = registry.getProject('non-existent-id')
      expect(retrieved).toBeNull()
    })

    it('should return all registered projects', async () => {
      // Create a fresh registry for this test to avoid retry issues
      const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-getall-'))
      const testConfigPath = path.join(testTempDir, 'projects.json')
      const testRegistry = new ProjectRegistry(testConfigPath)

      try {
        await testRegistry.load()

        testRegistry.registerProject('/Users/alex/repos/getall-project1')
        testRegistry.registerProject('/Users/alex/repos/getall-project2')
        testRegistry.registerProject('/Users/alex/repos/getall-project3')

        const all = testRegistry.getAllProjects()
        expect(all).toHaveLength(3)
      } finally {
        // Clean up
        if (fs.existsSync(testTempDir)) {
          fs.rmSync(testTempDir, { recursive: true, force: true })
        }
      }
    })
  })

  describe('recent projects', () => {
    it('should maintain recent projects list', async () => {
      await registry.load()

      const project1 = registry.registerProject('/Users/alex/repos/project1')
      const project2 = registry.registerProject('/Users/alex/repos/project2')
      const project3 = registry.registerProject('/Users/alex/repos/project3')

      const recent = registry.getRecentProjects()
      expect(recent).toHaveLength(3)

      // Most recent should be first
      expect(recent[0].id).toBe(project3.id)
      expect(recent[1].id).toBe(project2.id)
      expect(recent[2].id).toBe(project1.id)
    })

    it('should move project to front when re-added to recent', async () => {
      await registry.load()

      const project1 = registry.registerProject('/Users/alex/repos/project1')
      const project2 = registry.registerProject('/Users/alex/repos/project2')

      // Add project1 again
      registry.addToRecent(project1.id)

      const recent = registry.getRecentProjects()
      expect(recent[0].id).toBe(project1.id)
      expect(recent[1].id).toBe(project2.id)
    })

    it('should limit recent projects to maxRecentProjects', async () => {
      await registry.load()
      registry.updateSettings({ maxRecentProjects: 3 })

      // Register 5 projects
      for (let i = 1; i <= 5; i++) {
        registry.registerProject(`/Users/alex/repos/project${i}`)
      }

      const recent = registry.getRecentProjects()
      expect(recent).toHaveLength(3)
    })

    it('should filter out deleted projects from recent list', async () => {
      await registry.load()

      const project1 = registry.registerProject('/Users/alex/repos/project1')
      registry.registerProject('/Users/alex/repos/project2')

      // Delete project1
      registry.unregisterProject(project1.id)

      const recent = registry.getRecentProjects()
      expect(recent).toHaveLength(1)
      expect(recent[0].id).not.toBe(project1.id)
    })
  })

  describe('favorites', () => {
    it('should toggle favorite status', async () => {
      await registry.load()

      const project = registry.registerProject('/Users/alex/repos/test-project')
      expect(project.favorite).toBe(false)

      registry.toggleFavorite(project.id)
      const updated = registry.getProject(project.id)
      expect(updated?.favorite).toBe(true)

      registry.toggleFavorite(project.id)
      const toggled = registry.getProject(project.id)
      expect(toggled?.favorite).toBe(false)
    })

    it('should return false when toggling non-existent project', async () => {
      await registry.load()

      const result = registry.toggleFavorite('non-existent-id')
      expect(result).toBe(false)
    })

    it('should get all favorite projects', async () => {
      await registry.load()

      const project1 = registry.registerProject('/Users/alex/repos/project1')
      const project2 = registry.registerProject('/Users/alex/repos/project2')
      registry.registerProject('/Users/alex/repos/project3')

      registry.toggleFavorite(project1.id)
      registry.toggleFavorite(project2.id)

      const favorites = registry.getFavoriteProjects()
      expect(favorites).toHaveLength(2)
      expect(favorites.some((p) => p.id === project1.id)).toBe(true)
      expect(favorites.some((p) => p.id === project2.id)).toBe(true)
    })
  })

  describe('persistence', () => {
    it('should persist changes to disk', async () => {
      // Create a fresh registry for this test to avoid retry issues
      const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-persist-'))
      const testConfigPath = path.join(testTempDir, 'projects.json')
      const testRegistry = new ProjectRegistry(testConfigPath)

      try {
        await testRegistry.load()

        const projectPath = '/Users/alex/repos/test-project-persist'
        testRegistry.registerProject(projectPath)

        const saveResult = await testRegistry.save()
        expect(saveResult.ok).toBe(true)

        // Create new registry instance and load
        const registry2 = new ProjectRegistry(testConfigPath)
        await registry2.load()

        const all = registry2.getAllProjects()
        expect(all).toHaveLength(1)
        expect(all[0].path).toBe(projectPath)
      } finally {
        // Clean up
        if (fs.existsSync(testTempDir)) {
          fs.rmSync(testTempDir, { recursive: true, force: true })
        }
      }
    })

    it('should save atomically (write to temp, then rename)', async () => {
      await registry.load()

      registry.registerProject('/Users/alex/repos/test-project')
      const saveResult = await registry.save()

      expect(saveResult.ok).toBe(true)

      // Temp file should not exist after save
      const tempPath = `${configPath}.tmp`
      expect(fs.existsSync(tempPath)).toBe(false)

      // Config file should exist
      expect(fs.existsSync(configPath)).toBe(true)
    })

    it('should preserve all data across save/load cycle', async () => {
      await registry.load()

      const project = registry.registerProject('/Users/alex/repos/test-project')
      registry.toggleFavorite(project.id)
      registry.updateSettings({ maxRecentProjects: 5 })

      await registry.save()

      // Load in new instance
      const registry2 = new ProjectRegistry(configPath)
      await registry2.load()

      const loaded = registry2.getProject(project.id)
      expect(loaded?.favorite).toBe(true)

      const settings = registry2.getSettings()
      expect(settings.maxRecentProjects).toBe(5)
    })
  })

  describe('settings', () => {
    it('should update settings', async () => {
      await registry.load()

      registry.updateSettings({
        maxRecentProjects: 20,
        autoOpenLastProject: true,
      })

      const settings = registry.getSettings()
      expect(settings.maxRecentProjects).toBe(20)
      expect(settings.autoOpenLastProject).toBe(true)
    })

    it('should support partial settings updates', async () => {
      await registry.load()

      registry.updateSettings({ maxRecentProjects: 15 })

      const settings = registry.getSettings()
      expect(settings.maxRecentProjects).toBe(15)
      expect(settings.autoOpenLastProject).toBe(false) // Should keep default
    })
  })

  describe('updateLastOpened', () => {
    it('should update lastOpenedAt timestamp', async () => {
      await registry.load()

      const project = registry.registerProject('/Users/alex/repos/test-project')
      const originalTimestamp = project.lastOpenedAt

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10))

      registry.updateLastOpened(project.id)
      const updated = registry.getProject(project.id)

      expect(updated?.lastOpenedAt).not.toBe(originalTimestamp)
    })

    it('should do nothing for non-existent project', async () => {
      await registry.load()

      // Should not throw
      registry.updateLastOpened('non-existent-id')
    })
  })
})
