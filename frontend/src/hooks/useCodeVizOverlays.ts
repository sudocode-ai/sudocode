/**
 * useCodeVizOverlays - Hook for managing CodeViz overlays including agent widgets
 *
 * Manages overlays on the code map to show:
 * - Active agent executions with their working files
 * - File highlights for files being modified
 * - Multi-agent file overlap with layered highlights
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
import type { FileEntityMap } from '@/hooks/useFileEntityMap'

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
  /** File entity map for file highlights (optional) */
  fileEntityMap?: FileEntityMap
  /** Whether to show file highlights */
  showFileHighlights?: boolean
  /** Whether to show change badges (A/M/D) */
  showChangeBadges?: boolean
}

/**
 * Information about agents working on a file (for tooltips)
 */
export interface FileAgentInfo {
  executionId: string
  agentColor: string
  isSelected: boolean
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
  /** Clear all file highlights */
  clearFileHighlights: () => void
  /** Clear all change badges */
  clearChangeBadges: () => void
  /** Highlight a specific file */
  highlightFile: (filePath: string, color?: string) => string
  /** Remove a file highlight */
  removeHighlight: (highlightId: string) => void
  /** Get agent info for a file (for tooltip display) */
  getFileAgentInfo: (filePath: string) => FileAgentInfo[]
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
/**
 * Get badge color based on file change status
 */
function getStatusBadgeColor(status: 'A' | 'M' | 'D' | 'R'): string {
  switch (status) {
    case 'A':
      return '#22c55e' // Green for added
    case 'M':
      return '#eab308' // Yellow for modified
    case 'D':
      return '#ef4444' // Red for deleted
    case 'R':
      return '#3b82f6' // Blue for renamed
    default:
      return '#6b7280' // Gray fallback
  }
}

/**
 * Get primary status from multiple change entries (prefer M > A > D > R)
 */
function getPrimaryStatus(
  changes: Record<string, { status: 'A' | 'M' | 'D' | 'R' }>
): 'A' | 'M' | 'D' | 'R' {
  const statuses = Object.values(changes).map((c) => c.status)
  if (statuses.includes('M')) return 'M'
  if (statuses.includes('A')) return 'A'
  if (statuses.includes('D')) return 'D'
  if (statuses.includes('R')) return 'R'
  return 'M' // Default to modified
}

export function useCodeVizOverlays({
  executions,
  selectedAgentId,
  onAgentClick,
  fileEntityMap,
  showFileHighlights = true,
  showChangeBadges = true,
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

  // Sync agent overlays with executions
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

  // Sync file highlights with fileEntityMap
  useEffect(() => {
    if (!showFileHighlights || !fileEntityMap) {
      return
    }

    // Clear existing file highlights (use a custom filter pattern)
    // We identify file highlights by their ID prefix
    const existingHighlights = port.getByType('highlight')
    existingHighlights.forEach((overlay) => {
      if (overlay.id.startsWith('file-highlight-')) {
        port.remove(overlay.id)
      }
    })

    // Create highlights for each file with active changes
    Object.entries(fileEntityMap).forEach(([filePath, info]) => {
      if (info.executions.length === 0) return

      const fileId = generateFileId(filePath)
      const isMultiAgent = info.executions.length > 1

      if (isMultiAgent) {
        // Multi-agent: create layered highlights with different colors
        // Each agent gets a highlight with decreasing opacity
        info.executions.forEach((execId, index) => {
          const color = getAgentColor(execId)
          const baseOpacity = 0.4
          const layerOpacity = baseOpacity / (index + 1) // Decreasing opacity for layers

          port.bind({
            type: 'highlight',
            position: {
              type: 'node',
              nodeId: fileId,
            },
            targetType: 'node',
            targetId: fileId,
            style: {
              color,
              opacity: layerOpacity,
              strokeWidth: 2 + index, // Slightly thicker for each layer
              glow: index === 0, // Only primary agent gets glow
              fill: true,
            },
            metadata: {
              fileHighlight: true,
              filePath,
              executionId: execId,
              isMultiAgent: true,
              agentIndex: index,
              totalAgents: info.executions.length,
            },
          })
        })
      } else {
        // Single agent: simple highlight
        const execId = info.executions[0]
        const color = getAgentColor(execId)

        port.bind({
          type: 'highlight',
          position: {
            type: 'node',
            nodeId: fileId,
          },
          targetType: 'node',
          targetId: fileId,
          style: {
            color,
            opacity: 0.3,
            strokeWidth: 2,
            glow: true,
            fill: true,
          },
          metadata: {
            fileHighlight: true,
            filePath,
            executionId: execId,
            isMultiAgent: false,
          },
        })
      }
    })
  }, [fileEntityMap, showFileHighlights, port])

  // Sync change badges with fileEntityMap
  useEffect(() => {
    if (!showChangeBadges || !fileEntityMap) {
      return
    }

    // Clear existing change badges
    const existingBadges = port.getByType('badge')
    existingBadges.forEach((overlay) => {
      if (overlay.metadata?.changeBadge) {
        port.remove(overlay.id)
      }
    })

    // Create badges for each file with changes
    Object.entries(fileEntityMap).forEach(([filePath, info]) => {
      if (info.executions.length === 0 || Object.keys(info.changes).length === 0) {
        return
      }

      const fileId = generateFileId(filePath)
      const primaryStatus = getPrimaryStatus(info.changes)
      const badgeColor = getStatusBadgeColor(primaryStatus)

      port.bind({
        type: 'badge',
        position: {
          type: 'node',
          nodeId: fileId,
          anchor: 'bottom-right',
          offset: { x: -5, y: -5 },
        },
        variant: 'text',
        value: primaryStatus,
        color: badgeColor,
        size: 'small',
        metadata: {
          changeBadge: true,
          filePath,
          status: primaryStatus,
          agentCount: info.executions.length,
        },
      })
    })
  }, [fileEntityMap, showChangeBadges, port])

  // Clear all agent overlays
  const clearAgentOverlays = useCallback(() => {
    port.clear({ type: 'agent' })
  }, [port])

  // Clear all file highlights
  const clearFileHighlights = useCallback(() => {
    const highlights = port.getByType('highlight')
    highlights.forEach((overlay) => {
      // Only remove file highlights (those with fileHighlight metadata)
      if (overlay.metadata?.fileHighlight) {
        port.remove(overlay.id)
      }
    })
  }, [port])

  // Clear all change badges
  const clearChangeBadges = useCallback(() => {
    const badges = port.getByType('badge')
    badges.forEach((overlay) => {
      if (overlay.metadata?.changeBadge) {
        port.remove(overlay.id)
      }
    })
  }, [port])

  // Highlight a file (manual highlight, not from fileEntityMap)
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

  // Get agent info for a file (for tooltip display)
  const getFileAgentInfo = useCallback(
    (filePath: string): FileAgentInfo[] => {
      if (!fileEntityMap || !fileEntityMap[filePath]) {
        return []
      }

      return fileEntityMap[filePath].executions.map((execId) => ({
        executionId: execId,
        agentColor: getAgentColor(execId),
        isSelected: execId === selectedAgentId,
      }))
    },
    [fileEntityMap, selectedAgentId]
  )

  return useMemo(
    () => ({
      overlayPort: port,
      overlayCount: count,
      clearAgentOverlays,
      clearFileHighlights,
      clearChangeBadges,
      highlightFile,
      removeHighlight,
      getFileAgentInfo,
    }),
    [port, count, clearAgentOverlays, clearFileHighlights, clearChangeBadges, highlightFile, removeHighlight, getFileAgentInfo]
  )
}
