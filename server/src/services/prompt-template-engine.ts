/**
 * Prompt Template Engine
 *
 * Simple template engine with Handlebars-like syntax for rendering prompts.
 * Supports variable substitution, conditionals, and loops.
 *
 * @module services/prompt-template-engine
 */

/**
 * PromptTemplateEngine - Render templates with context variables
 *
 * Template Syntax:
 * - Variables: {{variable}} or {{object.nested.path}}
 * - Conditionals: {{#if variable}}content{{/if}}
 * - Loops: {{#each array}}content{{/each}}
 *
 * @example
 * ```typescript
 * const engine = new PromptTemplateEngine();
 * const result = engine.render(
 *   'Hello {{name}}!',
 *   { name: 'World' }
 * );
 * // Result: 'Hello World!'
 * ```
 */
export class PromptTemplateEngine {
  /**
   * Render template with context variables
   *
   * @param template - Template string with {{variable}} syntax
   * @param context - Object containing variable values
   * @returns Rendered template string
   *
   * @example
   * ```typescript
   * const template = `
   *   Issue: {{issue.title}}
   *   {{#if issue.description}}
   *   Description: {{issue.description}}
   *   {{/if}}
   *   {{#each specs}}
   *   - [[{{id}}]]: {{title}}
   *   {{/each}}
   * `;
   *
   * const context = {
   *   issue: { title: 'Bug fix', description: 'Fix auth' },
   *   specs: [{ id: 'SPEC-001', title: 'Auth' }]
   * };
   *
   * engine.render(template, context);
   * ```
   */
  render(template: string, context: Record<string, any>): string {
    let result = template;

    // Process in order: loops, conditionals, then variables
    // Use a while loop to handle nested structures by processing innermost first

    // 1. Handle loops: {{#each array}}...{{/each}}
    // Process innermost loops first by finding balanced tags
    let previousResult = '';
    while (result !== previousResult) {
      previousResult = result;
      result = this.replaceLoop(result, context);
    }

    // 2. Handle conditionals: {{#if variable}}...{{/if}}
    previousResult = '';
    while (result !== previousResult) {
      previousResult = result;
      result = this.replaceConditional(result, context);
    }

    // 3. Replace simple variables: {{variable}}
    result = result.replace(/\{\{([^}#/]+)\}\}/g, (match, key) => {
      const value = this.getValue(context, key.trim());
      return value !== undefined ? String(value) : match;
    });

    return result;
  }

  /**
   * Replace one {{#each}} loop with balanced tags
   * Processes innermost loop first
   */
  private replaceLoop(template: string, context: Record<string, any>): string {
    const match = this.findBalancedTag(template, 'each');
    if (!match) return template;

    const { key, content, fullMatch } = match;
    const array = this.getValue(context, key.trim());

    if (!Array.isArray(array)) {
      return template.replace(fullMatch, '');
    }

    const replacement = array
      .map((item) => this.render(content, item))
      .join('');

    return template.replace(fullMatch, replacement);
  }

  /**
   * Replace one {{#if}} conditional with balanced tags
   */
  private replaceConditional(template: string, context: Record<string, any>): string {
    const match = this.findBalancedTag(template, 'if');
    if (!match) return template;

    const { key, content, fullMatch } = match;
    const value = this.getValue(context, key.trim());
    const replacement = value ? content : '';

    return template.replace(fullMatch, replacement);
  }

  /**
   * Find a balanced {{#tagName}} ... {{/tagName}} pair
   * Returns the FIRST match (outermost, will be processed recursively)
   */
  private findBalancedTag(
    template: string,
    tagName: string
  ): { key: string; content: string; fullMatch: string } | null {
    const openPattern = `\\{\\{#${tagName}\\s+([^}]+)\\}\\}`;
    const closePattern = `\\{\\{\\/${tagName}\\}\\}`;
    const openRegex = new RegExp(openPattern);
    const match = openRegex.exec(template);

    if (!match) return null;

    const openIndex = match.index;
    const key = match[1];
    let depth = 1;
    let i = openIndex + match[0].length;
    const contentStart = i;

    // Find the matching closing tag by counting depth
    while (i < template.length && depth > 0) {
      // Check for nested opening tags
      const nestedOpen = template.slice(i).match(new RegExp(`^${openPattern}`));
      if (nestedOpen) {
        depth++;
        i += nestedOpen[0].length;
        continue;
      }

      // Check for closing tags
      const close = template.slice(i).match(new RegExp(`^${closePattern}`));
      if (close) {
        depth--;
        if (depth === 0) {
          const content = template.slice(contentStart, i);
          const fullMatch = template.slice(openIndex, i + close[0].length);
          return { key, content, fullMatch };
        }
        i += close[0].length;
        continue;
      }

      i++;
    }

    return null;
  }

  /**
   * Get nested value from context using dot notation
   *
   * @param context - Context object
   * @param path - Dot-separated path (e.g., 'user.name')
   * @returns Value at path or undefined
   *
   * @example
   * ```typescript
   * getValue({ user: { name: 'Alice' } }, 'user.name')
   * // Returns: 'Alice'
   * ```
   */
  private getValue(context: Record<string, any>, path: string): any {
    const keys = path.split('.');
    let value: any = context;

    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      value = value[key];
    }

    return value;
  }

  /**
   * Validate template syntax
   *
   * Checks for:
   * - Balanced {{#if}} / {{/if}} tags
   * - Balanced {{#each}} / {{/each}} tags
   *
   * @param template - Template string to validate
   * @returns Validation result with errors if any
   *
   * @example
   * ```typescript
   * engine.validate('{{#if x}}content{{/if}}')
   * // Returns: { valid: true, errors: [] }
   *
   * engine.validate('{{#if x}}content')
   * // Returns: { valid: false, errors: ['Unbalanced {{#if}} tags'] }
   * ```
   */
  validate(template: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for balanced {{#if}} tags
    const ifCount = (template.match(/\{\{#if/g) || []).length;
    const endIfCount = (template.match(/\{\{\/if\}\}/g) || []).length;
    if (ifCount !== endIfCount) {
      errors.push(`Unbalanced {{#if}} tags (${ifCount} vs ${endIfCount})`);
    }

    // Check for balanced {{#each}} tags
    const eachCount = (template.match(/\{\{#each/g) || []).length;
    const endEachCount = (template.match(/\{\{\/each\}\}/g) || []).length;
    if (eachCount !== endEachCount) {
      errors.push(
        `Unbalanced {{#each}} tags (${eachCount} vs ${endEachCount})`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
