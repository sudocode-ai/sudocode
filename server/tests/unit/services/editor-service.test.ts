import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import which from 'which'
import { EditorService } from '../../../src/services/editor-service.js'
import { EditorType, EditorOpenError } from '../../../src/types/editor.js'

// Mock fs and which modules
vi.mock('fs/promises')
vi.mock('which')
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn()
  }))
}))

describe('EditorService', () => {
  let service: EditorService
  const mockRepoPath = '/test/repo'

  beforeEach(() => {
    service = new EditorService(mockRepoPath)
    vi.clearAllMocks()
  })

  describe('getCommand', () => {
    it('should return correct command for each editor type', () => {
      expect(service.getCommand(EditorType.VS_CODE)).toBe('code')
      expect(service.getCommand(EditorType.CURSOR)).toBe('cursor')
      expect(service.getCommand(EditorType.WINDSURF)).toBe('windsurf')
      expect(service.getCommand(EditorType.INTELLIJ)).toBe('idea')
      expect(service.getCommand(EditorType.ZED)).toBe('zed')
      expect(service.getCommand(EditorType.XCODE)).toBe('xed')
    })

    it('should use custom command for CUSTOM editor type', () => {
      expect(service.getCommand(EditorType.CUSTOM, 'code-insiders')).toBe('code-insiders')
    })

    it('should fallback to VS Code command if custom command not provided', () => {
      expect(service.getCommand(EditorType.CUSTOM)).toBe('code')
    })
  })

  describe('loadConfig', () => {
    it('should load config from .sudocode/config.local.json', async () => {
      const mockConfig = {
        editor: {
          editorType: 'cursor',
          customCommand: null
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

      const config = await service.loadConfig()

      expect(config.editorType).toBe('cursor')
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('.sudocode/config.local.json'),
        'utf-8'
      )
    })

    it('should return default config if file does not exist', async () => {
      const error: NodeJS.ErrnoException = new Error('File not found')
      error.code = 'ENOENT'
      vi.mocked(fs.readFile).mockRejectedValue(error)

      const config = await service.loadConfig()

      expect(config.editorType).toBe(EditorType.VS_CODE)
    })

    it('should cache config for 5 minutes', async () => {
      const mockConfig = {
        editor: {
          editorType: 'cursor'
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

      // First call
      await service.loadConfig()
      // Second call should use cache
      await service.loadConfig()

      // readFile should only be called once
      expect(fs.readFile).toHaveBeenCalledTimes(1)
    })

    it('should validate editor type and fallback to default if invalid', async () => {
      const mockConfig = {
        editor: {
          editorType: 'invalid-editor'
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

      const config = await service.loadConfig()

      expect(config.editorType).toBe(EditorType.VS_CODE)
    })
  })

  describe('checkAvailability', () => {
    it('should return true if command is available', async () => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/code')

      const available = await service.checkAvailability('code')

      expect(available).toBe(true)
      expect(which).toHaveBeenCalledWith('code')
    })

    it('should return false if command is not available', async () => {
      vi.mocked(which).mockRejectedValue(new Error('not found'))

      const available = await service.checkAvailability('nonexistent')

      expect(available).toBe(false)
    })
  })

  describe('spawnEditor', () => {
    it('should throw EDITOR_NOT_FOUND if command not available', async () => {
      vi.mocked(which).mockRejectedValue(new Error('not found'))

      const config = { editorType: EditorType.VS_CODE }

      await expect(
        service.spawnEditor('/test/worktree', config)
      ).rejects.toThrow(EditorOpenError)

      await expect(
        service.spawnEditor('/test/worktree', config)
      ).rejects.toMatchObject({
        code: 'EDITOR_NOT_FOUND',
        editorType: EditorType.VS_CODE
      })
    })

    it('should throw WORKTREE_MISSING if worktree path does not exist', async () => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/code')

      const error: NodeJS.ErrnoException = new Error('ENOENT')
      error.code = 'ENOENT'
      vi.mocked(fs.access).mockRejectedValue(error)

      const config = { editorType: EditorType.VS_CODE }

      await expect(
        service.spawnEditor('/test/nonexistent', config)
      ).rejects.toThrow(EditorOpenError)

      await expect(
        service.spawnEditor('/test/nonexistent', config)
      ).rejects.toMatchObject({
        code: 'WORKTREE_MISSING',
        editorType: EditorType.VS_CODE,
        message: expect.stringContaining('not found')
      })
    })

    it('should throw WORKTREE_MISSING if worktree path is not a directory', async () => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/code')
      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => false
      } as any)

      const config = { editorType: EditorType.VS_CODE }

      await expect(
        service.spawnEditor('/test/file.txt', config)
      ).rejects.toThrow(EditorOpenError)

      await expect(
        service.spawnEditor('/test/file.txt', config)
      ).rejects.toMatchObject({
        code: 'WORKTREE_MISSING',
        editorType: EditorType.VS_CODE,
        message: expect.stringContaining('not a directory')
      })
    })

    it('should spawn editor with correct arguments', async () => {
      vi.mocked(which).mockResolvedValue('/usr/local/bin/code')
      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true
      } as any)

      const config = { editorType: EditorType.VS_CODE }
      await service.spawnEditor('/test/worktree', config)

      const { spawn } = await import('child_process')
      expect(spawn).toHaveBeenCalledWith(
        'code',
        ['/test/worktree'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
          cwd: '/test/worktree'
        })
      )
    })
  })

  describe('openWorktree', () => {
    it('should use config from file', async () => {
      const mockConfig = {
        editor: {
          editorType: 'cursor'
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))
      vi.mocked(which).mockResolvedValue('/usr/local/bin/cursor')
      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true
      } as any)

      await service.openWorktree('/test/worktree')

      const { spawn } = await import('child_process')
      expect(spawn).toHaveBeenCalledWith(
        'cursor',
        ['/test/worktree'],
        expect.any(Object)
      )
    })

    it('should allow editor type override', async () => {
      const mockConfig = {
        editor: {
          editorType: 'vs-code'
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))
      vi.mocked(which).mockResolvedValue('/usr/local/bin/zed')
      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true
      } as any)

      await service.openWorktree('/test/worktree', EditorType.ZED)

      const { spawn } = await import('child_process')
      expect(spawn).toHaveBeenCalledWith(
        'zed',
        ['/test/worktree'],
        expect.any(Object)
      )
    })
  })

  describe('checkAllAvailability', () => {
    it('should check availability of all editors', async () => {
      // Mock VS Code and Cursor as available
      vi.mocked(which).mockImplementation(async (cmd: string) => {
        if (cmd === 'code' || cmd === 'cursor') {
          return '/usr/local/bin/' + cmd
        }
        throw new Error('not found')
      })

      const availability = await service.checkAllAvailability()

      expect(availability[EditorType.VS_CODE]).toBe(true)
      expect(availability[EditorType.CURSOR]).toBe(true)
      expect(availability[EditorType.WINDSURF]).toBe(false)
      expect(availability[EditorType.CUSTOM]).toBe(false)
    })
  })

  describe('clearCache', () => {
    it('should clear cached config', async () => {
      const mockConfig = {
        editor: {
          editorType: 'cursor'
        }
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

      // Load config (cached)
      await service.loadConfig()

      // Clear cache
      service.clearCache()

      // Load again (should read from file again)
      await service.loadConfig()

      expect(fs.readFile).toHaveBeenCalledTimes(2)
    })
  })
})
