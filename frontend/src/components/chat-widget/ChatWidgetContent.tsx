import { useRef, useCallback, useState, useEffect } from 'react'
import { X, PanelRight, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ExecutionMonitor } from '@/components/executions/ExecutionMonitor'
import { AgentConfigPanel } from '@/components/executions/AgentConfigPanel'
import { ExecutionSelector } from './ExecutionSelector'
import { executionsApi, type ExecutionChainResponse } from '@/lib/api'
import { useExecutions } from '@/hooks/useExecutions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Execution, ExecutionConfig } from '@/types/execution'
import { type ChatWidgetMode, PROJECT_ASSISTANT_TAG } from '@/contexts/ChatWidgetContext'

interface ChatWidgetContentProps {
  executionId: string | null
  execution: Execution | null
  autoConnectLatest: boolean
  mode: ChatWidgetMode
  onClose: () => void
  onModeToggle: () => void
  onExecutionSelect: (executionId: string | null) => void
  onAutoConnectChange: (value: boolean) => void
  className?: string
}

export function ChatWidgetContent({
  executionId,
  execution: _execution, // Unused - we fetch the chain data directly
  autoConnectLatest,
  mode,
  onClose,
  onModeToggle,
  onExecutionSelect,
  onAutoConnectChange,
  className,
}: ChatWidgetContentProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Fetch ONLY project-assistant tagged executions for the selector
  const { data: executionsData } = useExecutions({ tags: [PROJECT_ASSISTANT_TAG] })
  const executions = executionsData?.executions || []

  // Execution chain state - fetches full chain including follow-ups
  const [chainData, setChainData] = useState<ExecutionChainResponse | null>(null)

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
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
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

      try {
        if (chainData && chainData.executions.length > 0) {
          // Follow-up mode - create follow-up on the last execution in the chain
          const lastExecution = chainData.executions[chainData.executions.length - 1]
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
          // Auto-select the new execution (no toast - the widget itself shows the execution)
          onExecutionSelect(newExecution.id)
        }
      } catch (err) {
        console.error('Failed to create execution:', err)
        toast.error(chainData ? 'Failed to send follow-up' : 'Failed to start execution')
      }
    },
    [chainData, handleContentChange, onExecutionSelect]
  )

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <ExecutionSelector
          executions={executions}
          value={executionId}
          onChange={onExecutionSelect}
          autoConnectLatest={autoConnectLatest}
          onAutoConnectChange={onAutoConnectChange}
          className="max-w-[200px]"
        />

        <div className="flex items-center gap-1">
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

      {/* Body - scrollable execution display */}
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
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {executions.length === 0
              ? 'No executions yet. Start one below.'
              : 'Select an execution to view'}
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
              : { id: '', mode: 'local' } // Default to local mode for adhoc
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
    </div>
  )
}
