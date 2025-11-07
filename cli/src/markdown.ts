/**
 * Markdown parser with frontmatter support
 */

import matter from "gray-matter";
import * as fs from "fs";
import type Database from "better-sqlite3";
import { getSpec } from "./operations/specs.js";
import { getIssue } from "./operations/issues.js";
import { getSession } from "./operations/sessions.js";
import { createFeedbackAnchor } from "./operations/feedback-anchors.js";
import type { LocationAnchor } from "@sudocode-ai/types";

export interface ParsedMarkdown<T extends object = Record<string, any>> {
  /**
   * Parsed frontmatter data
   */
  data: T;
  /**
   * Markdown content (without frontmatter)
   */
  content: string;
  /**
   * Original raw content
   */
  raw: string;
  /**
   * Cross-references found in content
   */
  references: CrossReference[];
}

export interface CrossReference {
  /**
   * The full matched text (e.g., "[[spec-001]]", "[[@issue-042]]", or "[[SESS-001]]")
   */
  match: string;
  /**
   * The entity ID (e.g., "spec-001", "issue-042", or "SESS-001")
   */
  id: string;
  /**
   * Entity type (spec, issue, or session)
   */
  type: "spec" | "issue" | "session";
  /**
   * Position in content
   */
  index: number;
  /**
   * Optional display text (e.g., "Authentication" from "[[spec-001|Authentication]]")
   */
  displayText?: string;
  /**
   * Optional relationship type (e.g., "blocks" from "[[spec-001]]{ blocks }")
   * Defaults to "references" if not specified
   */
  relationshipType?: string;
  /**
   * Optional location anchor for spatial context of the reference
   */
  anchor?: LocationAnchor;
}

/**
 * Parse markdown file with YAML frontmatter
 * @param content - Markdown content to parse
 * @param db - Optional database for validating cross-references
 * @param outputDir - Optional output directory for loading config metadata
 */
export function parseMarkdown<T extends object = Record<string, any>>(
  content: string,
  db?: Database.Database,
  outputDir?: string
): ParsedMarkdown<T> {
  const parsed = matter(content);

  // Extract cross-references from content
  const references = extractCrossReferences(parsed.content, db);

  return {
    data: parsed.data as T,
    content: parsed.content,
    raw: content,
    references,
  };
}

/**
 * Parse markdown file from disk
 * @param filePath - Path to markdown file
 * @param db - Optional database for validating cross-references
 * @param outputDir - Optional output directory for loading config metadata
 */
export function parseMarkdownFile<T extends object = Record<string, any>>(
  filePath: string,
  db?: Database.Database,
  outputDir?: string
): ParsedMarkdown<T> {
  const content = fs.readFileSync(filePath, "utf8");
  return parseMarkdown<T>(content, db, outputDir);
}

/**
 * Convert character index to line number
 */
function getLineNumber(content: string, charIndex: number): number {
  const beforeMatch = content.substring(0, charIndex);
  return beforeMatch.split("\n").length;
}

/**
 * Convert FeedbackAnchor to LocationAnchor (strips tracking fields)
 */
function feedbackAnchorToLocationAnchor(
  feedbackAnchor: ReturnType<typeof createFeedbackAnchor>
): LocationAnchor {
  return {
    section_heading: feedbackAnchor.section_heading,
    section_level: feedbackAnchor.section_level,
    line_number: feedbackAnchor.line_number,
    line_offset: feedbackAnchor.line_offset,
    text_snippet: feedbackAnchor.text_snippet,
    context_before: feedbackAnchor.context_before,
    context_after: feedbackAnchor.context_after,
    content_hash: feedbackAnchor.content_hash,
  };
}

/**
 * Extract cross-references from markdown content
 * Supports formats:
 * - [[i-x7k9]] or [[s-14sh]] - hash-based entity reference
 * - [[SESS-001]] - session reference
 * - [[@i-x7k9]] - entity reference with @ prefix (for clarity)
 * - [[i-x7k9|Display Text]] - with custom display text
 * - [[i-x7k9]]{ blocks } - with relationship type (shorthand)
 * - [[i-x7k9]]{ type: blocks } - with relationship type (explicit)
 * - [[i-x7k9|Display]]{ blocks } - combination of display text and type
 *
 * If db is provided, validates references against the database and determines entity type.
 * Only returns references to entities that actually exist.
 *
 * If db is not provided, determines entity type from hash-based ID prefix (i- or s-) or SESS- prefix.
 */
