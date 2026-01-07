import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeVizOverlays } from '@/hooks/useCodeVizOverlays'
import type { ActiveExecution } from '@/hooks/useActiveExecutions'
import type { FileEntityMap } from '@/hooks/useFileEntityMap'

// Store highlights for getByType mock
let mockHighlights: Array<{ id: string; metadata?: { fileHighlight?: boolean } }> = []

// Mock codeviz/browser
const mockPort = {
  bind: vi.fn().mockReturnValue('overlay-id'),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  getOverlays: vi.fn().mockReturnValue([]),
  getOverlayById: vi.fn(),
  getByType: vi.fn().mockImplementation(() => mockHighlights),
  has: vi.fn(),
  subscribe: vi.fn().mockReturnValue(() => {}),
  onOverlayClick: undefined as ((id: string) => void) | undefined,
  onOverlayHover: undefined as ((id: string, isHovering: boolean) => void) | undefined,
}

vi.mock('codeviz/browser', () => ({
  useOverlayPort: vi.fn(({ onOverlayClick }) => {
    mockPort.onOverlayClick = onOverlayClick
    return {
      port: mockPort,
      overlays: [],
      clearAll: vi.fn(),
      getOverlay: vi.fn(),
      hasOverlay: vi.fn(),
      count: 0,
    }
  }),
  generateFileId: vi.fn((path: string) => `file-${path}`),
}))

// Mock colors utility
vi.mock('@/utils/colors', () => ({
  getAgentColor: vi.fn((id: string) => `#color-${id}`),
}))

// Sample active executions for testing
const mockExecutions: ActiveExecution[] = [
  {
    id: 'exec-001',
    issueId: 'i-abc1',
    agentType: 'claude-code',
    status: 'running',
    worktreePath: '/path/to/worktree',
    changedFiles: ['src/index.ts', 'src/utils.ts'],
    startedAt: '2024-01-01T10:00:00Z',
    prompt: 'Implement feature X with comprehensive error handling and tests',
  },
  {
    id: 'exec-002',
    issueId: 'i-xyz2',
    agentType: 'codex',
    status: 'pending',
    worktreePath: null,
    changedFiles: [],
    startedAt: '2024-01-01T11:00:00Z',
    prompt: 'Fix bug Y',
  },
]

