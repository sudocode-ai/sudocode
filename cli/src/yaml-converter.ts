/**
 * YAML-to-JSONL converter with lossless round-trip validation
 * Supports bidirectional conversion: JSON ↔ YAML
 */

import * as yaml from "js-yaml";
import type { Issue, Spec } from "@sudocode-ai/types";

export interface YamlConverterOptions {
  /**
   * Preserve line breaks in multi-line strings as literal newlines
   */
  preserveLineBreaks?: boolean;
  /**
   * Number of spaces for indentation (default: 2)
   */
  indent?: number;
  /**
   * Line width for YAML output (default: 80)
   */
  lineWidth?: number;
}

/**
 * Convert JSON entity (Issue or Spec) to YAML string
 * Preserves all field types and ensures round-trip compatibility
 */
export function jsonToYaml(
  entity: Issue | Spec | Record<string, any>,
  options: YamlConverterOptions = {}
): string {
  const {
    preserveLineBreaks = true,
    indent = 2,
    lineWidth = 80,
  } = options;

  try {
    // Use YAML dump with custom settings for lossless conversion
    const yamlString = yaml.dump(entity, {
      indent,
      lineWidth,
      noRefs: true, // Prevent references for clarity
      sortKeys: false, // Preserve field order
      noCompatMode: true, // Use YAML 1.2
      quotingType: '"', // Use double quotes for consistency
      forceQuotes: false, // Only quote when necessary
      // Customize how strings are folded
      condenseFlow: false,
      // Schema determines type interpretation
      schema: yaml.JSON_SCHEMA,
      // Custom string style resolver to use literal style only for multi-line strings
      styles: preserveLineBreaks
        ? {
            "!!str": (value: string) => {
              // Use literal style (|) for multi-line strings (containing newlines)
              // Use plain/quoted style for single-line strings
              if (value && typeof value === "string" && value.includes("\n")) {
                return "literal";
              }
              return "plain";
            },
          }
        : undefined,
    });

    return yamlString;
  } catch (error) {
    throw new Error(
      `Failed to convert JSON to YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Convert YAML string to JSON entity (Issue or Spec)
 * Restores line breaks and preserves all data types
 */
export function yamlToJson<T extends Issue | Spec | Record<string, any> = any>(
  yamlString: string
): T {
  try {
    // Parse YAML with JSON schema for consistent type handling
    const parsed = yaml.load(yamlString, {
      schema: yaml.JSON_SCHEMA,
      json: true, // Enforce JSON compatibility
    });

    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        "Invalid YAML: must parse to a non-null object"
      );
    }

    // Return the parsed object cast to the expected type
    return parsed as T;
  } catch (error) {
    throw new Error(
      `Failed to convert YAML to JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate round-trip conversion: JSON → YAML → JSON
 * Returns true if the conversion is lossless
 */
export function validateRoundTrip(
  original: Issue | Spec | Record<string, any>,
  options: YamlConverterOptions = {}
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    // Convert to YAML
    const yamlString = jsonToYaml(original, options);

    // Convert back to JSON
    const restored = yamlToJson(yamlString);

    // Deep equality check
    const isEqual = deepEqual(original, restored);

    if (!isEqual) {
      errors.push("Round-trip conversion is not lossless");

      // Find differences
      const diffs = findDifferences(original, restored);
      errors.push(...diffs);
    }

    return { valid: isEqual, errors };
  } catch (error) {
    errors.push(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { valid: false, errors };
  }
}

/**
 * Deep equality comparison for objects and arrays
 */
function deepEqual(a: any, b: any): boolean {
  // Strict equality for primitives
  if (a === b) return true;

  // Type check
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  // Array comparison
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Object comparison
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();

    if (keysA.length !== keysB.length) return false;
    if (!deepEqual(keysA, keysB)) return false;

    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Find differences between two objects for debugging
 */
function findDifferences(
  original: any,
  restored: any,
  path: string = ""
): string[] {
  const diffs: string[] = [];

  // Type mismatch
  if (typeof original !== typeof restored) {
    diffs.push(
      `Type mismatch at ${path || "root"}: ${typeof original} vs ${typeof restored}`
    );
    return diffs;
  }

  // Null/undefined handling
  if (original === null && restored !== null) {
    diffs.push(`Null mismatch at ${path || "root"}`);
    return diffs;
  }
  if (original === undefined && restored !== undefined) {
    diffs.push(`Undefined mismatch at ${path || "root"}`);
    return diffs;
  }

  // Array comparison
  if (Array.isArray(original) && Array.isArray(restored)) {
    if (original.length !== restored.length) {
      diffs.push(
        `Array length mismatch at ${path || "root"}: ${original.length} vs ${restored.length}`
      );
    }
    const minLength = Math.min(original.length, restored.length);
    for (let i = 0; i < minLength; i++) {
      diffs.push(
        ...findDifferences(original[i], restored[i], `${path}[${i}]`)
      );
    }
    return diffs;
  }

  // Object comparison
  if (typeof original === "object" && original !== null) {
    const keysOriginal = Object.keys(original);
    const keysRestored = Object.keys(restored);

    const missingInRestored = keysOriginal.filter(
      (k) => !keysRestored.includes(k)
    );
    const extraInRestored = keysRestored.filter(
      (k) => !keysOriginal.includes(k)
    );

    if (missingInRestored.length > 0) {
      diffs.push(
        `Missing keys in restored at ${path || "root"}: ${missingInRestored.join(", ")}`
      );
    }
    if (extraInRestored.length > 0) {
      diffs.push(
        `Extra keys in restored at ${path || "root"}: ${extraInRestored.join(", ")}`
      );
    }

    for (const key of keysOriginal) {
      if (keysRestored.includes(key)) {
        const newPath = path ? `${path}.${key}` : key;
        diffs.push(
          ...findDifferences(original[key], restored[key], newPath)
        );
      }
    }
    return diffs;
  }

  // Primitive value comparison
  if (original !== restored) {
    diffs.push(
      `Value mismatch at ${path || "root"}: ${JSON.stringify(original)} vs ${JSON.stringify(restored)}`
    );
  }

  return diffs;
}

/**
 * Batch convert multiple JSON entities to YAML
 */
export function jsonArrayToYaml(
  entities: Array<Issue | Spec | Record<string, any>>,
  options: YamlConverterOptions = {}
): string[] {
  return entities.map((entity) => jsonToYaml(entity, options));
}

/**
 * Batch convert multiple YAML strings to JSON entities
 */
export function yamlArrayToJson<T extends Issue | Spec | Record<string, any> = any>(
  yamlStrings: string[]
): T[] {
  return yamlStrings.map((yamlString) => yamlToJson<T>(yamlString));
}
