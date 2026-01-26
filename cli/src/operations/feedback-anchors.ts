/**
 * Feedback anchor creation and manipulation utilities
 */

import * as crypto from 'crypto';
import type { FeedbackAnchor } from '../types.js';

export interface SectionInfo {
  heading: string;
  level: number;
  startLine: number;
}

/**
 * Create a feedback anchor at a specific line in spec content
 */
export function createFeedbackAnchor(
  specContent: string,
  lineNumber: number,
  charOffset?: number
): FeedbackAnchor {
  const lines = specContent.split('\n');

  // Validate line number
  if (lineNumber < 1 || lineNumber > lines.length) {
    throw new Error(`Line number ${lineNumber} is out of range (1-${lines.length})`);
  }

  const targetLine = lines[lineNumber - 1];

  // Find containing section
  const section = findContainingSection(lines, lineNumber);

  // Extract snippet with context
  const snippet = extractSnippet(targetLine, charOffset, 50);
  const contextBefore = getContext(lines, lineNumber, -50);
  const contextAfter = getContext(lines, lineNumber, 50);

  // Calculate relative offset from section start
  const lineOffset = section ? lineNumber - section.startLine : undefined;

  // Create content hash for validation
  const hash = createContentHash(snippet);

  return {
    section_heading: section?.heading,
    section_level: section?.level,
    line_number: lineNumber,
    line_offset: lineOffset,
    text_snippet: snippet,
    context_before: contextBefore,
    context_after: contextAfter,
    content_hash: hash,
    anchor_status: 'valid',
    last_verified_at: new Date().toISOString(),
    original_location: {
      line_number: lineNumber,
      section_heading: section?.heading,
    },
  };
}

/**
 * Create a feedback anchor by searching for text in spec content
 */
export function createAnchorByText(
  specContent: string,
  searchText: string
): FeedbackAnchor | null {
  const lines = specContent.split('\n');

  // Find the first line containing the search text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const index = line.indexOf(searchText);

    if (index !== -1) {
      // Found it! Create anchor at this location
      const lineNumber = i + 1;
      return createFeedbackAnchor(specContent, lineNumber, index);
    }
  }

  // Not found
  return null;
}

/**
 * Find the section (markdown heading) containing a given line
 * Walks backwards from the line to find the nearest heading
 */
export function findContainingSection(
  lines: string[],
  lineNumber: number
): SectionInfo | null {
  // Walk backwards from the target line
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = lines[i];
    // Handle Windows line endings by trimming \r
    const match = line.match(/^(#{1,6})\s+(.+?)(\r)?$/);

    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();
      return {
        heading,
        level,
        startLine: i + 1,
      };
    }
  }

  return null;
}

/**
 * Extract a text snippet from a line with optional character offset
 */
export function extractSnippet(
  line: string,
  charOffset?: number,
  maxLength: number = 50
): string {
  if (!line || line.trim() === '') {
    return '';
  }

  // Trim the line first
  const trimmed = line.trim();
  let start = 0;
  let end = trimmed.length;

  if (charOffset !== undefined) {
    // Adjust offset for trimmed line
    const leadingSpaces = line.length - line.trimStart().length;
    const adjustedOffset = Math.max(0, charOffset - leadingSpaces);

    // Center snippet around the char offset
    const halfLen = Math.floor(maxLength / 2);
    start = Math.max(0, adjustedOffset - halfLen);
    end = Math.min(trimmed.length, adjustedOffset + halfLen);
  } else {
    // Take from start
    end = Math.min(trimmed.length, maxLength);
  }

  let snippet = trimmed.substring(start, end);

  // Add ellipsis if truncated (no space before ellipsis)
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < trimmed.length) {
    snippet = snippet + '...';
  }

  return snippet;
}

/**
 * Get context around a line (before or after)
 * @param chars Number of characters to get (negative for before, positive for after)
 */
export function getContext(
  lines: string[],
  fromLine: number,
  chars: number
): string {
  if (chars === 0) {
    return '';
  }

  const direction = chars > 0 ? 1 : -1;
  const maxChars = Math.abs(chars);
  let collected = '';
  let currentLine = fromLine - 1; // Convert to 0-indexed

  if (direction > 0) {
    // Get context after
    currentLine += 1; // Start from next line
  } else {
    // Get context before
    currentLine -= 1; // Start from previous line
  }

  while (
    currentLine >= 0 &&
    currentLine < lines.length &&
    collected.length < maxChars
  ) {
    const line = lines[currentLine];
    const remaining = maxChars - collected.length;

    if (direction > 0) {
      // Adding after - append
      if (collected.length > 0) {
        collected += ' ';
      }
      collected += line.substring(0, remaining);
    } else {
      // Adding before - prepend
      const start = Math.max(0, line.length - remaining);
      const chunk = line.substring(start);
      if (collected.length > 0) {
        collected = chunk + ' ' + collected;
      } else {
        collected = chunk;
      }
    }

    currentLine += direction;
  }

  return collected.trim();
}

