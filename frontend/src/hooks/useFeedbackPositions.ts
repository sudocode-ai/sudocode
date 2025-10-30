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

      const editorRect = editor.getBoundingClientRect()

      feedback.forEach((fb) => {
        const anchor = parseAnchor(fb.anchor)

        // Skip feedback without anchors (general comments)
        if (!anchor) return

        // Try to find element by feedback ID first (from FeedbackMark)
        let element = editor.querySelector<HTMLElement>(
          `[data-feedback-id="${fb.id}"]`
        )

        // If not found, try to find by line number
        if (!element && anchor.line_number !== undefined) {
          // Look for elements with line number data attribute
          element = editor.querySelector<HTMLElement>(
            `[data-line="${anchor.line_number}"]`
          )

          // If still not found, try to calculate approximate position
          // by finding paragraph/line elements and counting down
          if (!element) {
            const allLines = Array.from(
              editor.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, pre')
            )
            if (allLines.length > 0 && anchor.line_number > 0) {
              // Use line number as approximate index (0-based)
              const index = Math.min(anchor.line_number - 1, allLines.length - 1)
              element = allLines[index]
            }
          }
        }

        // If we found an element, calculate its position
        if (element) {
          const rect = element.getBoundingClientRect()
          // Calculate position relative to editor's current viewport
          // This makes feedback move with the visible content as you scroll
          const top = rect.top - editorRect.top
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
