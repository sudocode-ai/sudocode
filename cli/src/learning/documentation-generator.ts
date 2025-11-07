/**
 * Living documentation generator - transforms aggregated context into markdown
 */

import * as fs from "fs";
import * as path from "path";
import type { AggregatedContext, AggregatedPattern, AggregatedDecision } from "./context-aggregator.js";

export interface DocumentationOptions {
  outputDir: string;
  overwrite?: boolean;
  minOccurrences?: number; // Minimum occurrences to include a pattern
}

/**
 * Generate all documentation files from aggregated context
 */
export function generateDocumentation(
  context: AggregatedContext,
  options: DocumentationOptions
): string[] {
  const { outputDir } = options;
  const contextDir = path.join(outputDir, "context");

  // Create directory structure
  ensureDirectoryStructure(contextDir);

  const generatedFiles: string[] = [];

  // Generate main memory file
  const memoryPath = path.join(contextDir, "CODEBASE_MEMORY.md");
  fs.writeFileSync(memoryPath, generateCodebaseMemory(context));
  generatedFiles.push(memoryPath);

  // Generate patterns documentation
  const patternsDir = path.join(contextDir, "patterns");

  const successPath = path.join(patternsDir, "successful-patterns.md");
  fs.writeFileSync(successPath, generatePatternsDoc(
    "Successful Patterns",
    "Patterns that have worked well in this codebase",
    context.successful_patterns,
    options.minOccurrences || 1
  ));
  generatedFiles.push(successPath);

  const antiPath = path.join(patternsDir, "anti-patterns.md");
  fs.writeFileSync(antiPath, generatePatternsDoc(
    "Anti-Patterns",
    "Patterns and approaches that have failed or caused issues",
    context.anti_patterns,
    options.minOccurrences || 1
  ));
  generatedFiles.push(antiPath);

  const codePath = path.join(patternsDir, "code-patterns.md");
  fs.writeFileSync(codePath, generatePatternsDoc(
    "Code Patterns",
    "Coding patterns and architectures introduced to the codebase",
    context.code_patterns,
    options.minOccurrences || 1
  ));
  generatedFiles.push(codePath);

  // Generate gotchas documentation
  const gotchasDir = path.join(contextDir, "gotchas");

  const blockersPath = path.join(gotchasDir, "common-blockers.md");
  fs.writeFileSync(blockersPath, generateBlockersDoc(context.common_blockers, options.minOccurrences || 1));
  generatedFiles.push(blockersPath);

  // Generate decisions documentation
  const decisionsDir = path.join(contextDir, "decisions");

  const adrsPath = path.join(decisionsDir, "architecture-decisions.md");
  fs.writeFileSync(adrsPath, generateDecisionsDoc(context.decisions));
  generatedFiles.push(adrsPath);

  // Generate dependencies documentation
  const depsPath = path.join(contextDir, "dependencies.md");
  fs.writeFileSync(depsPath, generateDependenciesDoc(context.dependencies));
  generatedFiles.push(depsPath);

  // Generate metrics
  const metricsPath = path.join(contextDir, "metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify(context.metrics, null, 2));
  generatedFiles.push(metricsPath);

  return generatedFiles;
}

/**
 * Ensure directory structure exists
 */
function ensureDirectoryStructure(contextDir: string): void {
  const dirs = [
    contextDir,
    path.join(contextDir, "patterns"),
    path.join(contextDir, "gotchas"),
    path.join(contextDir, "decisions"),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate CODEBASE_MEMORY.md - high-level overview
 */
function generateCodebaseMemory(context: AggregatedContext): string {
  const { metrics } = context;

  return `# Codebase Memory

> **Auto-generated from ${metrics.total_completions} completed specs/issues**
> **Last updated**: ${new Date().toISOString()}
> **Date range**: ${metrics.date_range.start} to ${metrics.date_range.end}

## Overview

This document contains high-level learnings extracted from completed work in this codebase.
It serves as a memory for AI agents and developers to understand what works, what doesn't,
and key decisions that have shaped the project.

## Key Statistics

- **Total Completions Analyzed**: ${metrics.total_completions}
  - Issues: ${metrics.total_issues_analyzed}
  - Specs: ${metrics.total_specs_analyzed}
- **Average Completion Time**: ${metrics.avg_completion_time} hours
- **Analysis Period**: ${metrics.date_range.start} to ${metrics.date_range.end}

## Top Successful Patterns

${context.successful_patterns.slice(0, 5).map((p, i) =>
  `${i + 1}. **${p.pattern}** (${p.occurrences} occurrences)`
).join("\n")}

[See all successful patterns →](./patterns/successful-patterns.md)

## Top Anti-Patterns to Avoid

${context.anti_patterns.slice(0, 5).map((p, i) =>
  `${i + 1}. **${p.pattern}** (${p.occurrences} occurrences)`
).join("\n") || "None identified yet."}

[See all anti-patterns →](./patterns/anti-patterns.md)

## Most Common Blockers

${context.common_blockers.slice(0, 5).map((p, i) =>
  `${i + 1}. **${p.pattern}** (${p.occurrences} occurrences)`
).join("\n") || "None identified yet."}

[See all blockers →](./gotchas/common-blockers.md)

## Recent Key Decisions

${context.decisions.slice(0, 3).map(d =>
  `- **${d.decision}**: ${d.rationale}`
).join("\n") || "None documented yet."}

[See all architecture decisions →](./decisions/architecture-decisions.md)

## Code Patterns in Use

${context.code_patterns.slice(0, 10).map(p =>
  `- ${p.pattern} (${p.occurrences}x)`
).join("\n") || "None identified yet."}

[See all code patterns →](./patterns/code-patterns.md)

## Key Dependencies

${context.dependencies.slice(0, 10).map(d =>
  `- ${d.pattern}`
).join("\n") || "None documented yet."}

[See dependencies →](./dependencies.md)

---

*This documentation is automatically generated from completion summaries.
To update, run: \`sudocode context generate\`*
`;
}

/**
 * Generate patterns documentation
 */
function generatePatternsDoc(
  title: string,
  description: string,
  patterns: AggregatedPattern[],
  minOccurrences: number
): string {
  const filtered = patterns.filter(p => p.occurrences >= minOccurrences);

  let doc = `# ${title}

${description}

**Total Patterns**: ${filtered.length}
**Last Updated**: ${new Date().toISOString()}

---

`;

  for (const pattern of filtered) {
    doc += `## ${pattern.pattern}

**Occurrences**: ${pattern.occurrences}
**First Seen**: ${pattern.first_seen}
**Last Seen**: ${pattern.last_seen}

**Sources**:
${pattern.sources.map(s => `- [${s.type}:${s.id}] ${s.title}`).join("\n")}

---

`;
  }

  return doc;
}

/**
 * Generate blockers documentation
 */
function generateBlockersDoc(blockers: AggregatedPattern[], minOccurrences: number): string {
  const filtered = blockers.filter(b => b.occurrences >= minOccurrences);

  let doc = `# Common Blockers & Gotchas

Things that have slowed down or blocked progress in the past.

**Total Blockers Identified**: ${filtered.length}
**Last Updated**: ${new Date().toISOString()}

---

`;

  for (const blocker of filtered) {
    doc += `## ${blocker.pattern}

**Frequency**: ${blocker.occurrences} times
**First Encountered**: ${blocker.first_seen}
**Last Encountered**: ${blocker.last_seen}

**Affected Work**:
${blocker.sources.map(s => `- [${s.type}:${s.id}] ${s.title}`).join("\n")}

---

`;
  }

  return doc;
}

/**
 * Generate architecture decisions documentation
 */
function generateDecisionsDoc(decisions: AggregatedDecision[]): string {
  let doc = `# Architecture Decision Records (ADRs)

Key architectural and technical decisions made in this project.

**Total Decisions**: ${decisions.length}
**Last Updated**: ${new Date().toISOString()}

---

`;

  for (const decision of decisions) {
    doc += `## ${decision.decision}

**Date**: ${decision.date}
**Source**: [${decision.source.type}:${decision.source.id}] ${decision.source.title}

### Rationale

${decision.rationale}

### Alternatives Considered

${decision.alternatives_considered.map(alt => `- ${alt}`).join("\n")}

---

`;
  }

  return doc;
}

/**
 * Generate dependencies documentation
 */
function generateDependenciesDoc(dependencies: AggregatedPattern[]): string {
  let doc = `# Dependencies

Dependencies used and discovered during implementation.

**Total Dependencies**: ${dependencies.length}
**Last Updated**: ${new Date().toISOString()}

---

`;

  for (const dep of dependencies) {
    doc += `## ${dep.pattern}

**Used In**: ${dep.occurrences} ${dep.occurrences === 1 ? 'place' : 'places'}
**First Added**: ${dep.first_seen}
**Last Referenced**: ${dep.last_seen}

**Related Work**:
${dep.sources.map(s => `- [${s.type}:${s.id}] ${s.title}`).join("\n")}

---

`;
  }

  return doc;
}

/**
 * Generate a summary report for console output
 */
export function generateSummaryReport(
  context: AggregatedContext,
  filesGenerated: string[]
): string {
  return `
Context Documentation Generated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Analysis Summary:
   • ${context.metrics.total_completions} completions analyzed
   • ${context.metrics.total_issues_analyzed} issues, ${context.metrics.total_specs_analyzed} specs
   • Average completion time: ${context.metrics.avg_completion_time}h

📝 Documentation Created:
   • ${context.successful_patterns.length} successful patterns
   • ${context.anti_patterns.length} anti-patterns
   • ${context.common_blockers.length} common blockers
   • ${context.decisions.length} architecture decisions
   • ${context.code_patterns.length} code patterns
   • ${context.dependencies.length} dependencies

📁 Files Generated: ${filesGenerated.length}
${filesGenerated.map(f => `   • ${f}`).join("\n")}

✓ Context is now available for agents!
`;
}
