import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Trash2,
  CircleDot,
  Signal,
  GitBranch,
  ExpandIcon,
  FileText,
  Code2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ArrowDown,
  ArrowUp,
} from 'lucide-react'
import type { Issue, Relationship, EntityType, RelationshipType, IssueStatus } from '@/types/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EntityBadge } from '@/components/entities'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { RelationshipList } from '@/components/relationships/RelationshipList'
import { RelationshipForm } from '@/components/relationships/RelationshipForm'
import { relationshipsApi, executionsApi } from '@/lib/api'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import type { ExecutionConfig, Execution } from '@/types/execution'
import { useRelationshipMutations } from '@/hooks/useRelationshipMutations'
import { TiptapEditor } from '@/components/specs/TiptapEditor'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ActivityTimeline } from './ActivityTimeline'
import type { IssueFeedback, WebSocketMessage } from '@/types/api'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { toast } from 'sonner'
import { findLatestExecutionInChain } from '@/utils/executions'

const VIEW_MODE_STORAGE_KEY = 'sudocode:details:viewMode'
const DESCRIPTION_COLLAPSED_STORAGE_KEY = 'sudocode:issue:descriptionCollapsed'

interface IssuePanelProps {
  issue: Issue
  onClose?: () => void
  onUpdate?: (data: Partial<Issue>) => void
  onDelete?: () => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  isUpdating?: boolean
  isDeleting?: boolean
  showOpenDetail?: boolean
  hideTopControls?: boolean
  viewMode?: 'formatted' | 'markdown'
  onViewModeChange?: (mode: 'formatted' | 'markdown') => void
  showViewToggleInline?: boolean
  feedback?: IssueFeedback[]
  autoFocusAgentConfig?: boolean
}

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Critical (P0)' },
  { value: '1', label: 'High (P1)' },
  { value: '2', label: 'Medium (P2)' },
  { value: '3', label: 'Low (P3)' },
  { value: '4', label: 'None (P4)' },
]

