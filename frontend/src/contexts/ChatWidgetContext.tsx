import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useExecutions } from '@/hooks/useExecutions'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { Execution, ExecutionConfig } from '@/types/execution'
import type { WebSocketMessage } from '@/types/api'

// Storage key for persisted preferences
const STORAGE_KEY = 'sudocode:chatWidget'

// Tag for project assistant executions
export const PROJECT_ASSISTANT_TAG = 'project-assistant'

export type ChatWidgetMode = 'floating' | 'panel'

interface ChatWidgetPersistedState {
  mode: ChatWidgetMode
  lastExecutionId?: string | null
  agentType?: string
  executionConfig?: Partial<ExecutionConfig>
}

export interface ChatWidgetContextValue {
  // State
  isOpen: boolean
  mode: ChatWidgetMode
  selectedExecutionId: string | null
  selectedExecution: Execution | null
  agentType: string
  executionConfig: Partial<ExecutionConfig>

  // Actions
  toggle: () => void
  open: () => void
  close: () => void
  setMode: (mode: ChatWidgetMode) => void
  selectExecution: (executionId: string | null) => void
  setCreatedExecution: (execution: Execution) => void
  setAgentType: (agentType: string) => void
  setExecutionConfig: (config: Partial<ExecutionConfig>) => void
  updateExecutionConfig: (updates: Partial<ExecutionConfig>) => void

  // Derived state
  hasActiveExecution: boolean
  latestActiveExecution: Execution | null
  isExecutionRunning: boolean
  hasUnseenExecution: boolean
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null)

const DEFAULT_STATE: ChatWidgetPersistedState = {
  mode: 'floating',
  agentType: 'claude-code',
  executionConfig: {
    mode: 'local',
  },
}

function loadPersistedState(): ChatWidgetPersistedState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        mode: parsed.mode || DEFAULT_STATE.mode,
        lastExecutionId: parsed.lastExecutionId ?? null,
        agentType: parsed.agentType || DEFAULT_STATE.agentType,
        executionConfig: parsed.executionConfig ?? DEFAULT_STATE.executionConfig,
      }
    }
  } catch (error) {
    console.error('Failed to load chat widget state:', error)
  }
  return DEFAULT_STATE
}

function savePersistedState(state: ChatWidgetPersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Failed to save chat widget state:', error)
  }
}

export interface ChatWidgetProviderProps {
  children: ReactNode
}

