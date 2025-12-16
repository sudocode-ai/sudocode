/**
 * Plan Parser for Spec-Kit Integration
 *
 * Parses plan.md files from spec-kit and extracts structured data.
 *
 * Expected format:
 * ```markdown
 * # Implementation Plan: [FEATURE]
 *
 * **Branch**: feature/xxx
 * **Spec**: [[s-001-spec]] or spec.md link
 * **Status**: Draft
 *
 * ## Overview
 * ...
 * ```
 */

import { readFileSync, existsSync } from "fs";
import {
  PATTERNS,
  extractMetadata,
  extractTitleWithPrefixRemoval,
  extractCrossReferences,
  findContentStartIndex,
  parseDate,
  normalizeStatus,
} from "./markdown-utils.js";

/**
 * Parsed result from a plan.md file
 */
export interface ParsedSpecKitPlan {
  /** The feature/plan title (without "Implementation Plan:" prefix) */
  title: string;
  /** Full raw title as it appears in the file */
  rawTitle: string;
  /** Branch name if specified */
  branch: string | null;
  /** Reference to the parent spec (ID or path) */
  specReference: string | null;
  /** Status of the plan (e.g., "Draft", "In Progress", "Complete") */
  status: string | null;
  /** Creation date */
  createdAt: Date | null;
  /** All metadata key-value pairs */
  metadata: Map<string, string>;
  /** Main content (everything after metadata section) */
  content: string;
  /** Cross-references found in the content */
  crossReferences: Array<{ id: string; displayText?: string }>;
  /** Source file path */
  filePath: string;
}

/**
 * Options for parsing plan files
 */
export interface ParsePlanOptions {
  /** Whether to include full content (default: true) */
  includeContent?: boolean;
  /** Whether to extract cross-references (default: true) */
  extractReferences?: boolean;
}

/**
 * Parse a plan.md file and extract structured data
 *
 * @param filePath - Absolute path to the plan.md file
 * @param options - Parsing options
 * @returns Parsed plan data or null if file doesn't exist
 *
 * @example
 * const plan = parsePlan("/project/.specify/specs/001-auth/plan.md");
 * console.log(plan?.title); // "Authentication"
 * console.log(plan?.specReference); // "spec.md" or "s-001-spec"
 */
