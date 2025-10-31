/**
 * Tests for Workflow Utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateId,
  renderTemplate,
  extractValue,
  mergeContext,
  evaluateCondition,
  createContext,
} from '../../../../src/execution/workflow/utils.js';

describe('Workflow Utilities', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      assert.notStrictEqual(id1, id2);
    });

    it('should generate IDs with correct prefix', () => {
      const id = generateId('test');
      assert.ok(id.startsWith('test-'));
    });

    it('should generate IDs with default prefix', () => {
      const id = generateId();
      assert.ok(id.startsWith('id-'));
    });

    it('should generate IDs with correct format', () => {
      const id = generateId('execution');
      const parts = id.split('-');
      assert.strictEqual(parts.length, 3);
      assert.strictEqual(parts[0], 'execution');
      assert.ok(!isNaN(parseInt(parts[1]))); // timestamp
      assert.ok(parts[2].length > 0); // random component
    });
  });

  describe('renderTemplate', () => {
    it('should replace single variable', () => {
      const context = { name: 'World' };
      const result = renderTemplate('Hello {{name}}', context);
      assert.strictEqual(result, 'Hello World');
    });

    it('should replace multiple variables', () => {
      const context = { name: 'Alice', age: 30 };
      const result = renderTemplate(
        'Hello {{name}}, you are {{age}} years old',
        context
      );
      assert.strictEqual(result, 'Hello Alice, you are 30 years old');
    });

    it('should replace multiple occurrences of same variable', () => {
      const context = { value: 'test' };
      const result = renderTemplate('{{value}} and {{value}}', context);
      assert.strictEqual(result, 'test and test');
    });

    it('should handle missing variables by leaving placeholder', () => {
      const context = { name: 'World' };
      const result = renderTemplate('Hello {{name}}, age {{age}}', context);
      assert.strictEqual(result, 'Hello World, age {{age}}');
    });

    it('should handle nested context paths', () => {
      const context = {
        user: { name: 'Bob', email: 'bob@test.com' },
      };
      const result = renderTemplate(
        'User: {{user.name}}, Email: {{user.email}}',
        context
      );
      assert.strictEqual(result, 'User: Bob, Email: bob@test.com');
    });

    it('should handle empty template', () => {
      const context = { name: 'World' };
      const result = renderTemplate('', context);
      assert.strictEqual(result, '');
    });

    it('should handle template with no placeholders', () => {
      const context = { name: 'World' };
      const result = renderTemplate('Hello World', context);
      assert.strictEqual(result, 'Hello World');
    });

    it('should convert non-string values to strings', () => {
      const context = { count: 42, enabled: true };
      const result = renderTemplate('Count: {{count}}, Enabled: {{enabled}}', context);
      assert.strictEqual(result, 'Count: 42, Enabled: true');
    });

    it('should handle null values', () => {
      const context = { value: null };
      const result = renderTemplate('Value: {{value}}', context);
      assert.strictEqual(result, 'Value: {{value}}');
    });

    it('should handle undefined values', () => {
      const context = { value: undefined };
      const result = renderTemplate('Value: {{value}}', context);
      assert.strictEqual(result, 'Value: {{value}}');
    });
  });

  describe('extractValue', () => {
    it('should extract simple value', () => {
      const obj = { name: 'Alice' };
      const result = extractValue(obj, 'name');
      assert.strictEqual(result, 'Alice');
    });

    it('should extract nested value', () => {
      const obj = { user: { profile: { name: 'Bob' } } };
      const result = extractValue(obj, 'user.profile.name');
      assert.strictEqual(result, 'Bob');
    });

    it('should return undefined for non-existent path', () => {
      const obj = { name: 'Alice' };
      const result = extractValue(obj, 'age');
      assert.strictEqual(result, undefined);
    });

    it('should return undefined for non-existent nested path', () => {
      const obj = { user: { name: 'Alice' } };
      const result = extractValue(obj, 'user.profile.name');
      assert.strictEqual(result, undefined);
    });

    it('should handle null object', () => {
      const result = extractValue(null, 'name');
      assert.strictEqual(result, undefined);
    });

    it('should handle undefined object', () => {
      const result = extractValue(undefined, 'name');
      assert.strictEqual(result, undefined);
    });

    it('should handle array values', () => {
      const obj = { items: ['a', 'b', 'c'] };
      const result = extractValue(obj, 'items');
      assert.deepStrictEqual(result, ['a', 'b', 'c']);
    });

    it('should handle array indexing', () => {
      const obj = { items: ['a', 'b', 'c'] };
      const result = extractValue(obj, 'items.1');
      assert.strictEqual(result, 'b');
    });

    it('should handle deeply nested objects', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: { value: 'deep' },
            },
          },
        },
      };
      const result = extractValue(obj, 'level1.level2.level3.level4.value');
      assert.strictEqual(result, 'deep');
    });
  });

  describe('mergeContext', () => {
    it('should merge two contexts', () => {
      const base = { a: 1 };
      const updates = { b: 2 };
      const result = mergeContext(base, updates);
      assert.deepStrictEqual(result, { a: 1, b: 2 });
    });

    it('should override existing keys', () => {
      const base = { a: 1, b: 2 };
      const updates = { b: 3, c: 4 };
      const result = mergeContext(base, updates);
      assert.deepStrictEqual(result, { a: 1, b: 3, c: 4 });
    });

    it('should handle empty base', () => {
      const base = {};
      const updates = { a: 1 };
      const result = mergeContext(base, updates);
      assert.deepStrictEqual(result, { a: 1 });
    });

    it('should handle empty updates', () => {
      const base = { a: 1 };
      const updates = {};
      const result = mergeContext(base, updates);
      assert.deepStrictEqual(result, { a: 1 });
    });

    it('should not mutate original contexts', () => {
      const base = { a: 1 };
      const updates = { b: 2 };
      const result = mergeContext(base, updates);

      assert.deepStrictEqual(base, { a: 1 });
      assert.deepStrictEqual(updates, { b: 2 });
      assert.deepStrictEqual(result, { a: 1, b: 2 });
    });
  });

  describe('evaluateCondition', () => {
    it('should evaluate true condition', () => {
      const context = { isEnabled: true };
      const result = evaluateCondition('{{isEnabled}}', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate false condition', () => {
      const context = { isEnabled: false };
      const result = evaluateCondition('{{isEnabled}}', context);
      assert.strictEqual(result, false);
    });

    it('should evaluate string "true" as true', () => {
      const context = { value: 'true' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate string "false" as false', () => {
      const context = { value: 'false' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, false);
    });

    it('should evaluate "1" as true', () => {
      const context = { value: '1' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate "0" as false', () => {
      const context = { value: '0' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, false);
    });

    it('should evaluate empty string as false', () => {
      const context = { value: '' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, false);
    });

    it('should evaluate non-empty string as true', () => {
      const context = { value: 'any text' };
      const result = evaluateCondition('{{value}}', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate missing variable as false', () => {
      const context = {};
      const result = evaluateCondition('{{missing}}', context);
      assert.strictEqual(result, false);
    });
  });

  describe('createContext', () => {
    it('should create empty context', () => {
      const context = createContext();
      assert.deepStrictEqual(context, {});
    });

    it('should create context with initial values', () => {
      const context = createContext({ name: 'test', value: 42 });
      assert.deepStrictEqual(context, { name: 'test', value: 42 });
    });

    it('should not mutate initial values', () => {
      const initial = { name: 'test' };
      const context = createContext(initial);

      context.name = 'modified';
      assert.strictEqual(initial.name, 'test');
    });
  });
});
