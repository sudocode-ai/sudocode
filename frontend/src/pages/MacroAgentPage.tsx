/**
 * MacroAgentPage - Dashboard for monitoring macro-agent activity
 * Shows agent hierarchy visualization and status information
 */

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Network,
  RefreshCw,
  AlertCircle,
  Loader2,
  Users,
  Clock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import {
  useMacroAgentStatus,
  useMacroAgentAgents,
  useMacroAgentSessions,
} from '@/hooks/useMacroAgent'
import { AgentHierarchyDAG } from '@/components/macro-agent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { AgentRecord, MacroAgentSession } from '@/types/macro-agent'

// =============================================================================
// State Badge Component
// =============================================================================

function StateBadge({ state }: { state: AgentRecord['state'] }) {
  const styles = {
    spawning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    stopped: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
  }

  return (
    <Badge variant="outline" className={cn('capitalize', styles[state])}>
      {state}
    </Badge>
  )
}

// =============================================================================
// Status Badge Component
// =============================================================================

function StatusBadge({
  serverReady,
  connected,
}: {
  serverReady: boolean
  connected: boolean
}) {
  if (!serverReady) {
    return (
      <Badge variant="outline" className="bg-gray-100 text-gray-600">
        Server Offline
      </Badge>
    )
  }
  if (!connected) {
    return (
      <Badge variant="outline" className="bg-amber-100 text-amber-700">
        Connecting...
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="bg-green-100 text-green-700">
      Connected
    </Badge>
  )
}

// =============================================================================
// Time Formatting
// =============================================================================

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const seconds = Math.floor((now - timestamp) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// =============================================================================
// Agent Detail Panel
// =============================================================================

interface AgentDetailPanelProps {
  agent: AgentRecord | null
  agents: AgentRecord[]
  sessions: MacroAgentSession[]
  executionPath: (id: string) => string
}

function AgentDetailPanel({
  agent,
  agents,
  sessions,
  executionPath,
}: AgentDetailPanelProps) {
  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <Network className="h-12 w-12 mb-4 opacity-50" />
        <p>Select an agent to view details</p>
      </div>
    )
  }

  // Find parent agent if exists
  const parentAgent = agent.parent ? agents.find((a) => a.id === agent.parent) : null

  // Find children
  const children = agents.filter((a) => a.parent === agent.id)

  // Find session info
  const session = sessions.find((s) => s.id === agent.session_id)

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Agent Details</h3>
            <StateBadge state={agent.state} />
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-1">{agent.id}</p>
        </div>

        <Separator />

        {/* Task */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Task</h4>
          <p className="text-sm">{agent.task}</p>
        </div>

        {/* Session */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Session</h4>
          <p className="text-sm font-mono">{agent.session_id}</p>
          {session && session.connectedExecutions.length > 0 && (
            <div className="mt-2 space-y-1">
              {session.connectedExecutions.map((execId) => (
                <Link
                  key={execId}
                  to={executionPath(execId)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {execId}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Created</h4>
          <div className="flex items-center gap-1 text-sm">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(agent.created_at)}
          </div>
        </div>

        {/* Parent */}
        {parentAgent && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">Parent</h4>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs">{parentAgent.id}</span>
              <StateBadge state={parentAgent.state} />
            </div>
          </div>
        )}

        {/* Lineage */}
        {agent.lineage.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">Lineage</h4>
            <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
              {agent.lineage.map((ancestorId, idx) => (
                <span key={ancestorId} className="flex items-center">
                  {idx > 0 && <ChevronRight className="h-3 w-3 mx-0.5" />}
                  <span className="bg-muted px-1.5 py-0.5 rounded">{ancestorId}</span>
                </span>
              ))}
              <ChevronRight className="h-3 w-3 mx-0.5" />
              <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {agent.id}
              </span>
            </div>
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              Children ({children.length})
            </h4>
            <div className="space-y-2">
              {children.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between text-sm bg-muted/50 p-2 rounded"
                >
                  <span className="font-mono text-xs">{child.id}</span>
                  <StateBadge state={child.state} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function MacroAgentPage() {
  const { paths } = useProjectRoutes()
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>()

  // Fetch data
  const { status, loading: statusLoading, error: statusError, refetch: refetchStatus } =
    useMacroAgentStatus()
  const {
    agents,
    loading: agentsLoading,
    error: agentsError,
    refetch: refetchAgents,
  } = useMacroAgentAgents()
  const { sessions, loading: sessionsLoading, refetch: refetchSessions } =
    useMacroAgentSessions()

  // Find selected agent
  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null
    return agents.find((a) => a.id === selectedAgentId) ?? null
  }, [selectedAgentId, agents])

  // Handle refresh
  const handleRefresh = () => {
    refetchStatus()
    refetchAgents()
    refetchSessions()
  }

  // Loading state
  const isLoading = statusLoading || agentsLoading || sessionsLoading

  // Error state
  const hasError = statusError || agentsError

  // Server not ready
  if (status && !status.serverReady) {
    return (
      <div className="container max-w-7xl mx-auto py-8">
        <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
          <AlertCircle className="h-16 w-16 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Macro-Agent Server Offline</h2>
          <p className="text-center max-w-md">
            The macro-agent server is not running. It will start automatically when you
            create an execution with macro-agent.
          </p>
          <Button variant="outline" className="mt-4" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container max-w-7xl mx-auto py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Network className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Macro-Agent Dashboard</h1>
          {status && (
            <StatusBadge
              serverReady={status.serverReady}
              connected={status.observabilityConnected}
            />
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Error state */}
      {hasError && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Error loading data</p>
            <p className="text-sm text-muted-foreground">
              {(statusError || agentsError)?.message || 'Unknown error occurred'}
            </p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !agents.length && (
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !hasError && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
          <Users className="h-16 w-16 mb-4 opacity-50" />
          <h2 className="text-xl font-semibold mb-2">No Active Agents</h2>
          <p className="text-center max-w-md">
            No macro-agent activity detected. Start an execution with macro-agent to see
            agent hierarchy here.
          </p>
        </div>
      )}

      {/* Main content */}
      {agents.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent Hierarchy DAG */}
          <div className="lg:col-span-2">
            <Card className="h-[500px]">
              <CardHeader className="py-3">
                <CardTitle className="text-base">Agent Hierarchy</CardTitle>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-48px)]">
                <AgentHierarchyDAG
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onAgentSelect={setSelectedAgentId}
                  onPaneClick={() => setSelectedAgentId(undefined)}
                  className="h-full"
                />
              </CardContent>
            </Card>
          </div>

          {/* Agent Detail Panel */}
          <div className="lg:col-span-1">
            <Card className="h-[500px]">
              <CardHeader className="py-3">
                <CardTitle className="text-base">
                  {selectedAgent ? 'Agent Details' : 'Select Agent'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-48px)]">
                <AgentDetailPanel
                  agent={selectedAgent}
                  agents={agents}
                  sessions={sessions}
                  executionPath={paths.execution}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Status bar */}
      {status && (
        <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="font-medium">Sessions:</span>
              <span>{status.sessions.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Agents:</span>
              <span>
                {status.agents.total} ({status.agents.running} running)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Connected Executions:</span>
              <span>{status.executions.connected}</span>
            </div>
          </div>
          <div className="text-xs">
            {status.observabilityConnected ? (
              <span className="text-green-600">Observability connected</span>
            ) : (
              <span className="text-amber-600">Observability disconnected</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
