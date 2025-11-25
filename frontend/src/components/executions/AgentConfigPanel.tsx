import { useState, useEffect, useRef } from 'react'
import { Play, Settings, AlertCircle, Info } from 'lucide-react'
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

export function AgentConfigPanel({
  issueId,
  onStart,
  disabled = false,
  onSelectOpenChange,
}: AgentConfigPanelProps) {
  const [loading, setLoading] = useState(true)
  const [prepareResult, setPrepareResult] = useState<ExecutionPrepareResult | null>(null)
  const [prompt, setPrompt] = useState('')
  const [config, setConfig] = useState<ExecutionConfig>({
    mode: 'worktree',
    cleanupMode: 'manual',
  })
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [selectedAgentType, setSelectedAgentType] = useState<string>('claude-code')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch available agents
  const { agents, loading: agentsLoading } = useAgents()

  // Load template preview on mount
  useEffect(() => {
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
  }, [issueId])

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
    onStart(config, prompt, selectedAgentType)
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
          placeholder={loading ? 'Loading prompt...' : 'Enter prompt for the agent...'}
          disabled={loading}
          className="max-h-[300px] min-h-0 resize-none overflow-y-auto border-none bg-muted/80 py-2 text-sm shadow-none transition-[height] duration-100 focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{ height: 'auto' }}
          rows={1}
        />
      </div>

      {/* Configuration Row */}
      <TooltipProvider>
        <div className="flex items-center gap-2">
          {/* Agent Selection */}
          <Select
            value={selectedAgentType}
            onValueChange={setSelectedAgentType}
            onOpenChange={onSelectOpenChange}
            disabled={loading || agentsLoading}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder={agentsLoading ? 'Loading...' : 'Agent'}>
                {agents?.find((a) => a.type === selectedAgentType)?.displayName || 'Select agent'}
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

          {/* Execution Mode */}
          <Select
            value={config.mode}
            onValueChange={(value) => updateConfig({ mode: value as ExecutionMode })}
            onOpenChange={onSelectOpenChange}
            disabled={loading}
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

          {/* Base Branch (only for worktree mode) */}
          {config.mode === 'worktree' && prepareResult?.availableBranches && (
            <Select
              value={config.baseBranch}
              onValueChange={(value) => updateConfig({ baseBranch: value })}
              onOpenChange={onSelectOpenChange}
              disabled={loading}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                {prepareResult.availableBranches.map((branch) => (
                  <SelectItem key={branch} value={branch} className="text-xs">
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="ml-auto" />

          {/* Settings Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettingsDialog(true)}
                disabled={loading}
                className="h-8 px-2"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Advanced settings</TooltipContent>
          </Tooltip>

          {/* Run Button */}
          <Button
            onClick={handleStart}
            disabled={!canStart}
            size="sm"
            className="h-8 gap-2 font-semibold"
          >
            <Play className="h-4 w-4" />
            Run
          </Button>
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