/**
 * Create a content hash for quick validation
 */
export function createContentHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Verify that an anchor still points to the expected location
 */
export function verifyAnchor(
  specContent: string,
  anchor: FeedbackAnchor
): boolean {
  if (!anchor.line_number) {
    return false;
  }

  const lines = specContent.split('\n');

  if (anchor.line_number < 1 || anchor.line_number > lines.length) {
    return false;
  }

  const targetLine = lines[anchor.line_number - 1];

  // Check if the line still contains the snippet (remove ellipsis for matching)
  if (anchor.text_snippet && anchor.text_snippet.trim()) {
    const cleanSnippet = anchor.text_snippet.replace(/\.\.\./g, '').trim();
    if (cleanSnippet && !targetLine.includes(cleanSnippet)) {
      return false;
    }
  }

  // Check content hash if available (most reliable check)
  if (anchor.content_hash && anchor.text_snippet && anchor.text_snippet.trim()) {
    const currentSnippet = extractSnippet(targetLine, undefined, 50);
    if (currentSnippet) {
      const currentHash = createContentHash(currentSnippet);
      if (currentHash !== anchor.content_hash) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Get all section headings from spec content
 */
export function getAllSections(specContent: string): SectionInfo[] {
  const lines = specContent.split('\n');
  const sections: SectionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Handle Windows line endings
    const match = line.match(/^(#{1,6})\s+(.+?)(\r)?$/);

    if (match) {
      sections.push({
        heading: match[2].trim(),
        level: match[1].length,
        startLine: i + 1,
      });
    }
  }

  return sections;
}

/**
 * Search for text with context matching
 * Returns all matching locations with confidence scores
 */
export function searchByContent(
  specContent: string,
  snippet?: string,
  contextBefore?: string,
  contextAfter?: string
): Array<{ lineNumber: number; confidence: number }> {
  if (!snippet) {
    return [];
  }

  const lines = specContent.split('\n');
  const results: Array<{ lineNumber: number; confidence: number }> = [];

  // Clean snippet (remove ellipsis)
  const cleanSnippet = snippet.replace(/\.\.\./g, '').trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes(cleanSnippet)) {
      let confidence = 0.5; // Base confidence for snippet match

      // Boost confidence if context matches
      if (contextBefore) {
        const actualBefore = getContext(lines, i + 1, -50);
        if (actualBefore.includes(contextBefore.substring(0, 20))) {
          confidence += 0.25;
        }
      }

      if (contextAfter) {
        const actualAfter = getContext(lines, i + 1, 50);
        if (actualAfter.includes(contextAfter.substring(0, 20))) {
          confidence += 0.25;
        }
      }

      results.push({
        lineNumber: i + 1,
        confidence: Math.min(confidence, 1.0),
      });
    }
  }

  // Sort by confidence (highest first)
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of section headings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create a 2D array for dynamic programming
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Calculate distances
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Find the best matching section using fuzzy matching
 * Returns section with lowest edit distance (Levenshtein)
 */
export function findFuzzySection(
  specContent: string,
  targetHeading: string,
  maxDistance: number = 5
): SectionInfo | null {
  const sections = getAllSections(specContent);

  if (sections.length === 0) {
    return null;
  }

  // Normalize headings for comparison (lowercase, trim)
  const normalizedTarget = targetHeading.toLowerCase().trim();

  let bestMatch: SectionInfo | null = null;
  let bestDistance = Infinity;

  for (const section of sections) {
    const normalizedHeading = section.heading.toLowerCase().trim();
    const distance = levenshteinDistance(normalizedTarget, normalizedHeading);

    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      bestMatch = section;
    }
  }

  return bestMatch;
}

/**
 * Relocate a feedback anchor when spec content changes
 * Uses cascade strategy:
 * 1. Section + Line Offset (if section unchanged)
 * 2. Content Search (snippet + context)
 * 3. Fuzzy Section Match (Levenshtein distance)
 * 4. Mark as Stale (preserve original)
 *
 * @returns The relocated anchor, or null if anchor was null/undefined
 */
export function relocateFeedbackAnchor(
  oldSpecContent: string,
  newSpecContent: string,
  anchor: FeedbackAnchor | null | undefined
): FeedbackAnchor | null {
  // Handle null/undefined anchor - feedback without anchors should be preserved unchanged
  if (!anchor) {
    return null;
  }

  // First, verify if anchor is still valid at original location
  if (verifyAnchor(newSpecContent, anchor)) {
    return {
      ...anchor,
      anchor_status: 'valid',
      last_verified_at: new Date().toISOString(),
    };
  }

  // Strategy 1: Try Section + Line Offset
  if (anchor.section_heading && anchor.line_offset !== undefined) {
    const sections = getAllSections(newSpecContent);
    const matchingSection = sections.find(
      (s) => s.heading === anchor.section_heading
    );

    if (matchingSection) {
      const newLineNumber = matchingSection.startLine + anchor.line_offset;
      const lines = newSpecContent.split('\n');

      if (newLineNumber > 0 && newLineNumber <= lines.length) {
        const targetLine = lines[newLineNumber - 1];

        // Verify this looks right (check if snippet is close)
        if (anchor.text_snippet) {
          const cleanSnippet = anchor.text_snippet.replace(/\.\.\./g, '').trim();
          if (cleanSnippet && targetLine.includes(cleanSnippet)) {
            // Success! Create new anchor at relocated position
            const newAnchor = createFeedbackAnchor(newSpecContent, newLineNumber);
            return {
              ...newAnchor,
              anchor_status: 'relocated',
              last_verified_at: new Date().toISOString(),
              original_location: anchor.original_location || {
                line_number: anchor.line_number || 0,
                section_heading: anchor.section_heading,
              },
            };
          }
        }
      }
    }
  }

  // Strategy 2: Content Search with Context
  if (anchor.text_snippet) {
    const matches = searchByContent(
      newSpecContent,
      anchor.text_snippet,
      anchor.context_before,
      anchor.context_after
    );

    if (matches.length > 0 && matches[0].confidence >= 0.7) {
      // High confidence match found
      const newAnchor = createFeedbackAnchor(newSpecContent, matches[0].lineNumber);
      return {
        ...newAnchor,
        anchor_status: 'relocated',
        last_verified_at: new Date().toISOString(),
        original_location: anchor.original_location || {
          line_number: anchor.line_number || 0,
          section_heading: anchor.section_heading,
        },
      };
    }
  }

  // Strategy 3: Fuzzy Section Match
  if (anchor.section_heading && anchor.line_offset !== undefined) {
    const fuzzyMatch = findFuzzySection(newSpecContent, anchor.section_heading, 5);

    if (fuzzyMatch) {
      const newLineNumber = fuzzyMatch.startLine + anchor.line_offset;
      const lines = newSpecContent.split('\n');

      if (newLineNumber > 0 && newLineNumber <= lines.length) {
        const newAnchor = createFeedbackAnchor(newSpecContent, newLineNumber);
        return {
          ...newAnchor,
          anchor_status: 'relocated',
          last_verified_at: new Date().toISOString(),
          original_location: anchor.original_location || {
            line_number: anchor.line_number || 0,
            section_heading: anchor.section_heading,
          },
        };
      }
    }
  }

  // Strategy 4: Mark as Stale - preserve original but mark invalid
  return {
    ...anchor,
    anchor_status: 'stale',
    last_verified_at: new Date().toISOString(),
    original_location: anchor.original_location || {
      line_number: anchor.line_number || 0,
      section_heading: anchor.section_heading,
    },
  };
}

/**
 * Relocate all feedback anchors for a spec when its content changes
 * Returns summary of relocation results
 */
export interface RelocationResult {
  feedback_id: string;
  old_status: 'valid' | 'relocated' | 'stale';
  new_status: 'valid' | 'relocated' | 'stale';
  relocated: boolean;
}

export interface RelocationSummary {
  total: number;
  valid: number;
  relocated: number;
  stale: number;
  results: RelocationResult[];
}

export function relocateSpecFeedback(
  oldSpecContent: string,
  newSpecContent: string,
  feedbackList: Array<{ id: string; anchor: FeedbackAnchor | null | undefined }>
): RelocationSummary {
  const results: RelocationResult[] = [];
  let validCount = 0;
  let relocatedCount = 0;
  let staleCount = 0;

  for (const feedback of feedbackList) {
    // Skip feedback without anchors - they should be preserved unchanged
    if (!feedback.anchor) {
      continue;
    }

    const oldStatus = feedback.anchor.anchor_status;
    const newAnchor = relocateFeedbackAnchor(
      oldSpecContent,
      newSpecContent,
      feedback.anchor
    );

    // newAnchor should never be null here since we checked feedback.anchor above
    if (!newAnchor) {
      continue;
    }

    const relocated = newAnchor.anchor_status === 'relocated';

    if (newAnchor.anchor_status === 'valid') {
      validCount++;
    } else if (newAnchor.anchor_status === 'relocated') {
      relocatedCount++;
    } else {
      staleCount++;
    }

    results.push({
      feedback_id: feedback.id,
      old_status: oldStatus,
      new_status: newAnchor.anchor_status,
      relocated,
    });

    // Note: Actual database update should be done by the caller
    // This function only performs the relocation logic
  }

  return {
    total: feedbackList.length,
    valid: validCount,
    relocated: relocatedCount,
    stale: staleCount,
    results,
  };
}
