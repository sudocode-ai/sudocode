/**
 * MessageStream Component
 *
 * Displays streaming text messages with markdown support and auto-scroll.
 */

import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { MessageBuffer } from '@/types/stream'

export interface MessageStreamProps {
  /**
   * Map of messages to display
   */
  messages: Map<string, MessageBuffer>

  /**
   * Whether to render markdown (default: true)
   */
  renderMarkdown?: boolean

  /**
   * Whether to auto-scroll to latest message (default: true)
   */
  autoScroll?: boolean

  /**
   * Custom class name
   */
  className?: string
}

/**
 * MessageStream Component
 *
 * @example
 * ```tsx
 * <MessageStream messages={messages} renderMarkdown autoScroll />
 * ```
 */
export function MessageStream({
  messages,
  renderMarkdown = true,
  autoScroll = true,
  className = '',
}: MessageStreamProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageArray = Array.from(messages.values())

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messageArray.length, autoScroll])

  if (messageArray.length === 0) {
    return null
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-sm font-medium">Messages</h4>
      {messageArray.map((message) => (
        <div
          key={message.messageId}
          className="rounded-md bg-muted/50 p-3 text-sm"
        >
          {/* Message Header */}
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {message.role}
            </Badge>
            {!message.complete && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Message Content */}
          <div className="text-foreground/90">
            {renderMarkdown ? (
              <ReactMarkdown
                className="prose prose-sm max-w-none dark:prose-invert"
                components={{
                  // Customize markdown rendering
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  code: ({ inline, children, ...props }: any) =>
                    inline ? (
                      <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
                        {children}
                      </code>
                    ) : (
                      <pre className="bg-muted p-2 rounded overflow-x-auto">
                        <code {...props}>{children}</code>
                      </pre>
                    ),
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className="text-primary hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <div className="whitespace-pre-wrap">{message.content}</div>
            )}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
