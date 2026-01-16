/**
 * MacroAgentSessionInfo - Displays macro-agent session info for an execution
 * Shows session details, agent count, and link to dashboard
 */

import { Link } from 'react-router-dom'
import { Circle, Network, Users, ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useExecutionMacroAgents, useExecutionMacroSession } from '@/hooks/useMacroAgent'
import type { AgentRecord } from '@/types/macro-agent'

// =============================================================================
// Mini Agent Summary Component
// =============================================================================

interface MiniAgentSummaryProps {
  agents: AgentRecord[]
}

function MiniAgentSummary({ agents }: MiniAgentSummaryProps) {
  if (agents.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No agents</span>
    )
  }

  // Show up to 5 agents
  const displayAgents = agents.slice(0, 5)
  const remaining = agents.length - displayAgents.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {displayAgents.map((agent) => (
        <span
          key={agent.id}
          className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5"
          title={agent.task}
        >
          <Circle
            className={cn(
              'h-2 w-2',
              agent.state === 'running' && 'fill-blue-500 text-blue-500',
              agent.state === 'spawning' && 'fill-amber-500 text-amber-500',
              agent.state === 'stopped' && 'fill-gray-400 text-gray-400'
            )}
          />
          <span className="max-w-[60px] truncate font-mono text-[10px]">
            {agent.id.slice(0, 8)}
          </span>
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">
          +{remaining} more
        </span>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

interface MacroAgentSessionInfoProps {
  executionId: string
  dashboardPath: string
}

export function MacroAgentSessionInfo({
  executionId,
  dashboardPath,
}: MacroAgentSessionInfoProps) {
  const {
    sessionId,
    agentCount,
    runningCount,
    loading: sessionLoading,
  } = useExecutionMacroSession(executionId)

  const { agents, loading: agentsLoading } = useExecutionMacroAgents(executionId)

  const isLoading = sessionLoading || agentsLoading

  // Don't show if no session
  if (!sessionId && !isLoading) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-muted-foreground" />
        <h4 className="font-medium">Macro-Agent Session</h4>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading session...
        </div>
      ) : sessionId ? (
        <div className="space-y-3">
          {/* Session ID */}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Session ID</span>
            <code className="block rounded bg-muted px-2 py-1 font-mono text-xs">
              {sessionId}
            </code>
          </div>

          {/* Agent Stats */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{agentCount} agents</span>
            </div>
            {runningCount > 0 && (
              <Badge variant="outline" className="bg-blue-100/50 text-blue-700 text-xs py-0">
                {runningCount} running
              </Badge>
            )}
          </div>

          {/* Agent Summary */}
          {agents.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Agents</span>
              <MiniAgentSummary agents={agents} />
            </div>
          )}

          <Separator />

          {/* Dashboard Link */}
          <Link to={dashboardPath}>
            <Button variant="outline" size="sm" className="w-full">
              <Network className="mr-2 h-4 w-4" />
              View in Dashboard
              <ExternalLink className="ml-2 h-3 w-3" />
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  )
}
