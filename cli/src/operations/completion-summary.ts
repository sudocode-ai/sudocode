/**
 * Utilities for working with completion summaries
 */

import type Database from "better-sqlite3";
import type {
  CompletionSummary,
  Spec,
  Issue,
} from "@sudocode-ai/types";

/**
 * Parse completion_summary from database row
 */
export function parseCompletionSummary(
  row: any
): CompletionSummary | undefined {
  if (!row.completion_summary) {
    return undefined;
  }

  try {
    return JSON.parse(row.completion_summary) as CompletionSummary;
  } catch (error) {
    console.error("Failed to parse completion_summary:", error);
    return undefined;
  }
}

/**
 * Serialize completion_summary for database storage
 */
export function serializeCompletionSummary(
  summary: CompletionSummary | undefined
): string | null {
  if (!summary) {
    return null;
  }

  return JSON.stringify(summary);
}

/**
 * Transform database row to Spec with parsed completion_summary
 */
export function rowToSpec(row: any): Spec {
  const spec: Spec = {
    ...row,
    archived: Boolean(row.archived),
    completion_summary: parseCompletionSummary(row),
  };
  return spec;
}

/**
 * Transform database row to Issue with parsed completion_summary
 */
export function rowToIssue(row: any): Issue {
  const issue: Issue = {
    ...row,
    archived: Boolean(row.archived),
    completion_summary: parseCompletionSummary(row),
  };
  return issue;
}

/**
 * Validate completion summary structure
 */
export function validateCompletionSummary(
  summary: any
): summary is CompletionSummary {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  // Check required arrays
  const requiredArrays = [
    "what_worked",
    "what_failed",
    "blocking_factors",
    "key_decisions",
    "code_patterns_introduced",
    "dependencies_discovered",
  ];

  for (const field of requiredArrays) {
    if (!Array.isArray(summary[field])) {
      return false;
    }
  }

  // Validate key_decisions structure
  if (!summary.key_decisions.every((d: any) =>
    d &&
    typeof d.decision === "string" &&
    typeof d.rationale === "string" &&
    Array.isArray(d.alternatives_considered)
  )) {
    return false;
  }

  return true;
}

/**
 * Create an empty completion summary template
 */
export function createEmptyCompletionSummary(): CompletionSummary {
  return {
    what_worked: [],
    what_failed: [],
    blocking_factors: [],
    key_decisions: [],
    code_patterns_introduced: [],
    dependencies_discovered: [],
  };
}
