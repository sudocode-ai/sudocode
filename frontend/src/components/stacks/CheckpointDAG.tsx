/**
 * CheckpointDAG - DAG visualization component for checkpoints
 * Uses React Flow with dagre for automatic layout
 * Supports multi-select via click (Cmd/Ctrl) and box selection (selectionOnDrag)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  MarkerType,
  Position,
  SelectionMode,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'

import type {
  DataplaneCheckpoint,
  Stream,
  CheckpointNodeData,
  CheckpointStats,
  DiffStackWithCheckpoints,
} from '@/types/checkpoint'
import { getStreamColor } from '@/types/checkpoint'
import { CheckpointNode } from './CheckpointNode'
import { useTheme } from '@/contexts/ThemeContext'

// =============================================================================
// Types
// =============================================================================

export interface CheckpointDAGProps {
  /** Checkpoints to visualize */
  checkpoints: DataplaneCheckpoint[]
  /** Stream data for checkpoint context */
  streams?: Stream[]
  /** Diff stacks for showing which checkpoints are in stacks */
  diffStacks?: DiffStackWithCheckpoints[]
  /** Checkpoint stats (keyed by checkpoint ID) */
  checkpointStats?: Record<string, CheckpointStats>
  /** Currently selected checkpoint IDs */
  selectedCheckpointIds?: string[]
  /** Callback when selection changes */
  onSelectionChange?: (checkpointIds: string[]) => void
  /** Callback when clicking on empty pane area */
  onPaneClick?: () => void
  /** Whether the DAG is interactive (default: true) */
  interactive?: boolean
  /** Show minimap (default: true) */
  showMinimap?: boolean
  /** Show controls (default: true) */
  showControls?: boolean
  /** Custom class name */
  className?: string
}

// Node dimensions for layout calculation
const NODE_WIDTH = 260
const NODE_HEIGHT = 120

// =============================================================================
// Layout Utilities
// =============================================================================

/**
 * Apply dagre layout to nodes and edges
 * Returns nodes with calculated positions
 */
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 30,
    marginy: 30,
  })

  // Add nodes to dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  // Add edges to dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Calculate layout
  dagre.layout(dagreGraph)

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

/**
 * Build lookup maps for checkpoint state
 */
function buildCheckpointMaps(diffStacks?: DiffStackWithCheckpoints[]) {
  const inStackMap = new Map<string, string>() // checkpoint ID -> stack ID
  const mergedMap = new Set<string>() // checkpoint IDs that are merged

  if (diffStacks) {
    for (const stack of diffStacks) {
      for (const entry of stack.checkpoints) {
        inStackMap.set(entry.checkpointId, stack.id)
        if (stack.reviewStatus === 'merged') {
          mergedMap.add(entry.checkpointId)
        }
      }
    }
  }

  return { inStackMap, mergedMap }
}

/**
 * Convert checkpoints to React Flow nodes and edges
 */
function checkpointsToFlowElements(
  checkpoints: DataplaneCheckpoint[],
  streams: Stream[] | undefined,
  diffStacks: DiffStackWithCheckpoints[] | undefined,
  checkpointStats: Record<string, CheckpointStats> | undefined,
  selectedIds: Set<string>,
  onSelect: (checkpointId: string, multiSelect: boolean) => void
): { nodes: Node[]; edges: Edge[] } {
  const { inStackMap, mergedMap } = buildCheckpointMaps(diffStacks)
  const streamMap = new Map(streams?.map((s) => [s.id, s]) || [])
  const streamIds = [...new Set(checkpoints.map((cp) => cp.streamId))]

  // Create nodes from checkpoints
  const nodes: Node[] = checkpoints.map((checkpoint) => {
    const stream = streamMap.get(checkpoint.streamId)
    const stackId = inStackMap.get(checkpoint.id)
    const stats = checkpointStats?.[checkpoint.id]
    const streamColor = getStreamColor(checkpoint.streamId, streamIds)

    const nodeData: Record<string, unknown> = {
      checkpoint,
      stream,
      stats,
      isSelected: selectedIds.has(checkpoint.id),
      inStack: inStackMap.has(checkpoint.id),
      stackId,
      merged: mergedMap.has(checkpoint.id),
      onSelect,
      streamColor,
    }

    return {
      id: checkpoint.id,
      type: 'checkpoint',
      position: { x: 0, y: 0 }, // Will be calculated by dagre
      data: nodeData,
      selected: selectedIds.has(checkpoint.id),
    }
  })

  // Create edges from parent relationships
  const edges: Edge[] = []
  const checkpointMap = new Map(checkpoints.map((cp) => [cp.commitSha, cp]))

  checkpoints.forEach((checkpoint) => {
    if (checkpoint.parentCommit) {
      // Find checkpoint with matching commit SHA
      const parentCheckpoint = checkpointMap.get(checkpoint.parentCommit)
      if (parentCheckpoint) {
        const isMerged = mergedMap.has(checkpoint.id) && mergedMap.has(parentCheckpoint.id)

        edges.push({
          id: `${parentCheckpoint.id}-${checkpoint.id}`,
          source: parentCheckpoint.id,
          target: checkpoint.id,
          type: 'smoothstep',
          animated: false,
          style: {
            stroke: isMerged ? '#a855f7' : '#94a3b8',
            strokeWidth: 2,
            opacity: isMerged ? 0.5 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isMerged ? '#a855f7' : '#94a3b8',
          },
        })
      }
    }
  })

  return { nodes, edges }
}

