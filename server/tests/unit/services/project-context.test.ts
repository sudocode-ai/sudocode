import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProjectContext } from '../../../src/services/project-context.js'
import type Database from 'better-sqlite3'
import type { TransportManager } from '../../../src/execution/transport/transport-manager.js'
import type { ExecutionService } from '../../../src/services/execution-service.js'
import type { ExecutionLogsStore } from '../../../src/services/execution-logs-store.js'
import type { WorktreeManager } from '../../../src/execution/worktree/manager.js'
import type { ServerWatcherControl } from '../../../src/services/watcher.js'

describe('ProjectContext', () => {
  let mockDb: Database.Database
  let mockTransportManager: TransportManager
  let mockExecutionService: ExecutionService
  let mockLogsStore: ExecutionLogsStore
  let mockWorktreeManager: WorktreeManager

  beforeEach(() => {
    // Create mock objects
    mockDb = {
      close: vi.fn(),
    } as any

    mockTransportManager = {
      shutdown: vi.fn(),
    } as any

    mockExecutionService = {
      shutdown: vi.fn(),
      hasActiveExecutions: vi.fn(() => false),
    } as any

    mockLogsStore = {} as any
    mockWorktreeManager = {} as any
  })

  describe('initialization', () => {
    it('should create a ProjectContext with all required properties', () => {
      const context = new ProjectContext(
        'test-project-12345678',
        '/path/to/project',
        '/path/to/project/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      expect(context.id).toBe('test-project-12345678')
      expect(context.path).toBe('/path/to/project')
      expect(context.sudocodeDir).toBe('/path/to/project/.sudocode')
      expect(context.db).toBe(mockDb)
      expect(context.transportManager).toBe(mockTransportManager)
      expect(context.executionService).toBe(mockExecutionService)
      expect(context.logsStore).toBe(mockLogsStore)
      expect(context.worktreeManager).toBe(mockWorktreeManager)
      expect(context.watcher).toBeNull()
      expect(context.openedAt).toBeInstanceOf(Date)
    })

    it('should set openedAt to current time', () => {
      const before = new Date()
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )
      const after = new Date()

      expect(context.openedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(context.openedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should initialize successfully', async () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      await expect(context.initialize()).resolves.toBeUndefined()
    })
  })

  describe('watcher management', () => {
    it('should allow setting a file watcher', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      const mockWatcher: ServerWatcherControl = {
        stop: vi.fn(),
      } as any

      context.watcher = mockWatcher
      expect(context.watcher).toBe(mockWatcher)
    })
  })

  describe('shutdown', () => {
    it('should shutdown all services in correct order', async () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      const mockWatcher: ServerWatcherControl = {
        stop: vi.fn(),
      } as any
      context.watcher = mockWatcher

      await context.shutdown()

      // Should shutdown execution service first
      expect(mockExecutionService.shutdown).toHaveBeenCalledOnce()

      // Should stop file watcher
      expect(mockWatcher.stop).toHaveBeenCalledOnce()
      expect(context.watcher).toBeNull()

      // Should close transport streams
      expect(mockTransportManager.shutdown).toHaveBeenCalledOnce()
    })

    it('should shutdown without watcher if not set', async () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      await expect(context.shutdown()).resolves.toBeUndefined()

      expect(mockExecutionService.shutdown).toHaveBeenCalledOnce()
      expect(mockTransportManager.shutdown).toHaveBeenCalledOnce()
    })

    it('should propagate errors from shutdown', async () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      const shutdownError = new Error('Shutdown failed')
      vi.mocked(mockExecutionService.shutdown).mockRejectedValueOnce(shutdownError)

      await expect(context.shutdown()).rejects.toThrow('Shutdown failed')
    })
  })

  describe('getSummary', () => {
    it('should return summary with all context information', () => {
      const context = new ProjectContext(
        'test-project-12345678',
        '/path/to/project',
        '/path/to/project/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      const summary = context.getSummary()

      expect(summary).toEqual({
        id: 'test-project-12345678',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        openedAt: context.openedAt,
        hasWatcher: false,
        hasActiveExecutions: false,
      })
    })

    it('should indicate when watcher is present', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      const mockWatcher: ServerWatcherControl = {
        stop: vi.fn(),
      } as any
      context.watcher = mockWatcher

      const summary = context.getSummary()
      expect(summary.hasWatcher).toBe(true)
    })
  })

  describe('hasActiveExecutions', () => {
    it('should return false by default', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      expect(context.hasActiveExecutions()).toBe(false)
    })
  })

  describe('updateServerUrl', () => {
    it('should call setServerUrl on orchestratorWorkflowEngine if it has the method', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      // Mock orchestrator engine with setServerUrl method
      const mockSetServerUrl = vi.fn()
      context.orchestratorWorkflowEngine = {
        setServerUrl: mockSetServerUrl,
      } as any

      context.updateServerUrl('http://localhost:3005')

      expect(mockSetServerUrl).toHaveBeenCalledWith('http://localhost:3005')
    })

    it('should not throw if orchestratorWorkflowEngine is undefined', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      // orchestratorWorkflowEngine is undefined by default
      expect(context.orchestratorWorkflowEngine).toBeUndefined()

      // Should not throw
      expect(() => context.updateServerUrl('http://localhost:3005')).not.toThrow()
    })

    it('should not throw if orchestratorWorkflowEngine does not have setServerUrl', () => {
      const context = new ProjectContext(
        'test-12345678',
        '/path',
        '/path/.sudocode',
        mockDb,
        mockTransportManager,
        mockExecutionService,
        mockLogsStore,
        mockWorktreeManager
      )

      // Mock engine without setServerUrl method
      context.orchestratorWorkflowEngine = {
        createWorkflow: vi.fn(),
        startWorkflow: vi.fn(),
      } as any

      // Should not throw
      expect(() => context.updateServerUrl('http://localhost:3005')).not.toThrow()
    })
  })
})
