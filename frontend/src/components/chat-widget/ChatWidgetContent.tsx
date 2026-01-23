import { useRef, useCallback, useState, useEffect } from 'react'
import { X, PanelRight, Maximize2, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import { AgentSettingsDialog } from '@/components/executions/AgentSettingsDialog'
import { BranchSelector } from '@/components/executions/BranchSelector'
import { ExecutionSelector } from './ExecutionSelector'
import { executionsApi, repositoryApi, type ExecutionChainResponse } from '@/lib/api'
import { useExecutions } from '@/hooks/useExecutions'
import { useAgents } from '@/hooks/useAgents'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Execution, ExecutionConfig, ExecutionMode } from '@/types/execution'
import { type ChatWidgetMode, PROJECT_ASSISTANT_TAG } from '@/contexts/ChatWidgetContext'

interface ChatWidgetContentProps {
  executionId: string | null
  execution: Execution | null
  mode: ChatWidgetMode
  agentType: string
  executionConfig: Partial<ExecutionConfig>
  onClose: () => void
  onModeToggle: () => void
  onExecutionSelect: (executionId: string | null) => void
  onCreatedExecution: (execution: Execution) => void
  onAgentTypeChange: (agentType: string) => void
  onExecutionConfigChange: (updates: Partial<ExecutionConfig>) => void
  className?: string
}

