/**
 * EscalationPanel - UI for responding to orchestrator escalation requests
 *
 * Displays the escalation message, optional predefined choices,
 * and allows custom feedback input.
 */

import { useState } from 'react'
import { AlertTriangle, Send, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import type { EscalationData, EscalationResponseRequest } from '@/types/workflow'

// =============================================================================
// Types
// =============================================================================

export interface EscalationPanelProps {
  /** The escalation data to display */
  escalation: EscalationData
  /** Callback when user responds */
  onRespond: (response: EscalationResponseRequest) => void
  /** Whether a response is being submitted */
  isResponding?: boolean
  /** Additional class name */
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function EscalationPanel({
  escalation,
  onRespond,
  isResponding = false,
  className,
}: EscalationPanelProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState('')

  const hasOptions = escalation.options && escalation.options.length > 0

  const handleApprove = () => {
    onRespond({
      action: 'approve',
      message: selectedOption || customMessage || undefined,
    })
  }

  const handleReject = () => {
    onRespond({
      action: 'reject',
      message: customMessage || undefined,
    })
  }

  const handleCustom = () => {
    if (!customMessage.trim()) return
    onRespond({
      action: 'custom',
      message: customMessage,
    })
  }

  const handleOptionSelect = (option: string) => {
    setSelectedOption(option)
    setCustomMessage('')
  }

  const handleCustomMessageChange = (value: string) => {
    setCustomMessage(value)
    setSelectedOption(null)
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-yellow-500/50 bg-yellow-500/5',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-yellow-500/30 bg-yellow-500/10">
        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
        <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
          Orchestrator Needs Input
        </h3>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Message */}
        <div className="text-sm leading-relaxed">
          <p className="text-foreground whitespace-pre-wrap">{escalation.message}</p>
        </div>

        {/* Options */}
        {hasOptions && (
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Choose an option
            </Label>
            <RadioGroup
              value={selectedOption || ''}
              onValueChange={handleOptionSelect}
              className="space-y-2"
            >
              {escalation.options!.map((option, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-3 rounded-md border px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={option} id={`option-${index}`} />
                  <Label
                    htmlFor={`option-${index}`}
                    className="flex-1 cursor-pointer text-sm font-normal"
                  >
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        {/* Custom feedback */}
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {hasOptions ? 'Or provide custom feedback' : 'Your response'}
          </Label>
          <Textarea
            placeholder="Type your response or additional guidance..."
            value={customMessage}
            onChange={(e) => handleCustomMessageChange(e.target.value)}
            className="min-h-[80px] resize-none"
            disabled={isResponding}
          />
        </div>

        {/* Context (if provided) */}
        {escalation.context && Object.keys(escalation.context).length > 0 && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span className="font-medium text-muted-foreground">Context: </span>
            <span className="text-muted-foreground font-mono">
              {JSON.stringify(escalation.context)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/30">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReject}
          disabled={isResponding}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isResponding ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <X className="h-4 w-4 mr-1.5" />
          )}
          Reject
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleApprove}
          disabled={isResponding}
        >
          {isResponding ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-1.5" />
          )}
          Approve
        </Button>
        {customMessage.trim() && (
          <Button
            size="sm"
            onClick={handleCustom}
            disabled={isResponding}
          >
            {isResponding ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            Send Response
          </Button>
        )}
      </div>
    </div>
  )
}

export default EscalationPanel
