/**
 * Unit tests for watcher regex patterns
 * Ensures that the watcher correctly parses log messages from the CLI watcher
 */

import { describe, it, expect } from 'vitest'

describe('Watcher Regex Patterns', () => {
  describe('Sync log message regex', () => {
    // The regex pattern from watcher.ts
    // Supports both old format (ISSUE-001) and new format (i-x7k9)
    // Updated to support IDs with multiple hyphens (e.g., i-multi-jsonl1)
    const syncRegex = /\[watch\] Synced (spec|issue) ([A-Za-z0-9-]+) (?:to .+ )?\((created|updated)\)/

    it('should match new ID format for issues with path', () => {
      const message = '[watch] Synced issue i-x7k9 to markdown (updated)'
      const match = message.match(syncRegex)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('issue')
      expect(match![2]).toBe('i-x7k9')
      expect(match![3]).toBe('updated')
    })

    it('should match new ID format for specs with path', () => {
      const message = '[watch] Synced spec s-14sh to specs/s-14sh - Test Spec.md (created)'
      const match = message.match(syncRegex)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('spec')
      expect(match![2]).toBe('s-14sh')
      expect(match![3]).toBe('created')
    })

    it('should match new ID format without path', () => {
      const message = '[watch] Synced issue i-abc1 (updated)'
      const match = message.match(syncRegex)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('issue')
      expect(match![2]).toBe('i-abc1')
      expect(match![3]).toBe('updated')
    })

    it('should match various ID formats', () => {
      const testCases = [
        { msg: '[watch] Synced issue i-x7k9 to markdown (updated)', entityType: 'issue', id: 'i-x7k9', action: 'updated' },
        { msg: '[watch] Synced spec s-14sh to file.md (created)', entityType: 'spec', id: 's-14sh', action: 'created' },
        { msg: '[watch] Synced issue i-test1 (updated)', entityType: 'issue', id: 'i-test1', action: 'updated' },
        { msg: '[watch] Synced spec s-abc123 to path (created)', entityType: 'spec', id: 's-abc123', action: 'created' },
        { msg: '[watch] Synced issue i-multi-test (updated)', entityType: 'issue', id: 'i-multi-test', action: 'updated' },
        { msg: '[watch] Synced issue i-multi-jsonl1 (created)', entityType: 'issue', id: 'i-multi-jsonl1', action: 'created' },
      ]

      testCases.forEach(({ msg, entityType, id, action }) => {
        const match = msg.match(syncRegex)
        expect(match, `Should match: ${msg}`).not.toBeNull()
        expect(match![1]).toBe(entityType)
        expect(match![2]).toBe(id)
        expect(match![3]).toBe(action)
      })
    })

    it('should match old ID format for backwards compatibility', () => {
      const testCases = [
        { msg: '[watch] Synced issue ISSUE-001 (updated)', entityType: 'issue', id: 'ISSUE-001', action: 'updated' },
        { msg: '[watch] Synced spec SPEC-123 (created)', entityType: 'spec', id: 'SPEC-123', action: 'created' },
        { msg: '[watch] Synced issue ISSUE-001 to markdown (updated)', entityType: 'issue', id: 'ISSUE-001', action: 'updated' },
        { msg: '[watch] Synced spec SPEC-ABC (created)', entityType: 'spec', id: 'SPEC-ABC', action: 'created' },
      ]

      testCases.forEach(({ msg, entityType, id, action }) => {
        const match = msg.match(syncRegex)
        expect(match, `Should match old format: ${msg}`).not.toBeNull()
        expect(match![1]).toBe(entityType)
        expect(match![2]).toBe(id)
        expect(match![3]).toBe(action)
      })
    })

    it('should NOT match invalid formats', () => {
      const invalidMessages = [
        '[watch] Synced issue',
        '[watch] Synced issue i-x7k9',
        '[watch] Synced i-x7k9 (updated)',
        'Synced issue i-x7k9 (updated)', // Missing [watch] prefix
      ]

      invalidMessages.forEach((msg) => {
        const match = msg.match(syncRegex)
        expect(match, `Should NOT match: ${msg}`).toBeNull()
      })
    })
  })

  describe('JSONL change regex', () => {
    const jsonlRegex = /\[watch\] change (issues|specs)\.jsonl/

    it('should match issues.jsonl changes', () => {
      const message = '[watch] change issues.jsonl'
      const match = message.match(jsonlRegex)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('issues')
    })

    it('should match specs.jsonl changes', () => {
      const message = '[watch] change specs.jsonl'
      const match = message.match(jsonlRegex)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('specs')
    })

    it('should NOT match other files', () => {
      const invalidMessages = [
        '[watch] change config.json',
        '[watch] change issues.md',
        '[watch] change spec.jsonl', // Missing 's' in specs
      ]

      invalidMessages.forEach((msg) => {
        const match = msg.match(jsonlRegex)
        expect(match, `Should NOT match: ${msg}`).toBeNull()
      })
    })
  })
})
