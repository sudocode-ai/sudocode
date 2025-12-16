/**
 * ID Generation for Spec-Kit Integration
 *
 * Generates deterministic, path-based IDs for spec-kit entities.
 * IDs are stable across syncs (based on file path, not content hash).
 *
 * Examples:
 * .specify/specs/001-auth/spec.md      -> sk-001-spec
 * .specify/specs/001-auth/plan.md      -> sk-001-plan
 * .specify/specs/001-auth/tasks.md T001 -> skt-001-T001
 * .specify/specs/001-auth/research.md  -> sk-001-research
 * .specify/specs/001-auth/contracts/api-spec.json -> sk-001-contract-api-spec
 * .specify/memory/constitution.md      -> sk-constitution
 */

/**
 * Result of parsing a spec-kit ID
 */
export interface ParsedSpecId {
  /** The prefix used (e.g., "sk", "skt") */
  prefix: string;
  /** Feature number extracted from path (e.g., "001") or null for non-feature files */
  featureNumber: string | null;
  /** File type or identifier (e.g., "spec", "plan", "research", "T001") */
  fileType: string;
  /** Whether this is a task ID */
  isTask: boolean;
}

/**
 * File types recognized in spec-kit feature directories
 */
export type SpecKitFileType =
  | "spec"
  | "plan"
  | "tasks"
  | "research"
  | "data-model"
  | "contract";

/**
 * Extract feature number from a spec-kit path
 *
 * @param relativePath - Path relative to .specify directory (e.g., "specs/001-auth/spec.md")
 * @returns Feature number (e.g., "001") or null if not in a feature directory
 *
 * @example
 * extractFeatureNumber("specs/001-auth/spec.md") // "001"
 * extractFeatureNumber("specs/042-payments/plan.md") // "042"
 * extractFeatureNumber("memory/constitution.md") // null
 */
