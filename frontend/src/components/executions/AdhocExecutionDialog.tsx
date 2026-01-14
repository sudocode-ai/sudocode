import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AlertCircle } from 'lucide-react'
import { AgentConfigPanel } from './AgentConfigPanel'
import { executionsApi } from '@/lib/api'
import type { ExecutionConfig } from '@/types/execution'
import { toast } from 'sonner'

interface AdhocExecutionDialogProps {
  open: boolean
  onClose: () => void
  /** Default prompt to pre-populate the textarea */
  defaultPrompt?: string
  /** Custom title for the dialog */
  title?: string
  /** Custom description for the dialog */
  description?: string
}

/**
 * Dialog for creating adhoc executions not tied to an issue
 */
export function AdhocExecutionDialog({
  open,
  onClose,
  defaultPrompt,
  title = 'New Execution',
  description = 'Start a standalone execution without linking to a specific issue.',
}: AdhocExecutionDialogProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async (
    config: ExecutionConfig,
    prompt: string,
    agentType?: string
  ) => {
    // Validate prompt is provided (required for adhoc executions)
    if (!prompt.trim()) {
      setError('Prompt is required for standalone executions')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const execution = await executionsApi.createAdhoc({
        config,
        prompt: prompt.trim(),
        agentType,
      })

      onClose()

      // Navigate to the new execution
      navigate(paths.execution(execution.id))
    } catch (err) {
      console.error('Failed to create adhoc execution:', err)
      setError(err instanceof Error ? err.message : 'Failed to start execution')
      toast.error('Failed to start execution')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          )}

          {/* Agent Configuration Panel - no issueId for adhoc executions */}
          {/* Default to local mode for standalone executions */}
          <AgentConfigPanel
            onStart={handleStart}
            disabled={isSubmitting}
            variant="full"
            autoFocus={true}
            promptPlaceholder="Describe what you want the agent to do... (@ for context)"
            defaultPrompt={defaultPrompt}
            lastExecution={{
              id: '',
              mode: 'local',
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
