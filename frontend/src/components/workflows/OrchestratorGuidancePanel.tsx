/**
 * OrchestratorGuidancePanel Component
 *
 * Always-visible input panel for users to provide guidance to the orchestrator.
 * Creates a follow-up execution with user feedback when submitted.
 */

import { useState, useCallback } from 'react'
import { Send, Loader2, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { executionsApi } from '@/lib/api'

// =============================================================================
// Types
// =============================================================================

export interface OrchestratorGuidancePanelProps {
  /** Workflow ID for context */
  workflowId: string
  /** The orchestrator's execution ID */
  orchestratorExecutionId: string
  /** Whether the orchestrator is currently running */
  isOrchestratorRunning: boolean
  /** Disable input (e.g., when workflow is completed) */
  disabled?: boolean
  /** Additional class name */
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function OrchestratorGuidancePanel({
  orchestratorExecutionId,
  isOrchestratorRunning,
  disabled = false,
  className,
}: OrchestratorGuidancePanelProps) {
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isSubmitting || disabled) return

    setIsSubmitting(true)
    try {
      await executionsApi.createFollowUp(orchestratorExecutionId, {
        feedback: message.trim(),
      })
      setMessage('')
      toast.success('Guidance sent to orchestrator')
    } catch (error) {
      toast.error(
        `Failed to send guidance: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [message, orchestratorExecutionId, isSubmitting, disabled])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter submits, Shift+Enter adds newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const statusText = isOrchestratorRunning
    ? 'Orchestrator is working...'
    : 'Send guidance to orchestrator'

  const placeholderText = isOrchestratorRunning
    ? 'Type guidance (will be sent when ready)...'
    : 'Type your guidance or feedback...'

  return (
    <div
      className={cn(
        'border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        {isOrchestratorRunning ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
        <span>{statusText}</span>
      </div>

      {/* Input area */}
      <div className="flex gap-2 px-4 pb-4">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={disabled || isSubmitting}
          className="min-h-[60px] max-h-[120px] resize-none"
          rows={2}
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!message.trim() || isSubmitting || disabled}
          className="shrink-0 self-end"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Hint */}
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  )
}

export default OrchestratorGuidancePanel
