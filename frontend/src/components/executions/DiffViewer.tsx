/**
 * DiffViewer Component
 *
 * Generic diff viewer component that displays side-by-side code diffs.
 * Uses Monaco Editor's built-in diff viewer for rendering.
 */

import { DiffEditor } from '@monaco-editor/react'
import { useTheme } from '@/contexts/ThemeContext'
import { useState } from 'react'
import { detectLanguage } from '@/utils/languageDetector'

export interface DiffViewerProps {
  /** Content before changes (original) */
  oldContent: string
  /** Content after changes (modified) */
  newContent: string
  /** File path for language detection and display */
  filePath: string
  /** Optional CSS class name */
  className?: string
  /** Maximum lines to show before truncating (default: 50) */
  maxLines?: number
  /** Whether to render side-by-side (default: false) */
  sideBySide?: boolean
}

/**
 * Renders inline code diffs
 */
export function DiffViewer({
  oldContent,
  newContent,
  filePath,
  className = '',
  maxLines = 50,
  sideBySide = false,
}: DiffViewerProps) {
  const { actualTheme } = useTheme()
  const [showFullDiff, setShowFullDiff] = useState(false)

  if (!filePath) {
    return <div className="text-xs text-muted-foreground">No file path specified</div>
  }

  const lineCount = Math.max(oldContent.split('\n').length, newContent.split('\n').length)
  const shouldTruncate = lineCount > maxLines && !showFullDiff

  // Calculate height - if maxLines is very large (like 10000 for modal), use 100% height
  const useFlexHeight = maxLines >= 10000
  const displayHeight = shouldTruncate ? Math.min(lineCount * 19, 400) : lineCount * 19

  // Detect language from file extension for syntax highlighting
  const language = detectLanguage(filePath)

  return (
    <div className={`${className} ${useFlexHeight ? 'h-full' : ''}`}>
      <div
        className={`monaco-diff-wrapper ${shouldTruncate ? 'diff-collapsed cursor-pointer' : ''} ${useFlexHeight ? 'h-full' : ''}`}
        style={
          useFlexHeight
            ? { minHeight: '100px' }
            : { height: `${displayHeight}px`, minHeight: '100px' }
        }
        onClick={() => {
          if (shouldTruncate) {
            setShowFullDiff(true)
          }
        }}
        title={shouldTruncate ? 'Click to expand full diff' : undefined}
      >
        <DiffEditor
          original={oldContent}
          modified={newContent}
          language={language}
          theme={actualTheme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            readOnly: true,
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            folding: false,
            glyphMargin: false,
            wordWrap: 'off',
            overviewRulerLanes: 0,
            scrollbar: {
              vertical: shouldTruncate ? 'hidden' : 'auto',
              horizontal: 'auto',
              alwaysConsumeMouseWheel: false, // Allow page scroll when editor doesn't need it
            },
            renderLineHighlight: 'none',
            occurrencesHighlight: 'off',
            renderSideBySide: sideBySide,
          }}
        />
      </div>

      {lineCount > maxLines && (
        <button
          onClick={() => setShowFullDiff(!showFullDiff)}
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showFullDiff ? `> Collapse diff` : `> Expand full diff (${lineCount} lines)`}
        </button>
      )}
    </div>
  )
}
