import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeVizOverlays } from '@/hooks/useCodeVizOverlays'
import type { ActiveExecution } from '@/hooks/useActiveExecutions'

// Mock codeviz/browser
const mockPort = {
  bind: vi.fn().mockReturnValue('overlay-id'),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  getOverlays: vi.fn().mockReturnValue([]),
  getOverlayById: vi.fn(),
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
})
