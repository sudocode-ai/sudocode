import * as yaml from 'js-yaml';
import type { Issue, Spec } from '@sudocode-ai/types';

/**
 * Options for YAML conversion
 */
export interface YamlConverterOptions {
  /**
   * YAML indentation (default: 2)
   */
  indent?: number;

  /**
   * Line width for multi-line strings (default: 80)
   */
  lineWidth?: number;

  /**
   * Whether to use literal style for multi-line strings (default: true)
   */
  useLiteralStyle?: boolean;
}

/**
 * Convert YAML string to JSON entity (Issue or Spec)
 * Restores line breaks and preserves all data types
 *
 * @param yamlString - YAML string to parse
 * @returns Parsed JSON object
 * @throws Error if YAML is invalid
 */
export function yamlToJson<T extends Issue | Spec | Record<string, any>>(
  yamlString: string
): T {
  try {
    // Use JSON_SCHEMA for type consistency
    // This ensures proper handling of dates, nulls, booleans, etc.
    const parsed = yaml.load(yamlString, {
      schema: yaml.JSON_SCHEMA
    }) as T;

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML must parse to an object');
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse YAML: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Convert JSON entity to YAML string
 * Uses literal style for multi-line strings to enable git line-based merging
 *
 * @param obj - JSON object to convert
 * @param options - Conversion options
 * @returns YAML string
 */
export function jsonToYaml<T extends Issue | Spec | Record<string, any>>(
  obj: T,
  options: YamlConverterOptions = {}
): string {
  const {
    indent = 2,
    lineWidth = 80,
    useLiteralStyle = true
  } = options;

  try {
    // Custom dumper that uses literal style for multi-line strings
    const yamlStr = yaml.dump(obj, {
      indent,
      lineWidth,
      schema: yaml.JSON_SCHEMA,
      noRefs: true, // Disable anchors/aliases for deterministic output
      sortKeys: false, // Preserve key order from JSON
      quotingType: '"', // Use double quotes when quoting needed
      forceQuotes: false, // Only quote when necessary

      // Custom styles function to use literal style for multi-line strings
      styles: useLiteralStyle ? {
        '!!str': 'literal' // Use | style for all strings (yaml lib will use plain for short ones)
      } : undefined
    });

    return yamlStr;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to convert to YAML: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Deep equality comparison that handles all data types
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if values are deeply equal
 */
function deepEqual(a: any, b: any): boolean {
  // Strict equality for primitives
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every(key => deepEqual(a[key], b[key]));
  }

  // Different types
  return false;
}

/**
 * Validate round-trip conversion: JSON → YAML → JSON
 * Returns true if the conversion is lossless
 *
 * @param original - Original JSON object
 * @param options - YAML conversion options
 * @returns True if round-trip preserves all data
 */
export function validateRoundTrip(
  original: Issue | Spec | Record<string, any>,
  options?: YamlConverterOptions
): boolean {
  try {
    // Convert to YAML
    const yamlStr = jsonToYaml(original, options);

    // Convert back to JSON
    const restored = yamlToJson<typeof original>(yamlStr);

    // Deep equality check
    return deepEqual(original, restored);
  } catch (error) {
    // Any error means round-trip failed
    return false;
  }
}

/**
 * Validate round-trip and return detailed error information
 * Useful for debugging conversion issues
 *
 * @param original - Original JSON object
 * @param options - YAML conversion options
 * @returns Object with success status and optional error details
 */
export function validateRoundTripDetailed(
  original: Issue | Spec | Record<string, any>,
  options?: YamlConverterOptions
): {
  success: boolean;
  yaml?: string;
  restored?: any;
  error?: string;
  differences?: Array<{ path: string; original: any; restored: any }>;
} {
  try {
    // Convert to YAML
    const yamlStr = jsonToYaml(original, options);

    // Convert back to JSON
    const restored = yamlToJson<typeof original>(yamlStr);

    // Deep equality check
    const isEqual = deepEqual(original, restored);

    if (isEqual) {
      return { success: true, yaml: yamlStr, restored };
    }

    // Find differences
    const differences = findDifferences(original, restored);

    return {
      success: false,
      yaml: yamlStr,
      restored,
      differences
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Find differences between two objects
 *
 * @param original - Original object
 * @param restored - Restored object
 * @param path - Current path (for recursion)
 * @returns Array of differences
 */
function findDifferences(
  original: any,
  restored: any,
  path: string = ''
): Array<{ path: string; original: any; restored: any }> {
  const differences: Array<{ path: string; original: any; restored: any }> = [];

  // Handle primitives and null
  if (original === restored) return differences;
  if (original == null || restored == null) {
    if (original !== restored) {
      differences.push({ path, original, restored });
    }
    return differences;
  }

  // Handle arrays
  if (Array.isArray(original) && Array.isArray(restored)) {
    if (original.length !== restored.length) {
      differences.push({ path: `${path}.length`, original: original.length, restored: restored.length });
    }
    const maxLen = Math.max(original.length, restored.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      differences.push(...findDifferences(original[i], restored[i], itemPath));
    }
    return differences;
  }

  // Handle objects
  if (typeof original === 'object' && typeof restored === 'object') {
    const allKeys = new Set([...Object.keys(original), ...Object.keys(restored)]);
    for (const key of allKeys) {
      const keyPath = path ? `${path}.${key}` : key;
      if (!(key in original)) {
        differences.push({ path: keyPath, original: undefined, restored: restored[key] });
      } else if (!(key in restored)) {
        differences.push({ path: keyPath, original: original[key], restored: undefined });
      } else {
        differences.push(...findDifferences(original[key], restored[key], keyPath));
      }
    }
    return differences;
  }

  // Different types or values
  if (original !== restored) {
    differences.push({ path, original, restored });
  }

  return differences;
}
