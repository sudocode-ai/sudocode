/**
 * Tests for Claude Code tool output utilities
 */

import { describe, it, expect } from 'vitest'
import {
  claudeDiffToUnified,
  extractOldAndNewContent,
  getDiffSummary,
  parseClaudeToolArgs,
  type ClaudeEditArgs,
} from '@/utils/claude'

describe('claudeDiffToUnified', () => {
  it('converts single search-replace block to unified diff', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const foo = 1\n  const bar = 2\n+ const foo = 2\n  const bar = 2',
        },
      ],
    }

    const result = claudeDiffToUnified(args)

    expect(result).toContain('--- a/test.ts')
    expect(result).toContain('+++ b/test.ts')
    expect(result).toContain('@@ -1,2 +1,2 @@')
    expect(result).toContain('- const foo = 1')
    expect(result).toContain('-  const bar = 2')
    expect(result).toContain('+ const foo = 2')
    expect(result).toContain('+  const bar = 2')
  })

  it('handles multiple changes in a single file', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- import React from "react"\n+ import { useState } from "react"',
        },
        {
          type: 'edit',
          diff: '- const value = 1\n+ const value = 2',
        },
      ],
    }

    const result = claudeDiffToUnified(args)

    expect(result).toContain('--- a/test.ts')
    expect(result).toContain('+++ b/test.ts')
    expect(result).toContain('- import React from "react"')
    expect(result).toContain('+ import { useState } from "react"')
    expect(result).toContain('- const value = 1')
    expect(result).toContain('+ const value = 2')
  })

  it('handles multiline search-replace blocks', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- function old() {\n  return 1\n}\n+ function new() {\n  return 2\n}',
        },
      ],
    }

    const result = claudeDiffToUnified(args)

    expect(result).toContain('- function old() {')
    expect(result).toContain('-  return 1')
    expect(result).toContain('-}')
    expect(result).toContain('+ function new() {')
    expect(result).toContain('+  return 2')
    expect(result).toContain('+}')
  })

  it('handles empty search block (pure addition)', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '+ const newLine = 1',
        },
      ],
    }

    const result = claudeDiffToUnified(args)

    expect(result).toContain('@@ -1,0 +1,1 @@')
    expect(result).toContain('+ const newLine = 1')
  })

  it('handles empty replace block (pure deletion)', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const oldLine = 1',
        },
      ],
    }

    const result = claudeDiffToUnified(args)

    expect(result).toContain('@@ -1,1 +1,0 @@')
    expect(result).toContain('- const oldLine = 1')
  })
})

describe('extractOldAndNewContent', () => {
  it('extracts old and new content from single change', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const foo = 1\n+ const foo = 2',
        },
      ],
    }

    const result = extractOldAndNewContent(args)

    expect(result.oldContent).toBe(' const foo = 1')
    expect(result.newContent).toBe(' const foo = 2')
  })

  it('extracts multiline blocks correctly', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- function old() {\n  return 1\n}\n+ function new() {\n  return 2\n}',
        },
      ],
    }

    const result = extractOldAndNewContent(args)

    expect(result.oldContent).toBe(' function old() {\n  return 1\n}')
    expect(result.newContent).toBe(' function new() {\n  return 2\n}')
  })

  it('handles multiple changes and separates them with blank lines', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- import React\n+ import { useState }',
        },
        {
          type: 'edit',
          diff: '- const a = 1\n+ const a = 2',
        },
      ],
    }

    const result = extractOldAndNewContent(args)

    expect(result.oldContent).toBe(' import React\n\n const a = 1')
    expect(result.newContent).toBe(' import { useState }\n\n const a = 2')
  })

  it('handles empty search block', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '+ const newLine = 1',
        },
      ],
    }

    const result = extractOldAndNewContent(args)

    expect(result.oldContent).toBe('')
    expect(result.newContent).toBe(' const newLine = 1')
  })

  it('handles empty replace block', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const oldLine = 1',
        },
      ],
    }

    const result = extractOldAndNewContent(args)

    expect(result.oldContent).toBe(' const oldLine = 1')
    expect(result.newContent).toBe('')
  })
})

describe('getDiffSummary', () => {
  it('counts additions and deletions correctly', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const foo = 1\n  const bar = 2\n+ const foo = 2\n  const bar = 2',
        },
      ],
    }

    const result = getDiffSummary(args)

    expect(result.deletions).toBe(2) // "const foo = 1" + "const bar = 2"
    expect(result.additions).toBe(2) // "const foo = 2" + "const bar = 2"
    expect(result.totalChanges).toBe(1)
  })

  it('counts multiple changes', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- import React\n+ import { useState }',
        },
        {
          type: 'edit',
          diff: '- const a = 1\n+ const a = 2',
        },
      ],
    }

    const result = getDiffSummary(args)

    expect(result.deletions).toBe(2)
    expect(result.additions).toBe(2)
    expect(result.totalChanges).toBe(2)
  })

  it('handles pure additions', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '+ const newLine = 1\n  const anotherLine = 2',
        },
      ],
    }

    const result = getDiffSummary(args)

    expect(result.deletions).toBe(0)
    expect(result.additions).toBe(2)
    expect(result.totalChanges).toBe(1)
  })

  it('handles pure deletions', () => {
    const args: ClaudeEditArgs = {
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const oldLine = 1\n  const anotherLine = 2',
        },
      ],
    }

    const result = getDiffSummary(args)

    expect(result.deletions).toBe(2)
    expect(result.additions).toBe(0)
    expect(result.totalChanges).toBe(1)
  })
})

describe('parseClaudeToolArgs', () => {
  it('parses Edit tool args correctly', () => {
    const args = JSON.stringify({
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- const foo = 1\n+ const foo = 2',
        },
      ],
    })

    const result = parseClaudeToolArgs('Edit', args)

    expect(result.filePath).toBe('test.ts')
    expect(result.oldContent).toBe(' const foo = 1')
    expect(result.newContent).toBe(' const foo = 2')
  })

  it('handles Edit tool with multiple changes', () => {
    const args = JSON.stringify({
      path: 'test.ts',
      changes: [
        {
          type: 'edit',
          diff: '- import React\n+ import { useState }',
        },
        {
          type: 'edit',
          diff: '- const a = 1\n+ const a = 2',
        },
      ],
    })

    const result = parseClaudeToolArgs('Edit', args)

    expect(result.filePath).toBe('test.ts')
    expect(result.oldContent).toContain('import React')
    expect(result.oldContent).toContain('const a = 1')
    expect(result.newContent).toContain('import { useState }')
    expect(result.newContent).toContain('const a = 2')
  })

  it('throws error for unsupported tool', () => {
    const args = JSON.stringify({ path: 'test.ts' })

    expect(() => {
      parseClaudeToolArgs('UnsupportedTool' as any, args)
    }).toThrow('Unsupported tool')
  })
})
