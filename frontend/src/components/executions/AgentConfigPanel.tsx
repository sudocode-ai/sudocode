import { useState, useEffect, useRef } from 'react'
import { Settings, AlertCircle, Info, ArrowDown, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { executionsApi } from '@/lib/api'
import type { ExecutionConfig, ExecutionPrepareResult, ExecutionMode } from '@/types/execution'
import { AgentSettingsDialog } from './AgentSettingsDialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAgents } from '@/hooks/useAgents'
import type { CodexConfig } from './CodexConfigForm'
import type { CopilotConfig } from './CopilotConfigForm'

interface AgentConfigPanelProps {
  issueId: string
  onStart: (config: ExecutionConfig, prompt: string, agentType?: string) => void
  disabled?: boolean
  onSelectOpenChange?: (isOpen: boolean) => void
  /**
   * Follow-up mode: locks config options and shows inherited values
   */
  isFollowUp?: boolean
  /**
   * Parent execution for follow-up mode - provides locked config values
   */
  parentExecution?: {
    id: string
    mode?: string
    model?: string
    target_branch?: string
    agent_type?: string
    config?: ExecutionConfig
  }
  /**
   * Previous execution (not for follow-up) - used to default config to last execution's settings
   */
  previousExecution?: {
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
  parentExecution,
  previousExecution,
  promptPlaceholder,
  isRunning = false,
  onCancel,
  isCancelling = false,
}: AgentConfigPanelProps) {
  const [loading, setLoading] = useState(!isFollowUp) // Skip loading for follow-ups
  const [prepareResult, setPrepareResult] = useState<ExecutionPrepareResult | null>(null)
  const [prompt, setPrompt] = useState('')
  const [config, setConfig] = useState<ExecutionConfig>(() => {
    // For follow-ups, inherit config from parent execution
    if (isFollowUp && parentExecution?.config) {
      const inheritedConfig = {
        ...parentExecution.config,
        mode: (parentExecution.mode as ExecutionMode) || 'worktree',
        baseBranch: parentExecution.target_branch,
      }
      if (isValidExecutionConfig(inheritedConfig)) {
        return inheritedConfig
      }
      console.warn('Parent execution config is invalid, using defaults')
    }

    // For new executions, try to use previous execution config
    if (previousExecution?.config) {
      const previousConfig = {
        ...previousExecution.config,
        mode: (previousExecution.mode as ExecutionMode) || 'worktree',
        baseBranch: previousExecution.target_branch,
      }
      if (isValidExecutionConfig(previousConfig)) {
        return previousConfig
      }
      console.warn('Previous execution config is invalid, trying localStorage')
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
    // For follow-ups, inherit agent type from parent execution
    if (isFollowUp && parentExecution?.agent_type) {
      return parentExecution.agent_type
    }

    // For new executions, try to use previous execution's agent type
    if (previousExecution?.agent_type) {
      return previousExecution.agent_type
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

  // Reset config when issue or previousExecution changes (issue switching)
  useEffect(() => {
    // Skip for follow-ups - they use parent execution
    if (isFollowUp) return

    // Helper to load config with priority
    const loadConfigForIssue = (): ExecutionConfig => {
      // Try previous execution config first
      if (previousExecution?.config) {
        const previousConfig = {
          ...previousExecution.config,
          mode: (previousExecution.mode as ExecutionMode) || 'worktree',
          baseBranch: previousExecution.target_branch,
        }
        if (isValidExecutionConfig(previousConfig)) {
          return previousConfig
        }
        console.warn('Previous execution config is invalid, trying localStorage')
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
  }, [issueId, previousExecution?.id, isFollowUp])

  // Reset agent type when issue or previousExecution changes
  useEffect(() => {
    if (isFollowUp) return

    const loadAgentTypeForIssue = (): string => {
      // Try previous execution's agent type first
      if (previousExecution?.agent_type) {
        return previousExecution.agent_type
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
  }, [issueId, previousExecution?.id, isFollowUp])

  // Load template preview on mount (skip for follow-ups)
  useEffect(() => {
    // Skip prepare API call for follow-ups - we use parent execution config
    if (isFollowUp) return

    let isMounted = true

    const loadPreview = async () => {
      if (!isMounted) return
      setLoading(true)
      try {
        const result = await executionsApi.prepare(issueId)
        if (isMounted) {
          setPrepareResult(result)
          // setPrompt(result.renderedPrompt)
          setConfig({ ...config, ...result.defaultConfig })
        }
      } catch (error) {
        console.error('Failed to prepare execution:', error)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadPreview()

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

    onStart(config, prompt, selectedAgentType)
    setPrompt('') // Clear the prompt after submission
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canStart) {
        handleStart()
      }
    }
    // Shift+Enter creates newline (default behavior, no need to handle)
  }

  const hasErrors = prepareResult?.errors && prepareResult.errors.length > 0
  const hasWarnings = prepareResult?.warnings && prepareResult.warnings.length > 0
  const canStart = !loading && !hasErrors && prompt.trim().length > 0 && !disabled

  return (
    <div className="space-y-3 p-4">
      {/* Errors */}
      {hasErrors && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-destructive">Errors</p>
              {prepareResult!.errors!.map((error, i) => (
                <p key={i} className="text-xs text-destructive/90">
                  {error}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="rounded-lg border border-yellow-500 bg-yellow-500/10 p-2">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" />
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-yellow-600">Warnings</p>
              {prepareResult!.warnings!.map((warning, i) => (
                <p key={i} className="text-xs text-yellow-600/90">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Related Context Info */}
      {/* TODO: Re-enable */}
      {/* {prepareResult &&
          ((prepareResult.relatedSpecs?.length ?? 0) > 0 ||
            (prepareResult.relatedFeedback?.length ?? 0) > 0) && (
            <div className="rounded-lg border bg-muted/50 p-2 text-xs text-muted-foreground">
              {(prepareResult.relatedSpecs?.length ?? 0) > 0 && (
                <span>{prepareResult.relatedSpecs.length} spec(s)</span>
              )}
              {(prepareResult.relatedSpecs?.length ?? 0) > 0 &&
                (prepareResult.relatedFeedback?.length ?? 0) > 0 && <span> • </span>}
              {(prepareResult.relatedFeedback?.length ?? 0) > 0 && (
                <span>{prepareResult.relatedFeedback.length} feedback item(s)</span>
              )}
            </div>
          )} */}

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
                ? 'Enter feedback to continue the execution...'
                : 'Enter prompt for the agent...')
          }
          disabled={loading}
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
                      Run in worktree
                    </SelectItem>
                    <SelectItem value="local" className="text-xs">
                      Run directly
                    </SelectItem>
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            {isFollowUp && (
              <TooltipContent>Execution mode is inherited from parent execution</TooltipContent>
            )}
          </Tooltip>

          {/* Base Branch (only for worktree mode) - disabled in follow-up mode */}
          {config.mode === 'worktree' && (prepareResult?.availableBranches || isFollowUp) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Select
                    value={config.baseBranch}
                    onValueChange={(value) => updateConfig({ baseBranch: value })}
                    onOpenChange={onSelectOpenChange}
                    disabled={loading || isFollowUp}
                  >
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="Branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {isFollowUp && config.baseBranch ? (
                        <SelectItem value={config.baseBranch} className="text-xs">
                          {config.baseBranch}
                        </SelectItem>
                      ) : (
                        prepareResult?.availableBranches?.map((branch) => (
                          <SelectItem key={branch} value={branch} className="text-xs">
                            {branch}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </span>
              </TooltipTrigger>
              {isFollowUp && (
                <TooltipContent>Branch is inherited from parent execution</TooltipContent>
              )}
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
