/**
 * Context aggregation engine - collects learnings from completed specs/issues
 */

import type Database from "better-sqlite3";
import type { Issue, Spec, CompletionSummary } from "../types.js";
import { listIssues } from "../operations/issues.js";
import { listSpecs } from "../operations/specs.js";

export interface AggregatedPattern {
  pattern: string;
  occurrences: number;
  sources: Array<{ id: string; type: "issue" | "spec"; title: string }>;
  first_seen: string;
  last_seen: string;
}

export interface AggregatedDecision {
  decision: string;
  rationale: string;
  alternatives_considered: string[];
  source: { id: string; type: "issue" | "spec"; title: string };
  date: string;
}

export interface AggregatedContext {
  // Patterns that worked
  successful_patterns: AggregatedPattern[];

  // Anti-patterns to avoid
  anti_patterns: AggregatedPattern[];

  // Common blocking factors
  common_blockers: AggregatedPattern[];

  // Key architectural decisions
  decisions: AggregatedDecision[];

  // Code patterns introduced
  code_patterns: AggregatedPattern[];

  // Dependencies used
  dependencies: AggregatedPattern[];

  // Metrics
  metrics: {
    total_completions: number;
    avg_completion_time: number;
    total_issues_analyzed: number;
    total_specs_analyzed: number;
    date_range: {
      start: string;
      end: string;
    };
  };
}

/**
 * Aggregate learnings from all completed issues and specs
 */
export function aggregateContext(
  db: Database.Database,
  options: {
    since?: string; // ISO date string
    archived?: boolean;
    limit?: number;
  } = {}
): AggregatedContext {
  // Get completed issues
  const issues = listIssues(db, {
    status: "closed",
    archived: options.archived,
    limit: options.limit,
  }).filter(i => i.completion_summary);

  // Get completed specs
  const specs = listSpecs(db, {
    archived: options.archived !== false, // Default to true for specs
    limit: options.limit,
  }).filter(s => s.completion_summary);

  // Filter by date if specified
  const allEntities = [...issues, ...specs].filter(entity => {
    if (!options.since) return true;
    const entityDate = "closed_at" in entity ? entity.closed_at : entity.archived_at;
    return entityDate && entityDate >= options.since;
  });

  // Initialize aggregated context
  const context: AggregatedContext = {
    successful_patterns: [],
    anti_patterns: [],
    common_blockers: [],
    decisions: [],
    code_patterns: [],
    dependencies: [],
    metrics: {
      total_completions: allEntities.length,
      avg_completion_time: 0,
      total_issues_analyzed: issues.length,
      total_specs_analyzed: specs.length,
      date_range: {
        start: "",
        end: "",
      },
    },
  };

  // Track dates for metrics
  const dates: string[] = [];
  const completionTimes: number[] = [];

  // Aggregate patterns
  const successfulPatternsMap = new Map<string, AggregatedPattern>();
  const antiPatternsMap = new Map<string, AggregatedPattern>();
  const blockersMap = new Map<string, AggregatedPattern>();
  const codePatternsMap = new Map<string, AggregatedPattern>();
  const dependenciesMap = new Map<string, AggregatedPattern>();

  for (const entity of allEntities) {
    const summary = entity.completion_summary!;
    const entityType: "issue" | "spec" = "status" in entity ? "issue" : "spec";
    const source = { id: entity.id, type: entityType, title: entity.title };
    const date = "closed_at" in entity
      ? entity.closed_at || entity.updated_at
      : entity.archived_at || entity.updated_at;

    dates.push(date);

    // Track completion time
    if (summary.time_to_complete) {
      completionTimes.push(summary.time_to_complete);
    }

    // Aggregate what_worked
    for (const pattern of summary.what_worked) {
      aggregatePattern(successfulPatternsMap, pattern, source, date);
    }

    // Aggregate what_failed
    for (const pattern of summary.what_failed) {
      aggregatePattern(antiPatternsMap, pattern, source, date);
    }

    // Aggregate blocking_factors
    for (const blocker of summary.blocking_factors) {
      aggregatePattern(blockersMap, blocker, source, date);
    }

    // Aggregate code_patterns_introduced
    for (const codePattern of summary.code_patterns_introduced) {
      aggregatePattern(codePatternsMap, codePattern, source, date);
    }

    // Aggregate dependencies_discovered
    for (const dep of summary.dependencies_discovered) {
      aggregatePattern(dependenciesMap, dep, source, date);
    }

    // Collect decisions
    for (const decision of summary.key_decisions) {
      context.decisions.push({
        ...decision,
        source,
        date,
      });
    }
  }

  // Convert maps to sorted arrays
  context.successful_patterns = sortPatterns(successfulPatternsMap);
  context.anti_patterns = sortPatterns(antiPatternsMap);
  context.common_blockers = sortPatterns(blockersMap);
  context.code_patterns = sortPatterns(codePatternsMap);
  context.dependencies = sortPatterns(dependenciesMap);

  // Sort decisions by date (most recent first)
  context.decisions.sort((a, b) => b.date.localeCompare(a.date));

  // Calculate metrics
  if (dates.length > 0) {
    dates.sort();
    context.metrics.date_range.start = dates[0];
    context.metrics.date_range.end = dates[dates.length - 1];
  }

  if (completionTimes.length > 0) {
    const sum = completionTimes.reduce((a, b) => a + b, 0);
    context.metrics.avg_completion_time = Math.round((sum / completionTimes.length) * 10) / 10;
  }

  return context;
}