export function parsePlan(
  filePath: string,
  options: ParsePlanOptions = {}
): ParsedSpecKitPlan | null {
  const { includeContent = true, extractReferences = true } = options;

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const rawContent = readFileSync(filePath, "utf-8");
    const lines = rawContent.split("\n");

    // Extract raw title
    const rawTitle = extractRawTitle(lines);
    if (!rawTitle) {
      return null; // Invalid plan file without title
    }

    // Clean title by removing prefix
    const title = extractTitleWithPrefixRemoval(lines, [
      "Implementation Plan:",
      "Implementation Plan",
    ]) || rawTitle;

    // Extract metadata
    const metadata = extractMetadata(lines);

    // Extract specific metadata fields
    const branch = extractBranch(lines, metadata);
    const specReference = extractSpecReference(lines, metadata);
    const status = extractStatus(metadata);
    const createdAt = extractCreatedDate(metadata);

    // Extract main content
    let content = "";
    if (includeContent) {
      const contentStartIndex = findContentStartIndex(lines);
      content = lines.slice(contentStartIndex).join("\n").trim();
    }

    // Extract cross-references
    let crossReferences: Array<{ id: string; displayText?: string }> = [];
    if (extractReferences) {
      crossReferences = extractCrossReferences(rawContent);
    }

    return {
      title,
      rawTitle,
      branch,
      specReference,
      status,
      createdAt,
      metadata,
      content,
      crossReferences,
      filePath,
    };
  } catch (error) {
    console.error(`[plan-parser] Failed to parse ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse plan content from a string (for testing or in-memory parsing)
 *
 * @param content - Markdown content string
 * @param filePath - Optional file path for reference
 * @returns Parsed plan data or null
 */
export function parsePlanContent(
  content: string,
  filePath: string = "<string>"
): ParsedSpecKitPlan | null {
  const lines = content.split("\n");

  // Extract raw title
  const rawTitle = extractRawTitle(lines);
  if (!rawTitle) {
    return null;
  }

  // Clean title by removing prefix
  const title = extractTitleWithPrefixRemoval(lines, [
    "Implementation Plan:",
    "Implementation Plan",
  ]) || rawTitle;

  // Extract metadata
  const metadata = extractMetadata(lines);

  // Extract specific metadata fields
  const branch = extractBranch(lines, metadata);
  const specReference = extractSpecReference(lines, metadata);
  const status = extractStatus(metadata);
  const createdAt = extractCreatedDate(metadata);

  // Extract main content
  const contentStartIndex = findContentStartIndex(lines);
  const mainContent = lines.slice(contentStartIndex).join("\n").trim();

  // Extract cross-references
  const crossReferences = extractCrossReferences(content);

  return {
    title,
    rawTitle,
    branch,
    specReference,
    status,
    createdAt,
    metadata,
    content: mainContent,
    crossReferences,
    filePath,
  };
}

/**
 * Extract the raw title from lines
 */
function extractRawTitle(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(PATTERNS.TITLE);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Extract branch from metadata
 */
function extractBranch(
  lines: string[],
  metadata: Map<string, string>
): string | null {
  // Try "Branch" key first
  const branch = metadata.get("Branch");
  if (branch) {
    return branch;
  }

  // Also try "Feature Branch" for consistency
  const featureBranch = metadata.get("Feature Branch");
  if (featureBranch) {
    return featureBranch;
  }

  // Try direct regex match for flexibility
  for (const line of lines) {
    const branchMatch = line.match(PATTERNS.BRANCH);
    if (branchMatch) {
      return branchMatch[1].trim();
    }

    const featureBranchMatch = line.match(PATTERNS.FEATURE_BRANCH);
    if (featureBranchMatch) {
      return featureBranchMatch[1].trim();
    }
  }

  return null;
}

/**
 * Extract spec reference from metadata
 */
function extractSpecReference(
  lines: string[],
  metadata: Map<string, string>
): string | null {
  // Try "Spec" key
  const spec = metadata.get("Spec");
  if (spec) {
    // Clean up [[...]] if present
    const refMatch = spec.match(/\[\[([^\]]+)\]\]/);
    if (refMatch) {
      return refMatch[1].trim();
    }
    return spec;
  }

  // Try direct regex match
  for (const line of lines) {
    const match = line.match(PATTERNS.SPEC_LINK);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract status from metadata
 */
function extractStatus(metadata: Map<string, string>): string | null {
  const status = metadata.get("Status") || metadata.get("status");
  if (status) {
    return normalizeStatus(status);
  }
  return null;
}

/**
 * Extract created date from metadata
 */
function extractCreatedDate(metadata: Map<string, string>): Date | null {
  const created = metadata.get("Created") || metadata.get("created");
  if (created) {
    return parseDate(created);
  }
  return null;
}

/**
 * Check if a file appears to be a valid plan.md file
 *
 * @param filePath - Path to check
 * @returns true if the file looks like a plan file
 */
export function isPlanFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 10); // Check first 10 lines

    // Look for plan-like title
    for (const line of lines) {
      if (PATTERNS.TITLE.test(line)) {
        // Check if it has "Implementation Plan" prefix or spec reference metadata
        const hasPlanPrefix = /Implementation Plan/i.test(line);
        const hasSpecRef = content.includes("**Spec**");
        return hasPlanPrefix || hasSpecRef;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extract just the title from a plan file (fast extraction)
 *
 * @param filePath - Path to the plan file
 * @returns The title or null
 */
export function getPlanFileTitle(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 5); // Only check first 5 lines

    const rawTitle = extractRawTitle(lines);
    if (!rawTitle) {
      return null;
    }

    return extractTitleWithPrefixRemoval(lines, [
      "Implementation Plan:",
      "Implementation Plan",
    ]) || rawTitle;
  } catch {
    return null;
  }
}

/**
 * Extract just the status from a plan file (fast extraction)
 *
 * @param filePath - Path to the plan file
 * @returns The status or null
 */
export function getPlanFileStatus(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 15); // Check first 15 lines for metadata
    const metadata = extractMetadata(lines);
    return extractStatus(metadata);
  } catch {
    return null;
  }
}
