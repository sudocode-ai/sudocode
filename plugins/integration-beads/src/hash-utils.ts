/**
 * Hash utilities for content-based change detection
 *
 * Provides canonical hashing that produces consistent hashes regardless
 * of JSON key ordering, enabling reliable change detection.
 */

import { createHash } from "crypto";

/**
 * Recursively sort object keys to ensure consistent serialization
 *
 * This is critical because JSON.stringify doesn't guarantee key order,
 * so {"a":1,"b":2} and {"b":2,"a":1} would produce different hashes
 * without this normalization.
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return obj;
}

/**
 * Compute a canonical hash for an entity
 *
 * The hash is stable regardless of JSON key ordering, making it suitable
 * for detecting actual content changes vs just serialization differences.
 *
 * @param entity - The entity to hash
 * @returns SHA-256 hash of the canonicalized JSON
 */
export function computeCanonicalHash(entity: unknown): string {
  const sorted = sortObjectKeys(entity);
  const json = JSON.stringify(sorted);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Compute hash from raw JSON string (for files)
 *
 * @param content - Raw file content
 * @returns SHA-256 hash of the content
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
