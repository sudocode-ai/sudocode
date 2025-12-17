/**
 * OpenSpec Spec Parser
 *
 * Parses OpenSpec specification files from `openspec/specs/[capability]/spec.md`.
 *
 * OpenSpec spec format:
 * - Title from H1 heading: `# Title`
 * - Purpose section: `## Purpose`
 * - Requirements: `### Requirement: Name`
 * - Scenarios: `#### Scenario: Description` with GIVEN/WHEN/THEN steps
 */

import { readFileSync } from "fs";
import * as path from "path";
import { extractTitle, extractSection, PATTERNS } from "./markdown-utils.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A parsed scenario from an OpenSpec requirement
 */
export interface ParsedScenario {
  /** Scenario description from `#### Scenario: Description` */
  description: string;
  /** GIVEN steps (preconditions) */
  given?: string[];
  /** WHEN steps (actions) */
  when?: string[];
  /** THEN steps (expected outcomes) */
  then?: string[];
}

/**
 * A parsed requirement from an OpenSpec spec
 */
export interface ParsedRequirement {
  /** Requirement name from `### Requirement: Name` */
  name: string;
  /** Full content of the requirement section */
  content: string;
  /** Scenarios within this requirement */
  scenarios: ParsedScenario[];
}

/**
 * A fully parsed OpenSpec specification
 */
