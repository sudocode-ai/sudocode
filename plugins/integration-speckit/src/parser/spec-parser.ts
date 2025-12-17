/**
 * Spec Parser for Spec-Kit Integration
 *
 * Parses spec.md files from spec-kit and extracts structured data.
 *
 * Expected format:
 * ```markdown
 * # Feature Specification: [FEATURE NAME]
 *
 * **Feature Branch**: feature/xxx
 * **Status**: Draft
 * **Created**: 2024-01-01
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
 * Parsed result from a spec.md file
 */
export interface ParsedSpecKitSpec {
  /** The feature/spec title (without "Feature Specification:" prefix) */
  title: string;
  /** Full raw title as it appears in the file */
  rawTitle: string;
  /** Feature branch name if specified */
  featureBranch: string | null;
  /** Status of the spec (e.g., "Draft", "In Progress", "Complete") */
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
 * Options for parsing spec files
 */
export interface ParseSpecOptions {
  /** Whether to include full content (default: true) */
  includeContent?: boolean;
  /** Whether to extract cross-references (default: true) */
  extractReferences?: boolean;
}

/**
 * Parse a spec.md file and extract structured data
 *
 * @param filePath - Absolute path to the spec.md file
 * @param options - Parsing options
 * @returns Parsed spec data or null if file doesn't exist
 *
 * @example
 * const spec = parseSpec("/project/.specify/specs/001-auth/spec.md");
 * console.log(spec?.title); // "Authentication"
 * console.log(spec?.status); // "Draft"
 */
export function parseSpec(
  filePath: string,
  options: ParseSpecOptions = {}
): ParsedSpecKitSpec | null {
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
      return null; // Invalid spec file without title
    }

    // Clean title by removing prefix
    const title = extractTitleWithPrefixRemoval(lines, [
      "Feature Specification:",
      "Feature Specification",
    ]) || rawTitle;

    // Extract metadata
    const metadata = extractMetadata(lines);

    // Extract specific metadata fields
    const featureBranch = extractFeatureBranch(lines, metadata);
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
      featureBranch,
      status,
      createdAt,
      metadata,
      content,
      crossReferences,
      filePath,
    };
  } catch (error) {
    console.error(`[spec-parser] Failed to parse ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse spec content from a string (for testing or in-memory parsing)
 *
 * @param content - Markdown content string
 * @param filePath - Optional file path for reference
 * @returns Parsed spec data or null
 */
export function parseSpecContent(
  content: string,
  filePath: string = "<string>"
): ParsedSpecKitSpec | null {
  const lines = content.split("\n");

  // Extract raw title
  const rawTitle = extractRawTitle(lines);
  if (!rawTitle) {
    return null;
  }

  // Clean title by removing prefix
  const title = extractTitleWithPrefixRemoval(lines, [
    "Feature Specification:",
    "Feature Specification",
  ]) || rawTitle;

  // Extract metadata
  const metadata = extractMetadata(lines);

  // Extract specific metadata fields
  const featureBranch = extractFeatureBranch(lines, metadata);
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
    featureBranch,
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
 * Extract feature branch from metadata
 */
function extractFeatureBranch(
  lines: string[],
  metadata: Map<string, string>
): string | null {
  // Try "Feature Branch" key first
  const featureBranch = metadata.get("Feature Branch");
  if (featureBranch) {
    return featureBranch;
  }

  // Try direct regex match for flexibility
  for (const line of lines) {
    const match = line.match(PATTERNS.FEATURE_BRANCH);
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
 * Check if a file appears to be a valid spec.md file
 *
 * @param filePath - Path to check
 * @returns true if the file looks like a spec file
 */
export function isSpecFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 10); // Check first 10 lines

    // Look for spec-like title
    for (const line of lines) {
      if (PATTERNS.TITLE.test(line)) {
        // Check if it has "Feature Specification" prefix or feature branch metadata
        const hasSpecPrefix = /Feature Specification/i.test(line);
        const hasFeatureBranch = content.includes("**Feature Branch**");
        return hasSpecPrefix || hasFeatureBranch;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extract just the title from a spec file (fast extraction)
 *
 * @param filePath - Path to the spec file
 * @returns The title or null
 */
export function getSpecFileTitle(filePath: string): string | null {
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
      "Feature Specification:",
      "Feature Specification",
    ]) || rawTitle;
  } catch {
    return null;
  }
}

/**
 * Extract just the status from a spec file (fast extraction)
 *
 * @param filePath - Path to the spec file
 * @returns The status or null
 */
export function getSpecFileStatus(filePath: string): string | null {
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
