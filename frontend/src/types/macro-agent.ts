/**
 * Macro-Agent Types
 *
 * TypeScript interfaces for macro-agent observability data.
 * These mirror the backend types in server/src/services/macro-agent-observability.ts
 * and server/src/routes/macro-agent.ts
 */

/**
 * Represents a single agent spawned by macro-agent
 */
export interface AgentRecord {
  id: string
  session_id: string
  task: string
  state: 'spawning' | 'running' | 'stopped'
  parent: string | null
  lineage: string[]
  children_count: number
  created_at: number
  updated_at: number
}

/**
 * Agent state filter values
 */
export type AgentState = AgentRecord['state']

/**
 * Overall status of the macro-agent observability system
 */
export interface MacroAgentStatus {
  serverReady: boolean
  observabilityConnected: boolean
  agents: {
    total: number
    running: number
    stopped: number
  }
  sessions: {
    total: number
  }
  executions: {
    connected: number
  }
}

/**
 * Response from GET /api/macro-agent/agents
 */
export interface MacroAgentAgentsResponse {
  agents: AgentRecord[]
  total: number
}

/**
 * Session info with agent counts
 */
export interface MacroAgentSession {
  id: string
  agentCount: number
  runningCount: number
  connectedExecutions: string[]
}

/**
 * Response from GET /api/macro-agent/sessions
 */
export interface MacroAgentSessionsResponse {
  sessions: MacroAgentSession[]
  total: number
}

/**
 * Response from GET /api/executions/:id/macro/agents
 */
export interface ExecutionMacroAgentsResponse {
  agents: AgentRecord[]
  sessionId: string | null
  total: number
}

/**
 * Response from GET /api/executions/:id/macro/session
 */
export interface ExecutionMacroSessionResponse {
  sessionId: string | null
  connectedAt: number | null
  agentCount: number
  runningCount: number
}

/**
 * Parameters for filtering agents
 */
export interface MacroAgentAgentsParams {
  session?: string
  state?: AgentState
}
