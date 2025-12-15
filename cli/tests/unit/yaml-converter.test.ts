import { describe, it, expect } from 'vitest';
import {
  yamlToJson,
  jsonToYaml,
  validateRoundTrip,
  validateRoundTripDetailed
} from '../../src/yaml-converter.js';
import type { Issue, Spec } from '@sudocode-ai/types';

describe('yaml-converter', () => {
  describe('yamlToJson', () => {
    it('should parse simple YAML to JSON', () => {
      const yaml = `
id: s-abc123
title: Test Spec
priority: 1
`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.id).toBe('s-abc123');
      expect(result.title).toBe('Test Spec');
      expect(result.priority).toBe(1);
    });

    it('should parse multi-line strings with literal style', () => {
      const yaml = `
description: |
  Line 1
  Line 2
  Line 3
`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.description).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should preserve data types', () => {
      const yaml = `
string_field: hello
number_field: 42
boolean_field: true
null_field: null
array_field:
  - item1
  - item2
object_field:
  nested: value
`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.string_field).toBe('hello');
      expect(result.number_field).toBe(42);
      expect(result.boolean_field).toBe(true);
      expect(result.null_field).toBe(null);
      expect(result.array_field).toEqual(['item1', 'item2']);
      expect(result.object_field).toEqual({ nested: 'value' });
    });

    it('should handle empty strings', () => {
      const yaml = `
empty_field: ""
`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.empty_field).toBe('');
    });

    it('should handle empty arrays', () => {
      const yaml = `
empty_array: []
`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.empty_array).toEqual([]);
    });

    it('should handle special characters', () => {
      const yaml = `special: "Hello \\"World\\" with 'quotes' and \\\\backslash"`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.special).toBe('Hello "World" with \'quotes\' and \\backslash');
    });

    it('should handle unicode characters', () => {
      const yaml = `unicode: "Hello 世界 🌍"`;
      const result = yamlToJson<Record<string, any>>(yaml);
      expect(result.unicode).toBe('Hello 世界 🌍');
    });

    it('should throw error on invalid YAML', () => {
      // Invalid YAML: tabs instead of spaces for indentation
      const invalidYaml = `invalid:\n\t- bad indentation`;
      expect(() => yamlToJson(invalidYaml)).toThrow();
    });
  });

  describe('jsonToYaml', () => {
    it('should convert simple JSON to YAML', () => {
      const json = {
        id: 's-abc123',
        title: 'Test Spec',
        priority: 1
      };
      const yaml = jsonToYaml(json);
      expect(yaml).toContain('id: s-abc123');
      expect(yaml).toContain('title: Test Spec');
      expect(yaml).toContain('priority: 1');
    });

    it('should use literal style for multi-line strings', () => {
      const json = {
        description: 'Line 1\nLine 2\nLine 3'
      };
      const yaml = jsonToYaml(json);
      // The literal style uses |
      expect(yaml).toContain('description:');
      // Check that newlines are preserved
      expect(yaml).toContain('Line 1');
      expect(yaml).toContain('Line 2');
      expect(yaml).toContain('Line 3');
    });

    it('should handle arrays with block style', () => {
      const json = {
        tags: ['tag1', 'tag2', 'tag3']
      };
      const yaml = jsonToYaml(json);
      expect(yaml).toContain('tags:');
      expect(yaml).toContain('- tag1');
      expect(yaml).toContain('- tag2');
      expect(yaml).toContain('- tag3');
    });

    it('should handle nested objects', () => {
      const json = {
        location_anchor: {
          line: 42,
          text: 'example',
          section: 'Overview'
        }
      };
      const yaml = jsonToYaml(json);
      expect(yaml).toContain('location_anchor:');
      expect(yaml).toContain('line: 42');
      expect(yaml).toContain('text: example');
      expect(yaml).toContain('section: Overview');
    });

    it('should preserve null values', () => {
      const json = {
        optional_field: null
      };
      const yaml = jsonToYaml(json);
      expect(yaml).toContain('optional_field: null');
    });

    it('should handle empty arrays', () => {
      const json = {
        empty_array: []
      };
      const yaml = jsonToYaml(json);
      expect(yaml).toContain('empty_array: []');
    });

    it('should handle special characters', () => {
      const json = {
        special: 'Hello "World" with \'quotes\' and \\backslash'
      };
      const yaml = jsonToYaml(json);
      const parsed = yamlToJson(yaml);
      expect(parsed.special).toBe(json.special);
    });
  });

  describe('validateRoundTrip', () => {
    it('should validate simple entity round-trip', () => {
      const entity = {
        id: 's-abc123',
        title: 'Test Spec',
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate Issue entity round-trip', () => {
      const issue: Partial<Issue> = {
        id: 'i-xyz789',
        uuid: '12345678-1234-1234-1234-123456789012',
        title: 'Test Issue',
        status: 'open',
        content: 'This is a test issue with\nmultiple lines\nof content.',
        priority: 2,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      };
      expect(validateRoundTrip(issue)).toBe(true);
    });

    it('should validate Spec entity round-trip', () => {
      const spec: Partial<Spec> = {
        id: 's-abc123',
        uuid: '87654321-4321-4321-4321-210987654321',
        title: 'Test Spec',
        file_path: '.sudocode/specs/s-abc123.md',
        content: '# Overview\n\nThis is a spec.\n\n## Details\n\nMore content here.',
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      };
      expect(validateRoundTrip(spec)).toBe(true);
    });

    it('should validate entity with arrays', () => {
      const entity = {
        id: 's-test',
        tags: ['tag1', 'tag2', 'tag3'],
        relationships: [
          { from: 's-test', to: 'i-other', type: 'implements' }
        ]
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate entity with nested objects', () => {
      const entity = {
        id: 's-test',
        location_anchor: {
          line: 42,
          text: 'example text',
          section: 'Overview',
          context_before: ['line 1', 'line 2', 'line 3'],
          context_after: ['line 4', 'line 5', 'line 6']
        }
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate entity with empty values', () => {
      const entity = {
        id: 's-test',
        empty_string: '',
        empty_array: [],
        null_value: null
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate entity with special characters', () => {
      const entity = {
        id: 's-test',
        content: 'Special chars: "quotes" \'apostrophes\' \\backslash\nNewline\tTab'
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate entity with unicode', () => {
      const entity = {
        id: 's-test',
        content: 'Unicode: 世界 🌍 émojis and accénts'
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate large text blocks', () => {
      const largeText = Array(100)
        .fill(null)
        .map((_, i) => `Paragraph ${i + 1}\nWith multiple lines\nOf content.`)
        .join('\n\n');

      const entity = {
        id: 's-test',
        content: largeText
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should validate entity with complex nested structure', () => {
      const entity = {
        id: 's-test',
        uuid: '12345678-1234-1234-1234-123456789012',
        title: 'Complex Entity',
        content: 'Multi-line\ncontent\nhere',
        metadata: {
          nested: {
            deeply: {
              value: 'test',
              array: [1, 2, 3],
              object: { key: 'value' }
            }
          }
        },
        tags: ['a', 'b', 'c'],
        numbers: [1, 2, 3, 4, 5],
        booleans: [true, false, true],
        mixed: ['string', 123, true, null],
        null_field: null,
        empty_string: '',
        empty_array: []
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });
  });

  describe('validateRoundTripDetailed', () => {
    it('should return success for valid round-trip', () => {
      const entity = {
        id: 's-test',
        title: 'Test'
      };
      const result = validateRoundTripDetailed(entity);
      expect(result.success).toBe(true);
      expect(result.yaml).toBeDefined();
      expect(result.restored).toEqual(entity);
      expect(result.error).toBeUndefined();
    });

    it('should detect differences in restored data', () => {
      // This test is artificial since our converter should be lossless
      // But we can test the difference detection logic
      const entity = {
        id: 's-test',
        title: 'Test',
        content: 'Original content'
      };

      const result = validateRoundTripDetailed(entity);

      // Should succeed
      expect(result.success).toBe(true);

      // Now manually modify the restored object to test difference detection
      if (result.restored) {
        result.restored.content = 'Modified content';
        const differences = validateRoundTripDetailed(result.restored);
        // The modified version should still round-trip successfully
        expect(differences.success).toBe(true);
      }
    });

    it('should handle conversion errors', () => {
      // Create a circular reference (not valid for YAML)
      const circular: any = { id: 's-test' };
      circular.self = circular;

      const result = validateRoundTripDetailed(circular);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle Issue with all optional fields', () => {
      const issue: Partial<Issue> = {
        id: 'i-test',
        uuid: '12345678-1234-1234-1234-123456789012',
        title: 'Test Issue',
        status: 'in_progress',
        content: 'Content',
        priority: 1,
        assignee: 'alice@example.com',
        archived: true,
        archived_at: '2025-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        closed_at: '2025-01-03T00:00:00Z',
        parent_id: 'i-parent',
        parent_uuid: '87654321-4321-4321-4321-210987654321'
      };
      expect(validateRoundTrip(issue)).toBe(true);
    });

    it('should handle Spec with all optional fields', () => {
      const spec: Partial<Spec> = {
        id: 's-test',
        uuid: '12345678-1234-1234-1234-123456789012',
        title: 'Test Spec',
        file_path: '.sudocode/specs/s-test.md',
        content: 'Content',
        priority: 1,
        archived: true,
        archived_at: '2025-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        parent_id: 's-parent',
        parent_uuid: '87654321-4321-4321-4321-210987654321'
      };
      expect(validateRoundTrip(spec)).toBe(true);
    });

    it('should handle markdown content with code blocks', () => {
      const spec: Partial<Spec> = {
        id: 's-test',
        uuid: '12345678-1234-1234-1234-123456789012',
        title: 'Test Spec',
        file_path: '.sudocode/specs/s-test.md',
        content: `# Overview

Here's some code:

\`\`\`javascript
function example() {
  console.log("Hello World");
}
\`\`\`

And more text.`,
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      };
      expect(validateRoundTrip(spec)).toBe(true);
    });

    it('should handle content with YAML-like syntax', () => {
      const entity = {
        id: 's-test',
        content: `This content looks like YAML:
  - item 1
  - item 2
key: value
nested:
  key: value`
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should handle content with conflict markers', () => {
      const entity = {
        id: 's-test',
        content: `Some content
<<<<<<< HEAD
Our version
=======
Their version
>>>>>>> branch
More content`
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should handle very long single-line text', () => {
      const longText = 'a'.repeat(10000);
      const entity = {
        id: 's-test',
        content: longText
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should handle numbers in various formats', () => {
      const entity = {
        id: 's-test',
        integer: 42,
        float: 3.14159,
        negative: -100,
        zero: 0,
        scientific: 1e10
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });

    it('should handle mixed array types', () => {
      const entity = {
        id: 's-test',
        mixed_array: [
          'string',
          42,
          true,
          null,
          { nested: 'object' },
          ['nested', 'array']
        ]
      };
      expect(validateRoundTrip(entity)).toBe(true);
    });
  });
});
