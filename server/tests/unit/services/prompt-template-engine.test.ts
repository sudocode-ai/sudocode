/**
 * Unit tests for PromptTemplateEngine
 *
 * Tests variable substitution, conditionals, loops, nested paths, and validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PromptTemplateEngine } from '../../../src/services/prompt-template-engine.js';

describe('PromptTemplateEngine', () => {
  const engine = new PromptTemplateEngine();

  describe('Variable Substitution', () => {
    it('should replace simple variables', () => {
      const template = 'Hello {{name}}!';
      const context = { name: 'World' };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Hello World!');
    });

    it('should replace multiple variables', () => {
      const template = '{{greeting}} {{name}}!';
      const context = { greeting: 'Hello', name: 'Alice' };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Hello Alice!');
    });

    it('should handle missing variables gracefully', () => {
      const template = 'Hello {{name}}!';
      const context = {};
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Hello {{name}}!');
    });

    it('should convert non-string values to strings', () => {
      const template = 'Count: {{count}}';
      const context = { count: 42 };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Count: 42');
    });

    it('should handle boolean values', () => {
      const template = 'Active: {{active}}';
      const context = { active: true };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Active: true');
    });
  });

  describe('Nested Path Support', () => {
    it('should access nested object properties', () => {
      const template = '{{user.name}}';
      const context = { user: { name: 'Bob' } };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Bob');
    });

    it('should access deeply nested properties', () => {
      const template = '{{issue.author.name}}';
      const context = {
        issue: {
          author: { name: 'Alice' },
        },
      };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Alice');
    });

    it('should handle missing nested properties', () => {
      const template = '{{user.email}}';
      const context = { user: {} };
      const result = engine.render(template, context);
      assert.strictEqual(result, '{{user.email}}');
    });

    it('should handle null values in path', () => {
      const template = '{{user.profile.bio}}';
      const context = { user: { profile: null } };
      const result = engine.render(template, context);
      assert.strictEqual(result, '{{user.profile.bio}}');
    });
  });

  describe('Conditionals', () => {
    it('should show content when condition is truthy', () => {
      const template = '{{#if show}}Visible{{/if}}';
      const context = { show: true };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Visible');
    });

    it('should hide content when condition is falsy', () => {
      const template = '{{#if show}}Hidden{{/if}}';
      const context = { show: false };
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should treat undefined as falsy', () => {
      const template = '{{#if missing}}Hidden{{/if}}';
      const context = {};
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should treat empty string as falsy', () => {
      const template = '{{#if text}}Hidden{{/if}}';
      const context = { text: '' };
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should treat non-empty string as truthy', () => {
      const template = '{{#if text}}Visible{{/if}}';
      const context = { text: 'content' };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Visible');
    });

    it('should work with nested paths in conditionals', () => {
      const template = '{{#if user.active}}Active User{{/if}}';
      const context = { user: { active: true } };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Active User');
    });

    it('should preserve whitespace inside conditionals', () => {
      const template = '{{#if show}}\n  Content\n{{/if}}';
      const context = { show: true };
      const result = engine.render(template, context);
      assert.strictEqual(result, '\n  Content\n');
    });

    it('should handle variables inside conditional content', () => {
      const template = '{{#if show}}Hello {{name}}{{/if}}';
      const context = { show: true, name: 'World' };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'Hello World');
    });
  });

  describe('Loops', () => {
    it('should iterate over arrays', () => {
      const template = '{{#each items}}{{name}} {{/each}}';
      const context = {
        items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'A B C ');
    });

    it('should handle empty arrays', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      const context = { items: [] };
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should handle non-array values gracefully', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      const context = { items: 'not an array' };
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should handle missing array gracefully', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      const context = {};
      const result = engine.render(template, context);
      assert.strictEqual(result, '');
    });

    it('should access nested properties in loop items', () => {
      const template = '{{#each specs}}[[{{id}}]]: {{title}}\n{{/each}}';
      const context = {
        specs: [
          { id: 'SPEC-001', title: 'Auth' },
          { id: 'SPEC-002', title: 'Database' },
        ],
      };
      const result = engine.render(template, context);
      assert.strictEqual(
        result,
        '[[SPEC-001]]: Auth\n[[SPEC-002]]: Database\n'
      );
    });

    it('should handle loops with multiline content', () => {
      const template = `{{#each items}}
- {{name}}
{{/each}}`;
      const context = {
        items: [{ name: 'First' }, { name: 'Second' }],
      };
      const result = engine.render(template, context);
      assert.strictEqual(result, '\n- First\n\n- Second\n');
    });

    it('should handle nested loops', () => {
      const template = '{{#each outer}}{{#each inner}}{{value}} {{/each}}{{/each}}';
      const context = {
        outer: [
          { inner: [{ value: 'A' }, { value: 'B' }] },
          { inner: [{ value: 'C' }, { value: 'D' }] },
        ],
      };
      const result = engine.render(template, context);
      assert.strictEqual(result, 'A B C D ');
    });
  });

  describe('Complex Templates', () => {
    it('should handle combination of variables, conditionals, and loops', () => {
      const template = `Fix issue {{issueId}}: {{title}}

{{#if description}}
Description: {{description}}
{{/if}}

{{#if relatedSpecs}}
Related Specs:
{{#each relatedSpecs}}
- [[{{id}}]]: {{title}}
{{/each}}
{{/if}}`;

      const context = {
        issueId: 'ISSUE-001',
        title: 'Auth Bug',
        description: 'Fix authentication',
        relatedSpecs: [
          { id: 'SPEC-001', title: 'Auth System' },
          { id: 'SPEC-002', title: 'User Management' },
        ],
      };

      const result = engine.render(template, context);
      assert.ok(result.includes('Fix issue ISSUE-001: Auth Bug'));
      assert.ok(result.includes('Description: Fix authentication'));
      assert.ok(result.includes('[[SPEC-001]]: Auth System'));
      assert.ok(result.includes('[[SPEC-002]]: User Management'));
    });

    it('should handle real-world issue template', () => {
      const template = `Implement [[{{issueId}}]]: {{title}}

{{description}}

{{#if relatedSpecs}}
## Related Specifications
{{#each relatedSpecs}}
- See [[{{id}}]] for {{title}}
{{/each}}
{{/if}}

{{#if feedback}}
## Previous Feedback
{{#each feedback}}
- {{content}} (from {{issueId}})
{{/each}}
{{/if}}`;

      const context = {
        issueId: 'ISSUE-042',
        title: 'Add OAuth',
        description: 'Implement OAuth2 authentication flow',
        relatedSpecs: [{ id: 'SPEC-015', title: 'auth details' }],
        feedback: [
          { issueId: 'ISSUE-041', content: 'Consider token refresh' },
        ],
      };

      const result = engine.render(template, context);
      assert.ok(result.includes('Implement [[ISSUE-042]]: Add OAuth'));
      assert.ok(result.includes('[[SPEC-015]]'));
      assert.ok(result.includes('Consider token refresh'));
    });
  });

  describe('Validation', () => {
    it('should validate balanced {{#if}} tags', () => {
      const template = '{{#if x}}content{{/if}}';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should detect unbalanced {{#if}} tags (missing close)', () => {
      const template = '{{#if x}}content';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Unbalanced {{#if}}'));
    });

    it('should detect unbalanced {{#if}} tags (extra close)', () => {
      const template = '{{#if x}}content{{/if}}{{/if}}';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Unbalanced {{#if}}'));
    });

    it('should validate balanced {{#each}} tags', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should detect unbalanced {{#each}} tags (missing close)', () => {
      const template = '{{#each items}}{{name}}';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Unbalanced {{#each}}'));
    });

    it('should detect unbalanced {{#each}} tags (extra close)', () => {
      const template = '{{#each items}}{{name}}{{/each}}{{/each}}';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Unbalanced {{#each}}'));
    });

    it('should detect multiple validation errors', () => {
      const template = '{{#if x}}{{#each items}}content';
      const result = engine.validate(template);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 2);
    });

    it('should validate complex nested template', () => {
      const template = `{{#if hasItems}}
{{#each items}}
  {{#if item.active}}
    {{item.name}}
  {{/if}}
{{/each}}
{{/if}}`;
      const result = engine.validate(template);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });
  });
});
