/**
 * Reflection generator for creating completion summaries
 * Uses LLM to analyze git history, issue/spec content, and generate structured learnings
 */

import type { CompletionSummary, Issue, Spec } from "../types.js";
import type { GitDiffAnalysis } from "./git-analyzer.js";
import {
  analyzeDiff,
  getDiffContent,
  getCommits,
  extractPatterns,
  getCurrentCommit,
} from "./git-analyzer.js";

export interface ReflectionContext {
  entity: Issue | Spec;
  entityType: "issue" | "spec";
  gitCommitRange?: {
    start: string;
    end: string;
  };
  relatedIssues?: Issue[];
  relatedSpecs?: Spec[];
}

/**
 * Generate a reflection prompt for an LLM to analyze completion
 */
export async function generateReflectionPrompt(
  context: ReflectionContext
): Promise<string> {
  const { entity, entityType, gitCommitRange } = context;

  // Get git analysis
  let gitAnalysis: GitDiffAnalysis | null = null;
  let diffContent = "";
  let patterns: ReturnType<typeof extractPatterns> | null = null;

  if (gitCommitRange) {
    gitAnalysis = await analyzeDiff(gitCommitRange);
    patterns = extractPatterns(gitAnalysis);

    // Get diff content (limited to first 10KB for prompt)
    const fullDiff = await getDiffContent(gitCommitRange);
    diffContent = fullDiff.substring(0, 10000);
    if (fullDiff.length > 10000) {
      diffContent += "\n\n... (diff truncated)";
    }
  }

  const prompt = `You are analyzing a completed ${entityType} to extract learnings and patterns for future reference.

## ${entityType.toUpperCase()} DETAILS
**ID**: ${entity.id}
**Title**: ${entity.title}
**Status**: ${"status" in entity ? entity.status : "N/A"}
**Created**: ${entity.created_at}
**Closed**: ${"closed_at" in entity ? entity.closed_at || "N/A" : "N/A"}

## CONTENT
${entity.content}

${gitAnalysis ? `
## GIT ANALYSIS

**Commits**: ${gitAnalysis.commits.length}
**Files Changed**: ${gitAnalysis.files_changed.length}
**Lines Added**: ${gitAnalysis.additions}
**Lines Deleted**: ${gitAnalysis.deletions}

### Recent Commits
${gitAnalysis.commits.slice(0, 10).map(c => `- ${c.sha.substring(0, 7)}: ${c.message}`).join("\n")}

${patterns ? `
### Primary Areas of Change
${patterns.primary_areas.map(a => `- ${a}`).join("\n") || "None identified"}

### Significant File Changes
${patterns.significant_changes.map(c => `- ${c}`).join("\n") || "None identified"}

### Test Coverage Impact
${patterns.test_coverage_impact.map(t => `- ${t}`).join("\n") || "None identified"}
` : ""}

${diffContent ? `
### Code Changes (Sample)
\`\`\`diff
${diffContent}
\`\`\`
` : ""}
` : ""}

${context.relatedIssues && context.relatedIssues.length > 0 ? `
## RELATED ISSUES
${context.relatedIssues.map(i => `- ${i.id}: ${i.title} (${i.status})`).join("\n")}
` : ""}

${context.relatedSpecs && context.relatedSpecs.length > 0 ? `
## RELATED SPECS
${context.relatedSpecs.map(s => `- ${s.id}: ${s.title}`).join("\n")}
` : ""}

## TASK
Analyze the above information and generate a structured completion summary in JSON format.

The summary should include:
1. **what_worked**: Array of strings describing successful patterns, approaches, or decisions
2. **what_failed**: Array of strings describing failed attempts, anti-patterns, or mistakes
3. **blocking_factors**: Array of strings describing what slowed progress or blocked work
4. **key_decisions**: Array of objects with structure:
   - decision: string (the decision made)
   - rationale: string (why this decision was made)
   - alternatives_considered: string[] (what other options were considered)
5. **code_patterns_introduced**: Array of strings describing new patterns added to the codebase
6. **dependencies_discovered**: Array of strings listing new dependencies or integrations

Focus on:
- Technical insights that would help future agents/developers
- Patterns that could be reused
- Pitfalls to avoid
- Architectural decisions and their reasoning
- Performance insights
- Testing approaches

Return ONLY valid JSON matching this structure. Do not include any markdown formatting or explanation.

Example format:
{
  "what_worked": ["TDD approach led to better design", "Using TypeScript enums improved type safety"],
  "what_failed": ["Initial attempt at caching was premature optimization"],
  "blocking_factors": ["API documentation was incomplete", "Test fixtures needed refactoring"],
  "key_decisions": [
    {
      "decision": "Use SQLite for local storage",
      "rationale": "Simple, embedded, no external dependencies",
      "alternatives_considered": ["PostgreSQL", "File-based storage"]
    }
  ],
  "code_patterns_introduced": ["Repository pattern for data access", "Builder pattern for complex objects"],
  "dependencies_discovered": ["better-sqlite3", "chalk"]
}`;

  return prompt;
}

/**
 * Create a basic completion summary from available data (without LLM)
 */
export async function generateBasicSummary(
  context: ReflectionContext
): Promise<Partial<CompletionSummary>> {
  const summary: Partial<CompletionSummary> = {
    what_worked: [],
    what_failed: [],
    blocking_factors: [],
    key_decisions: [],
    code_patterns_introduced: [],
    dependencies_discovered: [],
  };

  if (context.gitCommitRange) {
    const gitAnalysis = await analyzeDiff(context.gitCommitRange);

    summary.git_commit_range = {
      start: context.gitCommitRange.start,
      end: context.gitCommitRange.end,
    };

    summary.files_modified = gitAnalysis.files_changed;

    // Extract basic patterns
    const patterns = extractPatterns(gitAnalysis);

    // Add some automated insights
    if (patterns.test_coverage_impact.length > 0) {
      summary.what_worked?.push("Added test coverage for changes");
    }

    if (gitAnalysis.additions > 1000) {
      summary.blocking_factors?.push("Large changeset may indicate complex implementation");
    }

    // Try to detect patterns from file changes
    const hasNewTests = gitAnalysis.files_changed.some(f =>
      f.includes("test") || f.includes("spec")
    );
    if (hasNewTests) {
      summary.code_patterns_introduced?.push("Test coverage added");
    }

    // Extract dependencies from package.json changes
    const packageJsonChanged = gitAnalysis.files_changed.some(f =>
      f.endsWith("package.json")
    );
    if (packageJsonChanged) {
      summary.dependencies_discovered?.push("Dependencies updated (see package.json diff)");
    }

    // Time estimation
    const { commits } = gitAnalysis;
    if (commits.length > 0) {
      const firstCommit = new Date(commits[commits.length - 1].date);
      const lastCommit = new Date(commits[0].date);
      const hours = (lastCommit.getTime() - firstCommit.getTime()) / (1000 * 60 * 60);

      summary.time_to_complete = Math.round(hours * 10) / 10; // Round to 1 decimal
    }
  }

  return summary;
}

/**
 * Get the current commit for marking completion
 */
export async function getCompletionCommit(): Promise<string | null> {
  return await getCurrentCommit();
}

/**
 * Helper to calculate time between dates in hours
 */
export function calculateCompletionTime(
  startDate: string,
  endDate: string
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.round(hours * 10) / 10;
}