// =============================================================================
// Custom Node Types
// =============================================================================

const nodeTypes = {
  checkpoint: CheckpointNode,
}

// =============================================================================
// Component
// =============================================================================

export function CheckpointDAG({
  checkpoints,
  streams,
  diffStacks,
  checkpointStats,
  selectedCheckpointIds = [],
  onSelectionChange,
  onPaneClick,
  interactive = true,
  showMinimap = true,
  showControls = true,
  className,
}: CheckpointDAGProps) {
  // Get current theme for dark mode support
  const { actualTheme } = useTheme()
  const isDark = actualTheme === 'dark'

  // Track selected IDs internally
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(selectedCheckpointIds)
  )

  // Sync external selection changes
  useEffect(() => {
    setSelectedIds(new Set(selectedCheckpointIds))
  }, [selectedCheckpointIds])

  // Handle node selection (click)
  const handleNodeSelect = useCallback(
    (checkpointId: string, multiSelect: boolean) => {
      setSelectedIds((prev) => {
        const newSet = new Set(multiSelect ? prev : [])
        if (prev.has(checkpointId) && multiSelect) {
          newSet.delete(checkpointId)
        } else {
          newSet.add(checkpointId)
        }
        const newIds = Array.from(newSet)
        onSelectionChange?.(newIds)
        return newSet
      })
    },
    [onSelectionChange]
  )

  // Convert checkpoints to flow elements
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = checkpointsToFlowElements(
      checkpoints,
      streams,
      diffStacks,
      checkpointStats,
      selectedIds,
      handleNodeSelect
    )
    const layouted = getLayoutedElements(nodes, edges, 'TB')
    return { initialNodes: layouted.nodes, initialEdges: layouted.edges }
  }, [checkpoints, streams, diffStacks, checkpointStats, selectedIds, handleNodeSelect])

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Update nodes when data changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = checkpointsToFlowElements(
      checkpoints,
      streams,
      diffStacks,
      checkpointStats,
      selectedIds,
      handleNodeSelect
    )
    const layouted = getLayoutedElements(newNodes, newEdges, 'TB')
    setNodes(layouted.nodes)
    setEdges(layouted.edges)
  }, [
    checkpoints,
    streams,
    diffStacks,
    checkpointStats,
    selectedIds,
    handleNodeSelect,
    setNodes,
    setEdges,
  ])

  // Handle React Flow's built-in selection (for box selection)
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (!interactive) return

      const newSelectedIds = selectedNodes.map((n) => n.id)
      setSelectedIds(new Set(newSelectedIds))
      onSelectionChange?.(newSelectedIds)
    },
    [interactive, onSelectionChange]
  )

  // Handle pane click (deselect all)
  const handlePaneClick = useCallback(() => {
    if (interactive) {
      setSelectedIds(new Set())
      onSelectionChange?.([])
      onPaneClick?.()
    }
  }, [interactive, onSelectionChange, onPaneClick])

  // Empty state
  if (checkpoints.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center text-muted-foreground ${className}`}
      >
        <p>No checkpoints to display</p>
      </div>
    )
  }

  return (
    <div className={`h-full w-full ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        colorMode={actualTheme}
        fitView
        fitViewOptions={{
          padding: 0.2,
          minZoom: 0.3,
          maxZoom: 1.5,
        }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        // Enable selection features
        selectionOnDrag={interactive}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={interactive}
        panOnDrag={interactive ? [1, 2] : false} // Middle/right mouse for pan when selection enabled
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        preventScrolling={interactive}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={isDark ? '#334155' : '#e2e8f0'} gap={16} size={1} />
        {showControls && <Controls showInteractive={false} />}
        {showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              const nodeData = node.data as unknown as CheckpointNodeData & {
                streamColor?: string
              }
              if (nodeData?.merged) return '#a855f7' // purple for merged
              if (nodeData?.inStack) return '#3b82f6' // blue for in stack
              if (nodeData?.streamColor) return nodeData.streamColor
              return '#94a3b8' // default gray
            }}
            maskColor={isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.1)'}
            className="rounded-lg border bg-background"
          />
        )}
      </ReactFlow>
    </div>
  )
}

export default CheckpointDAG
