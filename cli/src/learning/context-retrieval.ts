/**
 * Context retrieval system - finds relevant learnings for new work
 */

import type Database from "better-sqlite3";
import type { Issue, Spec, CompletionSummary } from "../types.js";
import { listIssues, searchIssues, getIssue } from "../operations/issues.js";
import { listSpecs, searchSpecs, getSpec } from "../operations/specs.js";
import { getOutgoingRelationships, getIncomingRelationships } from "../operations/relationships.js";
import { getTags } from "../operations/tags.js";

export interface RelevantContext {
  // Similar completed work
  similar_issues: Array<{
    issue: Issue;
    similarity_score: number;
    similarity_reasons: string[];
  }>;

  similar_specs: Array<{
    spec: Spec;
    similarity_score: number;
    similarity_reasons: string[];
  }>;

  // Applicable patterns
  applicable_patterns: Array<{
    pattern: string;
    type: "success" | "anti-pattern" | "code-pattern";
    occurrences: number;
    relevance_reason: string;
  }>;

  // Relevant blockers to watch out for
  known_gotchas: Array<{
    blocker: string;
    occurrences: number;
    relevance_reason: string;
  }>;

  // Relevant decisions
  relevant_decisions: Array<{
    decision: string;
    rationale: string;
    source: { id: string; type: "issue" | "spec"; title: string };
  }>;
}

export interface RetrievalOptions {
  maxSimilarItems?: number;
  maxPatterns?: number;
  maxGotchas?: number;
  maxDecisions?: number;
}

/**
 * Get relevant context for a new issue
 */
export function getRelevantContextForIssue(
  db: Database.Database,
  issue: Issue,
  options: RetrievalOptions = {}
): RelevantContext {
  const maxSimilar = options.maxSimilarItems || 3;
  const maxPatterns = options.maxPatterns || 5;
  const maxGotchas = options.maxGotchas || 3;
  const maxDecisions = options.maxDecisions || 5;

  // Find similar completed issues
  const similarIssues = findSimilarIssues(db, issue, maxSimilar);

  // Find similar completed specs
  const similarSpecs = findSimilarSpecs(db, issue.title, issue.content, maxSimilar);

  // Extract patterns from similar work
  const patterns = extractPatternsFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxPatterns
  );

  // Extract gotchas
  const gotchas = extractGotchasFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxGotchas
  );

  // Extract decisions
  const decisions = extractDecisionsFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxDecisions
  );

  return {
    similar_issues: similarIssues,
    similar_specs: similarSpecs,
    applicable_patterns: patterns,
    known_gotchas: gotchas,
    relevant_decisions: decisions,
  };
}

/**
 * Get relevant context for a new spec
 */
export function getRelevantContextForSpec(
  db: Database.Database,
  spec: Spec,
  options: RetrievalOptions = {}
): RelevantContext {
  const maxSimilar = options.maxSimilarItems || 3;
  const maxPatterns = options.maxPatterns || 5;
  const maxGotchas = options.maxGotchas || 3;
  const maxDecisions = options.maxDecisions || 5;

  // Find similar completed specs
  const similarSpecs = findSimilarSpecs(db, spec.title, spec.content, maxSimilar);

  // Find issues that implemented similar specs
  const similarIssues = findSimilarIssues(db, {
    title: spec.title,
    content: spec.content,
  } as Issue, maxSimilar);

  // Extract patterns
  const patterns = extractPatternsFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxPatterns
  );

  // Extract gotchas
  const gotchas = extractGotchasFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxGotchas
  );

  // Extract decisions
  const decisions = extractDecisionsFromSimilar(
    [...similarIssues.map(s => s.issue), ...similarSpecs.map(s => s.spec)],
    maxDecisions
  );

  return {
    similar_issues: similarIssues,
    similar_specs: similarSpecs,
    applicable_patterns: patterns,
    known_gotchas: gotchas,
    relevant_decisions: decisions,
  };
}

/**
 * Find similar completed issues
 */
function findSimilarIssues(
  db: Database.Database,
  reference: Issue | { title: string; content: string },
  limit: number
): Array<{ issue: Issue; similarity_score: number; similarity_reasons: string[] }> {
  // Get all closed issues with completion summaries
  const closedIssues = listIssues(db, { status: "closed" })
    .filter(i => i.completion_summary);

  // Calculate similarity scores
  const scored = closedIssues.map(issue => {
    const { score, reasons } = calculateSimilarity(
      reference.title,
      reference.content,
      issue.title,
      issue.content,
      getTags(db, issue.id, "issue")
    );

    return { issue, similarity_score: score, similarity_reasons: reasons };
  });

  // Sort by score and return top matches
  return scored
    .filter(s => s.similarity_score > 0)
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);
}

