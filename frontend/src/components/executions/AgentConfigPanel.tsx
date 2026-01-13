import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Settings,
  ArrowDown,
  Loader2,
  Square,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextSearchTextarea } from '@/components/ui/context-search-textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { repositoryApi } from '@/lib/api'
import type { ExecutionConfig, ExecutionMode, Execution } from '@/types/execution'
import { VoiceInputButton } from '@/components/voice'
import { AgentSettingsDialog } from './AgentSettingsDialog'
import { CommitChangesDialog } from './CommitChangesDialog'
import { CleanupWorktreeDialog } from './CleanupWorktreeDialog'
import { SyncPreviewDialog } from './SyncPreviewDialog'
import { BranchSelector } from './BranchSelector'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAgents } from '@/hooks/useAgents'
import { useProject } from '@/hooks/useProject'
import { useAgentActions } from '@/hooks/useAgentActions'
import { useWorktrees } from '@/hooks/useWorktrees'
import { useVoiceConfig } from '@/hooks/useVoiceConfig'
import { useAgentCommands } from '@/hooks/useAgentCommands'
import type { CodexConfig } from './CodexConfigForm'
import type { CopilotConfig } from './CopilotConfigForm'
import type { GeminiConfig } from './GeminiConfigForm'
import type { OpencodeConfig } from './OpencodeConfigForm'

interface AgentConfigPanelProps {
  /**
   * Issue ID for context (optional for adhoc executions)
   */
  issueId?: string
  onStart: (config: ExecutionConfig, prompt: string, agentType?: string, forceNew?: boolean) => void
  disabled?: boolean
  onSelectOpenChange?: (isOpen: boolean) => void
  /**
   * Display variant:
   * - 'full': Show all configuration options (agent, mode, branch, settings)
   * - 'compact': Show only textarea and submit/cancel buttons inline
   */
  variant?: 'full' | 'compact'
  /**
   * Follow-up mode: locks config options and shows inherited values
   */
  isFollowUp?: boolean
  /**
   * Latest execution to reference.
   * - In follow-up mode: provides locked config values for continuation
   * - In new execution mode: used to default config to last execution's settings
   */
  lastExecution?: {
    id: string
    mode?: string
    model?: string
    target_branch?: string
    agent_type?: string
    config?: ExecutionConfig
  }
  /**
   * Placeholder text for the prompt input
   */
  promptPlaceholder?: string
  /**
   * Whether an execution is currently running
   */
  isRunning?: boolean
  /**
   * Handler to cancel the running execution
   */
  onCancel?: () => void
  /**
   * Whether a cancel operation is in progress
   */
  isCancelling?: boolean
  /**
   * Auto-focus the prompt textarea when the panel mounts or issue changes
   */
  autoFocus?: boolean
  /**
   * Whether to allow toggling between follow-up and new execution modes
   * When false, disables Ctrl+K shortcut and hides toggle UI hints
   * Defaults to true
   */
  allowModeToggle?: boolean
  /**
   * Callback to expose the force new execution toggle function
   * Allows external components to trigger mode switching
   */
  onForceNewToggle?: (forceNew: boolean) => void
  /**
   * Controlled value for forcing a new execution instead of following up
   * When true, creates a new execution even in follow-up mode
   */
  forceNewExecution?: boolean
  /**
   * Current execution to analyze for contextual actions
   * Used by useAgentActions hook to determine available actions
   */
  currentExecution?: Execution | null
  /**
   * Whether to disable contextual actions (Commit Changes, Squash & Merge, Cleanup Worktree)
   * When true, contextual action buttons will not be rendered
   * Defaults to false
   */
  disableContextualActions?: boolean
  /**
   * Whether the worktree has uncommitted changes
   * Required for showing the commit action
   */
  hasUncommittedChanges?: boolean
  /**
   * Number of commits the worktree branch is ahead of the target branch
   * If 0, the Merge Changes action will be hidden
   */
  commitsAhead?: number
  /**
   * Whether the worktree still exists on disk
   */
  worktreeExists?: boolean
  /**
   * Default prompt to pre-populate the textarea
   */
  defaultPrompt?: string
  /**
   * Available slash commands from the agent (for autocomplete)
   */
  availableCommands?: import('@/hooks/useSessionUpdateStream').AvailableCommand[]
}

// TODO: Move this somewhere more central.
// Map of default agent-specific configurations
// Note: For claude-code, dangerouslySkipPermissions is loaded from localStorage
// via getDefaultAgentConfig() to persist user preference
const DEFAULT_AGENT_CONFIGS: Record<string, any> = {
  'claude-code': {
    dangerouslySkipPermissions: false, // Will be overridden by getDefaultAgentConfig()
    restrictToWorkDir: true,
  },
  codex: {
    fullAuto: true,
    search: true,
    json: true,
  } as CodexConfig,
  cursor: {
    force: true,
    model: 'auto',
  },
  copilot: {
    allowAllTools: true,
    model: 'claude-sonnet-4.5',
  } as CopilotConfig,
  gemini: {
    sandbox: false,
    dangerouslySkipPermissions: false,
  } as GeminiConfig,
  opencode: {
    dangerouslySkipPermissions: false,
  } as OpencodeConfig,
}