export interface ParsedOpenSpecSpec {
  /** Directory name (e.g., "cli-init") */
  capability: string;
  /** Title from H1 heading */
  title: string;
  /** Content from ## Purpose section */
  purpose?: string;
  /** Parsed requirements */
  requirements: ParsedRequirement[];
  /** Full markdown content of the file */
  rawContent: string;
  /** Absolute path to the spec file */
  filePath: string;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * OpenSpec-specific patterns for parsing spec files
 */
export const SPEC_PATTERNS = {
  /** Match requirement header: ### Requirement: Name */
  REQUIREMENT: /^###\s+Requirement:\s*(.+)$/m,

  /** Match scenario header: #### Scenario: Description */
  SCENARIO: /^####\s+Scenario:\s*(.+)$/m,

  /** Match GIVEN step: - **GIVEN** content or **GIVEN**: content */
  GIVEN: /^-?\s*\*\*GIVEN\*\*:?\s*(.+)$/i,

  /** Match WHEN step: - **WHEN** content or **WHEN**: content */
  WHEN: /^-?\s*\*\*WHEN\*\*:?\s*(.+)$/i,

  /** Match THEN step: - **THEN** content or **THEN**: content */
  THEN: /^-?\s*\*\*THEN\*\*:?\s*(.+)$/i,
};

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse an OpenSpec spec file
 *
 * @param filePath - Absolute path to the spec.md file
 * @returns Parsed spec object
 * @throws Error if file cannot be read
 *
 * @example
 * const spec = parseSpecFile("/path/to/openspec/specs/cli-init/spec.md");
 * console.log(spec.title);        // "CLI Init Specification"
 * console.log(spec.capability);   // "cli-init"
 * console.log(spec.requirements); // Array of parsed requirements
 */
export function parseSpecFile(filePath: string): ParsedOpenSpecSpec {
  const rawContent = readFileSync(filePath, "utf-8");
  const lines = rawContent.split("\n");

  // Extract capability from directory name
  const capability = extractCapability(filePath);

  // Extract title from H1 heading
  const title = extractTitle(lines) || capability;

  // Extract purpose section
  const purposeLines = extractSection(lines, "Purpose", 2);
  const purpose = purposeLines ? purposeLines.join("\n").trim() : undefined;

  // Parse requirements
  const requirements = parseRequirements(rawContent);

  return {
    capability,
    title,
    purpose,
    requirements,
    rawContent,
    filePath,
  };
}

/**
 * Extract the capability name from the file path
 *
 * Assumes path structure: .../specs/[capability]/spec.md
 *
 * @param filePath - Path to the spec file
 * @returns Capability directory name
 */
export function extractCapability(filePath: string): string {
  const parts = filePath.split(path.sep);
  const specIndex = parts.lastIndexOf("spec.md");

  if (specIndex > 0) {
    return parts[specIndex - 1];
  }

  // Fallback: use parent directory name
  return path.basename(path.dirname(filePath));
}

/**
 * Parse all requirements from spec content
 *
 * @param content - Full markdown content
 * @returns Array of parsed requirements
 */
export function parseRequirements(content: string): ParsedRequirement[] {
  const requirements: ParsedRequirement[] = [];
  const lines = content.split("\n");

  // Find all requirement header positions
  const requirementPositions: Array<{ name: string; lineIndex: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(SPEC_PATTERNS.REQUIREMENT);
    if (match) {
      requirementPositions.push({
        name: match[1].trim(),
        lineIndex: i,
      });
    }
  }

  // Extract content for each requirement
  for (let i = 0; i < requirementPositions.length; i++) {
    const req = requirementPositions[i];
    const startLine = req.lineIndex + 1;

    // End at next requirement or end of file
    const endLine =
      i < requirementPositions.length - 1
        ? requirementPositions[i + 1].lineIndex
        : lines.length;

    // Get requirement content (excluding the header line)
    const requirementLines = lines.slice(startLine, endLine);
    const requirementContent = requirementLines.join("\n").trim();

    // Parse scenarios within this requirement
    const scenarios = parseScenarios(requirementContent);

    requirements.push({
      name: req.name,
      content: requirementContent,
      scenarios,
    });
  }

  return requirements;
}

/**
 * Parse scenarios from requirement content
 *
 * @param content - Requirement section content
 * @returns Array of parsed scenarios
 */
export function parseScenarios(content: string): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];
  const lines = content.split("\n");

  // Find all scenario header positions
  const scenarioPositions: Array<{ description: string; lineIndex: number }> =
    [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(SPEC_PATTERNS.SCENARIO);
    if (match) {
      scenarioPositions.push({
        description: match[1].trim(),
        lineIndex: i,
      });
    }
  }

  // Extract content for each scenario
  for (let i = 0; i < scenarioPositions.length; i++) {
    const scenario = scenarioPositions[i];
    const startLine = scenario.lineIndex + 1;

    // End at next scenario or end of content
    const endLine =
      i < scenarioPositions.length - 1
        ? scenarioPositions[i + 1].lineIndex
        : lines.length;

    // Get scenario content
    const scenarioLines = lines.slice(startLine, endLine);

    // Parse GIVEN/WHEN/THEN steps
    const { given, when, then } = parseGivenWhenThen(scenarioLines);

    scenarios.push({
      description: scenario.description,
      given: given.length > 0 ? given : undefined,
      when: when.length > 0 ? when : undefined,
      then: then.length > 0 ? then : undefined,
    });
  }

  return scenarios;
}

/**
 * Parse GIVEN/WHEN/THEN steps from scenario lines
 *
 * @param lines - Lines within a scenario section
 * @returns Object with given, when, then arrays
 */
export function parseGivenWhenThen(
  lines: string[]
): { given: string[]; when: string[]; then: string[] } {
  const given: string[] = [];
  const when: string[] = [];
  const then: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for GIVEN
    const givenMatch = trimmed.match(SPEC_PATTERNS.GIVEN);
    if (givenMatch) {
      given.push(givenMatch[1].trim());
      continue;
    }

    // Check for WHEN
    const whenMatch = trimmed.match(SPEC_PATTERNS.WHEN);
    if (whenMatch) {
      when.push(whenMatch[1].trim());
      continue;
    }

    // Check for THEN
    const thenMatch = trimmed.match(SPEC_PATTERNS.THEN);
    if (thenMatch) {
      then.push(thenMatch[1].trim());
      continue;
    }
  }

  return { given, when, then };
}
