import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import { ExecutionMonitor, RunIndicator } from './ExecutionMonitor'
import type { AvailableCommand } from '@/hooks/useSessionUpdateStream'
import { AgentConfigPanel } from './AgentConfigPanel'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import type { WebSocketMessage } from '@/types/api'
import { DeleteWorktreeDialog } from './DeleteWorktreeDialog'
import { DeleteExecutionDialog } from './DeleteExecutionDialog'
import { SyncPreviewDialog } from './SyncPreviewDialog'
import { CommitChangesDialog } from './CommitChangesDialog'
import { CleanupWorktreeDialog } from './CleanupWorktreeDialog'
import { CodeChangesPanel } from './CodeChangesPanel'
import { TodoTracker, type TodoItem } from './TodoTracker'
import { useExecutionSync } from '@/hooks/useExecutionSync'
import { useAgentActions } from '@/hooks/useAgentActions'
import { useWorktreeMutations } from '@/hooks/useWorktreeMutations'
import { useExecutionMutations } from '@/hooks/useExecutionMutations'
import { useVoiceNarration } from '@/hooks/useVoiceNarration'
import { useVoiceConfig } from '@/hooks/useVoiceConfig'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Execution, ExecutionConfig, SyncMode } from '@/types/execution'
import type { ToolCallTracking } from '@/types/stream'
import {
  Loader2,
  XCircle,
  ArrowDown,
  ArrowUp,
  StopCircle,
} from 'lucide-react'

/**
 * Execution data exposed to parent component for header rendering
 */
export interface ExecutionHeaderData {
  rootExecution: Execution
  lastExecution: Execution
  worktreeExists: boolean
  cancelling: boolean
  deletingExecution: boolean
  canCancel: boolean
}

/**
 * Action handlers exposed to parent component
 */
export interface ExecutionActionHandlers {
  onCancel: () => void
  onDelete: () => void
  onOpenInIDE: () => void
}

export interface ExecutionViewProps {
  /**
   * Execution ID to display (will load the full chain)
   */
  executionId: string

  /**
   * Callback when follow-up execution is created (optional - for external navigation if needed)
   */
  onFollowUpCreated?: (newExecutionId: string) => void

  /**
   * Callback when execution status changes (for parent to display in header)
   */
  onStatusChange?: (status: Execution['status']) => void

  /**
   * Callback when execution data changes (for parent to render header info/actions)
   */
  onHeaderDataChange?: (data: ExecutionHeaderData, handlers: ExecutionActionHandlers) => void
}

/**
 * ExecutionView Component
 *
 * Displays an execution chain (root + all follow-ups) with real-time progress.
 * Each execution in the chain is rendered inline with its own ExecutionMonitor.
 * The follow-up input panel appears after the last execution.
 */
