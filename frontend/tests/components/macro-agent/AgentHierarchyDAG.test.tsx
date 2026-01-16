import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { AgentHierarchyDAG } from '@/components/macro-agent/AgentHierarchyDAG'
import type { AgentRecord } from '@/types/macro-agent'

// Mock React Flow as it requires browser APIs
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes }: { children: React.ReactNode; nodes: any[] }) => (
    <div data-testid="react-flow">
      <div data-testid="node-count">{nodes?.length ?? 0}</div>
      {children}
    </div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
  useNodesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
}))

describe('AgentHierarchyDAG', () => {
  const mockOnAgentSelect = vi.fn()
  const mockOnPaneClick = vi.fn()

  const now = Date.now()
  const mockAgents: AgentRecord[] = [
    {
      id: 'agent-root',
      session_id: 'session-1',
      task: 'Root task for multi-agent execution',
      state: 'running',
      parent: null,
      lineage: [],
      children_count: 2,
      created_at: now - 60000,
      updated_at: now,
    },
    {
      id: 'agent-child-1',
      session_id: 'session-1',
      task: 'First child task',
      state: 'running',
      parent: 'agent-root',
      lineage: ['agent-root'],
      children_count: 0,
      created_at: now - 30000,
      updated_at: now,
    },
    {
      id: 'agent-child-2',
      session_id: 'session-1',
      task: 'Second child task',
      state: 'stopped',
      parent: 'agent-root',
      lineage: ['agent-root'],
      children_count: 0,
      created_at: now - 20000,
      updated_at: now - 10000,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state when no agents', () => {
    renderWithProviders(
      <AgentHierarchyDAG
        agents={[]}
        onAgentSelect={mockOnAgentSelect}
        onPaneClick={mockOnPaneClick}
      />
    )

    expect(screen.getByText('No agents to display')).toBeInTheDocument()
  })

  it('should render React Flow with agents', () => {
    renderWithProviders(
      <AgentHierarchyDAG
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
        onPaneClick={mockOnPaneClick}
      />
    )

    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByTestId('node-count')).toHaveTextContent('3')
  })

  it('should render controls by default', () => {
    renderWithProviders(
      <AgentHierarchyDAG agents={mockAgents} onAgentSelect={mockOnAgentSelect} />
    )

    expect(screen.getByTestId('controls')).toBeInTheDocument()
  })

  it('should render minimap by default', () => {
    renderWithProviders(
      <AgentHierarchyDAG agents={mockAgents} onAgentSelect={mockOnAgentSelect} />
    )

    expect(screen.getByTestId('minimap')).toBeInTheDocument()
  })

  it('should hide controls when showControls is false', () => {
    renderWithProviders(
      <AgentHierarchyDAG
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
        showControls={false}
      />
    )

    expect(screen.queryByTestId('controls')).not.toBeInTheDocument()
  })

  it('should hide minimap when showMinimap is false', () => {
    renderWithProviders(
      <AgentHierarchyDAG
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
        showMinimap={false}
      />
    )

    expect(screen.queryByTestId('minimap')).not.toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <AgentHierarchyDAG
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
        className="custom-class"
      />
    )

    const wrapper = container.querySelector('.custom-class')
    expect(wrapper).toBeInTheDocument()
  })

  it('should render background', () => {
    renderWithProviders(
      <AgentHierarchyDAG agents={mockAgents} onAgentSelect={mockOnAgentSelect} />
    )

    expect(screen.getByTestId('background')).toBeInTheDocument()
  })

  it('should handle single agent without parent', () => {
    const singleAgent: AgentRecord[] = [
      {
        id: 'agent-single',
        session_id: 'session-1',
        task: 'Single agent task',
        state: 'running',
        parent: null,
        lineage: [],
        children_count: 0,
        created_at: now,
        updated_at: now,
      },
    ]

    renderWithProviders(
      <AgentHierarchyDAG agents={singleAgent} onAgentSelect={mockOnAgentSelect} />
    )

    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByTestId('node-count')).toHaveTextContent('1')
  })

  it('should handle deeply nested hierarchy', () => {
    const nestedAgents: AgentRecord[] = [
      {
        id: 'root',
        session_id: 's1',
        task: 'Root',
        state: 'running',
        parent: null,
        lineage: [],
        children_count: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'level1',
        session_id: 's1',
        task: 'Level 1',
        state: 'running',
        parent: 'root',
        lineage: ['root'],
        children_count: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'level2',
        session_id: 's1',
        task: 'Level 2',
        state: 'running',
        parent: 'level1',
        lineage: ['root', 'level1'],
        children_count: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'level3',
        session_id: 's1',
        task: 'Level 3',
        state: 'spawning',
        parent: 'level2',
        lineage: ['root', 'level1', 'level2'],
        children_count: 0,
        created_at: now,
        updated_at: now,
      },
    ]

    renderWithProviders(
      <AgentHierarchyDAG agents={nestedAgents} onAgentSelect={mockOnAgentSelect} />
    )

    expect(screen.getByTestId('node-count')).toHaveTextContent('4')
  })
})
