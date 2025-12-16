import yaml from 'js-yaml';

/**
 * YAML Converter for Sudocode entities
 *
 * Provides deterministic JSON ↔ YAML conversion with:
 * - Literal style (|) for multi-line strings (enables line-based git merging)
 * - Plain style for simple scalars
 * - Block style for arrays (one item per line)
 * - Deterministic formatting (2-space indent, LF line endings)
 * - Lossless round-trip conversion
 */

export interface YamlConverterOptions {
  /**
   * Indent size for YAML output (default: 2)
   */
  indent?: number;

  /**
   * Line width for wrapping (default: 80, set to -1 for no wrapping)
   */
  lineWidth?: number;

  /**
   * Minimum length for literal style multi-line strings (default: 60)
   * Strings with newlines shorter than this may use quoted style instead
   */
  literalMinLength?: number;
}

/**
 * YAML style variants
 */
type YamlStyle = 'plain' | 'single-quoted' | 'double-quoted' | 'literal' | 'folded';

/**
 * Determine the best YAML style for a string value
 */
function getStringStyle(value: string, literalMinLength: number = 60): YamlStyle {
  // Empty strings use plain style
  if (value.length === 0) {
    return 'plain';
  }

  // Strings with newlines use literal style for git-friendly line-based merging
  if (value.includes('\n')) {
    return 'literal';
  }

  // Single-line strings use plain style (js-yaml handles quoting automatically)
  return 'plain';
}

/**
 * Convert a JSON object to YAML string
 *
 * @param obj - The object to convert
 * @param options - Conversion options
 * @returns YAML string with deterministic formatting
 */
export function toYaml(obj: any, options: YamlConverterOptions = {}): string {
  const {
    indent = 2,
    lineWidth = 80,
    literalMinLength = 60,
  } = options;

  const yamlString = yaml.dump(obj, {
    indent,
    lineWidth,
    noRefs: true, // Don't use YAML anchors/aliases
    sortKeys: false, // Preserve key order
    noCompatMode: true, // Use YAML 1.2

    // Custom style function for strings
    styles: {
      '!!str': (value: string) => getStringStyle(value, literalMinLength),
    },

    // Don't wrap long lines in literal strings
    flowLevel: -1,
  } as any); // Use 'as any' to bypass type checking for extended options

  // Ensure trailing newline
  return yamlString.endsWith('\n') ? yamlString : yamlString + '\n';
}

/**
 * Convert a YAML string to JSON object
 *
 * @param yamlString - The YAML string to parse
 * @returns Parsed JavaScript object
 * @throws {yaml.YAMLException} If YAML is invalid
 */
export function fromYaml(yamlString: string): any {
  if (!yamlString || yamlString.trim() === '') {
    return null;
  }

  return yaml.load(yamlString, {
    schema: yaml.JSON_SCHEMA, // Use JSON-compatible schema
  });
}

/**
 * Verify that an object can round-trip through YAML without data loss
 *
 * @param obj - The object to test
 * @param options - Conversion options
 * @returns True if round-trip preserves all data
 */
export function verifyRoundTrip(obj: any, options: YamlConverterOptions = {}): boolean {
  try {
    const yamlStr = toYaml(obj, options);
    const parsed = fromYaml(yamlStr);

    // Deep equality check
    return JSON.stringify(obj) === JSON.stringify(parsed);
  } catch (error) {
    return false;
  }
}

/**
 * Convert multiple JSON objects to YAML documents in a single file
 * Uses YAML document separator (---) between objects
 *
 * @param objects - Array of objects to convert
 * @param options - Conversion options
 * @returns YAML string with multiple documents
 */
export function toYamlDocuments(objects: any[], options: YamlConverterOptions = {}): string {
  if (objects.length === 0) {
    return '';
  }

  const documents = objects.map(obj => {
    const yamlStr = toYaml(obj, options);
    // Remove trailing newline for joining
    return yamlStr.replace(/\n$/, '');
  });

  // Join with document separator
  return documents.join('\n---\n') + '\n';
}

/**
 * Parse multiple YAML documents from a single file
 *
 * @param yamlString - YAML string with multiple documents
 * @returns Array of parsed objects
 */
export function fromYamlDocuments(yamlString: string): any[] {
  if (!yamlString || yamlString.trim() === '') {
    return [];
  }

  return yaml.loadAll(yamlString, undefined, {
    schema: yaml.JSON_SCHEMA,
  });
}