export function extractCrossReferences(
  content: string,
  db?: Database.Database
): CrossReference[] {
  const references: CrossReference[] = [];

  // Pattern: [[optional-@][entity-id][|display-text]]optional-metadata
  // Supports hash-based IDs and session IDs:
  // - [[i-x7k9]] or [[s-14sh]]
  // - [[SESS-001]]
  // - [[i-x7k9|Display Text]]
  // - [[i-x7k9]]{ blocks }
  // - [[i-x7k9]]{ type: depends-on }
  const refPattern =
    /\[\[(@)?([is]-[0-9a-z]{4,8}|SESS-\d{3,})(?:\|([^\]]+))?\]\](?:\{\s*(?:type:\s*)?([a-z-]+)\s*\})?/gi;

  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(content)) !== null) {
    const hasAt = match[1] === "@";
    const id = match[2];
    const displayText = match[3]?.trim();
    const relationshipType = match[4]?.trim();

    // Create location anchor for this reference
    let anchor: LocationAnchor | undefined;
    try {
      const lineNumber = getLineNumber(content, match.index);
      const feedbackAnchor = createFeedbackAnchor(
        content,
        lineNumber,
        match.index
      );
      anchor = feedbackAnchorToLocationAnchor(feedbackAnchor);
    } catch (error) {
      // If anchor creation fails, continue without it
      anchor = undefined;
    }

    if (db) {
      let entityType: "spec" | "issue" | "session" | null = null;
      try {
        const spec = getSpec(db, id);
        if (spec) {
          entityType = "spec";
        }
      } catch (error) {}

      if (!entityType) {
        try {
          const issue = getIssue(db, id);
          if (issue) {
            entityType = "issue";
          }
        } catch (error) {}
      }

      if (!entityType) {
        try {
          const session = getSession(db, id);
          if (session) {
            entityType = "session";
          }
        } catch (error) {}
      }

      if (entityType) {
        references.push({
          match: match[0],
          id,
          type: entityType,
          index: match.index,
          displayText,
          relationshipType,
          anchor,
        });
      }
    } else {
      // Determine type from hash-based ID prefix or SESS prefix
      // Hash IDs always use i- for issues, s- for specs
      // Session IDs use SESS- prefix
      let type: "spec" | "issue" | "session";
      if (id.startsWith("i-")) {
        type = "issue";
      } else if (id.startsWith("s-")) {
        type = "spec";
      } else if (id.startsWith("SESS-")) {
        type = "session";
      } else {
        // Fallback (should not happen with current regex)
        type = "spec";
      }

      references.push({
        match: match[0],
        id,
        type,
        index: match.index,
        displayText,
        relationshipType,
        anchor,
      });
    }
  }

  return references;
}

/**
 * Stringify frontmatter and content back to markdown
 */
export function stringifyMarkdown<T extends object = Record<string, any>>(
  data: T,
  content: string
): string {
  return matter.stringify(content, data);
}

/**
 * Update frontmatter in an existing markdown file
 * Preserves content unchanged
 */
export function updateFrontmatter<T extends object = Record<string, any>>(
  originalContent: string,
  updates: Partial<T>
): string {
  const parsed = matter(originalContent);

  // Merge updates into existing frontmatter
  const merged = {
    ...parsed.data,
    ...updates,
  };

  // Remove keys with undefined values (allows explicit removal of fields)
  const newData = Object.fromEntries(
    Object.entries(merged).filter(([_, value]) => value !== undefined)
  );

  return matter.stringify(parsed.content, newData);
}

/**
 * Update frontmatter in a file
 */
export function updateFrontmatterFile<T extends object = Record<string, any>>(
  filePath: string,
  updates: Partial<T>
): void {
  const content = fs.readFileSync(filePath, "utf8");
  const updated = updateFrontmatter(content, updates);
  fs.writeFileSync(filePath, updated, "utf8");
}

/**
 * Check if a file has frontmatter
 */
export function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith("---");
}

/**
 * Create markdown with frontmatter
 */
export function createMarkdown<T extends object = Record<string, any>>(
  data: T,
  content: string
): string {
  return stringifyMarkdown(data, content);
}

/**
 * Write markdown file with frontmatter
 */
export function writeMarkdownFile<T extends object = Record<string, any>>(
  filePath: string,
  data: T,
  content: string
): void {
  const markdown = createMarkdown(data, content);
  fs.writeFileSync(filePath, markdown, "utf8");
}

/**
 * Remove frontmatter from markdown content
 */
export function removeFrontmatter(content: string): string {
  const parsed = matter(content);
  return parsed.content;
}

/**
 * Get only frontmatter data from markdown
 */
export function getFrontmatter<T extends object = Record<string, any>>(
  content: string
): T {
  const parsed = matter(content);
  return parsed.data as T;
}

// ============================================================================
// FEEDBACK MARKDOWN FUNCTIONS
// ============================================================================

export interface FeedbackMarkdownData {
  id: string;
  specId: string;
  specTitle?: string;
  type: string;
  location: {
    section?: string;
    line?: number;
    status: "valid" | "relocated" | "stale";
  };
  status: string;
  content: string;
  createdAt: string;
  resolution?: string;
}

/**
 * Parse feedback section from issue markdown content
 * Looks for "## Spec Feedback Provided" section
 */
