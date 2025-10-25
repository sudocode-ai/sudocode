import { useMemo } from 'react'
import { Card } from '@/components/ui/card'

interface SpecViewerProps {
  content: string
  showLineNumbers?: boolean
  highlightLines?: number[]
  className?: string
}

export function SpecViewer({
  content,
  showLineNumbers = true,
  highlightLines = [],
  className = '',
}: SpecViewerProps) {
  const lines = useMemo(() => {
    return content.split('\n')
  }, [content])

  return (
    <Card className={`overflow-hidden ${className}`}>
      <div className="relative">
        {/* Content with line numbers */}
        <div className="flex">
          {/* Line numbers column */}
          {showLineNumbers && (
            <div className="select-none border-r border-border bg-muted/30 px-4 py-4">
              {lines.map((_, index) => (
                <div
                  key={index}
                  className={`text-right font-mono text-xs leading-6 text-muted-foreground ${
                    highlightLines.includes(index + 1) ? 'font-bold text-primary' : ''
                  }`}
                  data-line-number={index + 1}
                >
                  {index + 1}
                </div>
              ))}
            </div>
          )}

          {/* Content column */}
          <div className="flex-1 overflow-x-auto px-4 py-4">
            {lines.map((line, index) => (
              <div
                key={index}
                className={`font-mono text-sm leading-6 ${
                  highlightLines.includes(index + 1)
                    ? 'bg-primary/10'
                    : ''
                }`}
                data-line={index + 1}
              >
                {/* Preserve whitespace and render line content */}
                <pre className="m-0 inline whitespace-pre-wrap break-words font-mono">
                  {line || ' '}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