/**
 * Find similar completed specs
 */
function findSimilarSpecs(
  db: Database.Database,
  title: string,
  content: string,
  limit: number
): Array<{ spec: Spec; similarity_score: number; similarity_reasons: string[] }> {
  // Get all archived specs with completion summaries
  const archivedSpecs = listSpecs(db, { archived: true })
    .filter(s => s.completion_summary);

  // Calculate similarity scores
  const scored = archivedSpecs.map(spec => {
    const { score, reasons } = calculateSimilarity(
      title,
      content,
      spec.title,
      spec.content,
      getTags(db, spec.id, "spec")
    );

    return { spec, similarity_score: score, similarity_reasons: reasons };
  });

  // Sort by score and return top matches
  return scored
    .filter(s => s.similarity_score > 0)
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);
}

/**
 * Calculate similarity between two items
 */
function calculateSimilarity(
  title1: string,
  content1: string,
  title2: string,
  content2: string,
  tags2: string[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Normalize text for comparison
  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);

  const title1Words = new Set(normalize(title1));
  const title2Words = new Set(normalize(title2));
  const content1Words = new Set(normalize(content1));
  const content2Words = new Set(normalize(content2));

  // Title similarity (weight: 3)
  const titleOverlap = intersection(title1Words, title2Words).size;
  if (titleOverlap > 0) {
    score += titleOverlap * 3;
    reasons.push(`${titleOverlap} matching keywords in title`);
  }

  // Content similarity (weight: 1)
  const contentOverlap = intersection(content1Words, content2Words).size;
  if (contentOverlap > 3) {
    score += contentOverlap;
    reasons.push(`${contentOverlap} matching keywords in content`);
  }

  // Tag matching (weight: 2)
  const content1Tags = extractImplicitTags(content1);
  const tagOverlap = tags2.filter(tag =>
    content1Tags.some(ct => ct.includes(tag.toLowerCase()) || tag.toLowerCase().includes(ct))
  );
  if (tagOverlap.length > 0) {
    score += tagOverlap.length * 2;
    reasons.push(`Related tags: ${tagOverlap.join(", ")}`);
  }

  return { score, reasons };
}

/**
 * Get intersection of two sets
 */
function intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  return new Set([...setA].filter(x => setB.has(x)));
}

/**
 * Extract implicit tags from content (e.g., "auth", "database", "api")
 */
function extractImplicitTags(content: string): string[] {
  const commonTags = [
    "auth", "authentication", "database", "api", "frontend", "backend",
    "test", "testing", "performance", "security", "ui", "ux", "migration",
    "refactor", "bug", "feature", "documentation", "deployment", "ci", "cd"
  ];

  const normalized = content.toLowerCase();
  return commonTags.filter(tag => normalized.includes(tag));
}

/**
 * Extract patterns from similar work
 */
