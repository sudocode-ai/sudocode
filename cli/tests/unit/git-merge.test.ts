import { describe, it, expect } from 'vitest';
import { mergeYaml } from '../../src/git-merge';

describe('git-merge', () => {
  describe('mergeYaml', () => {
    it('should perform clean merge when no conflicts', async () => {
      const base = `field1: value1
field2: value2
field3: value3`;

      const ours = `field1: changed-by-ours
field2: value2
field3: value3`;

      const theirs = `field1: value1
field2: value2
field3: changed-by-theirs`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('changed-by-ours');
      expect(result.merged).toContain('changed-by-theirs');
    });

    it('should detect conflicts when same line changed', async () => {
      const base = `field1: value1
field2: value2`;

      const ours = `field1: changed-by-ours
field2: value2`;

      const theirs = `field1: changed-by-theirs
field2: value2`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<<');
      expect(result.merged).toContain('>>>>>>>');
      expect(result.merged).toContain('changed-by-ours');
      expect(result.merged).toContain('changed-by-theirs');
    });

    it('should merge multi-line text with different line changes', async () => {
      const base = `description: |
  Line 1
  Line 2
  Line 3`;

      const ours = `description: |
  Line 1 modified by ours
  Line 2
  Line 3`;

      const theirs = `description: |
  Line 1
  Line 2
  Line 3 modified by theirs`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('Line 1 modified by ours');
      expect(result.merged).toContain('Line 3 modified by theirs');
    });

    it('should detect conflicts in multi-line text when same line changed', async () => {
      const base = `description: |
  Line 1
  Line 2`;

      const ours = `description: |
  Line 1 changed by ours
  Line 2`;

      const theirs = `description: |
  Line 1 changed by theirs
  Line 2`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<<');
      expect(result.merged).toContain('>>>>>>>');
    });

    it('should handle empty strings', async () => {
      const base = '';
      const ours = 'field: value1';
      const theirs = 'field: value2';

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<<');
    });

    it('should handle identical changes (no conflict)', async () => {
      const base = 'field: value1';
      const ours = 'field: value2';
      const theirs = 'field: value2';

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('value2');
    });

    it('should handle additions on both sides', async () => {
      const base = `field1: value1`;

      const ours = `field1: value1
field2: added-by-ours`;

      const theirs = `field1: value1
field3: added-by-theirs`;

      const result = await mergeYaml(base, ours, theirs);

      // Git treats this as a conflict because content is added at the same position
      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('added-by-ours');
      expect(result.merged).toContain('added-by-theirs');
      expect(result.merged).toContain('<<<<<<<');
    });

    it('should handle complex nested structures', async () => {
      const base = `parent:
  child1: value1
  child2: value2`;

      const ours = `parent:
  child1: changed-by-ours
  child2: value2`;

      const theirs = `parent:
  child1: value1
  child2: changed-by-theirs`;

      const result = await mergeYaml(base, ours, theirs);

      // Git treats overlapping changes in nested structures as conflicts
      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('changed-by-ours');
      expect(result.merged).toContain('changed-by-theirs');
    });

    it('should handle array additions', async () => {
      const base = `items:
  - item1`;

      const ours = `items:
  - item1
  - item2`;

      const theirs = `items:
  - item1
  - item3`;

      const result = await mergeYaml(base, ours, theirs);

      // Git treats array additions at the same position as conflicts
      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('item2');
      expect(result.merged).toContain('item3');
    });

    it('should preserve whitespace in merged result', async () => {
      const base = `field1: value1
field2: value2`;

      const ours = `field1: changed
field2: value2`;

      const theirs = `field1: value1
field2: also-changed`;

      const result = await mergeYaml(base, ours, theirs);

      // Git sees adjacent line changes as conflicts
      expect(result.hasConflicts).toBe(true);
      // Check that the result maintains YAML structure even with conflicts
      expect(result.merged.split('\n').length).toBeGreaterThan(1);
      expect(result.merged).toContain('changed');
      expect(result.merged).toContain('also-changed');
    });
  });
});
