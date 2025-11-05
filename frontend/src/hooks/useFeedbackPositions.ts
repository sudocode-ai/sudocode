import { useEffect, useState, useRef, RefObject } from 'react'
import type { IssueFeedback, FeedbackAnchor } from '@/types/api'

/**
 * Simple debounce helper
 */
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Parse anchor from string to FeedbackAnchor object
 */
function parseAnchor(anchor: string | undefined): FeedbackAnchor | null {
  if (!anchor) return null
  try {
    return JSON.parse(anchor) as FeedbackAnchor
  } catch {
    return null
  }
}

/**
 * Hook for tracking vertical positions of feedback anchors in the document
 *
 * Returns a Map of feedback IDs to their vertical positions (top offset from editor)
 * Updates positions on scroll, resize, and feedback changes with debouncing
 *
 * @param feedback Array of feedback items to track
 * @param editorRef Ref to the editor element containing the document
 * @returns Map of feedback ID to vertical position in pixels
 */
export function useFeedbackPositions(
  feedback: IssueFeedback[],
  editorRef: RefObject<HTMLElement>
): Map<string, number> {
  const [positions, setPositions] = useState<Map<string, number>>(new Map())
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const updatePositions = () => {
      const newPositions = new Map<string, number>()
      const editor = editorRef.current

      if (!editor) {
        setPositions(newPositions)
        return
      }

      feedback.forEach((fb) => {
        const anchor = parseAnchor(fb.anchor)

        // Skip feedback without anchors (general comments)
        if (!anchor) return

        // Try to find element by feedback ID first (from FeedbackMark)
        let element = editor.querySelector<HTMLElement>(`[data-feedback-id="${fb.id}"]`)

        // If not found, try to find by line number
        if (!element && anchor.line_number !== undefined) {
          // Look for elements with line number data attribute
          element = editor.querySelector<HTMLElement>(`[data-line-number="${anchor.line_number}"]`)

          // If still not found, find the closest line number
          // (line numbers are sparse due to frontmatter, code blocks, etc.)
          if (!element) {
            const allLines = Array.from(editor.querySelectorAll<HTMLElement>('[data-line-number]'))

            if (allLines.length > 0 && anchor.line_number > 0) {
              // Find the element with the closest line number <= target
              let closestElement: HTMLElement | null = null
              let closestLineNumber = 0

              for (const line of allLines) {
                const lineNumber = parseInt(line.getAttribute('data-line-number') || '0')
                if (lineNumber > 0 && lineNumber <= anchor.line_number) {
                  if (lineNumber > closestLineNumber) {
                    closestLineNumber = lineNumber
                    closestElement = line
                  }
                }
              }

              element = closestElement || allLines[0]
            }
          }
        }

        // If still not found and we have text snippet, search by text content
        if (!element && anchor.text_snippet) {
          const cleanSnippet = anchor.text_snippet.replace(/\.\.\./g, '').trim()

          if (cleanSnippet) {
            // Search all elements with data-line-number for matching text
            const allLines = Array.from(editor.querySelectorAll<HTMLElement>('[data-line-number]'))
            for (const line of allLines) {
              if (line.textContent?.includes(cleanSnippet)) {
                element = line
                break // Use first match
              }
            }
          }
        }

        // If we found an element, calculate its position
        if (element) {
          // Get position relative to the document (offsetTop) rather than viewport
          // This gives us the absolute position within the scrollable content
          let top = 0
          let el: HTMLElement | null = element

          // Walk up the tree to calculate offsetTop relative to the scroll container
          while (el && el !== editor) {
            top += el.offsetTop
            el = el.offsetParent as HTMLElement
          }

          newPositions.set(fb.id, top)
        }
      })

      setPositions(newPositions)
    }

    // Smooth scroll handler using requestAnimationFrame
    const handleScroll = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = requestAnimationFrame(updatePositions)
    }

    // Debounced version only for resize (scroll uses RAF)
    const debouncedResize = debounce(updatePositions, 100)

    // Setup event listeners
    const editor = editorRef.current
    editor?.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', debouncedResize)

    // Initial update (immediate, not debounced)
    // Delay slightly to allow DOM to render
    updateTimeoutRef.current = setTimeout(updatePositions, 50)

    // Cleanup
    return () => {
      editor?.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', debouncedResize)
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [feedback, editorRef])

  return positions
}