export function IssuePanel({
  issue,
  onClose,
  onUpdate,
  onDelete,
  onArchive,
  onUnarchive,
  isUpdating = false,
  isDeleting = false,
  showOpenDetail = false,
  hideTopControls = false,
  viewMode: externalViewMode,
  onViewModeChange,
  showViewToggleInline = true,
  feedback = [],
  autoFocusAgentConfig = false,
}: IssuePanelProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(issue.title)
  const [content, setContent] = useState(issue.content || '')
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [internalViewMode, setInternalViewMode] = useState<'formatted' | 'markdown'>(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : 'formatted'
  })
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(DESCRIPTION_COLLAPSED_STORAGE_KEY)
    return stored !== null ? JSON.parse(stored) : false
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Use external viewMode if provided, otherwise use internal state
  const viewMode = externalViewMode ?? internalViewMode
  const handleViewModeChange = (mode: 'formatted' | 'markdown') => {
    if (onViewModeChange) {
      onViewModeChange(mode)
    } else {
      setInternalViewMode(mode)
    }
  }
  const [priority, setPriority] = useState<number>(issue.priority)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [isLoadingRelationships, setIsLoadingRelationships] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [isCopied, setIsCopied] = useState(false)
  const [isFollowUpMode, setIsFollowUpMode] = useState(true)
  const [forceNewExecution, setForceNewExecution] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const isAgentPanelSelectOpenRef = useRef(false)
  const selectCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activitySectionRef = useRef<HTMLDivElement>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const shouldScrollToActivityRef = useRef(false)
  const hasInitializedForIssueRef = useRef<string | null>(null)
  const executionsLoadedRef = useRef(false)
  const activityBottomRef = useRef<HTMLDivElement>(null)
  const lastFeedbackRef = useRef<HTMLDivElement>(null)
  const escPressedWhileRunningRef = useRef(false)

  // Auto-scroll state and refs (enabled when execution is running)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false)
  const [isScrollable, setIsScrollable] = useState(false)
  const lastScrollTopRef = useRef(0)
  const isScrollingToTopRef = useRef(false)

  // WebSocket for real-time updates
  const { subscribe, unsubscribe, addMessageHandler, removeMessageHandler } = useWebSocketContext()

  // Computed values for follow-up mode
  const latestExecution = useMemo(() => {
    return findLatestExecutionInChain(executions)
  }, [executions])

  const canFollowUp = useMemo(() => {
    if (!latestExecution) return false

    const terminalStatuses: Execution['status'][] = ['completed', 'failed', 'stopped', 'cancelled']

    return terminalStatuses.includes(latestExecution.status)
  }, [latestExecution])

  const isExecutionRunning = useMemo(() => {
    if (!latestExecution) return false
    return latestExecution.status === 'running'
  }, [latestExecution])

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

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Check if container has scrollable content
    const hasScrollableContent = scrollHeight > clientHeight
    setIsScrollable(hasScrollableContent)

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
  }, [])

  // Check if container is scrollable whenever content changes
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const checkScrollable = () => {
      const hasScrollableContent = container.scrollHeight > container.clientHeight
      setIsScrollable(hasScrollableContent)
    }

    checkScrollable()
    // Also check on resize
    const resizeObserver = new ResizeObserver(checkScrollable)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [executions])

  // Relationship mutations with cache invalidation
  const { createRelationshipAsync, deleteRelationshipAsync } = useRelationshipMutations()
  const onUpdateRef = useRef(onUpdate)
  const latestValuesRef = useRef({ title, content, status, priority, hasChanges })

  // Keep refs in sync with latest values
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  useEffect(() => {
    latestValuesRef.current = { title, content, status, priority, hasChanges }
  }, [title, content, status, priority, hasChanges])

  // Reset state when switching to a different issue (issue.id changes)
  useEffect(() => {
    // Clear auto-save timer when switching issues
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Reset hasChanges to prevent saving old content to new issue
    setHasChanges(false)
    // Reset executions to prevent stale data affecting auto-collapse logic
    setExecutions([])
    // Reset initialization ref so auto-collapse can re-evaluate for new issue
    hasInitializedForIssueRef.current = null
    // Reset executions loaded flag
    executionsLoadedRef.current = false
    // Reset to follow-up mode when issue changes
    setIsFollowUpMode(true)
    // Reset force new execution flag
    setForceNewExecution(false)
    // Reset ESC pressed flag
    escPressedWhileRunningRef.current = false
  }, [issue.id])

  // Auto-manage follow-up mode based on whether follow-ups are possible
  useEffect(() => {
    if (isFollowUpMode && !canFollowUp) {
      // Disable follow-up mode when not possible (no terminal executions)
      setIsFollowUpMode(false)
    } else if (!isFollowUpMode && canFollowUp) {
      // Re-enable follow-up mode when it becomes possible
      setIsFollowUpMode(true)
    }
  }, [isFollowUpMode, canFollowUp])

  // Reset ESC pressed flag when execution stops running
  useEffect(() => {
    if (!isExecutionRunning) {
      escPressedWhileRunningRef.current = false
    }
  }, [isExecutionRunning])

  // Enable auto-scroll when execution is running
  useEffect(() => {
    if (isExecutionRunning) {
      setShouldAutoScroll(true)
    }
  }, [isExecutionRunning])

  // Auto-scroll when executions update and auto-scroll is enabled
  useEffect(() => {
    if (!shouldAutoScroll || !isExecutionRunning) return

    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      scrollToBottom()
    }, 100)
  }, [executions, shouldAutoScroll, isExecutionRunning, scrollToBottom])

  // Watch for content changes in scroll container (for real-time execution updates)
  useEffect(() => {
    if (!shouldAutoScroll || !isExecutionRunning) return

    const container = scrollContainerRef.current
    if (!container) return

    let scrollTimeout: NodeJS.Timeout | null = null

    // Use MutationObserver to detect content changes
    const observer = new MutationObserver(() => {
      if (!shouldAutoScroll || !isExecutionRunning) return

      // Throttle scroll calls to avoid excessive scrolling
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }

      scrollTimeout = setTimeout(() => {
        scrollToBottom()
        scrollTimeout = null
      }, 100)
    })

    // Observe the container for changes to its descendants
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false,
    })

    return () => {
      observer.disconnect()
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }, [shouldAutoScroll, isExecutionRunning, scrollToBottom])

  // Save internal view mode preference to localStorage
  useEffect(() => {
    // Only save if we're using internal view mode (not externally controlled)
    if (!externalViewMode) {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify(internalViewMode))
    }
  }, [internalViewMode, externalViewMode])

  // Save description collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(DESCRIPTION_COLLAPSED_STORAGE_KEY, JSON.stringify(isDescriptionCollapsed))
  }, [isDescriptionCollapsed])

  // Update form values when issue changes
  useEffect(() => {
    setTitle(issue.title)
    setContent(issue.content || '')
    setStatus(issue.status)
    setPriority(issue.priority)
    setHasChanges(false)
  }, [issue])

  // Fetch relationships when issue changes
  useEffect(() => {
    let isMounted = true

    const fetchRelationships = async () => {
      if (!isMounted) return
      setIsLoadingRelationships(true)
      try {
        const data = await relationshipsApi.getForEntity(issue.id, 'issue')

        // Handle both array and grouped object responses
        let relationshipsArray: Relationship[] = []
        if (Array.isArray(data)) {
          relationshipsArray = data
        } else if (data && typeof data === 'object' && 'outgoing' in data && 'incoming' in data) {
          // Backend returned grouped object, flatten it
          const grouped = data as { outgoing: Relationship[]; incoming: Relationship[] }
          relationshipsArray = [...(grouped.outgoing || []), ...(grouped.incoming || [])]
        }

        if (isMounted) {
          setRelationships(relationshipsArray)
        }
      } catch (error) {
        console.error('Failed to fetch relationships:', error)
        if (isMounted) {
          setRelationships([])
        }
      } finally {
        if (isMounted) {
          setIsLoadingRelationships(false)
        }
      }
    }

    fetchRelationships()

    return () => {
      isMounted = false
    }
  }, [issue.id])

  // Fetch executions when issue changes and listen for WebSocket updates
  useEffect(() => {
    let isMounted = true

    const fetchExecutions = async () => {
      if (!isMounted) return
      try {
        const data = await executionsApi.list(issue.id)
        if (isMounted) {
          setExecutions(data)
          executionsLoadedRef.current = true
        }
      } catch (error) {
        console.error('Failed to fetch executions:', error)
        if (isMounted) {
          setExecutions([])
          executionsLoadedRef.current = true
        }
      }
    }

    // Initial fetch
    fetchExecutions()

    // Subscribe to WebSocket updates for execution events
    // Execution updates are broadcast to issue subscribers (dual broadcast)
    const handlerId = `issue-panel-executions-${issue.id}`
    const handleMessage = (message: WebSocketMessage) => {
      if (
        message.type === 'execution_created' ||
        message.type === 'execution_updated' ||
        message.type === 'execution_status_changed' ||
        message.type === 'execution_deleted'
      ) {
        // Re-fetch executions when execution events occur
        fetchExecutions()
      }
    }

    // Subscribe to issue updates
    subscribe('issue', issue.id)
    addMessageHandler(handlerId, handleMessage)

    return () => {
      isMounted = false
      removeMessageHandler(handlerId)
      unsubscribe('issue', issue.id)
    }
  }, [issue.id, subscribe, unsubscribe, addMessageHandler, removeMessageHandler])

  // Scroll to activity section when a new execution is created
  useEffect(() => {
    if (shouldScrollToActivityRef.current && activityBottomRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        // Scroll to bottom when a new execution is created
        activityBottomRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        })
        shouldScrollToActivityRef.current = false
      })
    }
  }, [executions])

  // Auto-collapse description and scroll to activity when issue has activity
  useEffect(() => {
    // Only run once per issue (wait for executions to load)
    if (hasInitializedForIssueRef.current === issue.id) return

    // Wait for executions to load before making the initial decision
    if (!executionsLoadedRef.current) return

    const hasActivity = executions.length > 0 || feedback.length > 0

    // Mark as initialized for this issue
    hasInitializedForIssueRef.current = issue.id

    if (hasActivity) {
      // Collapse the description
      setIsDescriptionCollapsed(true)

      // Determine the last activity item type
      const allActivities = [
        ...executions.map((e) => ({
          ...e,
          itemType: 'execution' as const,
          created_at: e.created_at,
        })),
        ...feedback.map((f) => ({ ...f, itemType: 'feedback' as const, created_at: f.created_at })),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const lastActivity = allActivities[allActivities.length - 1]
      const isLastItemExecution = lastActivity?.itemType === 'execution'

      // Scroll to the most recent activity after a brief delay to let the collapse happen
      requestAnimationFrame(() => {
        if (isLastItemExecution && activityBottomRef.current) {
          // If last item is an execution, scroll to bottom
          activityBottomRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
          })
        } else if (lastFeedbackRef.current) {
          // If last item is feedback, scroll to the last feedback item
          lastFeedbackRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        } else if (activitySectionRef.current) {
          // Fallback: scroll to the start of the activity section
          activitySectionRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        }
      })
    } else {
      // No activity - expand the description
      setIsDescriptionCollapsed(false)
    }
  }, [issue.id, executions, feedback])

  // Handle click outside to close panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!panelRef.current || !onClose) return

      const target = event.target as Node
      const clickedElement = target as HTMLElement

      // Don't close panel if agent panel Select was open (it's being dismissed)
      if (isAgentPanelSelectOpenRef.current) {
        // Reset the ref after a short delay
        setTimeout(() => {
          isAgentPanelSelectOpenRef.current = false
        }, 100)
        return
      }

      // Don't close if clicking on an issue card (to prevent flicker when switching issues)
      const issueCard = clickedElement.closest('[data-issue-id]')
      if (issueCard) return

      // Don't close if clicking on the resize handle
      const resizeHandle = clickedElement.closest('[data-panel-resize-handle-id]')
      if (resizeHandle) return

      // Also check for resize handle by class (backup check)
      if (clickedElement.classList?.contains('cursor-col-resize')) return

      // Check for portal elements (dialogs, dropdowns, etc.)
      // Radix UI (which shadcn/ui is built on) renders portals with specific attributes
      const isInDialog = clickedElement.closest('[role="dialog"]')
      const isInAlertDialog = clickedElement.closest('[role="alertdialog"]')
      const isInDropdown = clickedElement.closest('[role="listbox"]')
      const isInPopover = clickedElement.closest('[data-radix-popper-content-wrapper]')
      const isInSelectContent = clickedElement.closest('[data-radix-select-content]')
      const isInSelectViewport = clickedElement.closest('[data-radix-select-viewport]')
      const isOpenSelect = clickedElement.closest('[data-state="open"]')
      const openSelectTrigger = document.querySelector(
        '[data-radix-select-trigger][data-state="open"]'
      )
      const isDialogOverlay =
        clickedElement.hasAttribute('data-dialog-overlay') ||
        clickedElement.closest('[data-dialog-overlay]')

      // Check if any Select dropdown is currently open
      const isSelectDropdownOpen =
        isInDropdown ||
        isInSelectContent ||
        isInSelectViewport ||
        isOpenSelect ||
        !!openSelectTrigger

      // Don't close if clicking on TipTap/ProseMirror elements
      const isInProseMirror = clickedElement.closest('.ProseMirror')
      const isInTiptap = clickedElement.closest('.tiptap-editor')
      const isInTiptapMenu = clickedElement.closest('[data-tippy-root]')
      const isInBubbleMenu = clickedElement.closest('.tippy-box')

      // If clicking on portal elements (except Select when dropdown is open), don't close
      if (
        isInDialog ||
        isInAlertDialog ||
        isInPopover ||
        isDialogOverlay ||
        isInProseMirror ||
        isInTiptap ||
        isInTiptapMenu ||
        isInBubbleMenu
      ) {
        return
      }

      if (isSelectDropdownOpen) {
        return
      }
      const isInsidePanel = panelRef.current.contains(target)

      if (showAddRelationship) {
        const relationshipFormContainer = panelRef.current.querySelector(
          '[data-relationship-form-container]'
        )
        const isInsideFormContainer = relationshipFormContainer?.contains(target) || false
        if (isInsideFormContainer) {
          // Clicking inside form container - do nothing (let form and dropdowns handle themselves)
          return
        }
        if (isInsidePanel) {
          // Clicking inside panel but outside form container - close the form
          setShowAddRelationship(false)
          return
        } else {
          // Clicking outside panel - close the form first
          setShowAddRelationship(false)
          return
        }
      } else {
        // Relationship form is closed
        if (!isInsidePanel) {
          // Clicking outside panel - close the panel
          onClose()
        }
        // Clicking inside panel - do nothing
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, showAddRelationship])

  // Handle ESC key to close panel
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (!onClose) return
      if (event.key !== 'Escape') return

      // Check if ESC originated from inside a dialog/modal by examining the event path
      // This handles cases where focus is inside the dialog
      const path = event.composedPath()
      const isFromDialog = path.some(
        (el) =>
          el instanceof Element &&
          (el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog')
      )

      if (isFromDialog) return

      // Also check if any dialog/modal is currently open in the document
      // This handles cases where focus is outside the dialog but the dialog is open
      // (e.g., AgentSettingsDialog, CommitChangesDialog, CleanupWorktreeDialog)
      const openDialog = document.querySelector('[role="dialog"][data-state="open"]')
      const openAlertDialog = document.querySelector('[role="alertdialog"][data-state="open"]')

      if (openDialog || openAlertDialog) return

      // Check for locally tracked dialogs as a final fallback
      if (showDeleteDialog || showAddRelationship) return

      // If execution is running, first ESC press stops the execution
      if (isExecutionRunning && !escPressedWhileRunningRef.current) {
        escPressedWhileRunningRef.current = true
        if (latestExecution) {
          handleCancel(latestExecution.id)
        }
        return
      }

      // Second ESC press (or no execution running) closes the panel
      onClose()
    }

    document.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('keydown', handleEscKey)
    }
  }, [onClose, showDeleteDialog, showAddRelationship, isExecutionRunning, latestExecution])

  // Auto-save effect with debounce
  useEffect(() => {
    if (!hasChanges || !onUpdateRef.current) return

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Set new timer for auto-save after 1 second of inactivity
    autoSaveTimerRef.current = setTimeout(() => {
      onUpdateRef.current?.({
        title,
        content,
        status,
        priority,
      })
      setHasChanges(false)
    }, 1000)

    // Cleanup timer on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [title, content, status, priority, hasChanges])

  // Save pending changes on unmount
  useEffect(() => {
    return () => {
      // On unmount, if there are unsaved changes, save them immediately
      const { hasChanges, title, content, status, priority } = latestValuesRef.current
      if (hasChanges && onUpdateRef.current) {
        onUpdateRef.current({
          title,
          content,
          status,
          priority,
        })
      }
    }
  }, [])

  // Auto-resize textarea to fit content in markdown mode
  useEffect(() => {
    if (viewMode === 'markdown' && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [content, viewMode])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    setHasChanges(true)
  }

  const handleContentChange = (value: string) => {
    setContent(value)
    setHasChanges(true)
  }

  const handleStatusChange = (value: IssueStatus) => {
    setStatus(value)
    setHasChanges(true)
  }

  const handlePriorityChange = (value: number) => {
    setPriority(value)
    setHasChanges(true)
  }

  const handleDelete = () => {
    onDelete?.()
    setShowDeleteDialog(false)
  }

  const handleCreateRelationship = async (
    toId: string,
    toType: EntityType,
    relationshipType: RelationshipType
  ) => {
    try {
      const data = await createRelationshipAsync({
        from_id: issue.id,
        from_type: 'issue',
        to_id: toId,
        to_type: toType,
        relationship_type: relationshipType,
      })
      setRelationships([...relationships, data])
      setShowAddRelationship(false)
    } catch (error) {
      console.error('Failed to create relationship:', error)
    }
  }

  const handleDeleteRelationship = async (relationship: Relationship) => {
    try {
      await deleteRelationshipAsync({
        from_id: relationship.from_id,
        from_type: relationship.from_type,
        to_id: relationship.to_id,
        to_type: relationship.to_type,
        relationship_type: relationship.relationship_type,
      })
      setRelationships(
        relationships.filter(
          (r) =>
            !(
              r.from_id === relationship.from_id &&
              r.to_id === relationship.to_id &&
              r.relationship_type === relationship.relationship_type
            )
        )
      )
    } catch (error) {
      console.error('Failed to delete relationship:', error)
    }
  }

  const handleStartExecution = async (
    config: ExecutionConfig,
    prompt: string,
    agentType?: string,
    forceNew?: boolean
  ) => {
    const shouldFollowUp = isFollowUpMode && latestExecution && !forceNew

    try {
      // Set flag to scroll to activity section when execution appears
      shouldScrollToActivityRef.current = true

      if (shouldFollowUp) {
        // Follow-up path: create follow-up from latest execution
        await executionsApi.createFollowUp(latestExecution.id, {
          feedback: prompt,
        })
      } else {
        // New conversation path: create fresh execution
        await executionsApi.create(issue.id, {
          config,
          prompt,
          agentType,
        })
      }
      // Execution will appear in activity timeline via WebSocket
      // Scroll will happen when executions state updates
    } catch (error) {
      console.error('Failed to create execution:', error)
      shouldScrollToActivityRef.current = false
      toast.error(shouldFollowUp ? 'Failed to create follow-up' : 'Failed to start execution')
    }
  }

  const handleCancel = async (executionId: string) => {
    setCancelling(true)
    try {
      await executionsApi.cancel(executionId)
      // Execution status will update via WebSocket
      toast.success('Execution cancelled')
    } catch (error) {
      console.error('Failed to cancel execution:', error)
      toast.error('Failed to cancel execution')
    } finally {
      setCancelling(false)
    }
  }

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(issue.id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
      toast.success('ID copied to clipboard', {
        duration: 2000,
      })
    } catch (error) {
      console.error('Failed to copy ID:', error)
      toast.error('Failed to copy ID')
    }
  }

  /**
   * Parses execution config JSON string into ExecutionConfig object.
   */
  const parseExecutionConfig = (execution: Execution | null): ExecutionConfig | undefined => {
    if (!execution?.config) return undefined
    try {
      return JSON.parse(execution.config)
    } catch (error) {
      console.warn('Failed to parse execution config:', error)
      return undefined
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col" ref={panelRef}>
        {/* Top Navigation Bar */}
        {!hideTopControls && (
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-4">
              {onClose && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onClose}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Back"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Close (ESC)</TooltipContent>
                </Tooltip>
              )}
              {showOpenDetail && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(`/issues/${issue.id}`)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Open in full page"
                    >
                      <ExpandIcon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Open in full page</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-4">
              {/* View mode toggle - shown inline in panel */}
              {showViewToggleInline && (
                <div className="mr-4 flex gap-1 rounded-md border border-border bg-muted/30 p-1">
                  <Button
                    variant={viewMode === 'formatted' ? 'outline' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewModeChange('formatted')}
                    className={`h-7 rounded-sm ${viewMode === 'formatted' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Formatted
                  </Button>
                  <Button
                    variant={viewMode === 'markdown' ? 'outline' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewModeChange('markdown')}
                    className={`h-7 rounded-sm ${viewMode === 'markdown' ? 'shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    <Code2 className="mr-2 h-4 w-4" />
                    Markdown
                  </Button>
                </div>
              )}
              {(onArchive || onUnarchive) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() =>
                        issue.archived ? onUnarchive?.(issue.id) : onArchive?.(issue.id)
                      }
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={issue.archived ? 'Unarchive' : 'Archive'}
                      disabled={isUpdating}
                    >
                      {issue.archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{issue.archived ? 'Unarchive' : 'Archive'}</TooltipContent>
                </Tooltip>
              )}
              {onDelete && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete"
                      disabled={isUpdating || isDeleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete issue</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div
          ref={scrollContainerRef}
          className={`w-full flex-1 overflow-y-auto ${hideTopControls ? 'py-4' : 'py-3'}`}
          onScroll={handleScroll}
        >
          <div className="mx-auto w-full max-w-7xl space-y-4 px-6">
            {/* Issue ID and Title */}
            <div className="space-y-2 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="group relative flex items-center gap-1">
                    <Badge variant="issue" className="font-mono">
                      {issue.id}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyId}
                          className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {isCopied ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isCopied ? 'Copied!' : 'Copy ID to Clipboard'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {issue.parent_id && (
                    <>
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Parent: </span>
                      <EntityBadge
                        entityId={issue.parent_id}
                        entityType="issue"
                        showTitle
                      />
                    </>
                  )}
                </div>
                {onUpdate && (
                  <div className="text-xs italic text-muted-foreground">
                    {isUpdating
                      ? 'Saving...'
                      : hasChanges
                        ? 'Unsaved changes...'
                        : 'All changes saved'}
                  </div>
                )}
              </div>
              <Input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Issue title..."
                disabled={isUpdating}
                className="border-none bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
              />
            </div>

            {/* Metadata Row */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={status}
                  onValueChange={(value) => handleStatusChange(value as IssueStatus)}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-8 w-auto gap-3 rounded-md border-none bg-accent px-3 shadow-none hover:bg-accent/80">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="flex items-center gap-2">
                <Signal className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={String(priority)}
                  onValueChange={(value) => handlePriorityChange(parseInt(value))}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-8 w-auto gap-3 rounded-md border-none bg-accent px-3 shadow-none hover:bg-accent/80">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Timestamp */}
              <div className="ml-auto text-xs text-muted-foreground">
                {issue.closed_at
                  ? `Closed ${formatDistanceToNow(new Date(issue.closed_at.endsWith('Z') ? issue.closed_at : issue.closed_at + 'Z'), { addSuffix: true })}`
                  : `Updated ${formatDistanceToNow(new Date(issue.updated_at.endsWith('Z') ? issue.updated_at : issue.updated_at + 'Z'), { addSuffix: true })}`}
              </div>
            </div>

            {/* Relationships */}
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <h3 className="text-sm font-medium text-muted-foreground">Relationships</h3>
                  <Badge variant="secondary">{relationships.length}</Badge>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowAddRelationship(!showAddRelationship)}
                  className="h-6"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>

              {/* Add Relationship Form */}
              {showAddRelationship && (
                <div className="rounded-lg border p-4" data-relationship-form-container>
                  <RelationshipForm
                    fromId={issue.id}
                    fromType="issue"
                    onSubmit={handleCreateRelationship}
                    onCancel={() => setShowAddRelationship(false)}
                  />
                </div>
              )}

              {/* Relationship List */}
              {isLoadingRelationships ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Loading relationships...
                </div>
              ) : (
                <RelationshipList
                  relationships={relationships}
                  currentEntityId={issue.id}
                  currentEntityType="issue"
                  onDelete={handleDeleteRelationship}
                  showEmpty={false}
                  showGroupHeaders={false}
                />
              )}
            </div>

            {/* Content Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsDescriptionCollapsed(!isDescriptionCollapsed)}
                  className="h-6 gap-1 text-muted-foreground"
                >
                  {isDescriptionCollapsed ? (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Expand
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Collapse
                    </>
                  )}
                </Button>
              </div>
              <div className="relative">
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isDescriptionCollapsed ? 'max-h-[200px] cursor-pointer 2xl:max-h-[300px]' : ''
                  }`}
                  onClick={() => {
                    if (isDescriptionCollapsed) {
                      setIsDescriptionCollapsed(false)
                    }
                  }}
                >
                  <Card className="overflow-hidden rounded-md border">
                    {viewMode === 'formatted' ? (
                      <TiptapEditor
                        content={content}
                        editable={!isDescriptionCollapsed}
                        onChange={handleContentChange}
                        onCancel={() => {
                          setContent(issue.content || '')
                          setHasChanges(false)
                        }}
                        className="min-h-[200px]"
                        placeholder="Issue description..."
                      />
                    ) : (
                      <div className="p-4">
                        <textarea
                          ref={textareaRef}
                          value={content}
                          onChange={(e) => handleContentChange(e.target.value)}
                          placeholder="Issue description in markdown..."
                          className="w-full resize-none border-none bg-transparent font-mono text-sm leading-6 outline-none focus:ring-0"
                          spellCheck={false}
                          disabled={isDescriptionCollapsed}
                          style={{ minHeight: '200px' }}
                        />
                      </div>
                    )}
                  </Card>
                </div>
                {isDescriptionCollapsed && (
                  <>
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsDescriptionCollapsed(false)
                        }}
                        className="gap-1 text-muted-foreground shadow-sm"
                      >
                        <ChevronDown className="h-4 w-4" />
                        Expand
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Additional Metadata */}
            {issue.assignee && (
              <div className="border-t pt-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Assignee: </span>
                  <span>{issue.assignee}</span>
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            <div ref={activitySectionRef} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Activity</h3>
                {/* New conversation button - shown when there's at least one execution and it's complete */}
                {executions.length > 0 && canFollowUp && !forceNewExecution && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForceNewExecution(true)}
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New conversation
                  </Button>
                )}
              </div>
              <ActivityTimeline
                items={[
                  ...feedback.map((f) => ({ ...f, itemType: 'feedback' as const })),
                  // Only show parent-level executions (no parent_execution_id)
                  // Follow-up executions are displayed inline on the parent's execution page
                  ...executions
                    .filter((e) => !e.parent_execution_id)
                    .map((e) => ({ ...e, itemType: 'execution' as const })),
                ]}
                currentEntityId={issue.id}
                lastFeedbackRef={lastFeedbackRef}
              />
              {/* Scroll marker for bottom of activity */}
              <div ref={activityBottomRef} />
            </div>

            {/* Scroll FABs - shows when container is scrollable */}
            {isScrollable && (
              <>
                {/* Scroll to Top FAB */}
                <div className="fixed bottom-44 right-10 z-10">
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
                {/* Scroll to Bottom FAB */}
                <div className="fixed bottom-32 right-10 z-10">
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
              </>
            )}
          </div>
        </div>

        {/* Fixed Footer - Agent Configuration Panel */}
        <div
          className="border-t border-border bg-muted/30"
          onMouseDown={(e) => {
            // Prevent clicks inside the agent config panel from bubbling up and closing the panel
            e.stopPropagation()
          }}
        >
          <div className="mx-auto w-full max-w-7xl px-6">
            <AgentConfigPanel
              issueId={issue.id}
              onStart={handleStartExecution}
              disabled={issue.archived || isUpdating || isExecutionRunning}
              autoFocus={autoFocusAgentConfig}
              isFollowUp={isFollowUpMode && canFollowUp}
              isRunning={isExecutionRunning}
              onCancel={latestExecution ? () => handleCancel(latestExecution.id) : undefined}
              isCancelling={cancelling}
              currentExecution={latestExecution || undefined}
              lastExecution={
                latestExecution
                  ? {
                      id: latestExecution.id,
                      mode: latestExecution.mode || undefined,
                      model: latestExecution.model || undefined,
                      target_branch: latestExecution.target_branch,
                      agent_type: latestExecution.agent_type,
                      config: parseExecutionConfig(latestExecution),
                    }
                  : undefined
              }
              forceNewExecution={forceNewExecution}
              onForceNewToggle={setForceNewExecution}
              onSelectOpenChange={(open) => {
                // Clear any pending timeout
                if (selectCloseTimeoutRef.current) {
                  clearTimeout(selectCloseTimeoutRef.current)
                  selectCloseTimeoutRef.current = null
                }

                if (open) {
                  // Immediately set to true when opening
                  isAgentPanelSelectOpenRef.current = true
                } else {
                  // Keep ref as true for a bit longer so mousedown handler can see it
                  // This handles the case where Radix closes the Select before mousedown fires
                  selectCloseTimeoutRef.current = setTimeout(() => {
                    isAgentPanelSelectOpenRef.current = false
                    selectCloseTimeoutRef.current = null
                  }, 50)
                }
              }}
            />
          </div>
        </div>

        <DeleteIssueDialog
          issue={issue}
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      </div>
    </TooltipProvider>
  )
}

export default IssuePanel