// localStorage keys for persisting config
const LAST_EXECUTION_CONFIG_KEY = 'sudocode:lastExecutionConfig'
const LAST_AGENT_TYPE_KEY = 'sudocode:lastAgentType'
const SKIP_PERMISSIONS_KEY = 'sudocode:skipPermissions'

/**
 * Load skip permissions setting from localStorage
 */
function loadSkipPermissionsSetting(): boolean {
  try {
    const saved = localStorage.getItem(SKIP_PERMISSIONS_KEY)
    return saved === 'true'
  } catch {
    return false
  }
}

/**
 * Save skip permissions setting to localStorage
 */
function saveSkipPermissionsSetting(value: boolean): void {
  try {
    localStorage.setItem(SKIP_PERMISSIONS_KEY, String(value))
  } catch (error) {
    console.warn('Failed to save skip permissions setting:', error)
  }
}

/**
 * Get default agent config, merging in any persisted settings from localStorage
 */
function getDefaultAgentConfig(agentType: string): any {
  const baseConfig = DEFAULT_AGENT_CONFIGS[agentType] ?? {}

  // For claude-code, merge in the persisted skip permissions setting
  if (agentType === 'claude-code') {
    return {
      ...baseConfig,
      dangerouslySkipPermissions: loadSkipPermissionsSetting(),
    }
  }

  return baseConfig
}

/**
 * Get verification status icon and color for an agent
 */
function getAgentVerificationStatus(agent: any) {
  // Not implemented agents
  if (!agent.implemented) {
    return {
      icon: AlertCircle,
      color: 'text-muted-foreground',
      tooltip: 'Coming soon',
    }
  }

  // Implemented but verification not yet run (still loading)
  if (agent.available === undefined) {
    return {
      icon: Loader2,
      color: 'text-muted-foreground',
      tooltip: 'Checking availability...',
      spin: true,
    }
  }

  // Available
  if (agent.available) {
    return {
      icon: CheckCircle2,
      color: 'text-green-600',
      tooltip: agent.executablePath ? `Available at ${agent.executablePath}` : 'Available',
    }
  }

  // Not available
  return {
    icon: XCircle,
    color: 'text-destructive',
    tooltip: agent.verificationError || 'Warning: Agent CLI not found in PATH',
  }
}

/**
 * Sanitizes a config object by removing deprecated top-level fields.
 * These fields have been moved to agentConfig and should not persist at top-level.
 */
function sanitizeConfig(config: any): any {
  if (!config || typeof config !== 'object') return config

  // Remove deprecated top-level fields that have moved to agentConfig
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dangerouslySkipPermissions, ...rest } = config

  return rest
}

/**
 * Validates that a config object has the expected shape and valid values.
 * Returns true if config is safe to use, false otherwise.
 */
function isValidExecutionConfig(config: any): config is ExecutionConfig {
  if (!config || typeof config !== 'object') {
    return false
  }

  // Validate mode if present
  if (config.mode !== undefined && config.mode !== 'worktree' && config.mode !== 'local') {
    return false
  }

  // Validate cleanupMode if present
  if (
    config.cleanupMode !== undefined &&
    config.cleanupMode !== 'auto' &&
    config.cleanupMode !== 'manual' &&
    config.cleanupMode !== 'never'
  ) {
    return false
  }

  // Validate numeric fields if present
  if (
    config.maxTokens !== undefined &&
    (typeof config.maxTokens !== 'number' || config.maxTokens < 0)
  ) {
    return false
  }
  if (
    config.temperature !== undefined &&
    (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2)
  ) {
    return false
  }
  if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout < 0)) {
    return false
  }
  if (
    config.checkpointInterval !== undefined &&
    (typeof config.checkpointInterval !== 'number' || config.checkpointInterval < 0)
  ) {
    return false
  }

  // Validate boolean fields if present
  if (
    config.continueOnStepFailure !== undefined &&
    typeof config.continueOnStepFailure !== 'boolean'
  ) {
    return false
  }
  if (config.captureFileChanges !== undefined && typeof config.captureFileChanges !== 'boolean') {
    return false
  }
  if (config.captureToolCalls !== undefined && typeof config.captureToolCalls !== 'boolean') {
    return false
  }

  return true
}

