/**
 * Workflow Utility Functions
 *
 * Helper functions for template rendering, path extraction, and ID generation.
 *
 * @module execution/workflow/utils
 */

/**
 * Generate a unique ID with a given prefix
 *
 * @param prefix - Prefix for the ID (e.g., 'execution', 'checkpoint')
 * @returns Unique ID string
 *
 * @example
 * ```typescript
 * const id = generateId('execution');
 * // Returns: 'execution-1234567890-abc123'
 * ```
 */
export function generateId(prefix = 'id'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Render a template string by replacing {{variable}} placeholders with context values
 *
 * @param template - Template string with {{variable}} placeholders
 * @param context - Context object containing variable values
 * @returns Rendered string with variables replaced
 *
 * @example
 * ```typescript
 * const context = { name: 'World', greeting: 'Hello' };
 * const result = renderTemplate('{{greeting}} {{name}}!', context);
 * // Returns: 'Hello World!'
 * ```
 */
export function renderTemplate(
  template: string,
  context: Record<string, any>
): string {
  let rendered = template;

  // Replace all {{variable}} placeholders with values from context
  const placeholderRegex = /\{\{(\w+(?:\.\w+)*)\}\}/g;

  rendered = rendered.replace(placeholderRegex, (match, path) => {
    const value = extractValue(context, path);

    // If value is undefined or null, leave placeholder as-is
    if (value === undefined || value === null) {
      return match;
    }

    // Convert value to string
    return String(value);
  });

  return rendered;
}

/**
 * Extract a value from an object using a dot-notation path
 *
 * @param obj - Object to extract value from
 * @param path - Dot-notation path (e.g., 'user.profile.name')
 * @returns Extracted value or undefined if path doesn't exist
 *
 * @example
 * ```typescript
 * const obj = { user: { profile: { name: 'Alice' } } };
 * const name = extractValue(obj, 'user.profile.name');
 * // Returns: 'Alice'
 * ```
 */
export function extractValue(obj: any, path: string): any {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  // Handle simple paths (no dots)
  if (!path.includes('.')) {
    return obj[path];
  }

  // Split path and traverse
  const parts = path.split('.');
  let value: any = obj;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }

  return value;
}

/**
 * Merge two context objects, with the second overriding the first
 *
 * @param base - Base context object
 * @param updates - Updates to merge into base
 * @returns New merged context object
 *
 * @example
 * ```typescript
 * const base = { a: 1, b: 2 };
 * const updates = { b: 3, c: 4 };
 * const merged = mergeContext(base, updates);
 * // Returns: { a: 1, b: 3, c: 4 }
 * ```
 */
export function mergeContext(
  base: Record<string, any>,
  updates: Record<string, any>
): Record<string, any> {
  return {
    ...base,
    ...updates,
  };
}

/**
 * Evaluate a condition string in the context
 *
 * @param condition - Condition string to evaluate (e.g., '{{isEnabled}}')
 * @param context - Context object
 * @returns Boolean result of condition
 *
 * @example
 * ```typescript
 * const context = { isEnabled: true };
 * const result = evaluateCondition('{{isEnabled}}', context);
 * // Returns: true
 * ```
 */
export function evaluateCondition(
  condition: string,
  context: Record<string, any>
): boolean {
  // Render the condition template
  const rendered = renderTemplate(condition, context);

  // If template still contains placeholders, variables are missing - treat as false (fail-safe)
  if (rendered.includes('{{') && rendered.includes('}}')) {
    return false;
  }

  // Simple boolean evaluation
  // True if: 'true', '1', non-empty string
  // False if: 'false', '0', '', or falsy value
  if (rendered === 'true' || rendered === '1') {
    return true;
  }
  if (rendered === 'false' || rendered === '0' || rendered === '') {
    return false;
  }

  // For other values, check if they're truthy
  return Boolean(rendered);
}

/**
 * Create initial workflow context
 *
 * @param initialValues - Initial context values
 * @returns New context object
 */
export function createContext(
  initialValues: Record<string, any> = {}
): Record<string, any> {
  return {
    ...initialValues,
  };
}
