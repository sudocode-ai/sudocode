/**
 * useCodeVizOverlays - Hook for managing CodeViz overlays including agent widgets
 *
 * Manages overlays on the code map to show:
 * - Active agent executions with their working files
 * - File highlights for files being modified
 *
 * Uses codeviz's overlay system to render these indicators on top of the code map.
 */

import { useEffect, useCallback, useMemo } from 'react'
import {
  useOverlayPort,
  generateFileId,
  type AgentStatus,
  type UseOverlayPortResult,
} from 'codeviz/browser'
import { getAgentColor } from '@/utils/colors'
import type { ActiveExecution } from '@/hooks/useActiveExecutions'
import type { ExecutionStatus } from '@/types/execution'

/**
 * Options for the useCodeVizOverlays hook
 */
export interface UseCodeVizOverlaysOptions {
  /** Active executions to display as overlays */
  executions: ActiveExecution[]
  /** Currently selected agent/execution ID */
  selectedAgentId?: string | null
  /** Callback when an agent overlay is clicked */
  onAgentClick?: (executionId: string) => void
}

/**
 * Result from useCodeVizOverlays hook
 */
export interface UseCodeVizOverlaysResult {
  /** The overlay port instance for passing to CodeMap */
  overlayPort: UseOverlayPortResult['port']
  /** Current overlay count */
  overlayCount: number
  /** Clear all agent overlays */
  clearAgentOverlays: () => void
  /** Highlight a specific file */
  highlightFile: (filePath: string, color?: string) => string
  /** Remove a file highlight */
  removeHighlight: (highlightId: string) => void
}

/**
 * Map execution status to codeviz AgentStatus
 */
function mapExecutionStatus(status: ExecutionStatus): AgentStatus {
  switch (status) {
    case 'preparing':
    case 'pending':
      return 'thinking'
    case 'running':
      return 'working'
    case 'paused':
      return 'waiting'
    case 'failed':
    case 'cancelled':
    case 'stopped':
      return 'error'
    case 'completed':
    default:
      return 'idle'
  }
}

/**
 * Format agent type for display
 */
function formatAgentName(agentType: string): string {
  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
  }
  return displayNames[agentType] || agentType
}

/**
 * Hook for managing CodeViz overlays for agent executions.
 *
 * Creates agent widget overlays positioned near the primary file being modified,
 * with fallback to viewport positioning when no files are known.
 *
 * @example
 * ```tsx
 * function CodeMapWithOverlays() {
 *   const { executions } = useActiveExecutions()
 *   const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
 *
 *   const { overlayPort } = useCodeVizOverlays({
 *     executions,
 *     selectedAgentId: selectedAgent,
 *     onAgentClick: setSelectedAgent,
 *   })
 *
 *   return <CodeMapComponent codeMap={codeMap} overlayPort={overlayPort} />
 * }
 * ```
 */
export function useCodeVizOverlays({
  executions,
  selectedAgentId,
  onAgentClick,
}: UseCodeVizOverlaysOptions): UseCodeVizOverlaysResult {
  // Create overlay port with click handler
  const { port, count } = useOverlayPort({
    onOverlayClick: useCallback(
      (id: string) => {
        // Extract execution ID from overlay ID (format: agent-{executionId})
        if (id.startsWith('agent-')) {
          const executionId = id.replace('agent-', '')
          onAgentClick?.(executionId)
        }
      },
      [onAgentClick]
    ),
  })

  // Calculate viewport offset for multiple agents (stack them vertically)
  const getViewportOffset = useCallback((index: number) => {
    return { x: -20, y: 20 + index * 80 }
  }, [])

  // Sync overlays with executions
  useEffect(() => {
    // Clear existing agent overlays
    port.clear({ type: 'agent' })

    // Create new agent overlays for each execution
    executions.forEach((exec, index) => {
      const primaryFile = exec.changedFiles[0] || null
      const color = getAgentColor(exec.id)
      const agentStatus = mapExecutionStatus(exec.status)

      port.bind({
        type: 'agent',
        position: primaryFile
          ? {
              type: 'node',
              nodeId: generateFileId(primaryFile),
              anchor: 'top-right',
              offset: { x: 20, y: -20 },
            }
          : {
              type: 'absolute',
              x: window.innerWidth - 180,
              y: 100 + index * 80,
            },
        agentId: exec.id,
        name: formatAgentName(exec.agentType),
        status: agentStatus,
        activity: exec.prompt ? exec.prompt.slice(0, 50) + (exec.prompt.length > 50 ? '...' : '') : undefined,
        targetNodes: exec.changedFiles.map(generateFileId),
        expandable: true,
        expanded: exec.id === selectedAgentId,
        metadata: {
          executionId: exec.id,
          issueId: exec.issueId,
          fileCount: exec.changedFiles.length,
          color,
        },
      })
    })
  }, [executions, selectedAgentId, port, getViewportOffset])

  // Clear all agent overlays
  const clearAgentOverlays = useCallback(() => {
    port.clear({ type: 'agent' })
  }, [port])

  // Highlight a file
  const highlightFile = useCallback(
    (filePath: string, color: string = '#3b82f6') => {
      return port.bind({
        type: 'highlight',
        position: {
          type: 'node',
          nodeId: generateFileId(filePath),
        },
        targetType: 'node',
        targetId: generateFileId(filePath),
        style: {
          color,
          opacity: 0.3,
          strokeWidth: 2,
          glow: true,
        },
      })
    },
    [port]
  )

  // Remove a highlight
  const removeHighlight = useCallback(
    (highlightId: string) => {
      port.remove(highlightId)
    },
    [port]
  )

  return useMemo(
    () => ({
      overlayPort: port,
      overlayCount: count,
      clearAgentOverlays,
      highlightFile,
      removeHighlight,
    }),
    [port, count, clearAgentOverlays, highlightFile, removeHighlight]
  )
}
