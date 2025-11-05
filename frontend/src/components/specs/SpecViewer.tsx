import { useMemo, useRef, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { FeedbackAnchor } from './FeedbackAnchor'
import type { IssueFeedback, FeedbackAnchor as FeedbackAnchorType } from '@/types/api'

interface SpecViewerProps {
  content: string
  showLineNumbers?: boolean
  highlightLines?: number[]
  feedback?: IssueFeedback[]
  selectedLine?: number | null
  onLineClick?: (lineNumber: number) => void
  onTextSelect?: (text: string, lineNumber: number) => void
  onFeedbackClick?: (feedback: IssueFeedback) => void
  editable?: boolean
  onChange?: (content: string) => void
  className?: string
}

export function SpecViewer({
  content,
  showLineNumbers = true,
  highlightLines = [],
  feedback = [],
  selectedLine,
  onLineClick,
  onTextSelect,
  onFeedbackClick,
  editable = false,
  onChange,
  className = '',
}: SpecViewerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lines = useMemo(() => {
    return content.split('\n')
  }, [content])

  // Map feedback to line numbers
  const feedbackByLine = useMemo(() => {
    const map = new Map<number, IssueFeedback[]>()
    feedback.forEach((fb) => {
      try {
        const anchor: FeedbackAnchorType | null = fb.anchor ? JSON.parse(fb.anchor) : null

        if (anchor?.line_number) {
          const existing = map.get(anchor.line_number) || []
          map.set(anchor.line_number, [...existing, fb])
        } else if (anchor?.text_snippet) {
          // Handle text-based anchors by searching for the text in content
          const cleanSnippet = anchor.text_snippet.replace(/\.\.\./g, '').trim()

          if (cleanSnippet) {
            const contentLines = content.split('\n')
            let found = false
            for (let i = 0; i < contentLines.length; i++) {
              if (contentLines[i].includes(cleanSnippet)) {
                const lineNumber = i + 1
                const existing = map.get(lineNumber) || []
                map.set(lineNumber, [...existing, fb])
                found = true
                break // Only match first occurrence
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse feedback anchor:', error)
      }
    })
    return map
  }, [feedback, content])

  const handleLineClick = (lineNumber: number) => {
    onLineClick?.(lineNumber)
  }

  const handleMouseUp = (lineNumber: number) => {
    if (!onTextSelect) return

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()

    if (selectedText && selectedText.length > 0) {
      onTextSelect(selectedText, lineNumber)
    }
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (editable && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [content, editable])

  return (
    <Card className={`overflow-hidden ${className}`}>
      <div className="relative">
        {editable ? (
          /* Editable mode: Simple textarea without line numbers */
          <div className="px-4 py-4">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              className="w-full resize-none border-none bg-transparent font-mono text-sm leading-6 outline-none focus:ring-0"
              spellCheck={false}
            />
          </div>
        ) : (
          /* Read-only mode: Grid with line numbers and content */
          <div
            className={`grid overflow-x-auto ${
              showLineNumbers ? 'grid-cols-[auto_1fr]' : 'grid-cols-1'
            }`}
          >
            {lines.flatMap((line, index) => {
              const lineNumber = index + 1
              const lineFeedback = feedbackByLine.get(lineNumber) || []

              const cells = []

              // Line number cell
              if (showLineNumbers) {
                cells.push(
                  <div
                    key={`line-${index}`}
                    className={`select-none border-r border-border bg-muted/30 px-4 py-1 text-right font-mono text-xs leading-6 text-muted-foreground transition-colors hover:bg-primary/10 ${
                      highlightLines.includes(lineNumber) ? 'font-bold text-primary' : ''
                    } ${selectedLine === lineNumber ? 'bg-primary/20' : ''}`}
                    data-line-number={lineNumber}
                    onClick={() => handleLineClick(lineNumber)}
                  >
                    {lineNumber}
                  </div>
                )
              }

              // Content cell
              cells.push(
                <div
                  key={`content-${index}`}
                  className={`group relative px-4 py-1 font-mono text-sm leading-6 ${
                    highlightLines.includes(lineNumber) ? 'bg-primary/10' : ''
                  } ${selectedLine === lineNumber ? 'bg-primary/20' : ''}`}
                  data-line={lineNumber}
                >
                  <div className="flex items-start gap-2">
                    {/* Line content */}
                    <pre
                      className="m-0 inline flex-1 cursor-pointer whitespace-pre-wrap break-words font-mono transition-colors hover:bg-muted/30"
                      onClick={() => handleLineClick(lineNumber)}
                      onMouseUp={() => handleMouseUp(lineNumber)}
                    >
                      {line || ' '}
                    </pre>

                    {/* Feedback anchors */}
                    {lineFeedback.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {/* Group feedback by type and show one anchor per type */}
                        {Array.from(new Set(lineFeedback.map((f) => f.feedback_type))).map(
                          (type) => {
                            const feedbackOfType = lineFeedback.filter(
                              (f) => f.feedback_type === type
                            )
                            return (
                              <FeedbackAnchor
                                key={type}
                                type={type}
                                count={feedbackOfType.length}
                                onClick={() => onFeedbackClick?.(feedbackOfType[0])}
                              />
                            )
                          }
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )

              return cells
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