export function parseFeedbackSection(content: string): FeedbackMarkdownData[] {
  const feedback: FeedbackMarkdownData[] = [];

  // Look for "## Spec Feedback Provided" section
  const feedbackSectionMatch = content.match(/^## Spec Feedback Provided\s*$/m);
  if (!feedbackSectionMatch) {
    return feedback;
  }

  const startIndex =
    feedbackSectionMatch.index! + feedbackSectionMatch[0].length;

  // Find the end of this section (next ## heading or end of content)
  const remainingContent = content.slice(startIndex);
  const endMatch = remainingContent.match(/^## /m);
  const sectionContent = endMatch
    ? remainingContent.slice(0, endMatch.index)
    : remainingContent;

  // Parse individual feedback items (### heading for each)
  const feedbackPattern =
    /^### (FB-\d+) → ([a-z]+-\d+)(?: \((.*?)\))?\s*\n\*\*Type:\*\* (.+?)\s*\n\*\*Location:\*\* (.*?)\s*\n\*\*Status:\*\* (.+?)\s*\n\n([\s\S]*?)(?=\n###|$)/gm;

  let match;
  while ((match = feedbackPattern.exec(sectionContent)) !== null) {
    const [, id, specId, specTitle, type, locationStr, status, content] = match;

    // Parse location string: "## Section Name, line 45 ✓" or "line 45 ⚠" or "Unknown ✗"
    const locationMatch = locationStr.match(
      /(?:(.+?),\s+)?line (\d+)\s*([✓⚠✗])/
    );

    const feedbackData: FeedbackMarkdownData = {
      id,
      specId,
      specTitle: specTitle || undefined,
      type: type.trim(),
      location: {
        section: locationMatch?.[1]?.trim(),
        line: locationMatch?.[2] ? parseInt(locationMatch[2]) : undefined,
        status:
          locationMatch?.[3] === "✓"
            ? "valid"
            : locationMatch?.[3] === "⚠"
              ? "relocated"
              : "stale",
      },
      status: status.trim(),
      content: content.trim(),
      createdAt: "", // Would need to parse from content or get from DB
    };

    // Check for resolution
    const resolutionMatch = content.match(/\*\*Resolution:\*\* (.+)/);
    if (resolutionMatch) {
      feedbackData.resolution = resolutionMatch[1].trim();
    }

    feedback.push(feedbackData);
  }

  return feedback;
}

/**
 * Format feedback data for inclusion in issue markdown
 */
export function formatFeedbackForIssue(
  feedback: FeedbackMarkdownData[]
): string {
  if (feedback.length === 0) {
    return "";
  }

  let output = "\n## Spec Feedback Provided\n\n";

  for (const fb of feedback) {
    // Determine status indicator
    const statusIndicator =
      fb.location.status === "valid"
        ? "✓"
        : fb.location.status === "relocated"
          ? "⚠"
          : "✗";

    // Format location
    let locationStr = "";
    if (fb.location.section && fb.location.line) {
      locationStr = `${fb.location.section}, line ${fb.location.line} ${statusIndicator}`;
    } else if (fb.location.line) {
      locationStr = `line ${fb.location.line} ${statusIndicator}`;
    } else {
      locationStr = `Unknown ${statusIndicator}`;
    }

    const titlePart = fb.specTitle ? ` (${fb.specTitle})` : "";

    output += `### ${fb.id} → ${fb.specId}${titlePart}\n`;
    output += `**Type:** ${fb.type}  \n`;
    output += `**Location:** ${locationStr}  \n`;
    output += `**Status:** ${fb.status}\n\n`;
    output += `${fb.content}\n`;

    if (fb.resolution) {
      output += `\n**Resolution:** ${fb.resolution}\n`;
    }

    output += "\n";
  }

  return output;
}

/**
 * Append or update feedback section in issue markdown
 */
export function updateFeedbackInIssue(
  issueContent: string,
  feedback: FeedbackMarkdownData[]
): string {
  // Remove existing feedback section if present
  const feedbackSectionMatch = issueContent.match(
    /^## Spec Feedback Provided\s*$/m
  );

  if (feedbackSectionMatch) {
    const startIndex = feedbackSectionMatch.index!;

    // Find the end of this section (next ## heading or end of content)
    const remainingContent = issueContent.slice(startIndex);
    const endMatch = remainingContent.match(/^## /m);

    if (endMatch && endMatch.index! > 0) {
      // There's another section after feedback
      const endIndex = startIndex + endMatch.index!;
      issueContent =
        issueContent.slice(0, startIndex) + issueContent.slice(endIndex);
    } else {
      // Feedback section is at the end
      issueContent = issueContent.slice(0, startIndex);
    }
  }

  // Append new feedback section
  const feedbackMarkdown = formatFeedbackForIssue(feedback);
  if (feedbackMarkdown) {
    // Ensure there's a blank line before the new section
    issueContent = issueContent.trimEnd() + "\n" + feedbackMarkdown;
  }

  return issueContent;
}
