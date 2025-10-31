import { describe, it, expect } from 'vitest'
import { calculateMarkdownLineNumbers } from '@/lib/markdown'

describe('calculateMarkdownLineNumbers', () => {
  it('should return empty array for empty content', () => {
    expect(calculateMarkdownLineNumbers('')).toEqual([])
  })

  it('should identify heading blocks', () => {
    const content = `# Heading 1

## Heading 2

### Heading 3`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 3, 5])
  })

  it('should identify paragraph blocks', () => {
    const content = `First paragraph

Second paragraph

Third paragraph`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 3, 5])
  })

  it('should identify list blocks (only first item)', () => {
    const content = `- Item 1
- Item 2
- Item 3

New paragraph`

    // Only line 1 (start of list) and line 5 (paragraph) should be marked
    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 5])
  })

  it('should handle ordered lists', () => {
    const content = `1. First
2. Second
3. Third`

    // Only the first list item
    expect(calculateMarkdownLineNumbers(content)).toEqual([1])
  })

  it('should identify code blocks', () => {
    const content = `Paragraph before

\`\`\`typescript
const code = 'block';
\`\`\`

Paragraph after`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 3, 7])
  })

  it('should handle blockquotes', () => {
    const content = `> Quote line 1
> Quote line 2

Regular paragraph`

    // Each blockquote line is treated as a block
    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 2, 4])
  })

  it('should handle horizontal rules', () => {
    const content = `Paragraph

---

Another paragraph`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 3, 5])
  })

  it('should handle mixed content types', () => {
    const content = `# Title

Introduction paragraph

## Section

- List item 1
- List item 2

Conclusion paragraph`

    // Line 1: # Title
    // Line 3: Introduction paragraph
    // Line 5: ## Section
    // Line 7: - List item 1 (only first list item counted)
    // Line 10: Conclusion paragraph
    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 3, 5, 7, 10])
  })

  it('should handle content with leading empty lines', () => {
    const content = `

First paragraph`

    expect(calculateMarkdownLineNumbers(content)).toEqual([3])
  })

  it('should handle content with trailing empty lines', () => {
    const content = `First paragraph


`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1])
  })

  it('should handle single line content', () => {
    const content = 'Single line'
    expect(calculateMarkdownLineNumbers(content)).toEqual([1])
  })

  it('should handle code block with empty lines inside', () => {
    const content = `\`\`\`javascript
function test() {

  return true;
}
\`\`\`

Next paragraph`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 8])
  })

  it('should handle multiple lists separated by paragraphs', () => {
    const content = `- First list item 1
- First list item 2

Paragraph between lists

- Second list item 1
- Second list item 2`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 4, 6])
  })

  it('should handle different heading levels', () => {
    const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('should not count lines inside code blocks', () => {
    const content = `\`\`\`
# This is not a heading
- This is not a list
\`\`\`

Real heading below
# Real Heading`

    expect(calculateMarkdownLineNumbers(content)).toEqual([1, 6, 7])
  })

  it('should handle continuous text without breaks', () => {
    const content = `Line 1
Line 2
Line 3`

    // All lines are part of the first block
    expect(calculateMarkdownLineNumbers(content)).toEqual([1])
  })
})
