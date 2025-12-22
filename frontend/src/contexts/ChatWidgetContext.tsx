import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { useExecutions } from '@/hooks/useExecutions'
import type { Execution } from '@/types/execution'

// Storage key for persisted preferences
const STORAGE_KEY = 'sudocode:chatWidget'

// Tag for project assistant executions
export const PROJECT_ASSISTANT_TAG = 'project-assistant'

export type ChatWidgetMode = 'floating' | 'panel'

interface ChatWidgetPersistedState {
  mode: ChatWidgetMode
  autoConnectLatest: boolean
  lastExecutionId?: string | null
}

export interface ChatWidgetContextValue {
  // State
  isOpen: boolean
  mode: ChatWidgetMode
  selectedExecutionId: string | null
  selectedExecution: Execution | null
  autoConnectLatest: boolean

  // Actions
  toggle: () => void
  open: () => void
  close: () => void
  setMode: (mode: ChatWidgetMode) => void
  selectExecution: (executionId: string | null) => void
  setAutoConnectLatest: (value: boolean) => void

  // Derived state
  hasActiveExecution: boolean
  latestActiveExecution: Execution | null
  isExecutionRunning: boolean
  hasUnseenExecution: boolean
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null)

const DEFAULT_STATE: ChatWidgetPersistedState = {
  mode: 'floating',
  autoConnectLatest: true,
}

function loadPersistedState(): ChatWidgetPersistedState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        mode: parsed.mode || DEFAULT_STATE.mode,
        autoConnectLatest: parsed.autoConnectLatest ?? DEFAULT_STATE.autoConnectLatest,
        lastExecutionId: parsed.lastExecutionId ?? null,
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
  const [autoConnectLatest, setAutoConnectLatestState] = useState(persistedState.autoConnectLatest)
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    persistedState.lastExecutionId ?? null
  )
  const [seenExecutionIds, setSeenExecutionIds] = useState<Set<string>>(new Set())

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

  // Determine the effective selected execution
  const effectiveExecutionId = useMemo(() => {
    if (autoConnectLatest && latestActiveExecution) {
      return latestActiveExecution.id
    }
    return selectedExecutionId
  }, [autoConnectLatest, latestActiveExecution, selectedExecutionId])

  // Find the selected execution object
  const selectedExecution = useMemo(() => {
    if (!effectiveExecutionId) return null
    return executions.find((e) => e.id === effectiveExecutionId) || null
  }, [executions, effectiveExecutionId])

  // Check if there's any active execution
  const hasActiveExecution = latestActiveExecution !== null

  // Check if selected execution is currently running
  const isExecutionRunning = useMemo(() => {
    if (!selectedExecution) return false
    return ['running', 'pending', 'preparing'].includes(selectedExecution.status)
  }, [selectedExecution])

  // Check if there's an unseen active execution
  const hasUnseenExecution = useMemo(() => {
    if (!latestActiveExecution) return false
    return !seenExecutionIds.has(latestActiveExecution.id)
  }, [latestActiveExecution, seenExecutionIds])

  // Mark current execution as seen when widget is opened
  useEffect(() => {
    if (isOpen && effectiveExecutionId) {
      setSeenExecutionIds((prev) => {
        if (prev.has(effectiveExecutionId)) return prev
        const next = new Set(prev)
        next.add(effectiveExecutionId)
        return next
      })
    }
  }, [isOpen, effectiveExecutionId])

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
    // When manually selecting, disable auto-connect
    if (executionId !== null) {
      setAutoConnectLatestState(false)
    }
  }, [])

  const setAutoConnectLatest = useCallback((value: boolean) => {
    setAutoConnectLatestState(value)
    if (value) {
      // Clear manual selection when enabling auto-connect
      setSelectedExecutionId(null)
    }
  }, [])

  // Persist preferences and last execution ID when they change
  useEffect(() => {
    // Only persist selectedExecutionId if not using auto-connect (to restore on reload)
    const lastExecutionId = autoConnectLatest ? null : selectedExecutionId
    savePersistedState({ mode, autoConnectLatest, lastExecutionId })
  }, [mode, autoConnectLatest, selectedExecutionId])

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
      autoConnectLatest,
      toggle,
      open,
      close,
      setMode,
      selectExecution,
      setAutoConnectLatest,
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
      autoConnectLatest,
      toggle,
      open,
      close,
      setMode,
      selectExecution,
      setAutoConnectLatest,
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
