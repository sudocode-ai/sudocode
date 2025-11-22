/**
 * Validation utilities for sudocode CLI
 */

import type { RelationshipType } from "./types.js";

/**
 * Valid relationship type values for runtime validation.
 * This mirrors the RelationshipType union type defined in types.ts.
 *
 * Note: TypeScript types are erased at runtime, so we need this runtime
 * set to validate incoming string values. Keep this in sync with the
 * RelationshipType type definition.
 */
const VALID_RELATIONSHIP_TYPES = new Set<RelationshipType>([
  "blocks",
  "related",
  "discovered-from",
  "implements",
  "references",
  "depends-on",
]);

export function isValidRelationshipType(type: string): type is RelationshipType {
  return VALID_RELATIONSHIP_TYPES.has(type as RelationshipType);
}

export function getValidRelationshipTypes(): string[] {
  return Array.from(VALID_RELATIONSHIP_TYPES);
}
