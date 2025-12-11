/**
 * WorkflowDAG - DAG visualization component for workflow steps
 * Uses React Flow with dagre for automatic layout
 */

import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  MarkerType,
  Position,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'

import type { WorkflowStep } from '@/types/workflow'
import type { Issue } from '@/types/api'
import { WorkflowStepNode } from './WorkflowStepNode'
import { useTheme } from '@/contexts/ThemeContext'

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDAGProps {
  /** Workflow steps to visualize */
  steps: WorkflowStep[]
  /** Optional issue data for enriching step display */
  issues?: Record<string, Issue>
  /** Currently selected step ID */
  selectedStepId?: string
  /** Callback when a step is selected */
  onStepSelect?: (stepId: string) => void
  /** Callback when clicking on empty pane area (useful for deselecting) */
  onPaneClick?: () => void
  /** Callback for step actions (retry, skip, cancel) */
  onStepAction?: (stepId: string, action: 'retry' | 'skip' | 'cancel') => void
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
const NODE_WIDTH = 280
const NODE_HEIGHT = 80

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
    nodesep: 50,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
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
 * Convert WorkflowStep[] to React Flow nodes and edges
 */
function stepsToFlowElements(
  steps: WorkflowStep[],
  issues?: Record<string, Issue>,
  selectedStepId?: string,
  onStepSelect?: (stepId: string) => void
): { nodes: Node[]; edges: Edge[] } {
  // Create nodes from steps
  const nodes: Node[] = steps.map((step) => ({
    id: step.id,
    type: 'workflowStep',
    position: { x: 0, y: 0 }, // Will be calculated by dagre
    data: {
      step,
      issue: issues?.[step.issueId],
      isSelected: step.id === selectedStepId,
      onSelect: onStepSelect,
    },
  }))

  // Create edges from dependencies
  const edges: Edge[] = []
  steps.forEach((step) => {
    step.dependencies.forEach((depId) => {
      // Find if dependency exists in steps
      const depExists = steps.some((s) => s.id === depId)
      if (depExists) {
        const isTargetRunning = step.status === 'running'
        const isSourceCompleted =
          steps.find((s) => s.id === depId)?.status === 'completed'

        edges.push({
          id: `${depId}-${step.id}`,
          source: depId,
          target: step.id,
          type: 'smoothstep',
          animated: isTargetRunning,
          style: {
            stroke: isSourceCompleted ? '#22c55e' : '#94a3b8',
            strokeWidth: 2,
            opacity: isSourceCompleted ? 0.6 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isSourceCompleted ? '#22c55e' : '#94a3b8',
          },
        })
      }
    })
  })

  return { nodes, edges }
}

// =============================================================================
// Custom Node Types
// =============================================================================

const nodeTypes = {
  workflowStep: WorkflowStepNode,
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowDAG({
  steps,
  issues,
  selectedStepId,
  onStepSelect,
  onPaneClick,
  // onStepAction - will be used when context menu is implemented
  onStepAction: _onStepAction,
  interactive = true,
  showMinimap = true,
  showControls = true,
  className,
}: WorkflowDAGProps) {
  // Get current theme for dark mode support
  const { actualTheme } = useTheme()
  const isDark = actualTheme === 'dark'

  // Convert steps to flow elements
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = stepsToFlowElements(steps, issues, selectedStepId, onStepSelect)
    const layouted = getLayoutedElements(nodes, edges, 'TB')
    return { initialNodes: layouted.nodes, initialEdges: layouted.edges }
  }, [steps, issues, selectedStepId, onStepSelect])

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Update nodes when steps change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = stepsToFlowElements(
      steps,
      issues,
      selectedStepId,
      onStepSelect
    )
    const layouted = getLayoutedElements(newNodes, newEdges, 'TB')
    setNodes(layouted.nodes)
    setEdges(layouted.edges)
  }, [steps, issues, selectedStepId, onStepSelect, setNodes, setEdges])

  // Handle node click
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (interactive && onStepSelect) {
        onStepSelect(node.id)
      }
    },
    [interactive, onStepSelect]
  )

  // Empty state
  if (steps.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center text-muted-foreground ${className}`}
      >
        <p>No steps in workflow</p>
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
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        colorMode={actualTheme}
        fitView
        fitViewOptions={{
          padding: 0.2,
          minZoom: 0.5,
          maxZoom: 1.5,
        }}
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={interactive}
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
              const step = node.data?.step as WorkflowStep | undefined
              if (!step) return '#94a3b8'
              switch (step.status) {
                case 'completed':
                  return '#22c55e'
                case 'running':
                  return '#3b82f6'
                case 'failed':
                  return '#ef4444'
                case 'blocked':
                  return '#eab308'
                case 'skipped':
                  return '#9ca3af'
                case 'ready':
                  return '#3b82f6'
                default:
                  return '#94a3b8'
              }
            }}
            maskColor={isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.1)'}
            className="rounded-lg border bg-background"
          />
        )}
      </ReactFlow>
    </div>
  )
}

export default WorkflowDAG
