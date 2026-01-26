import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { executionsApi } from '@/lib/api'

interface MessageInputProps {
  executionId: string
  disabled?: boolean
  onSent?: () => void
  placeholder?: string
}

/**
 * MessageInput - Send messages to an active execution
 *
 * For agents that support inject (like Claude Code), the message is queued
 * for the next turn without interrupting current work.
 *
 * For other agents, falls back to interrupt which cancels current work
 * and processes the new message immediately.
 */
export function MessageInput({
  executionId,
  disabled = false,
  onSent,
  placeholder = 'Send message...',
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmedMessage = message.trim()
      if (!trimmedMessage || sending) return

      setSending(true)
      try {
        // Response interceptor unwraps ApiResponse, throws on error
        const result = await executionsApi.inject(executionId, trimmedMessage)

        setMessage('')
        onSent?.()

        // Show toast only for interrupt method (inject is seamless)
        if (result.method === 'interrupt') {
          toast.info('Message sent via interrupt')
        }
      } catch (error) {
        console.error('Failed to inject message:', error)
        toast.error(
          error instanceof Error ? error.message : 'Failed to send message'
        )
      } finally {
        setSending(false)
      }
    },
    [executionId, message, sending, onSent]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Submit on Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (message.trim() && !sending && !disabled) {
        handleSubmit(e)
      }
    }
  }

  const canSubmit = message.trim().length > 0 && !sending && !disabled

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || sending}
        className="flex-1"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!canSubmit}
        variant="ghost"
        className="shrink-0"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  )
}
