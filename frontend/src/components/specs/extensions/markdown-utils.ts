/**
 * Preprocesses markdown to convert [[ENTITY-ID]] mentions to HTML that Tiptap can parse
 *
 * Supports multiple reference patterns:
 * - [[ISSUE-001]] - basic reference
 * - [[ISSUE-001|OAuth]] - with display text
 * - [[ISSUE-001]]{ implements } - with relationship metadata
 * - [[ISSUE-001|OAuth]]{ implements } - with both
 *
 * Converts to HTML spans that Tiptap can parse into EntityMention nodes.
 *
 * @param markdown - The raw markdown content
 * @returns Markdown with entity mentions converted to HTML spans
 */
export function preprocessEntityMentions(markdown: string): string {
  // Match [[ENTITY-ID|displayText]]{ relationshipType } patterns
  // Uses negative lookbehind to skip escaped brackets (\[\[)
  // Captures:
  // 1. entityId (required): ISSUE-001, SPEC-002, etc.
  // 2. displayText (optional): text after |
  // 3. relationshipType (optional): text inside { }
  return markdown.replace(
    /(?<!\\)\[\[([A-Z]+-\d+)(?:\|([^\]]+))?\]\](?:\{\s*([^}]+)\s*\})?/g,
    (_match, entityId, displayText, relationshipType) => {
      const entityType = entityId.startsWith('ISSUE-') ? 'issue' : 'spec'

      // Trim whitespace from captured groups
      const trimmedDisplayText = displayText?.trim()
      const trimmedRelationshipType = relationshipType?.trim()

      const attrs = [
        `data-entity-id="${entityId}"`,
        `data-entity-type="${entityType}"`,
        trimmedDisplayText ? `data-display-text="${escapeHtml(trimmedDisplayText)}"` : '',
        trimmedRelationshipType ? `data-relationship-type="${escapeHtml(trimmedRelationshipType)}"` : '',
      ]
        .filter(Boolean)
        .join(' ')

      // Display text takes precedence, otherwise show entity ID
      const displayContent = trimmedDisplayText || entityId

      return `<span ${attrs}>${escapeHtml(displayContent)}</span>`
    }
  )
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Postprocesses HTML to convert entity mention HTML back to [[ENTITY-ID]] format
 *
 * Reconstructs the original reference format including display text and relationship type:
 * - [[ISSUE-001]] - basic reference
 * - [[ISSUE-001|OAuth]] - with display text
 * - [[ISSUE-001]]{ implements } - with relationship metadata
 * - [[ISSUE-001|OAuth]]{ implements } - with both
 *
 * This is used when exporting from Tiptap back to markdown.
 *
 * @param html - The HTML content from Tiptap
 * @returns HTML with entity mentions converted back to [[ENTITY-ID]] format
 */
export function postprocessEntityMentions(html: string): string {
  // Convert entity mention spans back to [[ENTITY-ID]] format
  // Need to extract all attributes to reconstruct the original format
  return html.replace(
    /<span[^>]*data-entity-id="([^"]+)"[^>]*>.*?<\/span>/g,
    (match) => {
      // Extract entity ID (required)
      const entityIdMatch = match.match(/data-entity-id="([^"]+)"/)
      const entityId = entityIdMatch ? entityIdMatch[1] : ''

      // Extract display text (optional)
      const displayTextMatch = match.match(/data-display-text="([^"]+)"/)
      const displayText = displayTextMatch ? unescapeHtml(displayTextMatch[1]) : null

      // Extract relationship type (optional)
      const relationshipMatch = match.match(/data-relationship-type="([^"]+)"/)
      const relationshipType = relationshipMatch ? unescapeHtml(relationshipMatch[1]) : null

      // Reconstruct the reference
      let ref = `[[${entityId}`

      if (displayText) {
        ref += `|${displayText}`
      }

      ref += ']]'

      if (relationshipType) {
        ref += `{ ${relationshipType} }`
      }

      return ref
    }
  )
}

/**
 * Unescape HTML special characters
 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}