export function AgentConfigPanel({
  issueId,
  onStart,
  disabled = false,
  onSelectOpenChange,
  variant = 'full',
  isFollowUp = false,
  lastExecution,
  promptPlaceholder,
  isRunning = false,
  onCancel,
  isCancelling = false,
  autoFocus = false,
  allowModeToggle = true,
  onForceNewToggle,
  forceNewExecution: controlledForceNewExecution,
  currentExecution,
  disableContextualActions = true,
  hasUncommittedChanges,
  commitsAhead,
  worktreeExists = true,
  defaultPrompt,
  availableCommands = [],
}: AgentConfigPanelProps) {
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState(defaultPrompt || '')
  const [internalForceNewExecution, setInternalForceNewExecution] = useState(false)
  const [availableBranches, setAvailableBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>('')

  // Use controlled value if provided, otherwise use internal state
  const forceNewExecution =
    controlledForceNewExecution !== undefined
      ? controlledForceNewExecution
      : internalForceNewExecution
  const setForceNewExecution = (value: boolean) => {
    if (controlledForceNewExecution === undefined) {
      setInternalForceNewExecution(value)
    }
    onForceNewToggle?.(value)
  }

  const [config, setConfig] = useState<ExecutionConfig>(() => {
    // Try to use last execution config (works for both follow-up and new execution modes)
    if (lastExecution?.config) {
      // Sanitize to remove deprecated top-level fields
      const sanitizedConfig = sanitizeConfig(lastExecution.config)
      const executionConfig = {
        ...sanitizedConfig,
        mode: (lastExecution.mode as ExecutionMode) || 'worktree',
        baseBranch: lastExecution.target_branch,
      }
      if (isValidExecutionConfig(executionConfig)) {
        return executionConfig
      }
      console.warn('Last execution config is invalid, trying localStorage')
    }

    // Base defaults
    const defaults: ExecutionConfig = {
      mode: 'worktree',
      cleanupMode: 'manual',
    }

    // Try to load from localStorage
    let savedConfig: ExecutionConfig | null = null
    try {
      const savedConfigStr = localStorage.getItem(LAST_EXECUTION_CONFIG_KEY)
      if (savedConfigStr) {
        const parsed = JSON.parse(savedConfigStr)
        // Sanitize to remove deprecated top-level fields
        const sanitized = sanitizeConfig(parsed)
        if (isValidExecutionConfig(sanitized)) {
          savedConfig = sanitized
        } else {
          console.warn('Saved config is invalid, clearing localStorage')
          localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
        }
      }
    } catch (error) {
      console.warn('Failed to load saved execution config:', error)
      try {
        localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    // Merge: defaults <- localStorage <- lastExecution overrides
    // This preserves localStorage settings while respecting explicit overrides
    // Only apply mode override if it's a valid execution mode
    const validModes: ExecutionMode[] = ['worktree', 'local']
    const modeOverride =
      lastExecution?.mode && validModes.includes(lastExecution.mode as ExecutionMode)
        ? { mode: lastExecution.mode as ExecutionMode }
        : {}

    return {
      ...defaults,
      ...(savedConfig || {}),
      ...modeOverride,
    }
  })
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [selectedAgentType, setSelectedAgentType] = useState<string>(() => {
    // Try to use last execution's agent type
    if (lastExecution?.agent_type) {
      return lastExecution.agent_type
    }

    // Otherwise, try localStorage
    try {
      const savedAgentType = localStorage.getItem(LAST_AGENT_TYPE_KEY)
      if (savedAgentType) {
        return savedAgentType
      }
    } catch (error) {
      console.warn('Failed to load saved agent type:', error)
    }

    // Final fallback
    return 'claude-code'
  })
  const [isHoveringButton, setIsHoveringButton] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch available agents
  const { agents, loading: agentsLoading } = useAgents()

  // Agent command discovery (for slash command autocomplete)
  const {
    getCommands: getCachedCommands,
    discoverCommands,
    refreshCommands,
    updateCache: updateCommandsCache,
    isDiscovering: isDiscoveringCommands,
  } = useAgentCommands()

  // Merge WebSocket commands (prop) with discovered commands (cache)
  // WebSocket commands take priority as they are more recent
  const effectiveCommands = useMemo(() => {
    if (availableCommands.length > 0) {
      // WebSocket provided commands - update cache and use them
      updateCommandsCache(selectedAgentType, availableCommands)
      return availableCommands
    }
    return getCachedCommands(selectedAgentType) ?? []
  }, [availableCommands, selectedAgentType, getCachedCommands, updateCommandsCache])

  // Handler to trigger command discovery when "/" is typed
  const handleDiscoverCommands = useCallback(() => {
    discoverCommands(selectedAgentType)
  }, [discoverCommands, selectedAgentType])

  // Handler to refresh commands (bypass cache)
  const handleRefreshCommands = useCallback(() => {
    refreshCommands(selectedAgentType)
  }, [refreshCommands, selectedAgentType])

  // Get contextual actions based on execution state
  // Actions are handled internally by the hook
  const {
    actions,
    hasActions,
    isCommitDialogOpen,
    setIsCommitDialogOpen,
    isCleanupDialogOpen,
    setIsCleanupDialogOpen,
    isCommitting,
    isCleaning,
    handleCommitChanges,
    handleCleanupWorktree,
    // Sync dialog state
    syncPreview,
    isSyncPreviewOpen,
    setIsSyncPreviewOpen,
    performSync,
    isPreviewing,
  } = useAgentActions({
    execution: currentExecution,
    issueId,
    disabled: disabled || isRunning,
    hasUncommittedChanges,
    commitsAhead,
    worktreeExists,
  })

  // Get current project ID for context search
  const { currentProjectId } = useProject()

  // Fetch available worktrees for worktree-based creation
  const { worktrees } = useWorktrees()

  // Get voice configuration to conditionally show voice input
  const { voiceEnabled } = useVoiceConfig()

  // Check if the current execution's worktree has been cleaned up
  // If the execution was a worktree execution but the worktree no longer exists,
  // we can't follow up and must start a new execution
  const isWorktreeCleaned = useMemo(() => {
    // Only relevant for follow-up mode with worktree executions
    if (!isFollowUp) return false
    if (!currentExecution?.worktree_path) return false
    if (currentExecution.mode !== 'worktree') return false

    // Check if the worktree still exists
    const worktreeExists = worktrees.some(
      (wt) => wt.id === currentExecution.id || wt.worktree_path === currentExecution.worktree_path
    )

    return !worktreeExists
  }, [isFollowUp, currentExecution, worktrees])

  // Force new execution when worktree is cleaned up
  useEffect(() => {
    if (isWorktreeCleaned && !forceNewExecution) {
      setForceNewExecution(true)
    }
  }, [isWorktreeCleaned, forceNewExecution, setForceNewExecution])

  // Update prompt when defaultPrompt changes
  useEffect(() => {
    if (defaultPrompt !== undefined) {
      setPrompt(defaultPrompt)
    }
  }, [defaultPrompt])

  // Reset config when issue or lastExecution changes (issue switching)
  useEffect(() => {
    // Skip for follow-ups - they use parent execution
    if (isFollowUp) return

    // Helper to load config with priority
    const loadConfigForIssue = (): ExecutionConfig => {
      // Try last execution config first
      if (lastExecution?.config) {
        // Sanitize to remove deprecated top-level fields
        const sanitizedConfig = sanitizeConfig(lastExecution.config)
        const executionConfig = {
          ...sanitizedConfig,
          mode: (lastExecution.mode as ExecutionMode) || 'worktree',
          baseBranch: lastExecution.target_branch,
        }
        if (isValidExecutionConfig(executionConfig)) {
          return executionConfig
        }
        console.warn('Last execution config is invalid, trying localStorage')
      }

      // Base defaults
      const defaults: ExecutionConfig = {
        mode: 'worktree',
        cleanupMode: 'manual',
      }

      // Try to load from localStorage
      let savedConfig: ExecutionConfig | null = null
      try {
        const savedConfigStr = localStorage.getItem(LAST_EXECUTION_CONFIG_KEY)
        if (savedConfigStr) {
          const parsed = JSON.parse(savedConfigStr)
          // Sanitize to remove deprecated top-level fields
          const sanitized = sanitizeConfig(parsed)
          if (isValidExecutionConfig(sanitized)) {
            savedConfig = sanitized
          } else {
            console.warn('Saved config is invalid, clearing localStorage')
            localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
          }
        }
      } catch (error) {
        console.warn('Failed to load saved execution config:', error)
        try {
          localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Merge: defaults <- localStorage <- lastExecution overrides
      // Only apply mode override if it's a valid execution mode
      const validModes: ExecutionMode[] = ['worktree', 'local']
      const modeOverride =
        lastExecution?.mode && validModes.includes(lastExecution.mode as ExecutionMode)
          ? { mode: lastExecution.mode as ExecutionMode }
          : {}

      return {
        ...defaults,
        ...(savedConfig || {}),
        ...modeOverride,
      }
    }

    setConfig(loadConfigForIssue())
  }, [issueId, lastExecution?.id, lastExecution?.mode, isFollowUp])

  // Reset agent type when issue or lastExecution changes
  useEffect(() => {
    if (isFollowUp) return

    const loadAgentTypeForIssue = (): string => {
      // Try last execution's agent type first
      if (lastExecution?.agent_type) {
        return lastExecution.agent_type
      }

      // Otherwise, try localStorage
      try {
        const savedAgentType = localStorage.getItem(LAST_AGENT_TYPE_KEY)
        if (savedAgentType) {
          return savedAgentType
        }
      } catch (error) {
        console.warn('Failed to load saved agent type:', error)
      }

      // Final fallback
      return 'claude-code'
    }

    setSelectedAgentType(loadAgentTypeForIssue())
  }, [issueId, lastExecution?.id, isFollowUp])

  // Function to refresh branch information
  const refreshBranches = async () => {
    try {
      const branchInfo = await repositoryApi.getBranches()

      // Store available branches and current branch
      setAvailableBranches(branchInfo.branches)
      setCurrentBranch(branchInfo.current)

      // Validate and set baseBranch
      // Use current branch if stored baseBranch is not valid for this project
      setConfig((prev) => {
        const storedBranch = prev.baseBranch
        const isStoredBranchValid = storedBranch && branchInfo.branches.includes(storedBranch)

        if (isStoredBranchValid) {
          // Keep the stored branch - it's valid for this project
          return prev
        }

        // Fall back to current branch
        const fallbackBranch = branchInfo.current
        if (fallbackBranch) {
          return {
            ...prev,
            baseBranch: fallbackBranch,
          }
        }
        return prev
      })
    } catch (error) {
      console.error('Failed to get repository info:', error)
    }
  }

  // Load branches and repository info (skip for follow-ups and compact mode)
  useEffect(() => {
    // Skip for follow-ups - we use parent execution config
    // Skip for compact mode - we don't show config options
    if (isFollowUp || variant === 'compact') {
      setLoading(false) // Ensure loading is false
      return
    }

    let isMounted = true

    const loadRepoInfo = async () => {
      if (!isMounted) return
      setLoading(true)
      try {
        await refreshBranches()
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadRepoInfo()

    return () => {
      isMounted = false
    }
  }, [issueId, isFollowUp, variant])

  // Validate reuseWorktreePath when worktrees change
  // If the stored worktree no longer exists, clear it and fall back to current branch
  useEffect(() => {
    if (isFollowUp || variant === 'compact') return
    if (!config.reuseWorktreePath) return

    // Check if the stored worktree still exists
    const worktreeExists = worktrees.some((w) => w.worktree_path === config.reuseWorktreePath)
    if (!worktreeExists) {
      // Worktree no longer exists, clear it and fall back to current branch
      setConfig((prev) => ({
        ...prev,
        reuseWorktreePath: undefined,
        baseBranch: currentBranch || prev.baseBranch,
      }))
    }
  }, [worktrees, config.reuseWorktreePath, isFollowUp, variant, currentBranch])

  // Auto-focus textarea when panel opens or issue changes
  useEffect(() => {
    if (autoFocus && textareaRef.current && !loading) {
      // Small delay to ensure the component is fully rendered
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [autoFocus, issueId, loading])

  const updateConfig = (updates: Partial<ExecutionConfig>) => {
    setConfig({ ...config, ...updates })
  }

  // When agent type changes, reset agentConfig to defaults for the new agent
  // This ensures we don't carry over config from a different agent type
  const prevAgentTypeRef = useRef<string | undefined>(selectedAgentType)
  useEffect(() => {
    const prevAgentType = prevAgentTypeRef.current
    prevAgentTypeRef.current = selectedAgentType

    if (selectedAgentType) {
      // Always reset agentConfig when agent type changes
      const agentChanged = prevAgentType !== undefined && prevAgentType !== selectedAgentType
      const needsInit = !config.agentConfig || agentChanged

      if (needsInit) {
        // Use getDefaultAgentConfig to include localStorage-persisted settings
        const defaultAgentConfig = getDefaultAgentConfig(selectedAgentType)
        updateConfig({ agentConfig: defaultAgentConfig })
      }
    }
  }, [selectedAgentType])

  // Persist skip permissions setting to localStorage whenever it changes
  useEffect(() => {
    if (selectedAgentType === 'claude-code' && config.agentConfig) {
      const skipPerms = config.agentConfig.dangerouslySkipPermissions ?? false
      saveSkipPermissionsSetting(skipPerms)
    }
  }, [selectedAgentType, config.agentConfig?.dangerouslySkipPermissions])

  // Sync agentConfig from lastExecution when it changes (handles skip-all-permissions)
  // This is needed because the main config reset useEffect skips in follow-up mode
  useEffect(() => {
    if (!lastExecution?.config) return

    // Parse config if it's a string
    const parsedConfig =
      typeof lastExecution.config === 'string'
        ? JSON.parse(lastExecution.config)
        : lastExecution.config

    // Check if lastExecution has agentConfig with dangerouslySkipPermissions
    const lastAgentConfig = parsedConfig?.agentConfig
    if (lastAgentConfig?.dangerouslySkipPermissions !== undefined) {
      const lastSkipPerms = lastAgentConfig.dangerouslySkipPermissions

      // Only update if different from current config
      if (config.agentConfig?.dangerouslySkipPermissions !== lastSkipPerms) {
        updateConfig({
          agentConfig: {
            ...config.agentConfig,
            dangerouslySkipPermissions: lastSkipPerms,
          },
        })
      }
    }
  }, [lastExecution?.config, lastExecution?.id])

  const handleStart = () => {
    // Save config and agent type to localStorage for future executions
    // Only save if config is valid to prevent persisting corrupted data
    // Sanitize before saving to ensure deprecated fields are not persisted
    const sanitizedConfig = sanitizeConfig(config)
    if (isValidExecutionConfig(sanitizedConfig)) {
      try {
        localStorage.setItem(LAST_EXECUTION_CONFIG_KEY, JSON.stringify(sanitizedConfig))
        localStorage.setItem(LAST_AGENT_TYPE_KEY, selectedAgentType)
      } catch (error) {
        console.warn('Failed to save execution config to localStorage:', error)
      }
    } else {
      console.warn('Config is invalid, not saving to localStorage')
    }

    // Use default prompt for first messages when no prompt is provided
    // For adhoc executions (no issueId), prompt is always required
    const finalPrompt =
      prompt.trim() || (!isFollowUp && issueId ? `Implement issue [[${issueId}]]` : '')

    // For local mode, don't send baseBranch - let the server use the current branch
    const finalConfig = config.mode === 'local' ? { ...config, baseBranch: undefined } : config

    onStart(finalConfig, finalPrompt, selectedAgentType, forceNewExecution)
    setPrompt('') // Clear the prompt after submission
    setForceNewExecution(false) // Reset the flag after submission
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Toggle between new execution and follow-up mode with Ctrl+K (only if allowed)
    // Don't allow toggling back to follow-up if worktree was cleaned up
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (isFollowUp && allowModeToggle && !isWorktreeCleaned) {
        const newValue = !forceNewExecution
        setForceNewExecution(newValue)
        onForceNewToggle?.(newValue)
      }
      return
    }

    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canStart) {
        handleStart()
      }
    }
    // Shift+Enter creates newline (default behavior, no need to handle)
  }

  // Voice input state for live transcription
  const voiceBasePromptRef = useRef<string>('')
  const currentPromptRef = useRef<string>(prompt)
  const isRecordingRef = useRef<boolean>(false)

  // Keep prompt ref in sync (only when not recording)
  useEffect(() => {
    if (!isRecordingRef.current) {
      currentPromptRef.current = prompt
    }
  }, [prompt])

  // Called when recording starts - save the current prompt as base
  const handleVoiceRecordingStart = useCallback(() => {
    isRecordingRef.current = true
    voiceBasePromptRef.current = currentPromptRef.current
  }, [])

  // Called for interim/cumulative results - update prompt live
  // Note: useVoiceInput now sends cumulative transcript (all finals + current interim)
  const handleVoiceInterimResult = useCallback((cumulativeText: string) => {
    const base = voiceBasePromptRef.current
    const separator = base && !base.endsWith(' ') && !base.endsWith('\n') ? ' ' : ''
    const newPrompt = base + separator + cumulativeText
    setPrompt(newPrompt)
    // Keep currentPromptRef in sync so it has the latest value when recording stops
    currentPromptRef.current = newPrompt
  }, [])

  // Called when recording stops - just mark as done
  // The prompt is already up-to-date from interim results, so we don't need to update it
  const handleVoiceTranscription = useCallback((_text: string) => {
    isRecordingRef.current = false
  }, [])

  // Allow empty prompts for first messages (not follow-ups) when there's an issue
  // For follow-ups or adhoc executions (no issueId), require a prompt
  // Note: We don't block based on agent availability - we just show warnings
  // Users can still attempt to run unavailable agents (will fail at execution time)
  const canStart = !loading && (prompt.trim().length > 0 || (!isFollowUp && !!issueId)) && !disabled

  // Compact mode: inline textarea with voice input and submit/cancel button
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ContextSearchTextarea
            ref={textareaRef}
            value={prompt}
            onChange={setPrompt}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning
                ? 'Execution is running (esc to cancel)'
                : promptPlaceholder || 'Send feedback to the agent... (@ for context, / for commands)'
            }
            disabled={loading || disabled}
            className="max-h-[150px] min-h-0 resize-none overflow-y-auto border-none bg-muted/80 py-2 text-sm shadow-none transition-[height] duration-100 focus-visible:ring-0 focus-visible:ring-offset-0"
            projectId={currentProjectId || ''}
            autoResize
            maxHeight={150}
            availableCommands={effectiveCommands}
            onDiscoverCommands={handleDiscoverCommands}
            isLoadingCommands={isDiscoveringCommands}
            onRefreshCommands={handleRefreshCommands}
          />
        </div>
        <TooltipProvider>
          {/* Voice Input Button - only shown when voice is enabled */}
          {voiceEnabled && (
            <VoiceInputButton
              onTranscription={handleVoiceTranscription}
              onRecordingStart={handleVoiceRecordingStart}
              onInterimResult={handleVoiceInterimResult}
              disabled={loading || disabled || isRunning}
              size="sm"
            />
          )}
          {/* Submit/Cancel Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={isRunning && isHoveringButton ? onCancel : handleStart}
                disabled={isRunning ? isCancelling : !canStart}
                size="sm"
                onMouseEnter={() => setIsHoveringButton(true)}
                onMouseLeave={() => setIsHoveringButton(false)}
                className="h-7 w-7 shrink-0 rounded-full p-0"
                variant={isRunning && isHoveringButton ? 'destructive' : 'default'}
                aria-label={isRunning ? (isHoveringButton ? 'Cancel' : 'Running...') : 'Submit'}
              >
                {isRunning ? (
                  isHoveringButton ? (
                    <Square className="h-3 w-3" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRunning ? (isHoveringButton ? 'Cancel' : 'Running...') : 'Submit'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-2 py-2 xl:px-0">
      {/* Contextual Actions */}
      {!disableContextualActions && hasActions && (
        <div className="flex items-center justify-end gap-2">
          {actions.map((action) => {
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

      {/* Prompt Input */}
      <div>
        <ContextSearchTextarea
          ref={textareaRef}
          value={prompt}
          onChange={setPrompt}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning
              ? 'Execution is running (esc to cancel)'
              : promptPlaceholder ||
                (loading
                  ? 'Loading prompt...'
                  : isFollowUp
                    ? forceNewExecution
                      ? isWorktreeCleaned
                        ? 'Worktree cleaned up. Start a new execution... (@ for context, / for commands)'
                        : allowModeToggle
                          ? 'Start a new execution... (ctrl+k to continue previous, @ for context, / for commands)'
                          : 'Start a new execution... (@ for context, / for commands)'
                      : allowModeToggle
                        ? 'Continue the previous conversation... (ctrl+k for new, @ for context, / for commands)'
                        : 'Continue the previous conversation... (@ for context, / for commands)'
                    : issueId
                      ? 'Add additional context (optional) for the agent... (@ for context, / for commands)'
                      : 'Enter a prompt for the agent... (@ for context, / for commands)')
          }
          disabled={loading || disabled}
          className="max-h-[300px] min-h-0 resize-none overflow-y-auto border-none bg-muted/80 py-2 text-sm shadow-none transition-[height] duration-100 focus-visible:ring-0 focus-visible:ring-offset-0"
          projectId={currentProjectId || ''}
          autoResize
          maxHeight={300}
          availableCommands={effectiveCommands}
          onDiscoverCommands={handleDiscoverCommands}
          isLoadingCommands={isDiscoveringCommands}
          onRefreshCommands={handleRefreshCommands}
        />
      </div>

      {/* Configuration Row - stacks vertically on narrow screens */}
      <TooltipProvider>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Selectors row - wraps on very narrow screens */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Agent Selection - disabled in follow-up mode (unless forcing new execution) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Select
                    value={selectedAgentType}
                    onValueChange={setSelectedAgentType}
                    onOpenChange={onSelectOpenChange}
                    disabled={loading || agentsLoading || (isFollowUp && !forceNewExecution)}
                  >
                    <SelectTrigger className="h-8 w-[140px] min-w-0 shrink text-xs">
                      <SelectValue placeholder={agentsLoading ? 'Loading...' : 'Agent'}>
                        {(() => {
                          const selectedAgent = agents?.find((a) => a.type === selectedAgentType)
                          if (!selectedAgent) return 'Select agent'

                          const status = getAgentVerificationStatus(selectedAgent)
                          const StatusIcon = status.icon
                          // Only show icon for unavailable agents to keep UI clean
                          const showIcon =
                            !selectedAgent.available && selectedAgent.available !== undefined

                          return (
                            <div className="flex items-center gap-1.5">
                              {showIcon && (
                                <StatusIcon
                                  className={`h-3 w-3 ${status.color} ${status.spin ? 'animate-spin' : ''}`}
                                />
                              )}
                              <span>{selectedAgent.displayName}</span>
                            </div>
                          )
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {agents
                        ?.filter((agent) => agent.implemented)
                        .map((agent) => {
                          const status = getAgentVerificationStatus(agent)
                          const StatusIcon = status.icon
                          // Only show icon for unavailable agents to keep UI clean
                          const showIcon = !agent.available && agent.available !== undefined
                          return (
                            <SelectItem key={agent.type} value={agent.type} className="text-xs">
                              <div className="flex items-center gap-2">
                                {showIcon && (
                                  <StatusIcon
                                    className={`h-3.5 w-3.5 ${status.color} ${status.spin ? 'animate-spin' : ''}`}
                                  />
                                )}
                                <span>{agent.displayName}</span>
                                {showIcon && (
                                  <span className="text-[10px] text-muted-foreground">
                                    (not installed)
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          )
                        })}
                    </SelectContent>
                  </Select>
                </span>
              </TooltipTrigger>
              {isFollowUp && !forceNewExecution && (
                <TooltipContent>Agent type is inherited from parent execution</TooltipContent>
              )}
            </Tooltip>

            {/* Execution Mode - disabled in follow-up mode (unless forcing new execution) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Select
                    value={config.mode}
                    onValueChange={(value) => updateConfig({ mode: value as ExecutionMode })}
                    onOpenChange={onSelectOpenChange}
                    disabled={loading || (isFollowUp && !forceNewExecution)}
                  >
                    <SelectTrigger className="h-8 w-[140px] min-w-0 shrink text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worktree" className="text-xs">
                        Run in worktree
                      </SelectItem>
                      <SelectItem value="local" className="text-xs">
                        Run local
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </span>
              </TooltipTrigger>
              {isFollowUp && !forceNewExecution && (
                <TooltipContent>Execution mode is inherited from parent execution</TooltipContent>
              )}
            </Tooltip>

            {/* Branch Selector - enabled for worktree mode, disabled for local mode and follow-ups */}
            {config.baseBranch && config.mode === 'worktree' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <BranchSelector
                      branches={
                        availableBranches.length > 0 ? availableBranches : [config.baseBranch]
                      }
                      value={config.baseBranch}
                      onChange={(branch, isNew, worktreePath) => {
                        updateConfig({
                          baseBranch: branch,
                          createBaseBranch: isNew || false,
                          reuseWorktreePath: worktreePath, // If worktreePath is set, reuse that worktree
                        })
                      }}
                      disabled={loading || (isFollowUp && !forceNewExecution)}
                      allowCreate={!isFollowUp || forceNewExecution}
                      className="w-[180px] min-w-0 shrink"
                      currentBranch={currentBranch}
                      worktrees={worktrees}
                      onOpen={refreshBranches}
                    />
                  </span>
                </TooltipTrigger>
                {isFollowUp && !forceNewExecution && (
                  <TooltipContent>Base branch is inherited from parent execution</TooltipContent>
                )}
              </Tooltip>
            )}
          </div>

          {/* Buttons row - right-aligned, on same row on sm+ screens */}
          <div className="flex shrink-0 items-center gap-2 self-end sm:ml-auto sm:self-auto">
            {/* Settings Button - disabled in follow-up mode (unless forcing new execution) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSettingsDialog(true)}
                  disabled={loading || (isFollowUp && !forceNewExecution)}
                  className="h-8 shrink-0 px-2"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isFollowUp && !forceNewExecution
                  ? 'Settings are inherited from parent execution'
                  : 'Advanced settings'}
              </TooltipContent>
            </Tooltip>

            {/* Voice Input Button - only shown when voice is enabled */}
            {voiceEnabled && (
              <VoiceInputButton
                onTranscription={handleVoiceTranscription}
                onRecordingStart={handleVoiceRecordingStart}
                onInterimResult={handleVoiceInterimResult}
                disabled={loading || disabled || isRunning}
                size="default"
              />
            )}

            {/* Submit/Cancel Button - Round button that changes based on state */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={isRunning && isHoveringButton ? onCancel : handleStart}
                  disabled={isRunning ? isCancelling : !canStart}
                  size="sm"
                  onMouseEnter={() => setIsHoveringButton(true)}
                  onMouseLeave={() => setIsHoveringButton(false)}
                  className="h-7 w-7 shrink-0 rounded-full p-0"
                  variant={isRunning && isHoveringButton ? 'destructive' : 'default'}
                  aria-label={isRunning ? (isHoveringButton ? 'Cancel' : 'Running...') : 'Submit'}
                >
                  {isRunning ? (
                    isHoveringButton ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isRunning ? (isHoveringButton ? 'Cancel' : 'Running...') : 'Submit'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Settings Dialog */}
      <AgentSettingsDialog
        open={showSettingsDialog}
        config={config}
        onConfigChange={updateConfig}
        onClose={() => setShowSettingsDialog(false)}
        agentType={selectedAgentType}
      />

      {/* Commit Changes Dialog */}
      {currentExecution && (
        <CommitChangesDialog
          execution={currentExecution}
          isOpen={isCommitDialogOpen}
          onClose={() => setIsCommitDialogOpen(false)}
          onConfirm={handleCommitChanges}
          isCommitting={isCommitting}
        />
      )}

      {/* Cleanup Worktree Dialog */}
      {currentExecution && (
        <CleanupWorktreeDialog
          execution={currentExecution}
          isOpen={isCleanupDialogOpen}
          onClose={() => setIsCleanupDialogOpen(false)}
          onConfirm={handleCleanupWorktree}
          isCleaning={isCleaning}
        />
      )}

      {/* Sync Preview Dialog */}
      {currentExecution && syncPreview && (
        <SyncPreviewDialog
          preview={syncPreview}
          isOpen={isSyncPreviewOpen}
          onClose={() => setIsSyncPreviewOpen(false)}
          onConfirmSync={(mode, options) => {
            performSync(currentExecution.id, mode, options)
          }}
          onOpenIDE={() => {
            // Open worktree path in IDE (copy to clipboard for now)
            if (currentExecution.worktree_path) {
              navigator.clipboard.writeText(currentExecution.worktree_path)
              alert(
                `Worktree path copied to clipboard:\n${currentExecution.worktree_path}\n\nOpen it manually in your IDE.`
              )
            }
          }}
          isPreviewing={isPreviewing}
          targetBranch={currentExecution.target_branch ?? undefined}
        />
      )}
    </div>
  )
}
