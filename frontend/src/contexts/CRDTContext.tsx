/**
 * CRDT Context for Real-Time State Synchronization
 *
 * Provides real-time synchronization of issues, specs, executions, and agents
 * using Yjs and WebSocket connection to the CRDT Coordinator.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type {
  IssueState,
  SpecState,
  ExecutionState,
  AgentMetadata,
  FeedbackState,
} from '@sudocode-ai/types'

interface CRDTContextValue {
  connected: boolean
  issues: Map<string, IssueState>
  specs: Map<string, SpecState>
  executions: Map<string, ExecutionState>
  agents: Map<string, AgentMetadata>
  feedback: Map<string, FeedbackState>
  getIssue: (id: string) => IssueState | undefined
  getSpec: (id: string) => SpecState | undefined
  getExecution: (id: string) => ExecutionState | undefined
  getAgent: (id: string) => AgentMetadata | undefined
  getFeedback: (id: string) => FeedbackState | undefined
}

const CRDTContext = createContext<CRDTContextValue | null>(null)

interface CRDTProviderProps {
  children: React.ReactNode
  url?: string
  room?: string
  enabled?: boolean
}

/**
 * CRDT Provider that manages Yjs document and WebSocket connection
 * to CRDT Coordinator for real-time state synchronization.
 */
