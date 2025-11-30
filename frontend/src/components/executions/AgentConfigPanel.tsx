import { useState, useEffect, useRef } from 'react'
import { Settings, ArrowDown, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { repositoryApi } from '@/lib/api'
import type { ExecutionConfig, ExecutionMode } from '@/types/execution'
import { AgentSettingsDialog } from './AgentSettingsDialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAgents } from '@/hooks/useAgents'
import type { CodexConfig } from './CodexConfigForm'
import type { CopilotConfig } from './CopilotConfigForm'

interface AgentConfigPanelProps {
  issueId: string
  onStart: (config: ExecutionConfig, prompt: string, agentType?: string, forceNew?: boolean) => void
  disabled?: boolean
  onSelectOpenChange?: (isOpen: boolean) => void
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
}

// TODO: Move this somewhere more central.
// Map of default agent-specific configurations
const DEFAULT_AGENT_CONFIGS: Record<string, any> = {
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
}

// localStorage keys for persisting config
const LAST_EXECUTION_CONFIG_KEY = 'sudocode:lastExecutionConfig'
const LAST_AGENT_TYPE_KEY = 'sudocode:lastAgentType'

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
}: AgentConfigPanelProps) {
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [internalForceNewExecution, setInternalForceNewExecution] = useState(false)

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
      const executionConfig = {
        ...lastExecution.config,
        mode: (lastExecution.mode as ExecutionMode) || 'worktree',
        baseBranch: lastExecution.target_branch,
      }
      if (isValidExecutionConfig(executionConfig)) {
        return executionConfig
      }
      console.warn('Last execution config is invalid, trying localStorage')
    }

    // Otherwise, try localStorage
    try {
      const savedConfig = localStorage.getItem(LAST_EXECUTION_CONFIG_KEY)
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig)
        if (isValidExecutionConfig(parsed)) {
          return parsed
        }
        console.warn('Saved config is invalid, clearing localStorage and using defaults')
        localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
      }
    } catch (error) {
      console.warn('Failed to load saved execution config:', error)
      // Clear corrupted data
      try {
        localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    // Final fallback: base defaults
    return {
      mode: 'worktree',
      cleanupMode: 'manual',
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

  // Reset config when issue or lastExecution changes (issue switching)
  useEffect(() => {
    // Skip for follow-ups - they use parent execution
    if (isFollowUp) return

    // Helper to load config with priority
    const loadConfigForIssue = (): ExecutionConfig => {
      // Try last execution config first
      if (lastExecution?.config) {
        const executionConfig = {
          ...lastExecution.config,
          mode: (lastExecution.mode as ExecutionMode) || 'worktree',
          baseBranch: lastExecution.target_branch,
        }
        if (isValidExecutionConfig(executionConfig)) {
          return executionConfig
        }
        console.warn('Last execution config is invalid, trying localStorage')
      }

      // Otherwise, try localStorage
      try {
        const savedConfig = localStorage.getItem(LAST_EXECUTION_CONFIG_KEY)
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig)
          if (isValidExecutionConfig(parsed)) {
            return parsed
          }
          console.warn('Saved config is invalid, clearing localStorage and using defaults')
          localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
        }
      } catch (error) {
        console.warn('Failed to load saved execution config:', error)
        try {
          localStorage.removeItem(LAST_EXECUTION_CONFIG_KEY)
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Final fallback: base defaults
      return {
        mode: 'worktree',
        cleanupMode: 'manual',
      }
    }

    setConfig(loadConfigForIssue())
  }, [issueId, lastExecution?.id, isFollowUp])

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

  // Load current branch for baseBranch default (skip for follow-ups)
  useEffect(() => {
    // Skip for follow-ups - we use parent execution config
    if (isFollowUp) return

    let isMounted = true

    const loadRepoInfo = async () => {
      if (!isMounted) return
      setLoading(true)
      try {
        const repoInfo = await repositoryApi.getInfo()
        if (isMounted && repoInfo.branch) {
          // Set baseBranch to current branch if not already set
          setConfig((prev) => ({
            ...prev,
            baseBranch: prev.baseBranch || repoInfo.branch,
          }))
        }
      } catch (error) {
        console.error('Failed to get repository info:', error)
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
  }, [issueId, isFollowUp])

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'

    // Calculate new height (max 300px to prevent it from getting too tall)
    const newHeight = Math.min(textarea.scrollHeight, 300)
    textarea.style.height = `${newHeight}px`
  }, [prompt])

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

  // When agent type changes, initialize agentConfig with defaults if not present
  useEffect(() => {
    if (selectedAgentType && !config.agentConfig) {
      const defaultAgentConfig = DEFAULT_AGENT_CONFIGS[selectedAgentType]
      if (defaultAgentConfig) {
        updateConfig({ agentConfig: defaultAgentConfig })
      }
    }
  }, [selectedAgentType])

  const handleStart = () => {
    // Save config and agent type to localStorage for future executions
    // Only save if config is valid to prevent persisting corrupted data
    if (isValidExecutionConfig(config)) {
      try {
        localStorage.setItem(LAST_EXECUTION_CONFIG_KEY, JSON.stringify(config))
        localStorage.setItem(LAST_AGENT_TYPE_KEY, selectedAgentType)
      } catch (error) {
        console.warn('Failed to save execution config to localStorage:', error)
      }
    } else {
      console.warn('Config is invalid, not saving to localStorage')
    }

    onStart(config, prompt, selectedAgentType, forceNewExecution)
    setPrompt('') // Clear the prompt after submission
    setForceNewExecution(false) // Reset the flag after submission
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Toggle between new execution and follow-up mode with Ctrl+K (only if allowed)
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (isFollowUp && allowModeToggle) {
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

  const canStart = !loading && prompt.trim().length > 0 && !disabled

  return (
    <div className="space-y-3 p-4">
      {/* Prompt Input */}
      <div>
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            promptPlaceholder ||
            (loading
              ? 'Loading prompt...'
              : isFollowUp
                ? forceNewExecution
                  ? allowModeToggle
                    ? 'Start a new execution... (ctrl+k to continue previous)'
                    : 'Start a new execution...'
                  : allowModeToggle
                    ? 'Continue the previous conversation... (ctrl+k for new)'
                    : 'Continue the previous conversation...'
                : 'Enter prompt for the agent...')
          }
          disabled={loading || disabled}
          className="max-h-[300px] min-h-0 resize-none overflow-y-auto border-none bg-muted/80 py-2 text-sm shadow-none transition-[height] duration-100 focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{ height: 'auto' }}
          rows={1}
        />
      </div>

      {/* Configuration Row */}
      <TooltipProvider>
        <div className="flex items-center gap-2">
          {/* Agent Selection - disabled in follow-up mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Select
                  value={selectedAgentType}
                  onValueChange={setSelectedAgentType}
                  onOpenChange={onSelectOpenChange}
                  disabled={loading || agentsLoading || isFollowUp}
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue placeholder={agentsLoading ? 'Loading...' : 'Agent'}>
                      {agents?.find((a) => a.type === selectedAgentType)?.displayName ||
                        'Select agent'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {agents
                      ?.filter((agent) => agent.implemented)
                      .map((agent) => (
                        <SelectItem key={agent.type} value={agent.type} className="text-xs">
                          {agent.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            {isFollowUp && (
              <TooltipContent>Agent type is inherited from parent execution</TooltipContent>
            )}
          </Tooltip>

          {/* Execution Mode - disabled in follow-up mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Select
                  value={config.mode}
                  onValueChange={(value) => updateConfig({ mode: value as ExecutionMode })}
                  onOpenChange={onSelectOpenChange}
                  disabled={loading || isFollowUp}
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="worktree" className="text-xs">
                      New worktree
                    </SelectItem>
                    <SelectItem value="local" className="text-xs">
                      Run local
                    </SelectItem>
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            {isFollowUp && (
              <TooltipContent>Execution mode is inherited from parent execution</TooltipContent>
            )}
          </Tooltip>

          {/* Branch Display - shows current branch, disabled in local mode or follow-up */}
          {config.baseBranch && config.mode === 'worktree' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-8 w-[160px] items-center rounded-md border border-input bg-muted/50 px-3 text-xs text-muted-foreground">
                  {config.baseBranch}
                </div>
              </TooltipTrigger>
              <TooltipContent>Base branch for worktree</TooltipContent>
            </Tooltip>
          )}

          <div className="ml-auto" />

          {/* Settings Button - disabled in follow-up mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettingsDialog(true)}
                disabled={loading || isFollowUp}
                className="h-8 px-2"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFollowUp ? 'Settings are inherited from parent execution' : 'Advanced settings'}
            </TooltipContent>
          </Tooltip>

          {/* Submit/Cancel Button - Round button that changes based on state */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={isRunning && isHoveringButton ? onCancel : handleStart}
                disabled={isRunning ? isCancelling : !canStart}
                size="sm"
                onMouseEnter={() => setIsHoveringButton(true)}
                onMouseLeave={() => setIsHoveringButton(false)}
                className="h-7 w-7 rounded-full p-0"
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
      </TooltipProvider>

      {/* Settings Dialog */}
      <AgentSettingsDialog
        open={showSettingsDialog}
        config={config}
        onConfigChange={updateConfig}
        onClose={() => setShowSettingsDialog(false)}
        agentType={selectedAgentType}
      />
    </div>
  )
}
