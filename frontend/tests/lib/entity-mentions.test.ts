import { describe, it, expect } from 'vitest'
import { preprocessEntityMentions, postprocessEntityMentions } from '@/components/specs/extensions/markdown-utils'

describe('Entity Mention Processing', () => {
  describe('preprocessEntityMentions', () => {
    it('should convert basic issue mention', () => {
      const input = '[[ISSUE-001]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-001"')
      expect(output).toContain('data-entity-type="issue"')
      expect(output).toContain('<span')
      expect(output).toContain('>ISSUE-001</span>')
    })

    it('should convert basic spec mention', () => {
      const input = '[[SPEC-001]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="SPEC-001"')
      expect(output).toContain('data-entity-type="spec"')
      expect(output).toContain('<span')
      expect(output).toContain('>SPEC-001</span>')
    })

    it('should convert mention with display text', () => {
      const input = '[[ISSUE-002|OAuth Implementation]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-002"')
      expect(output).toContain('data-display-text="OAuth Implementation"')
      expect(output).toContain('>OAuth Implementation</span>')
    })

    it('should convert mention with relationship type', () => {
      const input = '[[ISSUE-003]]{ implements }'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-003"')
      expect(output).toContain('data-relationship-type="implements"')
    })

    it('should convert mention with both display text and relationship', () => {
      const input = '[[ISSUE-004|Database Schema]]{ references }'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-004"')
      expect(output).toContain('data-display-text="Database Schema"')
      expect(output).toContain('data-relationship-type="references"')
      expect(output).toContain('>Database Schema</span>')
    })

    it('should handle multiple mentions in one line', () => {
      const input = '[[ISSUE-001]] and [[SPEC-002]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-001"')
      expect(output).toContain('data-entity-id="SPEC-002"')
      expect(output).toContain(' and ')
    })

    it('should trim whitespace in display text', () => {
      const input = '[[ISSUE-005|  Spaced Text  ]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-display-text="Spaced Text"')
      expect(output).not.toContain('  Spaced Text  ')
    })

    it('should trim whitespace in relationship type', () => {
      const input = '[[ISSUE-006]]{   references   }'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-relationship-type="references"')
    })

    it('should NOT convert escaped mentions', () => {
      const input = '\\[\\[ISSUE-007\\]\\]'
      const output = preprocessEntityMentions(input)

      // Should remain unchanged (not converted to span)
      expect(output).toBe(input)
      expect(output).not.toContain('<span')
    })

    it('should handle mixed escaped and normal mentions', () => {
      const input = '[[ISSUE-001]] and \\[\\[ISSUE-002\\]\\]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-001"')
      expect(output).toContain('\\[\\[ISSUE-002\\]\\]')
    })

    it('should escape HTML special characters in display text', () => {
      const input = '[[ISSUE-008|<script>alert("xss")</script>]]'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('&lt;script&gt;')
      expect(output).not.toContain('<script>')
    })

    it('should handle entity mentions in complex markdown', () => {
      const input = `# Heading

This is a paragraph with [[ISSUE-001]] and [[SPEC-002|Spec]].

- List item with [[ISSUE-003]]{ implements }
- Another item`

      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-entity-id="ISSUE-001"')
      expect(output).toContain('data-entity-id="SPEC-002"')
      expect(output).toContain('data-entity-id="ISSUE-003"')
    })
  })

  describe('postprocessEntityMentions', () => {
    it('should convert basic entity span back to markdown', () => {
      const input = '<span data-entity-id="ISSUE-001" data-entity-type="issue">ISSUE-001</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe('[[ISSUE-001]]')
    })

    it('should convert entity span with display text', () => {
      const input = '<span data-entity-id="ISSUE-002" data-entity-type="issue" data-display-text="OAuth">OAuth</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe('[[ISSUE-002|OAuth]]')
    })

    it('should convert entity span with relationship type', () => {
      const input = '<span data-entity-id="ISSUE-003" data-entity-type="issue" data-relationship-type="implements">ISSUE-003</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe('[[ISSUE-003]]{ implements }')
    })

    it('should convert entity span with both display text and relationship', () => {
      const input = '<span data-entity-id="ISSUE-004" data-entity-type="issue" data-display-text="Database" data-relationship-type="references">Database</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe('[[ISSUE-004|Database]]{ references }')
    })

    it('should handle multiple entity spans', () => {
      const input = '<p><span data-entity-id="ISSUE-001" data-entity-type="issue">ISSUE-001</span> and <span data-entity-id="SPEC-002" data-entity-type="spec">SPEC-002</span></p>'
      const output = postprocessEntityMentions(input)

      expect(output).toContain('[[ISSUE-001]]')
      expect(output).toContain('[[SPEC-002]]')
    })

    it('should unescape HTML entities in display text', () => {
      const input = '<span data-entity-id="ISSUE-005" data-entity-type="issue" data-display-text="&lt;text&gt;">text</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe('[[ISSUE-005|<text>]]')
    })

    it('should not affect regular spans', () => {
      const input = '<span class="regular">Regular text</span>'
      const output = postprocessEntityMentions(input)

      expect(output).toBe(input)
    })
  })

  describe('Round-trip conversion', () => {
    it('should preserve basic mentions', () => {
      const original = '[[ISSUE-001]]'
      const processed = preprocessEntityMentions(original)
      const restored = postprocessEntityMentions(processed)

      expect(restored).toBe(original)
    })

    it('should preserve mentions with display text', () => {
      const original = '[[ISSUE-002|OAuth]]'
      const processed = preprocessEntityMentions(original)
      const restored = postprocessEntityMentions(processed)

      expect(restored).toBe(original)
    })

    it('should preserve mentions with relationship type', () => {
      const original = '[[ISSUE-003]]{ implements }'
      const processed = preprocessEntityMentions(original)
      const restored = postprocessEntityMentions(processed)

      expect(restored).toBe(original)
    })

    it('should preserve mentions with both attributes', () => {
      const original = '[[ISSUE-004|Database]]{ references }'
      const processed = preprocessEntityMentions(original)
      const restored = postprocessEntityMentions(processed)

      expect(restored).toBe(original)
    })

    it('should preserve complex markdown with multiple mentions', () => {
      const original = 'See [[ISSUE-001]] and [[SPEC-002|Spec]]{ implements } for details.'
      const processed = preprocessEntityMentions(original)
      const restored = postprocessEntityMentions(processed)

      expect(restored).toBe(original)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(preprocessEntityMentions('')).toBe('')
      expect(postprocessEntityMentions('')).toBe('')
    })

    it('should handle text with no mentions', () => {
      const text = 'Just regular text'
      expect(preprocessEntityMentions(text)).toBe(text)
    })

    it('should handle malformed mentions', () => {
      const input = '[[INVALID]] [[ALSO-WRONG-123]]'
      const output = preprocessEntityMentions(input)

      // Should not convert invalid patterns
      expect(output).toBe(input)
    })

    it('should handle entity IDs with different numbers', () => {
      expect(preprocessEntityMentions('[[ISSUE-1]]')).toContain('ISSUE-1')
      expect(preprocessEntityMentions('[[ISSUE-123]]')).toContain('ISSUE-123')
      expect(preprocessEntityMentions('[[ISSUE-9999]]')).toContain('ISSUE-9999')
    })

    it('should handle special characters in relationship type', () => {
      const input = '[[ISSUE-001]]{ depends-on }'
      const output = preprocessEntityMentions(input)

      expect(output).toContain('data-relationship-type="depends-on"')
    })
  })
})
