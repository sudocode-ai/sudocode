/**
 * Prompt resolver service
 *
 * Resolves entity references and file mentions in agent prompts:
 * - Injects [[s-xxxxx]] or @s-xxxxx spec references with markdown content
 * - Injects [[i-xxxxx]] or @i-xxxxx issue references with markdown content
 * - Tracks @file mentions but leaves them for agent to handle
 */

import type Database from "better-sqlite3"
import type { Spec, Issue } from "@sudocode-ai/types"
import { getSpecById } from "./specs.js"
import { getIssueById } from "./issues.js"

/**
 * Reference types found in prompts
 */
export type ReferenceType = "spec" | "issue" | "file"

/**
 * A reference found in a prompt
 */
export interface PromptReference {
  type: ReferenceType
  id: string
  found: boolean
  error?: string
}

/**
 * Result of prompt resolution
 */
export interface PromptResolutionResult {
  resolvedPrompt: string
  references: PromptReference[]
  errors: string[]
}

/**
 * PromptResolver service
 *
 * Extracts and resolves entity references in agent prompts
 */
export class PromptResolver {
  constructor(private db: Database.Database) {}

  /**
   * Resolve all references in a prompt
   *
   * @param prompt - The raw prompt with [[entity-id]], @entity-id, and @file references
   * @returns Resolution result with resolved prompt, references, and errors
   */
  async resolve(prompt: string): Promise<PromptResolutionResult> {
    const references: PromptReference[] = []
    const errors: string[] = []

    // Extract all references (order matters - extract entity IDs first)
    const specRefs = this.extractSpecReferences(prompt)
    const issueRefs = this.extractIssueReferences(prompt)

    // Extract entity IDs for filtering file mentions
    const entityIds = new Set([
      ...specRefs.map(r => r.id),
      ...issueRefs.map(r => r.id)
    ])

    const fileRefs = this.extractFileMentions(prompt, entityIds)

    // Track all references
    references.push(...fileRefs)

    // Resolve and inject specs
    let resolvedPrompt = prompt
    for (const ref of specRefs) {
      const spec = getSpecById(this.db, ref.id)
      if (spec) {
        ref.found = true
        resolvedPrompt = this.replaceReference(
          resolvedPrompt,
          ref.id,
          this.formatSpec(spec)
        )
      } else {
        ref.found = false
        ref.error = `Spec ${ref.id} not found`
        errors.push(ref.error)
      }
      references.push(ref)
    }

    // Resolve and inject issues
    for (const ref of issueRefs) {
      const issue = getIssueById(this.db, ref.id)
      if (issue) {
        ref.found = true
        resolvedPrompt = this.replaceReference(
          resolvedPrompt,
          ref.id,
          this.formatIssue(issue)
        )
      } else {
        ref.found = false
        ref.error = `Issue ${ref.id} not found`
        errors.push(ref.error)
      }
      references.push(ref)
    }

    return {
      resolvedPrompt,
      references,
      errors,
    }
  }

  /**
   * Extract spec references from prompt
   * Supports two patterns:
   * - [[s-xxxxx]] (bracket syntax)
   * - @s-xxxxx (@ mention syntax)
   */
  private extractSpecReferences(prompt: string): PromptReference[] {
    const refs: PromptReference[] = []

    // Extract bracket syntax: [[s-xxxxx]]
    const bracketPattern = /\[\[(s-[a-z0-9]+)\]\]/gi
    const bracketMatches = prompt.matchAll(bracketPattern)
    for (const match of bracketMatches) {
      const id = match[1].toLowerCase()
      if (!refs.some((r) => r.id === id)) {
        refs.push({
          type: "spec",
          id,
          found: false,
        })
      }
    }

    // Extract @ mention syntax: @s-xxxxx
    const mentionPattern = /@(s-[a-z0-9]+)(?=\s|$|[^\w-])/gi
    const mentionMatches = prompt.matchAll(mentionPattern)
    for (const match of mentionMatches) {
      const id = match[1].toLowerCase()
      if (!refs.some((r) => r.id === id)) {
        refs.push({
          type: "spec",
          id,
          found: false,
        })
      }
    }

    return refs
  }

  /**
   * Extract issue references from prompt
   * Supports two patterns:
   * - [[i-xxxxx]] (bracket syntax)
   * - @i-xxxxx (@ mention syntax)
   */
  private extractIssueReferences(prompt: string): PromptReference[] {
    const refs: PromptReference[] = []

    // Extract bracket syntax: [[i-xxxxx]]
    const bracketPattern = /\[\[(i-[a-z0-9]+)\]\]/gi
    const bracketMatches = prompt.matchAll(bracketPattern)
    for (const match of bracketMatches) {
      const id = match[1].toLowerCase()
      if (!refs.some((r) => r.id === id)) {
        refs.push({
          type: "issue",
          id,
          found: false,
        })
      }
    }

    // Extract @ mention syntax: @i-xxxxx
    const mentionPattern = /@(i-[a-z0-9]+)(?=\s|$|[^\w-])/gi
    const mentionMatches = prompt.matchAll(mentionPattern)
    for (const match of mentionMatches) {
      const id = match[1].toLowerCase()
      if (!refs.some((r) => r.id === id)) {
        refs.push({
          type: "issue",
          id,
          found: false,
        })
      }
    }

    return refs
  }

  /**
   * Extract file mentions from prompt
   * Pattern: @filepath (but not @s-xxxxx or @i-xxxxx)
   *
   * Note: File mentions are tracked but not resolved (agent handles them)
   */
  private extractFileMentions(prompt: string, entityIds: Set<string>): PromptReference[] {
    const pattern = /@([^\s@]+)/g
    const matches = prompt.matchAll(pattern)
    const refs: PromptReference[] = []

    for (const match of matches) {
      let path = match[1]

      // Remove trailing punctuation (period, comma, etc.)
      path = path.replace(/[.,;:!?]+$/, '')

      // Skip if it's a spec or issue ID (already handled)
      if (entityIds.has(path.toLowerCase())) {
        continue
      }

      // Avoid duplicates
      if (!refs.some((r) => r.id === path)) {
        refs.push({
          type: "file",
          id: path,
          found: true, // Files are not resolved here, just tracked
        })
      }
    }

    return refs
  }

  /**
   * Replace a reference with formatted content
   * Handles both [[id]] and @id syntaxes
   */
  private replaceReference(
    prompt: string,
    id: string,
    content: string
  ): string {
    // Replace bracket syntax: [[id]]
    const bracketPattern = new RegExp(`\\[\\[${id}\\]\\]`, "gi")
    prompt = prompt.replace(bracketPattern, content)

    // Replace @ mention syntax: @id
    const mentionPattern = new RegExp(`@${id}(?=\\s|$|[^\\w-])`, "gi")
    prompt = prompt.replace(mentionPattern, content)

    return prompt
  }

  /**
   * Format spec - returns raw content only
   */
  private formatSpec(spec: Spec): string {
    return spec.content
  }

  /**
   * Format issue - returns raw content only
   */
  private formatIssue(issue: Issue): string {
    return issue.content
  }
}
