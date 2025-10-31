/**
 * Calculate line numbers for markdown blocks based on source content.
 * This identifies where each block-level element starts in the markdown source,
 * ensuring consistency between formatted and source views.
 *
 * @param content - The markdown content as a string
 * @returns Array of line numbers corresponding to block start positions
 */
export function calculateMarkdownLineNumbers(content: string): number[] {
  if (!content) return []

  const lines = content.split('\n')
  const blockLineNumbers: number[] = []

  let inCodeBlock = false
  let inList = false
  let firstContentBlockFound = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Track code blocks
    if (trimmedLine.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      if (!inCodeBlock) {
        inList = false
        continue
      } else {
        blockLineNumbers.push(i + 1)
        firstContentBlockFound = true
        inList = false
        continue
      }
    }

    if (inCodeBlock) {
      continue
    }

    // Skip empty lines
    if (!trimmedLine) {
      inList = false
      continue
    }

    // Check if this is a block-level element
    const isHeading = /^#{1,6}\s/.test(trimmedLine)
    const isBulletList = /^[-*+]\s/.test(trimmedLine)
    const isOrderedList = /^\d+\.\s/.test(trimmedLine)
    const isBlockquote = trimmedLine.startsWith('>')
    const isHorizontalRule = /^[-*_]{3,}$/.test(trimmedLine)

    // For lists, only count the first item
    if (isBulletList || isOrderedList) {
      if (!inList) {
        blockLineNumbers.push(i + 1)
        firstContentBlockFound = true
        inList = true
      }
      // Skip subsequent list items
      continue
    }

    // Non-list items end the list
    inList = false

    // Add block if it's a special element or starts a new block
    // For the first content block, use its actual line number regardless of position
    if (isHeading || isBlockquote || isHorizontalRule) {
      blockLineNumbers.push(i + 1)
      firstContentBlockFound = true
    } else if (!firstContentBlockFound || !lines[i - 1]?.trim()) {
      // Regular paragraph: add if it's the first content block or preceded by empty line
      blockLineNumbers.push(i + 1)
      firstContentBlockFound = true
    }
  }

  return blockLineNumbers
}