export function ChatWidgetContent({
  executionId,
  execution: _execution, // Unused - we fetch the chain data directly
  mode,
  agentType,
  executionConfig,
  onClose,
  onModeToggle,
  onExecutionSelect,
  onCreatedExecution,
  onAgentTypeChange,
  onExecutionConfigChange,
  className,
}: ChatWidgetContentProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  // Track which execution IDs have pending follow-up requests to prevent duplicates
  const pendingFollowUpParentsRef = useRef<Set<string>>(new Set())
  // Track if an adhoc execution is being created (simple boolean since new executions are allowed)
  const creatingAdhocExecutionRef = useRef(false)

  // Fetch ONLY project-assistant tagged executions for the selector
  const { data: executionsData } = useExecutions({ tags: [PROJECT_ASSISTANT_TAG] })
  const executions = executionsData?.executions || []

  // Execution chain state - fetches full chain including follow-ups
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)

  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availableBranches, setAvailableBranches] = useState<string[]>([])

  // Fetch available agents
  const { agents: agentsList } = useAgents()
  const agents = agentsList || []

  // Fetch branches when in worktree mode (on mount and when mode changes)
  useEffect(() => {
    if (executionConfig.mode === 'worktree') {
      repositoryApi
        .getBranches()
        .then((branchInfo) => {
          setAvailableBranches(branchInfo.branches)
          // Set default base branch if not already set
          if (!executionConfig.baseBranch && branchInfo.current) {
            onExecutionConfigChange({ baseBranch: branchInfo.current })
          }
        })
        .catch((err: Error) => {
          console.error('Failed to fetch branches:', err)
        })
    }
  }, [executionConfig.mode])

  // Load execution chain when executionId changes
  useEffect(() => {
    if (!executionId) {
      setChainData(null)
      return
    }

    const loadChain = async () => {
      try {
        const data = await executionsApi.getChain(executionId)
        setChainData(data)
      } catch (err) {
        console.error('Failed to load execution chain:', err)
        setChainData(null)
      }
    }

    loadChain()
  }, [executionId])

  // Scroll to bottom when content changes
  const handleContentChange = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [])

  // Handle execution completion - reload chain to get updated status
  const handleExecutionComplete = useCallback(async () => {
    if (!executionId) return
    try {
      const data = await executionsApi.getChain(executionId)
      setChainData(data)
    } catch (err) {
      console.error('Failed to reload execution chain:', err)
    }
  }, [executionId])

  // Handle execution start from AgentConfigPanel
  const handleExecutionStart = useCallback(
    async (config: ExecutionConfig, prompt: string, agentType?: string) => {
      if (!prompt.trim()) {
        toast.error('Prompt is required')
        return
      }

      const isFollowUpMode = chainData && chainData.executions.length > 0
      const lastExecution = isFollowUpMode
        ? chainData.executions[chainData.executions.length - 1]
        : null

      if (isFollowUpMode && lastExecution) {
        // Follow-up path: prevent duplicate follow-ups from the same parent execution
        if (pendingFollowUpParentsRef.current.has(lastExecution.id)) {
          console.log(
            '[ChatWidgetContent] Follow-up already in progress for execution',
            lastExecution.id,
            '- ignoring duplicate request'
          )
          return
        }
        pendingFollowUpParentsRef.current.add(lastExecution.id)
      } else {
        // Adhoc execution path: simple lock to prevent rapid double-clicks
        if (creatingAdhocExecutionRef.current) {
          console.log('[ChatWidgetContent] Adhoc execution creation already in progress, ignoring duplicate request')
          return
        }
        creatingAdhocExecutionRef.current = true
      }

      try {
        if (isFollowUpMode && lastExecution) {
          // Follow-up mode - create follow-up on the last execution in the chain
          const newExecution = await executionsApi.createFollowUp(lastExecution.id, {
            feedback: prompt.trim(),
          })

          // Add the new execution to the chain immediately
          setChainData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              executions: [...prev.executions, newExecution],
            }
          })
          // Update context with new execution for FAB spinner
          onCreatedExecution(newExecution)
          handleContentChange()
        } else {
          // Adhoc execution mode - create new execution without an issue
          // Tag it as project-assistant so it shows in this widget
          const newExecution = await executionsApi.createAdhoc({
            config: {
              ...config,
              tags: [PROJECT_ASSISTANT_TAG],
            },
            prompt: prompt.trim(),
            agentType,
          })
          // Use onCreatedExecution to immediately make execution available for FAB spinner
          onCreatedExecution(newExecution)
        }
      } catch (err) {
        // On error, remove the lock so user can retry
        if (isFollowUpMode && lastExecution) {
          pendingFollowUpParentsRef.current.delete(lastExecution.id)
        } else {
          creatingAdhocExecutionRef.current = false
        }
        console.error('Failed to create execution:', err)
        toast.error(chainData ? 'Failed to send follow-up' : 'Failed to start execution')
      } finally {
        // For adhoc executions, release the lock after a short delay to prevent rapid re-clicking
        // For follow-ups, we intentionally keep the lock - no more follow-ups from same parent
        if (!isFollowUpMode) {
          setTimeout(() => {
            creatingAdhocExecutionRef.current = false
          }, 1000)
        }
      }
    },
    [chainData, handleContentChange, onCreatedExecution]
  )

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <ExecutionSelector
          executions={executions}
          value={executionId}
          onChange={onExecutionSelect}
          className="max-w-[200px]"
        />

        <div className="flex items-center gap-1">
          {/* Settings button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Agent settings</TooltipContent>
          </Tooltip>

          {/* Mode toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onModeToggle}>
                {mode === 'floating' ? (
                  <PanelRight className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {mode === 'floating' ? 'Switch to panel mode' : 'Switch to floating mode'}
            </TooltipContent>
          </Tooltip>

          {/* Close button */}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body - scrollable execution display or config panel */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-3">
        {chainData && chainData.executions.length > 0 ? (
          <div className="space-y-3">
            {chainData.executions.map((exec, index) => (
              <div key={exec.id}>
                <ExecutionMonitor
                  executionId={exec.id}
                  execution={exec}
                  compact
                  hideTodoTracker
                  onContentChange={handleContentChange}
                  onComplete={handleExecutionComplete}
                />
                {/* Visual separator between executions */}
                {index < chainData.executions.length - 1 && (
                  <div className="my-3 border-t border-border/50" />
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Welcome/Config Panel - shown when no execution chain */
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-4">
              {/* Header info */}
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Project Assistant</h3>
                <p className="text-xs text-muted-foreground">
                  Ask questions, run tasks, or get help with your codebase. The assistant can read
                  files, run commands, and make changes.
                </p>
              </div>

              {/* Environment Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <label className="w-20 shrink-0 text-xs">Environment</label>
                  <div className="flex flex-1 items-center gap-2">
                    <Select
                      value={executionConfig.mode || 'local'}
                      onValueChange={(value: ExecutionMode) =>
                        onExecutionConfigChange({ mode: value })
                      }
                    >
                      <SelectTrigger className="h-7 w-[100px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local" className="text-xs">
                          Local
                        </SelectItem>
                        <SelectItem value="worktree" className="text-xs">
                          Worktree
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Branch Selector - only show in worktree mode */}
                    {executionConfig.mode === 'worktree' && availableBranches.length > 0 && (
                      <BranchSelector
                        branches={availableBranches}
                        value={executionConfig.baseBranch || availableBranches[0]}
                        onChange={(branch) => onExecutionConfigChange({ baseBranch: branch })}
                        className="h-7 flex-1 text-xs"
                        placeholder="Select branch..."
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Agent info */}
              <div className="flex items-center gap-3">
                <label className="w-20 shrink-0 text-xs">Agent</label>
                <div className="flex flex-1 items-center justify-between rounded-md px-2.5 py-1.5">
                  <span className="text-xs font-medium">
                    {agents.find((a) => a.type === agentType)?.displayName || agentType}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-1.5 text-xs"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="mr-1 h-3 w-3" />
                    Configure
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Footer - agent config panel */}
      <div className="border-t border-border p-2">
        <AgentConfigPanel
          variant="compact"
          issueId={chainData?.executions[0]?.issue_id || undefined}
          onStart={handleExecutionStart}
          isFollowUp={!!(chainData && chainData.executions.length > 0)}
          lastExecution={
            chainData && chainData.executions.length > 0
              ? {
                  id: chainData.executions[chainData.executions.length - 1].id,
                  mode: chainData.executions[0].mode || undefined,
                  target_branch: chainData.executions[0].target_branch,
                  agent_type: chainData.executions[0].agent_type,
                }
              : { id: '', mode: executionConfig.mode || 'local', config: executionConfig, agent_type: agentType }
          }
          promptPlaceholder={
            chainData && chainData.executions.length > 0
              ? 'Send a follow-up message...'
              : 'Start a new execution...'
          }
          disableContextualActions={true}
          allowModeToggle={false}
        />
      </div>

      {/* Agent Settings Dialog */}
      <AgentSettingsDialog
        open={settingsOpen}
        config={executionConfig}
        onConfigChange={onExecutionConfigChange}
        onClose={() => setSettingsOpen(false)}
        agentType={agentType}
        onAgentTypeChange={onAgentTypeChange}
        availableAgents={agents}
        availableBranches={availableBranches}
        showModeSelector={true}
      />
    </div>
  )
}