describe('useCodeVizOverlays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHighlights = []
  })

  describe('Initialization', () => {
    it('should return overlay port and helper functions', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      expect(result.current.overlayPort).toBe(mockPort)
      expect(result.current.overlayCount).toBe(0)
      expect(typeof result.current.clearAgentOverlays).toBe('function')
      expect(typeof result.current.highlightFile).toBe('function')
      expect(typeof result.current.removeHighlight).toBe('function')
    })
  })

  describe('Agent overlays', () => {
    it('should create agent overlays for each execution', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: mockExecutions,
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      // Should clear existing agent overlays first
      expect(mockPort.clear).toHaveBeenCalledWith({ type: 'agent' })

      // Should create overlay for each execution
      expect(mockPort.bind).toHaveBeenCalledTimes(2)
    })

    it('should position overlay at primary file when available', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: [mockExecutions[0]], // Has changed files
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent',
          position: expect.objectContaining({
            type: 'node',
            nodeId: 'file-src/index.ts', // First changed file
            anchor: 'top-right',
          }),
        })
      )
    })

    it('should use absolute position when no files available', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: [mockExecutions[1]], // No changed files
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent',
          position: expect.objectContaining({
            type: 'absolute',
          }),
        })
      )
    })

    it('should map execution status to agent status correctly', () => {
      const statusMappings: Array<{
        execStatus: ActiveExecution['status']
        expectedAgentStatus: string
      }> = [
        { execStatus: 'preparing', expectedAgentStatus: 'thinking' },
        { execStatus: 'pending', expectedAgentStatus: 'thinking' },
        { execStatus: 'running', expectedAgentStatus: 'working' },
        { execStatus: 'paused', expectedAgentStatus: 'waiting' },
        { execStatus: 'failed', expectedAgentStatus: 'error' },
        { execStatus: 'completed', expectedAgentStatus: 'idle' },
      ]

      for (const { execStatus, expectedAgentStatus } of statusMappings) {
        vi.clearAllMocks()

        renderHook(() =>
          useCodeVizOverlays({
            executions: [{ ...mockExecutions[0], status: execStatus }],
            selectedAgentId: null,
            onAgentClick: vi.fn(),
          })
        )

        expect(mockPort.bind).toHaveBeenCalledWith(
          expect.objectContaining({
            status: expectedAgentStatus,
          })
        )
      }
    })

    it('should format agent names correctly', () => {
      const agentTypes = [
        { type: 'claude-code', expected: 'Claude Code' },
        { type: 'codex', expected: 'Codex' },
        { type: 'copilot', expected: 'Copilot' },
        { type: 'cursor', expected: 'Cursor' },
        { type: 'unknown', expected: 'unknown' },
      ]

      for (const { type, expected } of agentTypes) {
        vi.clearAllMocks()

        renderHook(() =>
          useCodeVizOverlays({
            executions: [{ ...mockExecutions[0], agentType: type }],
            selectedAgentId: null,
            onAgentClick: vi.fn(),
          })
        )

        expect(mockPort.bind).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expected,
          })
        )
      }
    })

    it('should set expanded state based on selectedAgentId', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: mockExecutions,
          selectedAgentId: 'exec-001',
          onAgentClick: vi.fn(),
        })
      )

      // First execution should be expanded
      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'exec-001',
          expanded: true,
        })
      )

      // Second execution should not be expanded
      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'exec-002',
          expanded: false,
        })
      )
    })

    it('should truncate long prompts in activity', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: [mockExecutions[0]], // Has long prompt
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          // Prompt is truncated to 50 chars + '...'
          activity: expect.stringMatching(/^.{50,53}$/),
        })
      )
    })

    it('should include target nodes for files being modified', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: [mockExecutions[0]],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          targetNodes: ['file-src/index.ts', 'file-src/utils.ts'],
        })
      )
    })
  })

  describe('Click handling', () => {
    it('should call onAgentClick when overlay is clicked', () => {
      const onAgentClick = vi.fn()

      renderHook(() =>
        useCodeVizOverlays({
          executions: mockExecutions,
          selectedAgentId: null,
          onAgentClick,
        })
      )

      // Simulate overlay click through the port's onOverlayClick handler
      act(() => {
        mockPort.onOverlayClick?.('agent-exec-001')
      })

      expect(onAgentClick).toHaveBeenCalledWith('exec-001')
    })

    it('should not call onAgentClick for non-agent overlays', () => {
      const onAgentClick = vi.fn()

      renderHook(() =>
        useCodeVizOverlays({
          executions: mockExecutions,
          selectedAgentId: null,
          onAgentClick,
        })
      )

      act(() => {
        mockPort.onOverlayClick?.('highlight-123')
      })

      expect(onAgentClick).not.toHaveBeenCalled()
    })
  })

  describe('Helper functions', () => {
    it('should clear agent overlays', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: mockExecutions,
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      vi.clearAllMocks()

      act(() => {
        result.current.clearAgentOverlays()
      })

      expect(mockPort.clear).toHaveBeenCalledWith({ type: 'agent' })
    })

    it('should highlight a file', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      vi.clearAllMocks()

      act(() => {
        result.current.highlightFile('src/index.ts', '#ff0000')
      })

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'highlight',
          targetType: 'node',
          targetId: 'file-src/index.ts',
          style: expect.objectContaining({
            color: '#ff0000',
          }),
        })
      )
    })

    it('should use default color for highlight', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      vi.clearAllMocks()

      act(() => {
        result.current.highlightFile('src/index.ts')
      })

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          style: expect.objectContaining({
            color: '#3b82f6', // Default blue
          }),
        })
      )
    })

    it('should remove a highlight', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      act(() => {
        result.current.removeHighlight('highlight-123')
      })

      expect(mockPort.remove).toHaveBeenCalledWith('highlight-123')
    })
  })

  describe('Re-rendering', () => {
    it('should update overlays when executions change', () => {
      const { rerender } = renderHook(
        ({ executions }) =>
          useCodeVizOverlays({
            executions,
            selectedAgentId: null,
            onAgentClick: vi.fn(),
          }),
        { initialProps: { executions: [mockExecutions[0]] } }
      )

      vi.clearAllMocks()

      // Add second execution
      rerender({ executions: mockExecutions })

      // Should clear and recreate overlays
      expect(mockPort.clear).toHaveBeenCalledWith({ type: 'agent' })
      expect(mockPort.bind).toHaveBeenCalledTimes(2)
    })

    it('should update overlays when selectedAgentId changes', () => {
      const { rerender } = renderHook(
        ({ selectedAgentId }) =>
          useCodeVizOverlays({
            executions: mockExecutions,
            selectedAgentId,
            onAgentClick: vi.fn(),
          }),
        { initialProps: { selectedAgentId: null as string | null } }
      )

      vi.clearAllMocks()

      // Select first agent
      rerender({ selectedAgentId: 'exec-001' })

      // Should recreate overlays with new expanded state
      expect(mockPort.clear).toHaveBeenCalled()
      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'exec-001',
          expanded: true,
        })
      )
    })
  })

  describe('File highlighting', () => {
    const mockFileEntityMap: FileEntityMap = {
      'src/index.ts': {
        executions: ['exec-001'],
        issues: ['i-abc1'],
        specs: ['s-spec1'],
        changes: {
          'exec-001': { additions: 10, deletions: 5, status: 'M' },
        },
      },
      'src/utils.ts': {
        executions: ['exec-001', 'exec-002'], // Multi-agent file
        issues: ['i-abc1', 'i-xyz2'],
        specs: [],
        changes: {
          'exec-001': { additions: 20, deletions: 0, status: 'A' },
          'exec-002': { additions: 5, deletions: 2, status: 'M' },
        },
      },
    }

    it('should create highlights for files in fileEntityMap', () => {
      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMap,
          showFileHighlights: true,
        })
      )

      // Should create highlights for both files
      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'highlight',
          targetId: 'file-src/index.ts',
        })
      )
    })

    it('should create single highlight for single-agent file', () => {
      const singleAgentMap: FileEntityMap = {
        'src/single.ts': {
          executions: ['exec-001'],
          issues: [],
          specs: [],
          changes: { 'exec-001': { additions: 10, deletions: 0, status: 'A' } },
        },
      }

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: singleAgentMap,
          showFileHighlights: true,
        })
      )

      expect(mockPort.bind).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'highlight',
          style: expect.objectContaining({
            color: '#color-exec-001',
            glow: true,
          }),
          metadata: expect.objectContaining({
            fileHighlight: true,
            isMultiAgent: false,
          }),
        })
      )
    })

    it('should create layered highlights for multi-agent file', () => {
      const multiAgentMap: FileEntityMap = {
        'src/shared.ts': {
          executions: ['exec-001', 'exec-002'],
          issues: [],
          specs: [],
          changes: {},
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: multiAgentMap,
          showFileHighlights: true,
        })
      )

      // Should create 2 highlights (one per agent)
      const highlightCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'highlight'
      )
      expect(highlightCalls).toHaveLength(2)

      // First agent should have glow, second should not
      expect(highlightCalls[0][0].style.glow).toBe(true)
      expect(highlightCalls[1][0].style.glow).toBe(false)

      // Both should be marked as multi-agent
      expect(highlightCalls[0][0].metadata.isMultiAgent).toBe(true)
      expect(highlightCalls[1][0].metadata.isMultiAgent).toBe(true)
    })

    it('should not create highlights when showFileHighlights is false', () => {
      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMap,
          showFileHighlights: false,
        })
      )

      const highlightCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'highlight'
      )
      expect(highlightCalls).toHaveLength(0)
    })

    it('should not create highlights when fileEntityMap is undefined', () => {
      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: undefined,
          showFileHighlights: true,
        })
      )

      const highlightCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'highlight'
      )
      expect(highlightCalls).toHaveLength(0)
    })

    it('should skip files with no executions', () => {
      const emptyMap: FileEntityMap = {
        'src/empty.ts': {
          executions: [],
          issues: [],
          specs: [],
          changes: {},
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: emptyMap,
          showFileHighlights: true,
        })
      )

      const highlightCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'highlight'
      )
      expect(highlightCalls).toHaveLength(0)
    })
  })

  describe('clearFileHighlights', () => {
    it('should clear only file highlights', () => {
      mockHighlights = [
        { id: 'highlight-1', metadata: { fileHighlight: true } },
        { id: 'highlight-2', metadata: { fileHighlight: true } },
        { id: 'manual-highlight', metadata: {} }, // Not a file highlight
      ]

      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      vi.clearAllMocks()

      act(() => {
        result.current.clearFileHighlights()
      })

      // Should only remove file highlights
      expect(mockPort.remove).toHaveBeenCalledTimes(2)
      expect(mockPort.remove).toHaveBeenCalledWith('highlight-1')
      expect(mockPort.remove).toHaveBeenCalledWith('highlight-2')
    })
  })

  describe('getFileAgentInfo', () => {
    const mockFileEntityMap: FileEntityMap = {
      'src/index.ts': {
        executions: ['exec-001', 'exec-002'],
        issues: [],
        specs: [],
        changes: {},
      },
    }

    it('should return agent info for file', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: 'exec-001',
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMap,
        })
      )

      const agentInfo = result.current.getFileAgentInfo('src/index.ts')

      expect(agentInfo).toHaveLength(2)
      expect(agentInfo[0]).toEqual({
        executionId: 'exec-001',
        agentColor: '#color-exec-001',
        isSelected: true,
      })
      expect(agentInfo[1]).toEqual({
        executionId: 'exec-002',
        agentColor: '#color-exec-002',
        isSelected: false,
      })
    })

    it('should return empty array for unknown file', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMap,
        })
      )

      const agentInfo = result.current.getFileAgentInfo('src/unknown.ts')
      expect(agentInfo).toEqual([])
    })

    it('should return empty array when no fileEntityMap', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      const agentInfo = result.current.getFileAgentInfo('src/index.ts')
      expect(agentInfo).toEqual([])
    })
  })

  describe('Change badges', () => {
    // Store badges for getByType mock
    let mockBadges: Array<{ id: string; metadata?: { changeBadge?: boolean } }> = []

    beforeEach(() => {
      mockBadges = []
      mockPort.getByType.mockImplementation((type: string) => {
        if (type === 'badge') return mockBadges
        return mockHighlights
      })
    })

    const mockFileEntityMapWithChanges: FileEntityMap = {
      'src/added.ts': {
        executions: ['exec-001'],
        issues: [],
        specs: [],
        changes: {
          'exec-001': { additions: 50, deletions: 0, status: 'A' },
        },
      },
      'src/modified.ts': {
        executions: ['exec-001'],
        issues: [],
        specs: [],
        changes: {
          'exec-001': { additions: 10, deletions: 5, status: 'M' },
        },
      },
      'src/deleted.ts': {
        executions: ['exec-001'],
        issues: [],
        specs: [],
        changes: {
          'exec-001': { additions: 0, deletions: 30, status: 'D' },
        },
      },
    }

    it('should create badges for files with changes', () => {
      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMapWithChanges,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls).toHaveLength(3)
    })

    it('should use correct colors for different status types', () => {
      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMapWithChanges,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )

      // Find the Added badge (green)
      const addedBadge = badgeCalls.find(
        (call) => call[0].metadata?.status === 'A'
      )
      expect(addedBadge?.[0].color).toBe('#22c55e')

      // Find the Modified badge (yellow)
      const modifiedBadge = badgeCalls.find(
        (call) => call[0].metadata?.status === 'M'
      )
      expect(modifiedBadge?.[0].color).toBe('#eab308')

      // Find the Deleted badge (red)
      const deletedBadge = badgeCalls.find(
        (call) => call[0].metadata?.status === 'D'
      )
      expect(deletedBadge?.[0].color).toBe('#ef4444')
    })

    it('should use primary status when multiple changes exist (M > A > D > R)', () => {
      const multiChangeMap: FileEntityMap = {
        'src/multi.ts': {
          executions: ['exec-001', 'exec-002'],
          issues: [],
          specs: [],
          changes: {
            'exec-001': { additions: 50, deletions: 0, status: 'A' },
            'exec-002': { additions: 10, deletions: 5, status: 'M' },
          },
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: multiChangeMap,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls).toHaveLength(1)
      // M takes priority over A
      expect(badgeCalls[0][0].value).toBe('M')
      expect(badgeCalls[0][0].metadata?.status).toBe('M')
    })

    it('should not create badges when showChangeBadges is false', () => {
      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: mockFileEntityMapWithChanges,
          showChangeBadges: false,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls).toHaveLength(0)
    })

    it('should skip files with no executions', () => {
      const emptyExecMap: FileEntityMap = {
        'src/orphan.ts': {
          executions: [],
          issues: [],
          specs: [],
          changes: {
            'exec-001': { additions: 10, deletions: 0, status: 'A' },
          },
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: emptyExecMap,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls).toHaveLength(0)
    })

    it('should skip files with no changes', () => {
      const noChangesMap: FileEntityMap = {
        'src/nochanges.ts': {
          executions: ['exec-001'],
          issues: [],
          specs: [],
          changes: {},
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: noChangesMap,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls).toHaveLength(0)
    })

    it('should position badge at bottom-right of file node', () => {
      const singleFileMap: FileEntityMap = {
        'src/test.ts': {
          executions: ['exec-001'],
          issues: [],
          specs: [],
          changes: {
            'exec-001': { additions: 10, deletions: 0, status: 'A' },
          },
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: singleFileMap,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls[0][0].position).toEqual({
        type: 'node',
        nodeId: 'file-src/test.ts',
        anchor: 'bottom-right',
        offset: { x: -5, y: -5 },
      })
    })

    it('should include metadata with badge info', () => {
      const singleFileMap: FileEntityMap = {
        'src/test.ts': {
          executions: ['exec-001', 'exec-002'],
          issues: [],
          specs: [],
          changes: {
            'exec-001': { additions: 10, deletions: 0, status: 'M' },
          },
        },
      }

      vi.clearAllMocks()

      renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
          fileEntityMap: singleFileMap,
          showChangeBadges: true,
        })
      )

      const badgeCalls = mockPort.bind.mock.calls.filter(
        (call) => call[0].type === 'badge'
      )
      expect(badgeCalls[0][0].metadata).toEqual({
        changeBadge: true,
        filePath: 'src/test.ts',
        status: 'M',
        agentCount: 2,
      })
    })
  })

  describe('clearChangeBadges', () => {
    let mockBadges: Array<{ id: string; metadata?: { changeBadge?: boolean } }> = []

    beforeEach(() => {
      mockBadges = [
        { id: 'badge-1', metadata: { changeBadge: true } },
        { id: 'badge-2', metadata: { changeBadge: true } },
        { id: 'other-badge', metadata: {} }, // Not a change badge
      ]
      mockPort.getByType.mockImplementation((type: string) => {
        if (type === 'badge') return mockBadges
        return mockHighlights
      })
    })

    it('should clear only change badges', () => {
      const { result } = renderHook(() =>
        useCodeVizOverlays({
          executions: [],
          selectedAgentId: null,
          onAgentClick: vi.fn(),
        })
      )

      vi.clearAllMocks()

      act(() => {
        result.current.clearChangeBadges()
      })

      // Should only remove change badges
      expect(mockPort.remove).toHaveBeenCalledTimes(2)
      expect(mockPort.remove).toHaveBeenCalledWith('badge-1')
      expect(mockPort.remove).toHaveBeenCalledWith('badge-2')
    })
  })
})