/**
 * Helper to aggregate a pattern
 */
function aggregatePattern(
  map: Map<string, AggregatedPattern>,
  pattern: string,
  source: { id: string; type: "issue" | "spec"; title: string },
  date: string
): void {
  const existing = map.get(pattern);

  if (existing) {
    existing.occurrences++;
    existing.sources.push(source);
    existing.last_seen = date;
  } else {
    map.set(pattern, {
      pattern,
      occurrences: 1,
      sources: [source],
      first_seen: date,
      last_seen: date,
    });
  }
}

/**
 * Convert pattern map to sorted array (by occurrences, descending)
 */
function sortPatterns(map: Map<string, AggregatedPattern>): AggregatedPattern[] {
  return Array.from(map.values()).sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Get recently completed items (useful for incremental updates)
 */
export function getRecentCompletions(
  db: Database.Database,
  since: string,
  options: { limit?: number } = {}
): Array<Issue | Spec> {
  const issues = listIssues(db, {
    status: "closed",
    limit: options.limit,
  }).filter(i =>
    i.completion_summary &&
    i.closed_at &&
    i.closed_at >= since
  );

  const specs = listSpecs(db, {
    archived: true,
    limit: options.limit,
  }).filter(s =>
    s.completion_summary &&
    s.archived_at &&
    s.archived_at >= since
  );

  return [...issues, ...specs].sort((a, b) => {
    const dateA = "closed_at" in a ? a.closed_at || "" : a.archived_at || "";
    const dateB = "closed_at" in b ? b.closed_at || "" : b.archived_at || "";
    return dateB.localeCompare(dateA);
  });
}

/**
 * Get statistics about completion summaries
 */
export function getCompletionStats(db: Database.Database): {
  total_with_summaries: number;
  total_issues_with_summaries: number;
  total_specs_with_summaries: number;
  total_without_summaries: number;
  coverage_percentage: number;
} {
  const allIssues = listIssues(db, { status: "closed" });
  const allSpecs = listSpecs(db, { archived: true });

  const issuesWithSummaries = allIssues.filter(i => i.completion_summary).length;
  const specsWithSummaries = allSpecs.filter(s => s.completion_summary).length;
  const totalWithSummaries = issuesWithSummaries + specsWithSummaries;
  const totalCompleted = allIssues.length + allSpecs.length;
  const totalWithoutSummaries = totalCompleted - totalWithSummaries;

  return {
    total_with_summaries: totalWithSummaries,
    total_issues_with_summaries: issuesWithSummaries,
    total_specs_with_summaries: specsWithSummaries,
    total_without_summaries: totalWithoutSummaries,
    coverage_percentage: totalCompleted > 0
      ? Math.round((totalWithSummaries / totalCompleted) * 100)
      : 0,
  };
}
