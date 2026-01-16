/**
 * AgentHierarchyDAG - DAG visualization component for macro-agent hierarchy
 * Uses React Flow with dagre for automatic tree layout
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

import type { AgentRecord } from '@/types/macro-agent'
import { AgentNode } from './AgentNode'
import { useTheme } from '@/contexts/ThemeContext'

// =============================================================================
// Types
// =============================================================================

export interface AgentHierarchyDAGProps {
  /** Agents to visualize */
  agents: AgentRecord[]
  /** Currently selected agent ID */
  selectedAgentId?: string
  /** Callback when an agent is selected */
  onAgentSelect?: (agentId: string) => void
  /** Callback when clicking on empty pane area (useful for deselecting) */
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
const NODE_HEIGHT = 100

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
    nodesep: 40,
    ranksep: 60,
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
 * Get edge style based on agent states
 */
function getEdgeStyle(
  sourceAgent: AgentRecord | undefined,
  targetAgent: AgentRecord | undefined
): { style: { stroke: string; strokeWidth: number; strokeDasharray?: string }; animated: boolean } {
  const targetState = targetAgent?.state
  const sourceState = sourceAgent?.state

  // Animated edges for running agents
  const animated = targetState === 'running' || sourceState === 'running'

  // Color based on state
  let strokeColor = '#94a3b8' // Default gray

  if (sourceState === 'stopped' && targetState === 'stopped') {
    strokeColor = '#9ca3af' // Gray for stopped
  } else if (targetState === 'running') {
    strokeColor = '#3b82f6' // Blue for running
  } else if (targetState === 'spawning') {
    strokeColor = '#f59e0b' // Amber for spawning
  }

  return {
    style: {
      stroke: strokeColor,
      strokeWidth: 2,
      strokeDasharray: targetState === 'spawning' ? '5,5' : undefined,
    },
    animated,
  }
}

/**
 * Convert AgentRecord[] to React Flow nodes and edges
 */
function agentsToFlowElements(
  agents: AgentRecord[],
  selectedAgentId?: string,
  onAgentSelect?: (agentId: string) => void
): { nodes: Node[]; edges: Edge[] } {
  // Create a map for quick agent lookup
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  // Create nodes from agents
  const nodes: Node[] = agents.map((agent) => ({
    id: agent.id,
    type: 'agentNode',
    position: { x: 0, y: 0 }, // Will be calculated by dagre
    data: {
      agent,
      isSelected: agent.id === selectedAgentId,
      onSelect: onAgentSelect,
    },
  }))

  // Create edges from parent relationships
  const edges: Edge[] = []
  agents.forEach((agent) => {
    if (agent.parent) {
      const parentAgent = agentMap.get(agent.parent)
      const { style, animated } = getEdgeStyle(parentAgent, agent)

      edges.push({
        id: `${agent.parent}-${agent.id}`,
        source: agent.parent,
        target: agent.id,
        type: 'smoothstep',
        animated,
        style,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.stroke,
        },
      })
    }
  })

  return { nodes, edges }
}

// =============================================================================
// Custom Node Types
// =============================================================================

const nodeTypes = {
  agentNode: AgentNode,
}

// =============================================================================
// Component
// =============================================================================

export function AgentHierarchyDAG({
  agents,
  selectedAgentId,
  onAgentSelect,
  onPaneClick,
  interactive = true,
  showMinimap = true,
  showControls = true,
  className,
}: AgentHierarchyDAGProps) {
  // Get current theme for dark mode support
  const { actualTheme } = useTheme()
  const isDark = actualTheme === 'dark'

  // Convert agents to flow elements
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = agentsToFlowElements(agents, selectedAgentId, onAgentSelect)
    const layouted = getLayoutedElements(nodes, edges, 'TB')
    return { initialNodes: layouted.nodes, initialEdges: layouted.edges }
  }, [agents, selectedAgentId, onAgentSelect])

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Update nodes when agents change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = agentsToFlowElements(
      agents,
      selectedAgentId,
      onAgentSelect
    )
    const layouted = getLayoutedElements(newNodes, newEdges, 'TB')
    setNodes(layouted.nodes)
    setEdges(layouted.edges)
  }, [agents, selectedAgentId, onAgentSelect, setNodes, setEdges])

  // Handle node click
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (interactive && onAgentSelect) {
        onAgentSelect(node.id)
      }
    },
    [interactive, onAgentSelect]
  )

  // Get minimap node color based on state
  const getMinimapNodeColor = useCallback((node: Node) => {
    const agent = (node.data as { agent?: AgentRecord })?.agent
    if (!agent) return '#94a3b8'
    switch (agent.state) {
      case 'running':
        return '#3b82f6'
      case 'spawning':
        return '#f59e0b'
      case 'stopped':
        return '#9ca3af'
      default:
        return '#94a3b8'
    }
  }, [])

  // Empty state
  if (agents.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center text-muted-foreground ${className}`}
      >
        <p>No agents to display</p>
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
            nodeColor={getMinimapNodeColor}
            maskColor={isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.1)'}
            className="rounded-lg border bg-background"
          />
        )}
      </ReactFlow>
    </div>
  )
}

export default AgentHierarchyDAG
