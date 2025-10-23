/**
 * Unit tests for reference operations
 */

import { describe, it, expect } from 'vitest';
import { formatReference, addReferenceToContent } from '../../../src/operations/references.js';

describe('Reference Operations', () => {
  describe('formatReference', () => {
    it('should format basic reference', () => {
      const result = formatReference('issue-001');
      expect(result).toBe('[[issue-001]]');
    });

    it('should format reference with display text', () => {
      const result = formatReference('issue-001', 'OAuth Implementation');
      expect(result).toBe('[[issue-001|OAuth Implementation]]');
    });

    it('should format reference with relationship type', () => {
      const result = formatReference('spec-002', undefined, 'implements');
      expect(result).toBe('[[spec-002]]{ implements }');
    });

    it('should format reference with both display text and relationship type', () => {
      const result = formatReference('spec-002', 'Auth Spec', 'blocks');
      expect(result).toBe('[[spec-002|Auth Spec]]{ blocks }');
    });
  });

  describe('addReferenceToContent', () => {
    const content = `# Test Document

## Requirements

This is line 5.
This is line 6.
This is line 7.

## Design

Some design content here.`;

    describe('line-based insertion', () => {
      it('should insert reference after specific line (inline)', () => {
        const result = addReferenceToContent(
          content,
          { line: 5 },
          {
            referenceId: 'issue-001',
            format: 'inline',
            position: 'after',
          }
        );

        expect(result).toContain('This is line 5. [[issue-001]]');
      });

      it('should insert reference before specific line (inline)', () => {
        const result = addReferenceToContent(
          content,
          { line: 6 },
          {
            referenceId: 'issue-002',
            format: 'inline',
            position: 'before',
          }
        );

        expect(result).toContain('[[issue-002]] This is line 6.');
      });

      it('should insert reference after specific line (newline)', () => {
        const result = addReferenceToContent(
          content,
          { line: 5 },
          {
            referenceId: 'issue-003',
            format: 'newline',
            position: 'after',
          }
        );

        const lines = result.split('\n');
        const line5Index = lines.findIndex((l) => l === 'This is line 5.');
        expect(lines[line5Index + 1]).toBe('[[issue-003]]');
      });

      it('should insert reference before specific line (newline)', () => {
        const result = addReferenceToContent(
          content,
          { line: 6 },
          {
            referenceId: 'issue-004',
            format: 'newline',
            position: 'before',
          }
        );

        const lines = result.split('\n');
        const line6Index = lines.findIndex((l) => l === 'This is line 6.');
        expect(lines[line6Index - 1]).toBe('[[issue-004]]');
      });

      it('should throw error for invalid line number', () => {
        expect(() => {
          addReferenceToContent(
            content,
            { line: 999 },
            { referenceId: 'issue-001' }
          );
        }).toThrow('out of bounds');
      });
    });

    describe('text-based insertion', () => {
      it('should insert reference after specific text (inline)', () => {
        const result = addReferenceToContent(
          content,
          { text: 'Requirements' },
          {
            referenceId: 'spec-001',
            format: 'inline',
            position: 'after',
          }
        );

        expect(result).toContain('Requirements [[spec-001]]');
      });

      it('should insert reference before specific text (inline)', () => {
        const result = addReferenceToContent(
          content,
          { text: 'Design' },
          {
            referenceId: 'spec-002',
            format: 'inline',
            position: 'before',
          }
        );

        expect(result).toContain('[[spec-002]] Design');
      });

      it('should insert reference after specific text (newline)', () => {
        const result = addReferenceToContent(
          content,
          { text: 'design content here.' },
          {
            referenceId: 'issue-005',
            format: 'newline',
            position: 'after',
          }
        );

        expect(result).toContain('design content here.\n[[issue-005]]');
      });

      it('should throw error for text not found', () => {
        expect(() => {
          addReferenceToContent(
            content,
            { text: 'NonExistent' },
            { referenceId: 'issue-001' }
          );
        }).toThrow('Text not found');
      });
    });

    describe('reference formatting in content', () => {
      it('should insert reference with display text', () => {
        const result = addReferenceToContent(
          content,
          { line: 5 },
          {
            referenceId: 'issue-001',
            displayText: 'OAuth',
            format: 'inline',
            position: 'after',
          }
        );

        expect(result).toContain('[[issue-001|OAuth]]');
      });

      it('should insert reference with relationship type', () => {
        const result = addReferenceToContent(
          content,
          { line: 5 },
          {
            referenceId: 'spec-002',
            relationshipType: 'implements',
            format: 'inline',
            position: 'after',
          }
        );

        expect(result).toContain('[[spec-002]]{ implements }');
      });

      it('should insert reference with both display text and relationship type', () => {
        const result = addReferenceToContent(
          content,
          { line: 5 },
          {
            referenceId: 'spec-003',
            displayText: 'Auth Spec',
            relationshipType: 'blocks',
            format: 'inline',
            position: 'after',
          }
        );

        expect(result).toContain('[[spec-003|Auth Spec]]{ blocks }');
      });
    });

    describe('validation', () => {
      it('should throw error if neither line nor text specified', () => {
        expect(() => {
          addReferenceToContent(content, {}, { referenceId: 'issue-001' });
        }).toThrow('Either line or text must be specified');
      });

      it('should throw error if both line and text specified', () => {
        expect(() => {
          addReferenceToContent(
            content,
            { line: 5, text: 'test' },
            { referenceId: 'issue-001' }
          );
        }).toThrow('Cannot specify both line and text');
      });
    });
  });
});