export function CRDTProvider({
  children,
  url,
  room = 'sudocode',
  enabled = true,
}: CRDTProviderProps) {
  const ydoc = useRef<Y.Doc | null>(null)
  const provider = useRef<WebsocketProvider | null>(null)
  const [connected, setConnected] = useState(false)

  // State snapshots for React
  const [issues, setIssues] = useState<Map<string, IssueState>>(new Map())
  const [specs, setSpecs] = useState<Map<string, SpecState>>(new Map())
  const [executions, setExecutions] = useState<Map<string, ExecutionState>>(new Map())
  const [agents, setAgents] = useState<Map<string, AgentMetadata>>(new Map())
  const [feedback, setFeedback] = useState<Map<string, FeedbackState>>(new Map())

  // Debounce timer for React state updates
  const updateTimer = useRef<NodeJS.Timeout | null>(null)

  // Store observers for cleanup
  const observersRef = useRef<{
    issues?: () => void
    specs?: () => void
    executions?: () => void
    agents?: () => void
    feedback?: () => void
  }>({})

  useEffect(() => {
    if (!enabled) {
      // Set connected to false when disabled
      setConnected(false)
      return
    }

    // Async initialization to fetch CRDT config from server
    const initializeCRDT = async () => {
      let crdtUrl = url || import.meta.env.VITE_CRDT_URL

      // If no URL provided, fetch from server config
      if (!crdtUrl) {
        try {
          const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
          const configUrl = apiBaseUrl.endsWith('/api')
            ? `${apiBaseUrl}/config`
            : `${apiBaseUrl}/api/config`
          const response = await fetch(configUrl)
          if (response.ok) {
            const config = await response.json()
            if (config.crdt?.enabled && config.crdt?.url) {
              crdtUrl = config.crdt.url
              console.log('[CRDT] Fetched CRDT URL from server config:', crdtUrl)
            } else {
              console.warn('[CRDT] Server config indicates CRDT is disabled')
              return
            }
          } else {
            console.warn('[CRDT] Failed to fetch config, using default URL')
            crdtUrl = 'ws://localhost:3001'
          }
        } catch (error) {
          console.warn('[CRDT] Failed to fetch config, using default URL:', error)
          crdtUrl = 'ws://localhost:3001'
        }
      }

      console.log('[CRDT] Initializing Yjs document and WebSocket provider')
      console.log('[CRDT] Coordinator URL:', crdtUrl)
      console.log('[CRDT] Room:', room)

      // Create Yjs document
      ydoc.current = new Y.Doc()

      // Create WebSocket provider
      provider.current = new WebsocketProvider(crdtUrl, room, ydoc.current, {
        connect: true,
        // Disable awareness for now (could enable later for cursor tracking, etc.)
        awareness: undefined,
      })

      // Connection status handlers
      provider.current.on('status', ({ status }: { status: string }) => {
        console.log('[CRDT] Connection status:', status)
        setConnected(status === 'connected')
      })

      provider.current.on('connection-close', () => {
        console.log('[CRDT] Connection closed')
        setConnected(false)
      })

      provider.current.on('connection-error', (event: Event) => {
        console.error('[CRDT] Connection error:', event)
        setConnected(false)
      })

      // Get shared maps from Yjs document
      const issuesMap = ydoc.current.getMap<IssueState>('issues')
      const specsMap = ydoc.current.getMap<SpecState>('specs')
      const executionsMap = ydoc.current.getMap<ExecutionState>('executions')
      const agentsMap = ydoc.current.getMap<AgentMetadata>('agentMetadata')
      const feedbackMap = ydoc.current.getMap<FeedbackState>('feedback')

      // Helper to convert Y.Map to plain Map with debouncing
      const scheduleUpdate = () => {
        if (updateTimer.current) {
          clearTimeout(updateTimer.current)
        }

        updateTimer.current = setTimeout(() => {
          // Convert Yjs maps to plain Maps for React state
          const issuesSnapshot = new Map<string, IssueState>()
          issuesMap.forEach((value, key) => {
            issuesSnapshot.set(key, value)
          })
          setIssues(issuesSnapshot)

          const specsSnapshot = new Map<string, SpecState>()
          specsMap.forEach((value, key) => {
            specsSnapshot.set(key, value)
          })
          setSpecs(specsSnapshot)

          const executionsSnapshot = new Map<string, ExecutionState>()
          executionsMap.forEach((value, key) => {
            executionsSnapshot.set(key, value)
          })
          setExecutions(executionsSnapshot)

          const agentsSnapshot = new Map<string, AgentMetadata>()
          agentsMap.forEach((value, key) => {
            agentsSnapshot.set(key, value)
          })
          setAgents(agentsSnapshot)

          const feedbackSnapshot = new Map<string, FeedbackState>()
          feedbackMap.forEach((value, key) => {
            feedbackSnapshot.set(key, value)
          })
          setFeedback(feedbackSnapshot)

          console.log('[CRDT] State updated:', {
            issues: issuesSnapshot.size,
            specs: specsSnapshot.size,
            executions: executionsSnapshot.size,
            agents: agentsSnapshot.size,
            feedback: feedbackSnapshot.size,
          })
        }, 100) // 100ms debounce to avoid excessive re-renders
      }

      // Observe changes to Yjs maps
      const issuesObserver = () => scheduleUpdate()
      const specsObserver = () => scheduleUpdate()
      const executionsObserver = () => scheduleUpdate()
      const agentsObserver = () => scheduleUpdate()
      const feedbackObserver = () => scheduleUpdate()

      // Store observers for cleanup
      observersRef.current = {
        issues: issuesObserver,
        specs: specsObserver,
        executions: executionsObserver,
        agents: agentsObserver,
        feedback: feedbackObserver,
      }

      issuesMap.observe(issuesObserver)
      specsMap.observe(specsObserver)
      executionsMap.observe(executionsObserver)
      agentsMap.observe(agentsObserver)
      feedbackMap.observe(feedbackObserver)

      // Initial sync
      scheduleUpdate()
    }

    // Call async initialization
    initializeCRDT()

    // Cleanup on unmount
    return () => {
      console.log('[CRDT] Cleaning up CRDT context')

      // Clear update timer
      if (updateTimer.current) {
        clearTimeout(updateTimer.current)
      }

      // Unobserve maps if they exist
      if (ydoc.current) {
        const issuesMap = ydoc.current.getMap<IssueState>('issues')
        const specsMap = ydoc.current.getMap<SpecState>('specs')
        const executionsMap = ydoc.current.getMap<ExecutionState>('executions')
        const agentsMap = ydoc.current.getMap<AgentMetadata>('agentMetadata')
        const feedbackMap = ydoc.current.getMap<FeedbackState>('feedback')

        if (observersRef.current.issues) issuesMap.unobserve(observersRef.current.issues)
        if (observersRef.current.specs) specsMap.unobserve(observersRef.current.specs)
        if (observersRef.current.executions)
          executionsMap.unobserve(observersRef.current.executions)
        if (observersRef.current.agents) agentsMap.unobserve(observersRef.current.agents)
        if (observersRef.current.feedback) feedbackMap.unobserve(observersRef.current.feedback)
      }

      // Disconnect provider
      if (provider.current) {
        provider.current.destroy()
        provider.current = null
      }

      // Destroy Yjs document
      if (ydoc.current) {
        ydoc.current.destroy()
        ydoc.current = null
      }

      setConnected(false)
    }
  }, [enabled, url, room])

  // Getter functions for individual entities
  const getIssue = useCallback((id: string) => issues.get(id), [issues])
  const getSpec = useCallback((id: string) => specs.get(id), [specs])
  const getExecution = useCallback((id: string) => executions.get(id), [executions])
  const getAgent = useCallback((id: string) => agents.get(id), [agents])
  const getFeedback = useCallback((id: string) => feedback.get(id), [feedback])

  const value: CRDTContextValue = {
    connected,
    issues,
    specs,
    executions,
    agents,
    feedback,
    getIssue,
    getSpec,
    getExecution,
    getAgent,
    getFeedback,
  }

  return <CRDTContext.Provider value={value}>{children}</CRDTContext.Provider>
}

/**
 * Hook to access CRDT context
 */
export function useCRDT() {
  const context = useContext(CRDTContext)
  if (!context) {
    throw new Error('useCRDT must be used within a CRDTProvider')
  }
  return context
}

/**
 * Hook to get a specific execution's state
 */
export function useCRDTExecution(executionId: string | undefined) {
  const { getExecution } = useCRDT()

  // Re-render when executions map changes or specific execution changes
  return executionId ? getExecution(executionId) : undefined
}

/**
 * Hook to get a specific issue's state
 */
export function useCRDTIssue(issueId: string | undefined) {
  const { getIssue } = useCRDT()

  return issueId ? getIssue(issueId) : undefined
}

/**
 * Hook to get a specific spec's state
 */
export function useCRDTSpec(specId: string | undefined) {
  const { getSpec } = useCRDT()

  return specId ? getSpec(specId) : undefined
}

/**
 * Hook to get a specific agent's metadata
 */
export function useCRDTAgent(agentId: string | undefined) {
  const { getAgent } = useCRDT()

  return agentId ? getAgent(agentId) : undefined
}
