import { describe, it, expect } from 'vitest';
import { toYaml, fromYaml, verifyRoundTrip, toYamlDocuments, fromYamlDocuments } from '../../src/yaml-converter.js';
import type { SpecJSONL, IssueJSONL, FeedbackJSONL, RelationshipJSONL } from '@sudocode-ai/types';

describe('yaml-converter', () => {
  describe('toYaml', () => {
    it('should convert simple object to YAML', () => {
      const obj = { name: 'test', value: 42 };
      const yaml = toYaml(obj);

      expect(yaml).toContain('name: test');
      expect(yaml).toContain('value: 42');
      expect(yaml.endsWith('\n')).toBe(true);
    });

    it('should use literal style for multi-line strings', () => {
      const obj = {
        description: 'Line 1\nLine 2\nLine 3'
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('description: |');
      expect(yaml).toContain('Line 1');
      expect(yaml).toContain('Line 2');
      expect(yaml).toContain('Line 3');
    });

    it('should use plain style for single-line strings', () => {
      const obj = {
        title: 'Simple title'
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('title: Simple title');
      expect(yaml).not.toContain('|');
    });

    it('should handle empty strings', () => {
      const obj = {
        empty: '',
        title: 'test'
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('empty:');
      expect(yaml).toContain('title: test');
    });

    it('should use block style for arrays', () => {
      const obj = {
        tags: ['tag1', 'tag2', 'tag3']
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('tags:');
      expect(yaml).toContain('- tag1');
      expect(yaml).toContain('- tag2');
      expect(yaml).toContain('- tag3');
    });

    it('should preserve key order', () => {
      const obj = {
        id: 's-123',
        title: 'Test',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z'
      };
      const yaml = toYaml(obj);

      const idIndex = yaml.indexOf('id:');
      const titleIndex = yaml.indexOf('title:');
      const createdIndex = yaml.indexOf('created_at:');
      const updatedIndex = yaml.indexOf('updated_at:');

      expect(idIndex).toBeLessThan(titleIndex);
      expect(titleIndex).toBeLessThan(createdIndex);
      expect(createdIndex).toBeLessThan(updatedIndex);
    });

    it('should use 2-space indentation', () => {
      const obj = {
        nested: {
          key: 'value'
        }
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('nested:');
      expect(yaml).toContain('  key: value');
    });

    it('should handle unicode characters', () => {
      const obj = {
        title: '日本語 🎉 العربية',
        description: 'Unicode\n日本語\n🎉'
      };
      const yaml = toYaml(obj);
      const parsed = fromYaml(yaml);

      expect(parsed.title).toBe(obj.title);
      expect(parsed.description).toBe(obj.description);
    });

    it('should handle null values', () => {
      const obj = {
        title: 'test',
        optional: null,
        value: 42
      };
      const yaml = toYaml(obj);

      expect(yaml).toContain('title: test');
      expect(yaml).toContain('optional: null');
      expect(yaml).toContain('value: 42');
    });

    it('should handle large text (10KB+)', () => {
      const largeText = 'Line\n'.repeat(2000); // ~10KB
      const obj = {
        content: largeText
      };
      const yaml = toYaml(obj);
      const parsed = fromYaml(yaml);

      expect(parsed.content).toBe(largeText);
      expect(yaml.length).toBeGreaterThan(10000);
    });
  });

  describe('fromYaml', () => {
    it('should parse YAML to object', () => {
      const yaml = `name: test
value: 42
`;
      const obj = fromYaml(yaml);

      expect(obj).toEqual({ name: 'test', value: 42 });
    });

    it('should parse literal style multi-line strings', () => {
      const yaml = `description: |
  Line 1
  Line 2
  Line 3
`;
      const obj = fromYaml(yaml);

      expect(obj.description).toBe('Line 1\nLine 2\nLine 3\n');
    });

    it('should parse arrays', () => {
      const yaml = `tags:
  - tag1
  - tag2
  - tag3
`;
      const obj = fromYaml(yaml);

      expect(obj.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should return null for empty string', () => {
      expect(fromYaml('')).toBeNull();
      expect(fromYaml('   ')).toBeNull();
    });

    it('should parse null values', () => {
      const yaml = `title: test
optional: null
value: 42
`;
      const obj = fromYaml(yaml);

      expect(obj.optional).toBeNull();
    });

    it('should throw on invalid YAML', () => {
      const invalidYaml = `invalid: yaml: : :`;

      expect(() => fromYaml(invalidYaml)).toThrow();
    });
  });

  describe('verifyRoundTrip', () => {
    it('should verify round-trip for simple object', () => {
      const obj = { name: 'test', value: 42 };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should verify round-trip for multi-line strings', () => {
      const obj = {
        description: 'Line 1\nLine 2\nLine 3'
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should verify round-trip for arrays', () => {
      const obj = {
        tags: ['tag1', 'tag2', 'tag3']
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should verify round-trip for nested objects', () => {
      const obj = {
        nested: {
          key: 'value',
          array: [1, 2, 3]
        }
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should verify round-trip for null values', () => {
      const obj = {
        title: 'test',
        optional: null
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });
  });

  describe('round-trip for entity types', () => {
    it('should handle SpecJSONL round-trip', () => {
      const spec: SpecJSONL = {
        id: 's-abc123',
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        title: 'OAuth Authentication System',
        file_path: '.sudocode/specs/s-abc123_oauth_authentication_system.md',
        content: '## Overview\n\nThis spec defines OAuth 2.0.\n\n## Requirements\n\n1. Support authorization code flow\n2. Implement PKCE',
        priority: 1,
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-02T15:30:00Z',
        tags: ['backend', 'security', 'oauth'],
        relationships: [
          {
            from: 'i-123',
            to: 's-abc123',
            type: 'implements'
          }
        ]
      };

      const yaml = toYaml(spec);
      const parsed = fromYaml(yaml) as SpecJSONL;

      expect(parsed.id).toBe(spec.id);
      expect(parsed.uuid).toBe(spec.uuid);
      expect(parsed.title).toBe(spec.title);
      expect(parsed.file_path).toBe(spec.file_path);
      expect(parsed.content).toBe(spec.content);
      expect(parsed.priority).toBe(spec.priority);
      expect(parsed.created_at).toBe(spec.created_at);
      expect(parsed.updated_at).toBe(spec.updated_at);
      expect(parsed.tags).toEqual(spec.tags);
      expect(parsed.relationships).toEqual(spec.relationships);

      expect(verifyRoundTrip(spec)).toBe(true);
    });

    it('should handle IssueJSONL round-trip', () => {
      const issue: IssueJSONL = {
        id: 'i-xyz789',
        uuid: '660e8400-e29b-41d4-a716-446655440001',
        title: 'Implement OAuth login',
        status: 'in_progress',
        content: '## Task\n\nImplement OAuth 2.0 login flow.\n\n## Acceptance Criteria\n\n- [ ] Authorization code flow\n- [ ] PKCE implementation',
        priority: 1,
        assignee: 'agent-1',
        created_at: '2025-01-03T10:00:00Z',
        updated_at: '2025-01-03T12:00:00Z',
        tags: ['backend', 'security'],
        relationships: [
          {
            from: 'i-xyz789',
            to: 's-abc123',
            type: 'implements'
          }
        ],
        feedback: [
          {
            id: 'f-001',
            from_id: 'i-xyz789',
            to_id: 's-abc123',
            feedback_type: 'comment',
            content: 'Implemented successfully',
            created_at: '2025-01-03T15:00:00Z',
            updated_at: '2025-01-03T15:00:00Z'
          }
        ]
      };

      const yaml = toYaml(issue);
      const parsed = fromYaml(yaml) as IssueJSONL;

      expect(parsed.id).toBe(issue.id);
      expect(parsed.uuid).toBe(issue.uuid);
      expect(parsed.title).toBe(issue.title);
      expect(parsed.status).toBe(issue.status);
      expect(parsed.content).toBe(issue.content);
      expect(parsed.priority).toBe(issue.priority);
      expect(parsed.assignee).toBe(issue.assignee);
      expect(parsed.created_at).toBe(issue.created_at);
      expect(parsed.updated_at).toBe(issue.updated_at);
      expect(parsed.tags).toEqual(issue.tags);
      expect(parsed.relationships).toEqual(issue.relationships);
      expect(parsed.feedback).toEqual(issue.feedback);

      expect(verifyRoundTrip(issue)).toBe(true);
    });

    it('should handle SpecJSONL with optional fields', () => {
      const spec: SpecJSONL = {
        id: 's-opt',
        uuid: '770e8400-e29b-41d4-a716-446655440002',
        title: 'Test Spec',
        file_path: '.sudocode/specs/test.md',
        content: 'Test content',
        priority: 2,
        archived: true,
        archived_at: '2025-01-04T10:00:00Z',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-04T10:00:00Z',
        parent_id: 's-parent',
        parent_uuid: '880e8400-e29b-41d4-a716-446655440003',
        tags: [],
        relationships: []
      };

      expect(verifyRoundTrip(spec)).toBe(true);
    });

    it('should handle IssueJSONL with optional fields', () => {
      const issue: IssueJSONL = {
        id: 'i-opt',
        uuid: '990e8400-e29b-41d4-a716-446655440004',
        title: 'Test Issue',
        status: 'closed',
        content: 'Test content',
        priority: 3,
        archived: true,
        archived_at: '2025-01-05T10:00:00Z',
        closed_at: '2025-01-05T09:00:00Z',
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-05T10:00:00Z',
        parent_id: 'i-parent',
        parent_uuid: 'aa0e8400-e29b-41d4-a716-446655440005',
        tags: [],
        relationships: []
      };

      expect(verifyRoundTrip(issue)).toBe(true);
    });

    it('should preserve all metadata in round-trip', () => {
      const spec: SpecJSONL = {
        id: 's-meta',
        uuid: 'bb0e8400-e29b-41d4-a716-446655440006',
        title: 'Metadata Test',
        file_path: '.sudocode/specs/meta.md',
        content: 'Multi-line\ncontent\nwith\nseveral\nlines',
        priority: 1,
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-02T15:30:00Z',
        tags: ['tag1', 'tag2', 'tag3', 'tag4'],
        relationships: [
          { from: 'i-1', to: 's-meta', type: 'implements' },
          { from: 'i-2', to: 's-meta', type: 'implements' },
          { from: 's-meta', to: 's-other', type: 'references' }
        ]
      };

      const yaml = toYaml(spec);
      const parsed = fromYaml(yaml) as SpecJSONL;

      // Verify all fields are preserved
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(spec));
    });
  });

  describe('toYamlDocuments and fromYamlDocuments', () => {
    it('should convert array of objects to YAML documents', () => {
      const objects = [
        { id: '1', name: 'first' },
        { id: '2', name: 'second' },
        { id: '3', name: 'third' }
      ];

      const yaml = toYamlDocuments(objects);

      expect(yaml).toContain('id: \'1\'');
      expect(yaml).toContain('id: \'2\'');
      expect(yaml).toContain('id: \'3\'');
      expect(yaml).toContain('---');
      expect(yaml.split('---').length).toBe(3);
    });

    it('should parse YAML documents to array', () => {
      const yaml = `id: '1'
name: first
---
id: '2'
name: second
---
id: '3'
name: third
`;
      const objects = fromYamlDocuments(yaml);

      expect(objects).toHaveLength(3);
      expect(objects[0]).toEqual({ id: '1', name: 'first' });
      expect(objects[1]).toEqual({ id: '2', name: 'second' });
      expect(objects[2]).toEqual({ id: '3', name: 'third' });
    });

    it('should handle empty array', () => {
      expect(toYamlDocuments([])).toBe('');
      expect(fromYamlDocuments('')).toEqual([]);
    });

    it('should round-trip multiple documents', () => {
      const specs: SpecJSONL[] = [
        {
          id: 's-1',
          uuid: 'cc0e8400-e29b-41d4-a716-446655440007',
          title: 'First Spec',
          file_path: '.sudocode/specs/first.md',
          content: 'First\ncontent',
          priority: 1,
          created_at: '2025-01-01T10:00:00Z',
          updated_at: '2025-01-01T10:00:00Z',
          tags: ['tag1'],
          relationships: []
        },
        {
          id: 's-2',
          uuid: 'dd0e8400-e29b-41d4-a716-446655440008',
          title: 'Second Spec',
          file_path: '.sudocode/specs/second.md',
          content: 'Second\ncontent',
          priority: 2,
          created_at: '2025-01-02T10:00:00Z',
          updated_at: '2025-01-02T10:00:00Z',
          tags: ['tag2'],
          relationships: []
        }
      ];

      const yaml = toYamlDocuments(specs);
      const parsed = fromYamlDocuments(yaml) as SpecJSONL[];

      expect(parsed).toHaveLength(2);
      expect(JSON.stringify(parsed[0])).toBe(JSON.stringify(specs[0]));
      expect(JSON.stringify(parsed[1])).toBe(JSON.stringify(specs[1]));
    });
  });

  describe('deterministic output', () => {
    it('should produce same YAML for same input', () => {
      const obj = {
        id: 's-test',
        title: 'Test',
        content: 'Multi-line\ncontent\nhere',
        tags: ['tag1', 'tag2'],
        priority: 1
      };

      const yaml1 = toYaml(obj);
      const yaml2 = toYaml(obj);
      const yaml3 = toYaml(obj);

      expect(yaml1).toBe(yaml2);
      expect(yaml2).toBe(yaml3);
    });

    it('should produce same YAML after round-trip', () => {
      const obj = {
        id: 's-test',
        title: 'Test',
        content: 'Multi-line\ncontent\nhere',
        tags: ['tag1', 'tag2']
      };

      const yaml1 = toYaml(obj);
      const parsed = fromYaml(yaml1);
      const yaml2 = toYaml(parsed);

      expect(yaml1).toBe(yaml2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty object', () => {
      const obj = {};
      const yaml = toYaml(obj);
      const parsed = fromYaml(yaml);

      expect(parsed).toEqual({});
    });

    it('should handle empty arrays', () => {
      const obj = {
        tags: [],
        relationships: []
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle special characters in strings', () => {
      const obj = {
        title: 'Title with: colons, "quotes", and \'apostrophes\'',
        content: 'Content with\ttabs\nand\nnewlines'
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle numbers as strings', () => {
      const obj = {
        id: '123',
        value: 123,
        mixed: '123abc'
      };

      const yaml = toYaml(obj);
      const parsed = fromYaml(yaml);

      expect(parsed.id).toBe('123');
      expect(parsed.value).toBe(123);
      expect(parsed.mixed).toBe('123abc');
    });

    it('should handle boolean values', () => {
      const obj = {
        archived: true,
        active: false
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle dates as ISO strings', () => {
      const obj = {
        created_at: '2025-01-01T10:00:00Z',
        updated_at: '2025-01-02T15:30:00.123Z'
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle very long single-line strings', () => {
      const longString = 'a'.repeat(1000);
      const obj = {
        title: longString
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle deeply nested objects', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep'
              }
            }
          }
        }
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it('should handle mixed arrays', () => {
      const obj = {
        mixed: ['string', 42, true, null, { nested: 'object' }]
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });
  });
});