export function ExecutionView({ executionId, onFollowUpCreated, onStatusChange, onHeaderDataChange }: ExecutionViewProps) {
  const { deleteWorktree } = useWorktreeMutations()
  const { deleteExecution } = useExecutionMutations()
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteWorktree, setShowDeleteWorktree] = useState(false)
  const [showDeleteExecution, setShowDeleteExecution] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [deletingExecution, setDeletingExecution] = useState(false)
  const [worktreeExists, setWorktreeExists] = useState(false)
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState<boolean | undefined>(undefined)
  const [commitsAhead, setCommitsAhead] = useState<number | undefined>(undefined)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)
  const [endingSession, setEndingSession] = useState(false)

  // Sync state management
  const {
    syncPreview,
    isSyncPreviewOpen,
    performSync,
    openWorktreeInIDE,
    setIsSyncPreviewOpen,
    isPreviewing,
    fetchSyncPreview,
  } = useExecutionSync()

  // Get voice configuration from config.json
  const { voiceEnabled, narration, ttsProvider, kokoroMode, isLoading: voiceConfigLoading } = useVoiceConfig()

  // Voice narration for the current execution
  // Only enable if:
  // 1. Config is loaded (not loading)
  // 2. Voice is enabled in project config (voice.enabled)
  // 3. Narration is enabled in user settings (voice.narration.enabled)
  const narrationEnabled = !voiceConfigLoading && voiceEnabled && narration.enabled
  useVoiceNarration({
    executionId,
    enabled: narrationEnabled,
    ttsProvider,
    kokoroMode,
    voice: narration.voice,
    rate: narration.speed,
    volume: narration.volume,
  })

  // Accumulated tool calls from all executions in the chain (legacy, kept for onToolCallsUpdate callback)
  const [, setAllToolCalls] = useState<Map<string, ToolCallTracking>>(new Map())

  // Accumulated todos from all executions in the chain (from plan updates)
  const [todosByExecution, setTodosByExecution] = useState<Map<string, TodoItem[]>>(new Map())

  // Available slash commands from the agent (for autocomplete)
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([])

  // Merge todos from all executions - dedupe by content, keep most recent status
  const allTodos = useMemo(() => {
    const todoMap = new Map<string, TodoItem>()
    todosByExecution.forEach((todos) => {
      todos.forEach((todo) => {
        const existing = todoMap.get(todo.content)
        if (!existing || todo.lastSeen > existing.lastSeen) {
          todoMap.set(todo.content, todo)
        }
      })
    })
    return Array.from(todoMap.values()).sort((a, b) => a.firstSeen - b.firstSeen)
  }, [todosByExecution])

  // Get last execution for contextual actions
  const lastExecutionForActions = chainData?.executions[chainData.executions.length - 1] ?? null
  const rootExecutionForIssue = chainData?.executions[0]

  // Handle cleanup/commit complete - update local state and reload chain
  const handleActionComplete = useCallback(async () => {
    // Reload chain to get fresh data
    try {
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
      // Update the set of known execution IDs in this chain
      chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))

      // Re-check for uncommitted changes
      const rootExecution = data.executions[0]
      if (rootExecution?.worktree_path) {
        // Worktree mode
        try {
          const changes = await executionsApi.getChanges(rootExecution.id)
          // Check for uncommitted changes: must have uncommitted flag AND actual files to commit
          const uncommittedFiles =
            (changes.uncommittedSnapshot?.files?.length ?? 0) +
            (changes.captured?.uncommitted ? (changes.captured?.files?.length ?? 0) : 0)
          const hasUncommitted = changes.available && uncommittedFiles > 0
          setHasUncommittedChanges(hasUncommitted)
          setCommitsAhead(changes.commitsAhead)

          const worktreeStatus = await executionsApi.worktreeExists(rootExecution.id)
          setWorktreeExists(worktreeStatus.exists)
        } catch (err) {
          console.error('Failed to check changes after action:', err)
          setHasUncommittedChanges(false)
          setCommitsAhead(undefined)
          setWorktreeExists(false)
        }
      } else {
        // Local mode: check for uncommitted changes in main repo
        setWorktreeExists(false)
        setCommitsAhead(undefined) // Not applicable for local mode
        try {
          const changes = await executionsApi.getChanges(rootExecution.id)
          // Check for uncommitted changes: must have uncommitted flag AND actual files to commit
          const uncommittedFiles =
            (changes.uncommittedSnapshot?.files?.length ?? 0) +
            (changes.captured?.uncommitted ? (changes.captured?.files?.length ?? 0) : 0)
          const hasUncommitted = changes.available && uncommittedFiles > 0
          setHasUncommittedChanges(hasUncommitted)
        } catch (err) {
          console.error('Failed to check uncommitted changes for local mode:', err)
          setHasUncommittedChanges(false)
        }
      }
    } catch (err) {
      console.error('Failed to reload chain after action:', err)
    }
  }, [executionId])

  // Contextual actions (commit, sync, cleanup) - uses the common hook
  const {
    actions: contextualActions,
    isCommitDialogOpen,
    setIsCommitDialogOpen,
    isCleanupDialogOpen,
    setIsCleanupDialogOpen,
    isCommitting,
    isCleaning,
    changesRefreshTrigger,
    handleCommitChanges,
    handleCleanupWorktree: handleCleanupWorktreeAction,
    syncPreview: contextualSyncPreview,
    isSyncPreviewOpen: isContextualSyncPreviewOpen,
    setIsSyncPreviewOpen: setIsContextualSyncPreviewOpen,
    performSync: contextualPerformSync,
    isPreviewing: isContextualPreviewing,
  } = useAgentActions({
    execution: lastExecutionForActions,
    issueId: rootExecutionForIssue?.issue_id ?? '',
    worktreeExists,
    hasUncommittedChanges,
    commitsAhead,
    onCleanupComplete: handleActionComplete,
    onCommitComplete: handleActionComplete,
  })

  // WebSocket context for real-time status updates
  const { connected, subscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Track known execution IDs in this chain to detect relevant updates
  const chainExecutionIdsRef = useRef<Set<string>>(new Set())

  // Auto-scroll state and refs
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const lastScrollTopRef = useRef(0)
  const contentChangeCounterRef = useRef(0)
  const isScrollingToTopRef = useRef(false)

  // Load execution chain
  useEffect(() => {
    const loadChain = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await executionsApi.getChain(executionId)
        setChainData(data)
        // Update the set of known execution IDs in this chain
        chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))

        // Check worktree status (for worktree mode) and uncommitted changes (all modes)
        const rootExecution = data.executions[0]
        if (rootExecution?.worktree_path) {
          // Worktree mode: check if worktree exists
          try {
            const worktreeStatus = await executionsApi.worktreeExists(rootExecution.id)
            setWorktreeExists(worktreeStatus.exists)

            // Check for uncommitted changes only if worktree still exists
            if (worktreeStatus.exists) {
              try {
                const changes = await executionsApi.getChanges(rootExecution.id)
                // Uncommitted changes can be in:
                // 1. uncommittedSnapshot - when there are committed changes AND uncommitted on top
                // 2. captured with uncommitted=true - when there are only uncommitted changes (no commits yet)
                const hasUncommitted =
                  changes.available &&
                  ((changes.uncommittedSnapshot?.files?.length ?? 0) > 0 ||
                    (changes.captured?.uncommitted && (changes.captured?.files?.length ?? 0) > 0))
                setHasUncommittedChanges(hasUncommitted)
                setCommitsAhead(changes.commitsAhead)
              } catch (err) {
                console.error('Failed to check uncommitted changes:', err)
                setHasUncommittedChanges(undefined)
                setCommitsAhead(undefined)
              }
            } else {
              setHasUncommittedChanges(false)
              setCommitsAhead(undefined)
            }
          } catch (err) {
            console.error('Failed to check worktree status:', err)
            setWorktreeExists(false)
            setHasUncommittedChanges(false)
            setCommitsAhead(undefined)
          }
        } else {
          // Local mode: check for uncommitted changes in main repo
          setCommitsAhead(undefined) // Not applicable for local mode
          try {
            const changes = await executionsApi.getChanges(rootExecution.id)
            const hasUncommitted =
              changes.available &&
              ((changes.uncommittedSnapshot?.files?.length ?? 0) > 0 ||
                (changes.captured?.uncommitted && (changes.captured?.files?.length ?? 0) > 0))
            setHasUncommittedChanges(hasUncommitted)
          } catch (err) {
            console.error('Failed to check uncommitted changes for local mode:', err)
            setHasUncommittedChanges(undefined)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution chain')
      } finally {
        setLoading(false)
      }
    }

    loadChain()
  }, [executionId])

  // WebSocket subscription for real-time status updates
  useEffect(() => {
    const handlerId = `ExecutionView-${executionId}`

    const handleMessage = (message: WebSocketMessage) => {
      // Only handle execution-related messages
      if (
        message.type !== 'execution_created' &&
        message.type !== 'execution_updated' &&
        message.type !== 'execution_status_changed'
      ) {
        return
      }

      // Extract execution data from message
      const executionData = message.data as Execution | undefined
      if (!executionData?.id) return

      // Check if the message is about an execution in our chain
      const isInChain = chainExecutionIdsRef.current.has(executionData.id)
      // Check if it's a new follow-up execution for our chain
      const isNewFollowUp =
        message.type === 'execution_created' &&
        executionData.parent_execution_id &&
        chainExecutionIdsRef.current.has(executionData.parent_execution_id)

      if (isInChain) {
        // Update the execution status in chainData without reloading
        setChainData((prev) => {
          if (!prev) return prev
          const updatedExecutions = prev.executions.map((exec) => {
            if (exec.id === executionData.id) {
              return {
                ...exec,
                status: executionData.status,
                // Also update other fields that might have changed
                error: executionData.error,
                updated_at: executionData.updated_at,
              }
            }
            return exec
          })
          return {
            ...prev,
            executions: updatedExecutions,
          }
        })
      } else if (isNewFollowUp) {
        // Add the new follow-up execution to the chain
        setChainData((prev) => {
          if (!prev) return prev
          // Add new execution to the chain and update the ref
          chainExecutionIdsRef.current.add(executionData.id)
          return {
            ...prev,
            executions: [...prev.executions, executionData],
          }
        })
      }
    }

    addMessageHandler(handlerId, handleMessage)

    if (connected) {
      subscribe('execution')
    }

    return () => {
      removeMessageHandler(handlerId)
    }
  }, [executionId, connected, subscribe, addMessageHandler, removeMessageHandler])

  // Reload chain when an execution completes
  const handleExecutionComplete = useCallback(async (completedExecutionId: string) => {
    try {
      // Reload the full chain to get updated status
      const data = await executionsApi.getChain(completedExecutionId)
      setChainData(data)
      // Update the set of known execution IDs in this chain
      chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))

      // Re-check worktree status and uncommitted changes
      const rootExecution = data.executions[0]
      if (rootExecution?.worktree_path) {
        // Worktree mode
        try {
          const worktreeStatus = await executionsApi.worktreeExists(rootExecution.id)
          setWorktreeExists(worktreeStatus.exists)

          if (worktreeStatus.exists) {
            try {
              const changes = await executionsApi.getChanges(rootExecution.id)
              // Uncommitted changes can be in:
              // 1. uncommittedSnapshot - when there are committed changes AND uncommitted on top
              // 2. captured with uncommitted=true - when there are only uncommitted changes (no commits yet)
              const hasUncommitted =
                changes.available &&
                ((changes.uncommittedSnapshot?.files?.length ?? 0) > 0 ||
                  (changes.captured?.uncommitted && (changes.captured?.files?.length ?? 0) > 0))
              setHasUncommittedChanges(hasUncommitted)
            } catch (err) {
              console.error('Failed to check uncommitted changes:', err)
              setHasUncommittedChanges(undefined)
            }
          } else {
            setHasUncommittedChanges(false)
          }
        } catch (err) {
          console.error('Failed to check worktree status:', err)
          setWorktreeExists(false)
          setHasUncommittedChanges(false)
        }
      } else {
        // Local mode: check for uncommitted changes in main repo
        try {
          const changes = await executionsApi.getChanges(rootExecution.id)
          const hasUncommitted =
            changes.available &&
            ((changes.uncommittedSnapshot?.files?.length ?? 0) > 0 ||
              (changes.captured?.uncommitted && (changes.captured?.files?.length ?? 0) > 0))
          setHasUncommittedChanges(hasUncommitted)
        } catch (err) {
          console.error('Failed to check uncommitted changes for local mode:', err)
          setHasUncommittedChanges(undefined)
        }
      }
    } catch (err) {
      console.error('Failed to reload execution chain:', err)
    }
  }, [])

  // Handle execution errors
  const handleExecutionError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  // Handle cancel action for a specific execution
  const handleCancel = async (execId: string) => {
    setCancelling(true)
    try {
      await executionsApi.cancel(execId)
      // Reload chain to get updated status
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel execution')
    } finally {
      setCancelling(false)
    }
  }

  // Handle skip-all-permissions - new execution was created, reload chain
  const handleSkipAllPermissionsComplete = useCallback(
    async (newExecutionId: string) => {
      try {
        // Reload chain to include the new execution
        const data = await executionsApi.getChain(executionId)
        setChainData(data)
        // Update the ref to prevent WebSocket handler from adding duplicates
        chainExecutionIdsRef.current = new Set(data.executions.map((e) => e.id))

        // Notify parent if callback provided (for URL updates, etc.)
        if (onFollowUpCreated) {
          onFollowUpCreated(newExecutionId)
        }
      } catch (err) {
        console.error('Failed to reload chain after skip-all-permissions:', err)
      }
    },
    [executionId, onFollowUpCreated]
  )

  // Handle follow-up submission - either sends prompt to persistent session or creates new execution
  const handleFollowUpStart = async (
    _config: ExecutionConfig,
    prompt: string,
    _agentType?: string
  ) => {
    if (!chainData || chainData.executions.length === 0) return

    // Get the last execution in the chain
    const lastExecution = chainData.executions[chainData.executions.length - 1]

    // Check if this is a persistent session that's ready for another prompt
    const isPersistentSessionReady =
      lastExecution.status === 'waiting' || lastExecution.status === 'paused'

    setSubmittingFollowUp(true)
    try {
      if (isPersistentSessionReady) {
        // Optimistically update status to 'running' BEFORE the API call
        // This ensures the UI reflects the running state immediately
        setChainData((prev) => {
          if (!prev) return prev
          const updatedExecutions = [...prev.executions]
          const lastIdx = updatedExecutions.length - 1
          updatedExecutions[lastIdx] = {
            ...updatedExecutions[lastIdx],
            status: 'running',
          }
          return {
            ...prev,
            executions: updatedExecutions,
          }
        })

        // Send prompt to existing persistent session
        // WebSocket will update the status back to 'waiting' when complete
        await executionsApi.sendPrompt(lastExecution.id, prompt)
      } else {
        // Create a new follow-up execution
        const newExecution = await executionsApi.createFollowUp(lastExecution.id, {
          feedback: prompt,
        })

        // Add the new execution to the chain if not already added by WebSocket handler.
        // The WebSocket execution_created message may arrive before the API response,
        // so we check if the execution is already in the chain to avoid duplicates.
        if (!chainExecutionIdsRef.current.has(newExecution.id)) {
          chainExecutionIdsRef.current.add(newExecution.id)
          setChainData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              executions: [...prev.executions, newExecution],
            }
          })
        }

        // Notify parent if callback provided (for URL updates, etc.)
        if (onFollowUpCreated) {
          onFollowUpCreated(newExecution.id)
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isPersistentSessionReady
            ? 'Failed to send prompt to session'
            : 'Failed to create follow-up'
      )
    } finally {
      setSubmittingFollowUp(false)
    }
  }

  // Handle ending a persistent session
  const handleEndSession = async () => {
    if (!chainData || chainData.executions.length === 0) return

    const lastExecution = chainData.executions[chainData.executions.length - 1]

    // Only end if the session is in a state that can be ended
    if (lastExecution.status !== 'waiting' && lastExecution.status !== 'paused') {
      return
    }

    setEndingSession(true)
    try {
      await executionsApi.endSession(lastExecution.id)

      // Update the execution status locally
      // The WebSocket will update with the actual completed status
      setChainData((prev) => {
        if (!prev) return prev
        const updatedExecutions = [...prev.executions]
        const lastIdx = updatedExecutions.length - 1
        updatedExecutions[lastIdx] = {
          ...updatedExecutions[lastIdx],
          status: 'completed',
        }
        return {
          ...prev,
          executions: updatedExecutions,
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session')
    } finally {
      setEndingSession(false)
    }
  }

  // Handle delete worktree action
  const handleDeleteWorktree = async (deleteBranch: boolean) => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]
    if (!rootExecution.worktree_path) return

    setDeletingWorktree(true)
    try {
      await deleteWorktree({ executionId: rootExecution.id, deleteBranch })
      setWorktreeExists(false)

      // Reload chain
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
      setShowDeleteWorktree(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree')
    } finally {
      setDeletingWorktree(false)
    }
  }

  // Handle delete execution action
  const handleDeleteExecution = async (deleteBranch: boolean, deleteWorktreeFlag: boolean) => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]

    setDeletingExecution(true)
    try {
      await deleteExecution({
        executionId: rootExecution.id,
        deleteBranch,
        deleteWorktree: deleteWorktreeFlag,
      })

      // Navigate back after deletion
      if (rootExecution.issue_id) {
        window.location.href = `/issues/${rootExecution.issue_id}`
      } else {
        // For adhoc executions, navigate to executions list
        window.location.href = '/executions'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete execution')
      setDeletingExecution(false)
    }
  }

  // Handle open in IDE button click
  const handleOpenInIDE = useCallback(() => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]
    openWorktreeInIDE(rootExecution)
  }, [chainData, openWorktreeInIDE])

  // Handle sync confirmation (wrapper for dialog)
  const handleConfirmSync = useCallback(
    (mode: SyncMode, options?: { commitMessage?: string; includeUncommitted?: boolean }) => {
      if (!chainData || chainData.executions.length === 0) return
      const rootExecution = chainData.executions[0]
      performSync(rootExecution.id, mode, options)
    },
    [chainData, performSync]
  )

  // Handle refresh sync preview (refetch to get fresh data)
  const handleRefreshSyncPreview = useCallback(() => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExecution = chainData.executions[0]
    fetchSyncPreview(rootExecution.id)
  }, [chainData, fetchSyncPreview])

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Consider "at bottom" if within 50px of the bottom
    const isAtBottom = distanceFromBottom < 50

    // Detect if user scrolled up (manual scroll)
    const scrolledUp = scrollTop < lastScrollTopRef.current
    lastScrollTopRef.current = scrollTop

    // Don't modify auto-scroll state during programmatic scroll-to-top
    if (isScrollingToTopRef.current) return

    if (scrolledUp && !isAtBottom) {
      // User manually scrolled up - disable auto-scroll
      setShouldAutoScroll(false)
    } else if (isAtBottom) {
      // User scrolled to bottom - enable auto-scroll
      setShouldAutoScroll(true)
    }
  }, [shouldAutoScroll])

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Smooth scroll to bottom (with fallback for environments without scrollTo)
    if (container.scrollTo) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
    } else {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  // Scroll to top helper
  const scrollToTop = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Mark that we're programmatically scrolling to top to prevent
    // handleScroll from re-enabling auto-scroll during the animation
    isScrollingToTopRef.current = true

    // Smooth scroll to top (with fallback for environments without scrollTo)
    if (container.scrollTo) {
      container.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    } else {
      container.scrollTop = 0
    }

    // Clear the flag after animation completes (smooth scroll typically takes ~300-500ms)
    setTimeout(() => {
      isScrollingToTopRef.current = false
    }, 600)
  }, [])

  // Handle content changes from ExecutionMonitor
  const handleContentChange = useCallback(() => {
    if (!shouldAutoScroll) return
    contentChangeCounterRef.current += 1
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      scrollToBottom()
    }, 0)
  }, [shouldAutoScroll, scrollToBottom])

  // Handle tool calls update from ExecutionMonitor
  const handleToolCallsUpdate = useCallback(
    (executionId: string, toolCalls: Map<string, ToolCallTracking>) => {
      setAllToolCalls((prev) => {
        // Check if we need to update by comparing content, not just keys
        let hasChanges = false
        const executionPrefix = `${executionId}-`

        // Count existing entries for this execution
        let existingCount = 0
        prev.forEach((_, key) => {
          if (key.startsWith(executionPrefix)) {
            existingCount++
          }
        })

        // If sizes don't match, we have changes
        if (existingCount !== toolCalls.size) {
          hasChanges = true
        } else {
          // Check if any keys are missing or if content changed
          toolCalls.forEach((toolCall, id) => {
            const key = `${executionPrefix}${id}`
            const existing = prev.get(key)
            if (!existing) {
              hasChanges = true
            } else if (
              existing.status !== toolCall.status ||
              existing.result !== toolCall.result ||
              existing.args !== toolCall.args
            ) {
              hasChanges = true
            }
          })
        }

        if (!hasChanges) {
          return prev // No changes, return same reference to prevent re-render
        }

        const next = new Map(prev)
        // Remove old entries for this execution
        Array.from(next.keys()).forEach((key) => {
          if (key.startsWith(executionPrefix)) {
            next.delete(key)
          }
        })
        // Add new entries
        toolCalls.forEach((toolCall, id) => {
          next.set(`${executionPrefix}${id}`, toolCall)
        })
        return next
      })
    },
    []
  )

  // Handle todos update from ExecutionMonitor (from plan updates)
  const handleTodosUpdate = useCallback(
    (execId: string, todos: TodoItem[]) => {
      setTodosByExecution((prev) => {
        const existing = prev.get(execId)
        // Only update if todos changed
        if (existing && existing.length === todos.length) {
          const isSame = existing.every((t, i) =>
            t.content === todos[i].content &&
            t.status === todos[i].status &&
            t.wasCompleted === todos[i].wasCompleted
          )
          if (isSame) return prev
        }
        const next = new Map(prev)
        next.set(execId, todos)
        return next
      })
    },
    []
  )

  // Handle available commands update from ExecutionMonitor (for slash command autocomplete)
  const handleAvailableCommandsUpdate = useCallback((commands: AvailableCommand[]) => {
    setAvailableCommands(commands)
  }, [])

  // Notify parent of status changes
  useEffect(() => {
    if (!chainData || chainData.executions.length === 0) return
    const lastExecution = chainData.executions[chainData.executions.length - 1]
    onStatusChange?.(lastExecution.status)
  }, [chainData, onStatusChange])

  // Notify parent of header data changes
  useEffect(() => {
    if (!chainData || chainData.executions.length === 0) return
    const rootExec = chainData.executions[0]
    const lastExec = chainData.executions[chainData.executions.length - 1]
    // Only allow cancel for actively running executions (not waiting/paused persistent sessions)
    const canCancel = ['preparing', 'pending', 'running'].includes(lastExec.status)

    onHeaderDataChange?.(
      {
        rootExecution: rootExec,
        lastExecution: lastExec,
        worktreeExists,
        cancelling,
        deletingExecution,
        canCancel,
      },
      {
        onCancel: () => handleCancel(lastExec.id),
        onDelete: () => setShowDeleteExecution(true),
        onOpenInIDE: handleOpenInIDE,
      }
    )
  }, [chainData, worktreeExists, cancelling, deletingExecution, onHeaderDataChange, handleOpenInIDE])

  // Auto-scroll effect when chain data changes
  useEffect(() => {
    if (!shouldAutoScroll) return
    scrollToBottom()
  }, [chainData, shouldAutoScroll, scrollToBottom])

  // Initialize scroll position on mount
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    container.scrollTop = container.scrollHeight
    lastScrollTopRef.current = container.scrollTop
  }, [loading])

  // Loading state
  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading execution...</span>
        </div>
      </Card>
    )
  }

  // Error state
  if (error || !chainData || chainData.executions.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-2 text-destructive">
          <XCircle className="mt-0.5 h-5 w-5" />
          <div>
            <h4 className="font-semibold">Error Loading Execution</h4>
            <p className="mt-1 text-sm">{error || 'Execution not found'}</p>
          </div>
        </div>
      </Card>
    )
  }

  const executions = chainData.executions
  const rootExecution = executions[0]
  const lastExecution = executions[executions.length - 1]

  // Determine if we can enable follow-up/prompt panel
  // Terminal statuses allow creating a new follow-up execution
  // Waiting/paused statuses allow sending a prompt to a persistent session
  const lastExecutionTerminal =
    lastExecution.status === 'completed' ||
    lastExecution.status === 'failed' ||
    lastExecution.status === 'stopped' ||
    lastExecution.status === 'cancelled'
  const isPersistentSessionReady =
    lastExecution.status === 'waiting' || lastExecution.status === 'paused'
  const canEnableFollowUp = lastExecutionTerminal || isPersistentSessionReady

  // Determine if the execution is actively running (not waiting/paused)
  // This controls the "running" indicator in AgentConfigPanel
  const isActivelyRunning =
    lastExecution.status === 'preparing' ||
    lastExecution.status === 'pending' ||
    lastExecution.status === 'running'

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Scrollable content area with padding for sticky panel */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto py-6" onScroll={handleScroll}>
          <div className="relative mx-auto w-full max-w-7xl space-y-4 px-6">
            {/* Execution chain contents */}
            <Card className="p-6">
              {executions.map((execution, index) => {
                const isLast = index === executions.length - 1
                const showDivider = !isLast

                return (
                  <div key={execution.id}>
                    {/* Error message for this execution */}
                    {execution.error && (
                      <div className="mb-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                          <div>
                            <h5 className="font-medium text-destructive">Execution Error</h5>
                            <p className="mt-1 text-destructive/90">{execution.error}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Execution Monitor - compact mode for seamless inline display */}
                    <ExecutionMonitor
                      executionId={execution.id}
                      execution={execution}
                      onComplete={() => handleExecutionComplete(execution.id)}
                      onError={handleExecutionError}
                      onContentChange={handleContentChange}
                      onToolCallsUpdate={(toolCalls) =>
                        handleToolCallsUpdate(execution.id, toolCalls)
                      }
                      onTodosUpdate={handleTodosUpdate}
                      onAvailableCommandsUpdate={isLast ? handleAvailableCommandsUpdate : undefined}
                      onCancel={
                        isLast &&
                        ['preparing', 'pending', 'running'].includes(execution.status)
                          ? () => handleCancel(execution.id)
                          : undefined
                      }
                      onSkipAllPermissionsComplete={handleSkipAllPermissionsComplete}
                      compact
                      hideTodoTracker
                    />

                    {/* Visual separator between executions (subtle spacing only) */}
                    {showDivider && <div className="my-4" />}
                  </div>
                )
              })}

              {/* Accumulated Todo Tracker - shows todos from all executions in chain */}
              {allTodos.length > 0 && (
                <>
                  <div className="my-3" />
                  <TodoTracker todos={allTodos} />
                </>
              )}

              {/* Accumulated Code Changes - shows changes from the entire chain */}
              {(rootExecution.before_commit || rootExecution.after_commit) && (
                <>
                  <div className="my-3" />
                  <CodeChangesPanel
                    key={`${rootExecution.id}-${worktreeExists}`}
                    executionId={rootExecution.id}
                    autoRefreshInterval={
                      executions.some((exec) => exec.status === 'running') ? 30000 : undefined
                    }
                    executionStatus={lastExecution.status}
                    worktreePath={rootExecution.worktree_path}
                    refreshTrigger={changesRefreshTrigger}
                  />
                </>
              )}

              {/* Persistent Session Actions - shown when session is waiting/paused */}
              {isPersistentSessionReady && (
                <div className="flex flex-wrap items-center gap-2 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEndSession}
                    disabled={endingSession}
                    className="h-8 text-xs"
                    title="End the persistent session"
                  >
                    {endingSession ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <StopCircle className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {endingSession ? 'Ending...' : 'End Session'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Session {lastExecution.status === 'paused' ? 'paused' : 'waiting'} for input
                  </span>
                </div>
              )}

              {/* Contextual Actions - shown after execution completes */}
              {!executions.some((exec) => exec.status === 'running') &&
                !isPersistentSessionReady &&
                contextualActions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-4">
                    {contextualActions.map((action) => {
                      const Icon = action.icon
                      return (
                        <Button
                          key={action.id}
                          variant={action.variant || 'outline'}
                          size="sm"
                          onClick={action.onClick}
                          disabled={action.disabled}
                          className="h-8 text-xs"
                          title={action.description}
                        >
                          <Icon className="mr-1.5 h-3.5 w-3.5" />
                          {action.label}
                          {action.badge && (
                            <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs">
                              {action.badge}
                            </span>
                          )}
                        </Button>
                      )
                    })}
                  </div>
                )}

              {/* Running indicator if any executions are running */}
              {executions.some((exec) => exec.status === 'running') && (
                <>
                  <div className="my-3" />
                  <RunIndicator />
                </>
              )}
            </Card>

            {/* Scroll FABs - scroll-to-top always visible, scroll-to-bottom when auto-scroll disabled */}
            <>
              {/* Scroll to Top FAB */}
              <div className="fixed bottom-36 right-8 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        setShouldAutoScroll(false)
                        scrollToTop()
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary shadow-lg transition-colors hover:bg-primary hover:text-accent-foreground"
                      type="button"
                      data-testid="scroll-to-top-fab"
                      aria-label="Scroll to Top"
                    >
                      <ArrowUp className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Scroll to Top</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {/* Scroll to Bottom FAB - shows when auto-scroll is disabled */}
              {!shouldAutoScroll && (
                <div className="fixed bottom-24 right-8 z-10">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          setShouldAutoScroll(true)
                          scrollToBottom()
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary shadow-lg transition-colors hover:bg-primary hover:text-accent-foreground"
                        type="button"
                        data-testid="scroll-to-bottom-fab"
                        aria-label="Scroll to Bottom"
                      >
                        <ArrowDown className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>Scroll to Bottom</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </>
          </div>
        </div>

        {/* Sticky Follow-up Input Panel - always rendered at bottom */}
        {/* Works for both issue-based and adhoc executions */}
        <div className="sticky bottom-0 border-t bg-background shadow-lg">
          <div className="mx-auto w-full max-w-7xl">
            <AgentConfigPanel
              issueId={rootExecution.issue_id || undefined}
              onStart={handleFollowUpStart}
              isFollowUp
              allowModeToggle={false}
              disabled={!canEnableFollowUp || submittingFollowUp}
              isRunning={isActivelyRunning}
              onCancel={() => handleCancel(lastExecution.id)}
              isCancelling={cancelling}
              availableCommands={availableCommands}
              lastExecution={{
                id: lastExecution.id,
                mode: rootExecution.mode || undefined,
                model: rootExecution.model || undefined,
                target_branch: rootExecution.target_branch || undefined,
                agent_type: rootExecution.agent_type || undefined,
                // Use lastExecution.config to reflect any config changes from skip-all-permissions
                config: lastExecution.config
                  ? typeof lastExecution.config === 'string'
                    ? JSON.parse(lastExecution.config)
                    : lastExecution.config
                  : undefined,
              }}
            />
          </div>
        </div>

        {/* Delete Worktree Dialog */}
        <DeleteWorktreeDialog
          worktreePath={rootExecution.worktree_path}
          isOpen={showDeleteWorktree}
          onClose={() => setShowDeleteWorktree(false)}
          onConfirm={handleDeleteWorktree}
          isDeleting={deletingWorktree}
          branchName={rootExecution.branch_name}
          branchWasCreatedByExecution={(() => {
            const wasCreatedByExecution =
              rootExecution.branch_name !== rootExecution.target_branch &&
              rootExecution.branch_name !== '(detached)'
            return wasCreatedByExecution
          })()}
        />

        {/* Delete Execution Dialog */}
        <DeleteExecutionDialog
          executionId={rootExecution.id}
          isOpen={showDeleteExecution}
          onClose={() => setShowDeleteExecution(false)}
          onConfirm={handleDeleteExecution}
          isDeleting={deletingExecution}
          branchName={rootExecution.branch_name}
          branchWasCreatedByExecution={(() => {
            const wasCreatedByExecution =
              rootExecution.branch_name !== rootExecution.target_branch &&
              rootExecution.branch_name !== '(detached)'
            return wasCreatedByExecution
          })()}
          hasWorktree={!!rootExecution.worktree_path && worktreeExists}
          worktreePath={rootExecution.worktree_path || undefined}
        />

        {/* Sync Preview Dialog */}
        {syncPreview && (
          <SyncPreviewDialog
            preview={syncPreview}
            isOpen={isSyncPreviewOpen}
            onClose={() => setIsSyncPreviewOpen(false)}
            onConfirmSync={handleConfirmSync}
            onOpenIDE={handleOpenInIDE}
            isPreviewing={isPreviewing}
            targetBranch={rootExecution.target_branch ?? undefined}
            onRefresh={handleRefreshSyncPreview}
          />
        )}

        {/* Commit Changes Dialog (from contextual actions) */}
        {lastExecution && (
          <CommitChangesDialog
            execution={lastExecution}
            isOpen={isCommitDialogOpen}
            onClose={() => setIsCommitDialogOpen(false)}
            onConfirm={handleCommitChanges}
            isCommitting={isCommitting}
          />
        )}

        {/* Cleanup Worktree Dialog (from contextual actions) */}
        {rootExecution && (
          <CleanupWorktreeDialog
            execution={rootExecution}
            isOpen={isCleanupDialogOpen}
            onClose={() => setIsCleanupDialogOpen(false)}
            onConfirm={handleCleanupWorktreeAction}
            isCleaning={isCleaning}
          />
        )}

        {/* Sync Preview Dialog (from contextual actions) */}
        {lastExecution && contextualSyncPreview && (
          <SyncPreviewDialog
            preview={contextualSyncPreview}
            isOpen={isContextualSyncPreviewOpen}
            onClose={() => setIsContextualSyncPreviewOpen(false)}
            onConfirmSync={(mode, options) =>
              contextualPerformSync(lastExecution.id, mode, options)
            }
            onOpenIDE={handleOpenInIDE}
            isPreviewing={isContextualPreviewing}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
