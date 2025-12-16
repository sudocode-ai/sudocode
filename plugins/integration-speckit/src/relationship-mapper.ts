/**
 * Relationship Mapping for Spec-Kit Integration
 *
 * Maps spec-kit file hierarchy to sudocode relationships.
 *
 * Spec-kit hierarchy:
 * ```
 * spec.md (root)
 *   └── plan.md (implements spec.md)
 *         ├── tasks (implement plan.md)
 *         ├── research.md (references plan.md)
 *         ├── data-model.md (references plan.md)
 *         └── contracts/* (references plan.md)
 * ```
 *
 * This creates a clear dependency graph:
 * - plan implements spec (spec defines WHAT, plan defines HOW)
 * - tasks implement plan (tasks are actionable work items from the plan)
 * - supporting docs reference plan (research, data models, contracts support the plan)
 */

import type { RelationshipType, EntityType } from "@sudocode-ai/types";
import {
  getFeatureSpecId,
  getFeaturePlanId,
  generateTaskIssueId,
} from "./id-generator.js";

/**
 * A relationship to be created in sudocode
 */
export interface MappedRelationship {
  /** Source entity ID */
  fromId: string;
  /** Source entity type */
  fromType: EntityType;
  /** Target entity ID */
  toId: string;
  /** Target entity type */
  toType: EntityType;
  /** Relationship type */
  relationshipType: RelationshipType;
}

/**
 * Task information for relationship mapping
 */
export interface TaskInfo {
  /** Task ID from tasks.md (e.g., "T001", "T002") */
  taskId: string;
  /** Optional: task dependencies (other task IDs this task depends on) */
  dependsOn?: string[];
}

/**
 * Supporting document information
 */
export interface SupportingDocInfo {
  /** File type identifier (e.g., "research", "data-model", "contract-api-spec") */
  fileType: string;
  /** Entity type in sudocode */
  entityType: EntityType;
}

/**
 * Map all relationships for a spec-kit feature
 *
 * Creates the standard relationship hierarchy:
 * 1. plan implements spec
 * 2. each task implements plan
 * 3. supporting docs reference plan
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - Spec ID prefix (default: "sk")
 * @param taskPrefix - Task issue ID prefix (default: "skt")
 * @param tasks - Array of task information from tasks.md
 * @param supportingDocs - Optional array of supporting documents to include
 * @returns Array of relationships to create
 *
 * @example
 * const relationships = mapFeatureRelationships("001", "sk", "skt", [
 *   { taskId: "T001" },
 *   { taskId: "T002", dependsOn: ["T001"] },
 * ]);
 * // Returns relationships:
 * // - sk-001-plan implements sk-001-spec
 * // - skt-001-T001 implements sk-001-plan
 * // - skt-001-T002 implements sk-001-plan
 * // - skt-001-T002 depends-on skt-001-T001
 */
export function mapFeatureRelationships(
  featureNumber: string,
  prefix: string = "sk",
  taskPrefix: string = "skt",
  tasks: TaskInfo[] = [],
  supportingDocs: SupportingDocInfo[] = []
): MappedRelationship[] {
  const relationships: MappedRelationship[] = [];

  const specId = getFeatureSpecId(featureNumber, prefix);
  const planId = getFeaturePlanId(featureNumber, prefix);

  // 1. Plan implements Spec
  relationships.push({
    fromId: planId,
    fromType: "spec",
    toId: specId,
    toType: "spec",
    relationshipType: "implements",
  });

  // 2. Each task implements Plan
  for (const task of tasks) {
    const taskIssueId = generateTaskIssueId(
      featureNumber,
      task.taskId,
      taskPrefix
    );

    relationships.push({
      fromId: taskIssueId,
      fromType: "issue",
      toId: planId,
      toType: "spec",
      relationshipType: "implements",
    });

    // 3. Task dependencies (depends-on relationships)
    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const depTaskId of task.dependsOn) {
        const depIssueId = generateTaskIssueId(
          featureNumber,
          depTaskId,
          taskPrefix
        );
        relationships.push({
          fromId: taskIssueId,
          fromType: "issue",
          toId: depIssueId,
          toType: "issue",
          relationshipType: "depends-on",
        });
      }
    }
  }

  // 4. Supporting docs reference Plan
  for (const doc of supportingDocs) {
    const docId = `${prefix}-${featureNumber}-${doc.fileType}`;
    relationships.push({
      fromId: docId,
      fromType: doc.entityType,
      toId: planId,
      toType: "spec",
      relationshipType: "references",
    });
  }

  return relationships;
}

