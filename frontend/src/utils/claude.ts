/**
 * Utilities for working with Claude Code tool outputs
 */

export interface ClaudeEditChange {
  type: 'edit'
  diff: string
}

export interface ClaudeEditArgs {
  path: string
  changes: ClaudeEditChange[]
}

/**
 * Convert Claude Edit tool search-replace format to unified diff format
 *
 * Claude format is search-replace blocks:
 * - Lines starting with "-" begin the SEARCH block (old_string to find)
 * - Lines starting with "+" begin the REPLACE block (new_string to insert)
 * - All subsequent unprefixed lines belong to the current block
 * - This is a search-replace operation, not a traditional diff
 *
 * Unified diff format: Standard git-style diff with @@ headers and each line prefixed
 */
export function claudeDiffToUnified(args: ClaudeEditArgs): string {
  const { path, changes } = args

  // Build unified diff header
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`]

  // Process each change (search-replace pair)
  changes.forEach((change) => {
    const diffLines = change.diff.split('\n')

    const searchBlock: string[] = []
    const replaceBlock: string[] = []
    let inSearchBlock = false
    let inReplaceBlock = false

    diffLines.forEach((line) => {
      if (line.startsWith('-')) {
        // Start of search block (text to remove)
        inSearchBlock = true
        inReplaceBlock = false
        searchBlock.push(line.slice(1)) // Remove "-" prefix
      } else if (line.startsWith('+')) {
        // Start of replace block (text to add)
        inSearchBlock = false
        inReplaceBlock = true
        replaceBlock.push(line.slice(1)) // Remove "+" prefix
      } else if (inSearchBlock) {
        // Continuation of search block
        searchBlock.push(line)
      } else if (inReplaceBlock) {
        // Continuation of replace block
        replaceBlock.push(line)
      }
    })

    // Add hunk header
    lines.push(`@@ -1,${searchBlock.length} +1,${replaceBlock.length} @@`)

    // Add search block (deletions)
    searchBlock.forEach((line) => {
      lines.push('-' + line)
    })

    // Add replace block (additions)
    replaceBlock.forEach((line) => {
      lines.push('+' + line)
    })
  })

  return lines.join('\n')
}

/**
 * Extract old and new content from Claude search-replace format
 * Returns separate strings for the "before" and "after" state
 *
 * Claude format is search-replace blocks:
 * - Lines starting with "-" begin the SEARCH block (old_string to find)
 * - Lines starting with "+" begin the REPLACE block (new_string to insert)
 * - All subsequent unprefixed lines belong to the current block
 * - This represents what was found and what it was replaced with
 */
export function extractOldAndNewContent(args: ClaudeEditArgs): {
  oldContent: string
  newContent: string
} {
  const allSearchBlocks: string[] = []
  const allReplaceBlocks: string[] = []

  // Process each change (may have multiple search-replace operations)
  args.changes.forEach((change) => {
    const diffLines = change.diff.split('\n')

    const searchBlock: string[] = []
    const replaceBlock: string[] = []
    let inSearchBlock = false
    let inReplaceBlock = false

    diffLines.forEach((line) => {
      if (line.startsWith('-')) {
        // Start of search block (old text)
        inSearchBlock = true
        inReplaceBlock = false
        searchBlock.push(line.slice(1)) // Remove "-" prefix
      } else if (line.startsWith('+')) {
        // Start of replace block (new text)
        inSearchBlock = false
        inReplaceBlock = true
        replaceBlock.push(line.slice(1)) // Remove "+" prefix
      } else if (inSearchBlock) {
        // Continuation of search block
        searchBlock.push(line)
      } else if (inReplaceBlock) {
        // Continuation of replace block
        replaceBlock.push(line)
      }
    })

    if (searchBlock.length > 0) allSearchBlocks.push(searchBlock.join('\n'))
    if (replaceBlock.length > 0) allReplaceBlocks.push(replaceBlock.join('\n'))
  })

  return {
    oldContent: allSearchBlocks.join('\n\n'),
    newContent: allReplaceBlocks.join('\n\n'),
  }
}

/**
 * Get a display-friendly summary of changes
 * Counts lines in search (deleted) and replace (added) blocks
 */
export function getDiffSummary(args: ClaudeEditArgs): {
  additions: number
  deletions: number
  totalChanges: number
} {
  let additions = 0
  let deletions = 0

  args.changes.forEach((change) => {
    const diffLines = change.diff.split('\n')
    let inSearchBlock = false
    let inReplaceBlock = false

    diffLines.forEach((line) => {
      if (line.startsWith('-')) {
        // Start of search block (lines to remove)
        inSearchBlock = true
        inReplaceBlock = false
        deletions++
      } else if (line.startsWith('+')) {
        // Start of replace block (lines to add)
        inSearchBlock = false
        inReplaceBlock = true
        additions++
      } else if (inSearchBlock) {
        deletions++
      } else if (inReplaceBlock) {
        additions++
      }
    })
  })

  return {
    additions,
    deletions,
    totalChanges: args.changes.length,
  }
}

/**
 * Parse Claude Code tool arguments to extract diff content
 * Handles both Edit and Write tools
 *
 * @param toolName - The name of the tool ('Edit')
 * @param argsJson - JSON string containing tool arguments
 * @returns Object with oldContent, newContent, and filePath
 */
export function parseClaudeToolArgs(
  toolName: string,
  argsJson: string
): {
  oldContent: string
  newContent: string
  filePath: string
} {
  const parsedArgs = JSON.parse(argsJson)
  const filePath = parsedArgs.path || parsedArgs.file_path || ''

  if (toolName === 'Edit') {
    const { oldContent, newContent } = extractOldAndNewContent(parsedArgs as ClaudeEditArgs)
    return { oldContent, newContent, filePath }
  }

  throw new Error(`Unsupported tool: ${toolName}`)
}