export function extractFeatureNumber(relativePath: string): string | null {
  // Match patterns like "specs/001-xxx/" or "specs/42-xxx/"
  const featureMatch = relativePath.match(/specs\/(\d+)-[^/]+\//);
  return featureMatch ? featureMatch[1] : null;
}

/**
 * Extract file type from a spec-kit file path
 *
 * @param relativePath - Path relative to .specify directory
 * @returns File type identifier for ID generation
 *
 * @example
 * extractFileType("specs/001-auth/spec.md") // "spec"
 * extractFileType("specs/001-auth/plan.md") // "plan"
 * extractFileType("specs/001-auth/contracts/api-spec.json") // "contract-api-spec"
 * extractFileType("memory/constitution.md") // "constitution"
 */
export function extractFileType(relativePath: string): string {
  const parts = relativePath.split("/");
  const fileName = parts[parts.length - 1];
  const baseName = fileName.replace(/\.(md|json|yaml|yml)$/, "");

  // Handle contracts subdirectory
  if (relativePath.includes("/contracts/")) {
    return `contract-${baseName}`;
  }

  // Handle memory directory files
  if (relativePath.startsWith("memory/")) {
    return baseName;
  }

  // Standard file types in feature directory
  return baseName;
}

/**
 * Generate a spec ID from a file path
 *
 * @param relativePath - Path relative to .specify directory
 * @param prefix - ID prefix (default: "sk")
 * @returns Generated spec ID
 *
 * @example
 * generateSpecId("specs/001-auth/spec.md") // "sk-001-spec"
 * generateSpecId("specs/001-auth/plan.md") // "sk-001-plan"
 * generateSpecId("specs/001-auth/contracts/api-spec.json") // "sk-001-contract-api-spec"
 * generateSpecId("memory/constitution.md") // "sk-constitution"
 * generateSpecId("specs/001-auth/spec.md", "myprefix") // "myprefix-001-spec"
 */
export function generateSpecId(
  relativePath: string,
  prefix: string = "sk"
): string {
  const featureNumber = extractFeatureNumber(relativePath);
  const fileType = extractFileType(relativePath);

  if (featureNumber) {
    return `${prefix}-${featureNumber}-${fileType}`;
  }

  // Non-feature files (e.g., constitution.md)
  return `${prefix}-${fileType}`;
}

/**
 * Generate an issue ID for a task from tasks.md
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param taskId - Task identifier from tasks.md (e.g., "T001", "T002")
 * @param prefix - ID prefix (default: "skt" for spec-kit tasks)
 * @returns Generated issue ID
 *
 * @example
 * generateTaskIssueId("001", "T001") // "skt-001-T001"
 * generateTaskIssueId("042", "T003", "task") // "task-042-T003"
 */
export function generateTaskIssueId(
  featureNumber: string,
  taskId: string,
  prefix: string = "skt"
): string {
  return `${prefix}-${featureNumber}-${taskId}`;
}

/**
 * Parse a spec-kit ID back into its components
 *
 * @param id - A spec-kit ID (e.g., "sk-001-spec", "skt-001-T001")
 * @returns Parsed ID components or null if invalid format
 *
 * @example
 * parseSpecId("sk-001-spec")
 * // { prefix: "sk", featureNumber: "001", fileType: "spec", isTask: false }
 *
 * parseSpecId("skt-001-T001")
 * // { prefix: "skt", featureNumber: "001", fileType: "T001", isTask: true }
 *
 * parseSpecId("sk-constitution")
 * // { prefix: "sk", featureNumber: null, fileType: "constitution", isTask: false }
 */
export function parseSpecId(id: string): ParsedSpecId | null {
  // Pattern for feature-based IDs: prefix-number-type
  const featureMatch = id.match(/^([a-z]+)-(\d+)-(.+)$/i);
  if (featureMatch) {
    const [, prefix, featureNumber, fileType] = featureMatch;
    return {
      prefix,
      featureNumber,
      fileType,
      isTask: fileType.startsWith("T") && /^T\d+$/.test(fileType),
    };
  }

  // Pattern for non-feature IDs: prefix-type
  const simpleMatch = id.match(/^([a-z]+)-(.+)$/i);
  if (simpleMatch) {
    const [, prefix, fileType] = simpleMatch;
    return {
      prefix,
      featureNumber: null,
      fileType,
      isTask: false,
    };
  }

  return null;
}

/**
 * Check if an ID is a valid spec-kit ID format
 *
 * @param id - ID to validate
 * @param expectedPrefix - Optional prefix to check against
 * @returns true if valid spec-kit ID format
 *
 * @example
 * isValidSpecKitId("sk-001-spec") // true
 * isValidSpecKitId("sk-001-spec", "sk") // true
 * isValidSpecKitId("sk-001-spec", "other") // false
 * isValidSpecKitId("invalid") // false
 */
export function isValidSpecKitId(id: string, expectedPrefix?: string): boolean {
  const parsed = parseSpecId(id);
  if (!parsed) return false;
  if (expectedPrefix && parsed.prefix !== expectedPrefix) return false;
  return true;
}

/**
 * Generate the spec ID for a feature's root spec file
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - ID prefix (default: "sk")
 * @returns Spec ID for the feature's spec.md
 *
 * @example
 * getFeatureSpecId("001") // "sk-001-spec"
 */
export function getFeatureSpecId(
  featureNumber: string,
  prefix: string = "sk"
): string {
  return `${prefix}-${featureNumber}-spec`;
}

/**
 * Generate the spec ID for a feature's plan file
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - ID prefix (default: "sk")
 * @returns Spec ID for the feature's plan.md
 *
 * @example
 * getFeaturePlanId("001") // "sk-001-plan"
 */
export function getFeaturePlanId(
  featureNumber: string,
  prefix: string = "sk"
): string {
  return `${prefix}-${featureNumber}-plan`;
}

/**
 * Generate the spec ID for a feature's tasks file
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - ID prefix (default: "sk")
 * @returns Spec ID for the feature's tasks.md
 *
 * @example
 * getFeatureTasksId("001") // "sk-001-tasks"
 */
export function getFeatureTasksId(
  featureNumber: string,
  prefix: string = "sk"
): string {
  return `${prefix}-${featureNumber}-tasks`;
}