/**
 * Map relationships for task dependencies within a feature
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param taskPrefix - Task issue ID prefix (default: "skt")
 * @param tasks - Array of tasks with their dependencies
 * @returns Array of depends-on relationships between tasks
 *
 * @example
 * const deps = mapTaskDependencies("001", "skt", [
 *   { taskId: "T001" },
 *   { taskId: "T002", dependsOn: ["T001"] },
 *   { taskId: "T003", dependsOn: ["T001", "T002"] },
 * ]);
 * // Returns:
 * // - skt-001-T002 depends-on skt-001-T001
 * // - skt-001-T003 depends-on skt-001-T001
 * // - skt-001-T003 depends-on skt-001-T002
 */
export function mapTaskDependencies(
  featureNumber: string,
  taskPrefix: string = "skt",
  tasks: TaskInfo[]
): MappedRelationship[] {
  const relationships: MappedRelationship[] = [];

  for (const task of tasks) {
    if (task.dependsOn && task.dependsOn.length > 0) {
      const taskIssueId = generateTaskIssueId(
        featureNumber,
        task.taskId,
        taskPrefix
      );

      for (const depTaskId of task.dependsOn) {
        const depIssueId = generateTaskIssueId(
          featureNumber,
          depTaskId,
          taskPrefix
        );
        relationships.push({
          fromId: taskIssueId,
          fromType: "issue",
          toId: depIssueId,
          toType: "issue",
          relationshipType: "depends-on",
        });
      }
    }
  }

  return relationships;
}

/**
 * Map relationships for supporting documents in a feature
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - Spec ID prefix (default: "sk")
 * @param supportingDocs - Array of supporting document information
 * @returns Array of reference relationships to the plan
 *
 * @example
 * const refs = mapSupportingDocRelationships("001", "sk", [
 *   { fileType: "research", entityType: "spec" },
 *   { fileType: "data-model", entityType: "spec" },
 *   { fileType: "contract-api-spec", entityType: "spec" },
 * ]);
 * // Returns:
 * // - sk-001-research references sk-001-plan
 * // - sk-001-data-model references sk-001-plan
 * // - sk-001-contract-api-spec references sk-001-plan
 */
export function mapSupportingDocRelationships(
  featureNumber: string,
  prefix: string = "sk",
  supportingDocs: SupportingDocInfo[]
): MappedRelationship[] {
  const planId = getFeaturePlanId(featureNumber, prefix);
  const relationships: MappedRelationship[] = [];

  for (const doc of supportingDocs) {
    const docId = `${prefix}-${featureNumber}-${doc.fileType}`;
    relationships.push({
      fromId: docId,
      fromType: doc.entityType,
      toId: planId,
      toType: "spec",
      relationshipType: "references",
    });
  }

  return relationships;
}

/**
 * Map the core spec->plan relationship for a feature
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param prefix - Spec ID prefix (default: "sk")
 * @returns The implements relationship from plan to spec
 *
 * @example
 * const rel = mapPlanToSpecRelationship("001");
 * // Returns: sk-001-plan implements sk-001-spec
 */
export function mapPlanToSpecRelationship(
  featureNumber: string,
  prefix: string = "sk"
): MappedRelationship {
  return {
    fromId: getFeaturePlanId(featureNumber, prefix),
    fromType: "spec",
    toId: getFeatureSpecId(featureNumber, prefix),
    toType: "spec",
    relationshipType: "implements",
  };
}

/**
 * Map a single task's relationship to its plan
 *
 * @param featureNumber - Feature number (e.g., "001")
 * @param taskId - Task ID (e.g., "T001")
 * @param prefix - Spec ID prefix (default: "sk")
 * @param taskPrefix - Task issue ID prefix (default: "skt")
 * @returns The implements relationship from task to plan
 *
 * @example
 * const rel = mapTaskToPlanRelationship("001", "T001");
 * // Returns: skt-001-T001 implements sk-001-plan
 */
export function mapTaskToPlanRelationship(
  featureNumber: string,
  taskId: string,
  prefix: string = "sk",
  taskPrefix: string = "skt"
): MappedRelationship {
  return {
    fromId: generateTaskIssueId(featureNumber, taskId, taskPrefix),
    fromType: "issue",
    toId: getFeaturePlanId(featureNumber, prefix),
    toType: "spec",
    relationshipType: "implements",
  };
}

/**
 * Determine the standard supporting doc types for a feature
 *
 * @returns Array of standard supporting document types
 */
export function getStandardSupportingDocTypes(): SupportingDocInfo[] {
  return [
    { fileType: "research", entityType: "spec" },
    { fileType: "data-model", entityType: "spec" },
  ];
}

/**
 * Create a contract document info for relationship mapping
 *
 * @param contractName - Contract file name without extension (e.g., "api-spec")
 * @returns Supporting doc info for the contract
 *
 * @example
 * createContractDocInfo("api-spec")
 * // Returns: { fileType: "contract-api-spec", entityType: "spec" }
 */
export function createContractDocInfo(contractName: string): SupportingDocInfo {
  return {
    fileType: `contract-${contractName}`,
    entityType: "spec",
  };
}
