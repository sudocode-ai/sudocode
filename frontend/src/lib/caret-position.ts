/**
 * Utility for getting the client rectangle of the caret position in a textarea
 * Used for positioning dropdowns and popovers relative to the cursor
 */

const CARET_PROBE_CHARACTER = '\u200b' // Zero-width space

const mirrorStyleProperties = [
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'textAlign',
  'textTransform',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
] as const

type MirrorStyleProperty = (typeof mirrorStyleProperties)[number]

/**
 * Get the client rectangle of the caret position in a textarea
 * @param textarea The textarea element
 * @param targetIndex Optional specific index to get caret position for (defaults to current selection end)
 * @returns DOMRect of the caret position, or null if not in browser environment
 */
export function getCaretClientRect(
  textarea: HTMLTextAreaElement,
  targetIndex?: number
): DOMRect | null {
  if (typeof window === 'undefined') return null

  const selectionIndex =
    typeof targetIndex === 'number'
      ? Math.min(Math.max(targetIndex, 0), textarea.value.length)
      : (textarea.selectionEnd ?? textarea.value.length)

  const textBeforeCaret = textarea.value.slice(0, selectionIndex)
  const textareaRect = textarea.getBoundingClientRect()
  const computedStyle = window.getComputedStyle(textarea)

  // Create a mirror div that mimics the textarea
  const mirror = document.createElement('div')
  mirror.setAttribute('data-caret-mirror', 'true')
  mirror.style.position = 'absolute'
  mirror.style.top = `${textareaRect.top + window.scrollY}px`
  mirror.style.left = `${textareaRect.left + window.scrollX}px`
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.overflow = 'hidden'
  mirror.style.width = `${textareaRect.width}px`

  // Copy all relevant styles from textarea to mirror
  mirrorStyleProperties.forEach((property: MirrorStyleProperty) => {
    const value = computedStyle[property]
    if (value) {
      mirror.style[property] = value
    }
  })

  // Add the text before the caret
  mirror.textContent = textBeforeCaret

  // Add a probe character at the caret position
  const probe = document.createElement('span')
  probe.textContent = CARET_PROBE_CHARACTER
  mirror.appendChild(probe)

  // Add mirror to DOM, measure probe, then remove
  document.body.appendChild(mirror)
  const caretRect = probe.getBoundingClientRect()
  document.body.removeChild(mirror)

  return caretRect
}
