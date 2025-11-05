/**
 * Preprocesses markdown to convert [[ENTITY-ID]] mentions to HTML that Tiptap can parse
 *
 * Supports multiple reference patterns:
 * - [[i-x7k9]] - basic reference (hash format)
 * - [[i-x7k9|OAuth]] - with display text
 * - [[i-x7k9]]{ implements } - with relationship metadata
 * - [[i-x7k9|OAuth]]{ implements } - with both
 * - [[ISSUE-001]] - legacy format still supported
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
  // 1. entityId (required): i-x7k9, s-14sh (hash format) or ISSUE-001, SPEC-002 (legacy format)
  // 2. displayText (optional): text after |
  // 3. relationshipType (optional): text inside { }
  return markdown.replace(
    /(?<!\\)\[\[((?:[is]-[0-9a-z]{4,8})|(?:[A-Z]+-\d+))(?:\|([^\]]+))?\]\](?:\{\s*([^}]+)\s*\})?/g,
    (_match, entityId, displayText, relationshipType) => {
      // Determine entity type from ID format
      // Hash format: i-xxxx for issues, s-xxxx for specs
      // Legacy format: ISSUE-xxx for issues, SPEC-xxx for specs
      const entityType = (entityId.startsWith('ISSUE-') || entityId.startsWith('i-')) ? 'issue' : 'spec'

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
 * - [[i-x7k9]] - basic reference (hash format)
 * - [[i-x7k9|OAuth]] - with display text
 * - [[i-x7k9]]{ implements } - with relationship metadata
 * - [[i-x7k9|OAuth]]{ implements } - with both
 * - [[ISSUE-001]] - legacy format still supported
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
