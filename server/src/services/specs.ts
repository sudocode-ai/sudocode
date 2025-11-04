/**
 * Specs service - wraps CLI operations for API use
 */

import type Database from "better-sqlite3";
import {
  getSpec,
  listSpecs,
  createSpec,
  updateSpec,
  deleteSpec,
  type CreateSpecInput,
  type UpdateSpecInput,
  type ListSpecsOptions,
} from "@sudocode/cli/dist/operations/index.js";
import type { Spec } from "@sudocode-ai/types";

/**
 * Get all specs with optional filtering
 */
export function getAllSpecs(
  db: Database.Database,
  options?: ListSpecsOptions
): Spec[] {
  return listSpecs(db, options || {});
}

/**
 * Get a single spec by ID
 */
export function getSpecById(db: Database.Database, id: string): Spec | null {
  return getSpec(db, id);
}

/**
 * Create a new spec
 */
export function createNewSpec(
  db: Database.Database,
  input: CreateSpecInput
): Spec {
  return createSpec(db, input);
}

/**
 * Update an existing spec
 */
export function updateExistingSpec(
  db: Database.Database,
  id: string,
  input: UpdateSpecInput
): Spec {
  return updateSpec(db, id, input);
}

/**
 * Delete a spec
 */
export function deleteExistingSpec(db: Database.Database, id: string): boolean {
  return deleteSpec(db, id);
}