export function ChatWidgetProvider({ children }: ChatWidgetProviderProps) {
  // Load persisted preferences
  const [persistedState] = useState(loadPersistedState)

  // Widget state
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setModeState] = useState<ChatWidgetMode>(persistedState.mode)
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    persistedState.lastExecutionId ?? null
  )
  // Store newly created execution until it appears in the query results
  const [pendingExecution, setPendingExecution] = useState<Execution | null>(null)
  // Track if user has made an explicit selection (to prevent auto-select overriding)
  const [hasUserSelection, setHasUserSelection] = useState(persistedState.lastExecutionId !== null)

  // Agent settings (persisted)
  const [agentType, setAgentTypeState] = useState<string>(persistedState.agentType || 'claude-code')
  const [executionConfig, setExecutionConfigState] = useState<Partial<ExecutionConfig>>(
    persistedState.executionConfig || { mode: 'local' }
  )

  // Fetch ONLY project-assistant tagged executions
  const { data: executionsData } = useExecutions({ tags: [PROJECT_ASSISTANT_TAG] })
  const executions = executionsData?.executions || []

  // Find the latest active execution (running, pending, or preparing)
  const latestActiveExecution = useMemo(() => {
    const activeStatuses = ['running', 'pending', 'preparing', 'paused']
    const activeExecutions = executions.filter((e) => activeStatuses.includes(e.status))
    if (activeExecutions.length === 0) return null
    // Sort by created_at descending
    return activeExecutions.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  }, [executions])

  // Find the most recent execution (for default selection when no active)
  const mostRecentExecution = useMemo(() => {
    if (executions.length === 0) return null
    return [...executions].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  }, [executions])

  // Auto-select latest active or most recent execution on first load (if no user selection)
  // If no executions exist or selected ID is invalid, default to null (new execution)
  useEffect(() => {
    if (!hasUserSelection && !selectedExecutionId && executions.length > 0) {
      const autoSelectId = latestActiveExecution?.id || mostRecentExecution?.id
      if (autoSelectId) {
        setSelectedExecutionId(autoSelectId)
      }
    }
    // Reset to null (new execution) if:
    // - No executions exist, or
    // - Selected execution ID doesn't exist in the list or pending execution (stale/invalid)
    if (selectedExecutionId !== null) {
      const inExecutionsList = executions.some((e) => e.id === selectedExecutionId)
      const isPendingExecution = pendingExecution?.id === selectedExecutionId
      if (!inExecutionsList && !isPendingExecution) {
        setSelectedExecutionId(null)
      }
    }
  }, [
    hasUserSelection,
    selectedExecutionId,
    executions,
    pendingExecution,
    latestActiveExecution,
    mostRecentExecution,
  ])

  // The effective execution ID is simply the selected one
  const effectiveExecutionId = selectedExecutionId

  // Find the selected execution object (prefer list for updated status, fall back to pending)
  const selectedExecution = useMemo(() => {
    if (!effectiveExecutionId) return null
    // First check the list (has updated status from server)
    const fromList = executions.find((e) => e.id === effectiveExecutionId)
    if (fromList) {
      return fromList
    }
    // Fall back to pending execution (for newly created executions not yet in query)
    if (pendingExecution && pendingExecution.id === effectiveExecutionId) {
      return pendingExecution
    }
    return null
  }, [executions, effectiveExecutionId, pendingExecution])

  // Clear pending execution once it appears in the query results
  useEffect(() => {
    if (pendingExecution && executions.some((e) => e.id === pendingExecution.id)) {
      setPendingExecution(null)
    }
  }, [executions, pendingExecution])

  // Subscribe to WebSocket to update pendingExecution status (for follow-ups not in root list)
  const { connected, subscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  useEffect(() => {
    if (!pendingExecution) return

    const handleMessage = (message: WebSocketMessage) => {
      // Update pending execution status when we receive status change for it
      if (
        (message.type === 'execution_status_changed' || message.type === 'execution_updated') &&
        message.data?.id === pendingExecution.id
      ) {
        const execution = message.data as Execution
        setPendingExecution((prev) => {
          if (!prev || prev.id !== execution.id) return prev
          return { ...prev, status: execution.status }
        })
      }
    }

    const handlerId = 'chatWidgetPendingExecution'
    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [pendingExecution?.id, connected, subscribe, addMessageHandler, removeMessageHandler])

  // Check if there's any active execution
  const hasActiveExecution = latestActiveExecution !== null

  // Check if the selected project-assistant execution is currently running (for FAB spinner)
  const isExecutionRunning = useMemo(() => {
    if (!selectedExecution) return false
    return ['running', 'pending', 'preparing'].includes(selectedExecution.status)
  }, [selectedExecution])

  // Track execution ID that was running when widget was closed (to show notification on completion)
  const [watchingExecutionId, setWatchingExecutionId] = useState<string | null>(null)

  // Check if watched execution has completed (user closed widget while it was running, now it's done)
  const hasUnseenCompletedExecution = useMemo(() => {
    if (!watchingExecutionId || !selectedExecution) return false
    // Only show notification if the watched execution completed
    if (selectedExecution.id !== watchingExecutionId) return false
    return selectedExecution.status === 'completed' || selectedExecution.status === 'failed'
  }, [watchingExecutionId, selectedExecution])

  // Notification dot shows when watched execution completes
  const hasUnseenExecution = hasUnseenCompletedExecution

  // Clear watching state when widget opens (user has seen the result)
  useEffect(() => {
    if (isOpen) {
      setWatchingExecutionId(null)
    }
  }, [isOpen])

  // When widget closes while execution is running, start watching for completion
  const prevIsOpen = useRef(isOpen)
  useEffect(() => {
    // Detect close transition (was open, now closed)
    if (prevIsOpen.current && !isOpen) {
      // If execution is running when closing, watch for its completion
      if (
        selectedExecution &&
        ['running', 'pending', 'preparing'].includes(selectedExecution.status)
      ) {
        setWatchingExecutionId(selectedExecution.id)
      }
    }
    prevIsOpen.current = isOpen
  }, [isOpen, selectedExecution])

  // Actions
  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const setMode = useCallback((newMode: ChatWidgetMode) => {
    setModeState(newMode)
  }, [])

  const selectExecution = useCallback((executionId: string | null) => {
    setSelectedExecutionId(executionId)
    // Mark that user has made an explicit selection
    setHasUserSelection(true)
  }, [])

  // Store a newly created execution (makes it available before query refetch)
  const setCreatedExecution = useCallback((execution: Execution) => {
    setPendingExecution(execution)
    setSelectedExecutionId(execution.id)
    setHasUserSelection(true)
  }, [])

  // Agent settings actions
  const setAgentType = useCallback((newAgentType: string) => {
    setAgentTypeState(newAgentType)
  }, [])

  const setExecutionConfig = useCallback((config: Partial<ExecutionConfig>) => {
    setExecutionConfigState(config)
  }, [])

  const updateExecutionConfig = useCallback((updates: Partial<ExecutionConfig>) => {
    setExecutionConfigState((prev) => ({ ...prev, ...updates }))
  }, [])

  // Persist preferences and last execution ID when they change
  useEffect(() => {
    savePersistedState({ mode, lastExecutionId: selectedExecutionId, agentType, executionConfig })
  }, [mode, selectedExecutionId, agentType, executionConfig])

  // Keyboard shortcut: Cmd/Ctrl + J to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+J (Mac) or Ctrl+J (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        toggle()
      }
      // Escape to close when open
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault()
        close()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, toggle, close])

  const value = useMemo(
    (): ChatWidgetContextValue => ({
      isOpen,
      mode,
      selectedExecutionId: effectiveExecutionId,
      selectedExecution,
      agentType,
      executionConfig,
      toggle,
      open,
      close,
      setMode,
      selectExecution,
      setCreatedExecution,
      setAgentType,
      setExecutionConfig,
      updateExecutionConfig,
      hasActiveExecution,
      latestActiveExecution,
      isExecutionRunning,
      hasUnseenExecution,
    }),
    [
      isOpen,
      mode,
      effectiveExecutionId,
      selectedExecution,
      agentType,
      executionConfig,
      toggle,
      open,
      close,
      setMode,
      selectExecution,
      setCreatedExecution,
      setAgentType,
      setExecutionConfig,
      updateExecutionConfig,
      hasActiveExecution,
      latestActiveExecution,
      isExecutionRunning,
      hasUnseenExecution,
    ]
  )

  return <ChatWidgetContext.Provider value={value}>{children}</ChatWidgetContext.Provider>
}

/**
 * Hook to access the chat widget context
 * @throws Error if used outside ChatWidgetProvider
 */
export function useChatWidget(): ChatWidgetContextValue {
  const context = useContext(ChatWidgetContext)
  if (!context) {
    throw new Error('useChatWidget must be used within ChatWidgetProvider')
  }
  return context
}