function extractPatternsFromSimilar(
  entities: Array<Issue | Spec>,
  limit: number
): Array<{ pattern: string; type: "success" | "anti-pattern" | "code-pattern"; occurrences: number; relevance_reason: string }> {
  const patternCounts = new Map<string, { type: "success" | "anti-pattern" | "code-pattern"; count: number }>();

  for (const entity of entities) {
    const summary = entity.completion_summary;
    if (!summary) continue;

    // Count successful patterns
    for (const pattern of summary.what_worked) {
      const key = `success:${pattern}`;
      const existing = patternCounts.get(key) || { type: "success" as const, count: 0 };
      patternCounts.set(key, { ...existing, count: existing.count + 1 });
    }

    // Count anti-patterns
    for (const pattern of summary.what_failed) {
      const key = `anti:${pattern}`;
      const existing = patternCounts.get(key) || { type: "anti-pattern" as const, count: 0 };
      patternCounts.set(key, { ...existing, count: existing.count + 1 });
    }

    // Count code patterns
    for (const pattern of summary.code_patterns_introduced) {
      const key = `code:${pattern}`;
      const existing = patternCounts.get(key) || { type: "code-pattern" as const, count: 0 };
      patternCounts.set(key, { ...existing, count: existing.count + 1 });
    }
  }

  // Convert to array and sort by count
  const patterns = Array.from(patternCounts.entries()).map(([key, value]) => {
    const [type, ...patternParts] = key.split(":");
    const pattern = patternParts.join(":");
    return {
      pattern,
      type: value.type,
      occurrences: value.count,
      relevance_reason: `Used in ${value.count} similar ${value.count === 1 ? 'item' : 'items'}`,
    };
  });

  return patterns
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

/**
 * Extract gotchas from similar work
 */
function extractGotchasFromSimilar(
  entities: Array<Issue | Spec>,
  limit: number
): Array<{ blocker: string; occurrences: number; relevance_reason: string }> {
  const blockerCounts = new Map<string, number>();

  for (const entity of entities) {
    const summary = entity.completion_summary;
    if (!summary) continue;

    for (const blocker of summary.blocking_factors) {
      blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
    }
  }

  const gotchas = Array.from(blockerCounts.entries()).map(([blocker, count]) => ({
    blocker,
    occurrences: count,
    relevance_reason: `Encountered in ${count} similar ${count === 1 ? 'item' : 'items'}`,
  }));

  return gotchas
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

/**
 * Extract decisions from similar work
 */
function extractDecisionsFromSimilar(
  entities: Array<Issue | Spec>,
  limit: number
): Array<{ decision: string; rationale: string; source: { id: string; type: "issue" | "spec"; title: string } }> {
  const decisions: Array<{ decision: string; rationale: string; source: { id: string; type: "issue" | "spec"; title: string } }> = [];

  for (const entity of entities) {
    const summary = entity.completion_summary;
    if (!summary) continue;

    const entityType: "issue" | "spec" = "status" in entity ? "issue" : "spec";
    const source = { id: entity.id, type: entityType, title: entity.title };

    for (const dec of summary.key_decisions) {
      decisions.push({
        decision: dec.decision,
        rationale: dec.rationale,
        source,
      });
    }
  }

  return decisions.slice(0, limit);
}

/**
 * Format relevant context as markdown for agent briefing
 */
export function formatContextForAgent(context: RelevantContext): string {
  let md = "# Relevant Context\n\n";

  // Similar work
  if (context.similar_issues.length > 0 || context.similar_specs.length > 0) {
    md += "## Similar Completed Work\n\n";

    if (context.similar_issues.length > 0) {
      md += "### Issues\n\n";
      for (const { issue, similarity_score, similarity_reasons } of context.similar_issues) {
        md += `- **${issue.id}**: ${issue.title} (similarity: ${similarity_score})\n`;
        md += `  - ${similarity_reasons.join(", ")}\n`;
        if (issue.completion_summary) {
          md += `  - Completion time: ${issue.completion_summary.time_to_complete || "N/A"}h\n`;
        }
      }
      md += "\n";
    }

    if (context.similar_specs.length > 0) {
      md += "### Specs\n\n";
      for (const { spec, similarity_score, similarity_reasons } of context.similar_specs) {
        md += `- **${spec.id}**: ${spec.title} (similarity: ${similarity_score})\n`;
        md += `  - ${similarity_reasons.join(", ")}\n`;
      }
      md += "\n";
    }
  }

  // Applicable patterns
  if (context.applicable_patterns.length > 0) {
    md += "## Applicable Patterns\n\n";
    for (const { pattern, type, occurrences, relevance_reason } of context.applicable_patterns) {
      const emoji = type === "success" ? "✅" : type === "anti-pattern" ? "❌" : "🔧";
      md += `${emoji} **${pattern}** (${occurrences}x) - ${relevance_reason}\n`;
    }
    md += "\n";
  }

  // Known gotchas
  if (context.known_gotchas.length > 0) {
    md += "## ⚠️ Known Gotchas\n\n";
    for (const { blocker, occurrences, relevance_reason } of context.known_gotchas) {
      md += `- **${blocker}** (${occurrences}x) - ${relevance_reason}\n`;
    }
    md += "\n";
  }

  // Relevant decisions
  if (context.relevant_decisions.length > 0) {
    md += "## Architecture Decisions\n\n";
    for (const { decision, rationale, source } of context.relevant_decisions) {
      md += `- **${decision}**\n`;
      md += `  - Rationale: ${rationale}\n`;
      md += `  - Source: [${source.type}:${source.id}] ${source.title}\n`;
    }
    md += "\n";
  }

  return md;
}
