/**
 * Tests for YAML Conflict Resolver
 */

import { describe, it, expect } from 'vitest';
import { resolveYamlConflicts } from '../../src/yaml-conflict-resolver.js';
import type { Issue, Spec } from '@sudocode-ai/types';

// Helper to create minimal test entities
function createIssue(updated_at: string): Issue {
  return {
    id: 'i-test',
    uuid: '00000000-0000-0000-0000-000000000000',
    title: 'Test Issue',
    description: '',
    status: 'open',
    priority: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at
  } as Issue;
}

function createSpec(updated_at: string): Spec {
  return {
    id: 's-test',
    uuid: '00000000-0000-0000-0000-000000000000',
    title: 'Test Spec',
    description: '',
    priority: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at
  } as Spec;
}

describe('resolveYamlConflicts', () => {
  describe('no conflicts', () => {
    it('should return unchanged YAML when no conflict markers present', () => {
      const yaml = `
title: Test
description: No conflicts here
status: open
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toBe(yaml);
    });

    it('should return unchanged YAML for empty string', () => {
      const yaml = '';
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toBe(yaml);
    });
  });

  describe('single conflict', () => {
    it('should resolve conflict with ours when ours is newer', () => {
      const yaml = `title: Test
<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
status: open
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toBe(`title: Test
description: Our version
status: open
`);
      expect(result).not.toContain('<<<<<<<');
      expect(result).not.toContain('=======');
      expect(result).not.toContain('>>>>>>>');
    });

    it('should resolve conflict with theirs when theirs is newer', () => {
      const yaml = `title: Test
<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
status: open
`;
      const ours = createIssue('2025-01-01T09:00:00Z');
      const theirs = createIssue('2025-01-01T10:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toBe(`title: Test
description: Their version
status: open
`);
      expect(result).not.toContain('<<<<<<<');
      expect(result).not.toContain('=======');
      expect(result).not.toContain('>>>>>>>');
    });

    it('should resolve multi-line conflict content', () => {
      const yaml = `title: Test
<<<<<<< HEAD
description: |
  Our version
  Line 2
  Line 3
=======
description: |
  Their version
  Line 2
  Line 3
>>>>>>> branch
status: open
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Our version');
      expect(result).not.toContain('Their version');
      expect(result).not.toContain('<<<<<<<');
    });
  });

  describe('multiple conflicts', () => {
    it('should resolve all conflicts consistently', () => {
      const yaml = `title: Test
<<<<<<< HEAD
description: Our description
=======
description: Their description
>>>>>>> branch
status: open
<<<<<<< HEAD
priority: 1
=======
priority: 2
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Our description');
      expect(result).toContain('priority: 1');
      expect(result).not.toContain('Their description');
      expect(result).not.toContain('priority: 2');
      expect(result).not.toContain('<<<<<<<');
      expect(result).not.toContain('=======');
      expect(result).not.toContain('>>>>>>>');
    });

    it('should preserve non-conflict content between conflicts', () => {
      const yaml = `title: Test
<<<<<<< HEAD
field1: ours
=======
field1: theirs
>>>>>>> branch
field2: unchanged
<<<<<<< HEAD
field3: ours
=======
field3: theirs
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('field1: ours');
      expect(result).toContain('field2: unchanged');
      expect(result).toContain('field3: ours');
    });
  });

  describe('timestamp handling', () => {
    it('should handle missing timestamps (ours missing)', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const ours = createIssue(''); // Empty timestamp
      const theirs = createIssue('2025-01-01T10:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Theirs should win (ours treated as oldest)
      expect(result).toContain('Their version');
      expect(result).not.toContain('Our version');
    });

    it('should handle missing timestamps (theirs missing)', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue(''); // Empty timestamp

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Ours should win (theirs treated as oldest)
      expect(result).toContain('Our version');
      expect(result).not.toContain('Their version');
    });

    it('should handle invalid timestamps', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const ours = createIssue('invalid-date');
      const theirs = createIssue('2025-01-01T10:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Theirs should win (ours invalid)
      expect(result).toContain('Their version');
    });

    it('should handle space-separated timestamp format', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01 10:00:00');
      const theirs = createIssue('2025-01-01 09:00:00');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Ours should win (newer)
      expect(result).toContain('Our version');
    });

    it('should handle mixed timestamp formats', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z'); // ISO format
      const theirs = createIssue('2025-01-01 09:00:00Z'); // Space-separated with Z

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Ours should win (newer)
      expect(result).toContain('Our version');
    });
  });

  describe('edge cases', () => {
    it('should handle identical timestamps (tie - ours wins)', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> branch
`;
      const timestamp = '2025-01-01T10:00:00Z';
      const ours = createIssue(timestamp);
      const theirs = createIssue(timestamp);

      const result = resolveYamlConflicts(yaml, ours, theirs);

      // Ours should win on tie (>= comparison)
      expect(result).toContain('Our version');
      expect(result).not.toContain('Their version');
    });

    it('should handle empty conflict sections', () => {
      const yaml = `title: Test
<<<<<<< HEAD
=======
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toBe(`title: Test
`);
    });

    it('should work with Spec entities', () => {
      const yaml = `<<<<<<< HEAD
description: Our spec
=======
description: Their spec
>>>>>>> branch
`;
      const ours = createSpec('2025-01-01T10:00:00Z');
      const theirs = createSpec('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Our spec');
      expect(result).not.toContain('Their spec');
    });

    it('should handle conflict markers with various branch names', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>> feature/my-branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Our version');
      expect(result).not.toContain('<<<<<<<');
    });

    it('should handle conflicts with whitespace variations', () => {
      const yaml = `<<<<<<< HEAD
description: Our version
=======
description: Their version
>>>>>>>         branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Our version');
      expect(result).not.toContain('<<<<<<<');
    });
  });

  describe('complex YAML structures', () => {
    it('should handle conflicts in nested YAML', () => {
      const yaml = `title: Test
metadata:
<<<<<<< HEAD
  author: Alice
  version: 2
=======
  author: Bob
  version: 1
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('Alice');
      expect(result).toContain('version: 2');
      expect(result).not.toContain('Bob');
    });

    it('should handle conflicts in arrays', () => {
      const yaml = `title: Test
<<<<<<< HEAD
tags:
  - tag1
  - tag2
=======
tags:
  - tag3
  - tag4
>>>>>>> branch
`;
      const ours = createIssue('2025-01-01T10:00:00Z');
      const theirs = createIssue('2025-01-01T09:00:00Z');

      const result = resolveYamlConflicts(yaml, ours, theirs);

      expect(result).toContain('tag1');
      expect(result).toContain('tag2');
      expect(result).not.toContain('tag3');
    });
  });
});
