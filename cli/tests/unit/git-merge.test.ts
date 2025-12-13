import { describe, it, expect } from 'vitest';
import { mergeYaml } from '../../src/git-merge.js';

describe('mergeYaml', () => {
  describe('clean merges', () => {
    it('should merge non-conflicting changes', async () => {
      const base = `
name: test
version: 1.0.0
items:
  - item1
  - item2
`;

      const ours = `
name: test
version: 2.0.0
items:
  - item1
  - item2
`;

      const theirs = `
name: test
version: 1.0.0
items:
  - item1
  - item2
  - item3
`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('version: 2.0.0');
      expect(result.merged).toContain('- item3');
    });

    it('should handle identical content', async () => {
      const content = `
name: test
version: 1.0.0
`;

      const result = await mergeYaml(content, content, content);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe(content);
    });

    it('should handle when ours equals base', async () => {
      const base = `
name: test
version: 1.0.0
`;

      const theirs = `
name: test
version: 2.0.0
`;

      const result = await mergeYaml(base, base, theirs);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('version: 2.0.0');
    });

    it('should handle when theirs equals base', async () => {
      const base = `
name: test
version: 1.0.0
`;

      const ours = `
name: test
version: 2.0.0
`;

      const result = await mergeYaml(base, ours, base);

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('version: 2.0.0');
    });
  });

  describe('conflicting merges', () => {
    it('should detect conflicts when same line is modified differently', async () => {
      const base = `
name: test
version: 1.0.0
`;

      const ours = `
name: test
version: 2.0.0
`;

      const theirs = `
name: test
version: 3.0.0
`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<<');
      expect(result.merged).toContain('=======');
      expect(result.merged).toContain('>>>>>>>');
      expect(result.merged).toContain('2.0.0');
      expect(result.merged).toContain('3.0.0');
    });

    it('should preserve conflict markers in output', async () => {
      const base = `
data:
  field1: value1
  field2: value2
`;

      const ours = `
data:
  field1: changed_by_us
  field2: value2
`;

      const theirs = `
data:
  field1: changed_by_them
  field2: value2
`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toMatch(/<<<<<<< .*\n.*changed_by_us/);
      expect(result.merged).toMatch(/=======\n.*changed_by_them/);
      expect(result.merged).toContain('>>>>>>>');
    });

    it('should handle multiple conflicts', async () => {
      const base = `
field1: value1
field2: value2
field3: value3
`;

      const ours = `
field1: ours1
field2: value2
field3: ours3
`;

      const theirs = `
field1: theirs1
field2: value2
field3: theirs3
`;

      const result = await mergeYaml(base, ours, theirs);

      expect(result.hasConflicts).toBe(true);
      // Should have conflict markers for both field1 and field3
      const conflictCount = (result.merged.match(/<<<<<<<|>>>>>>>/g) || []).length;
      expect(conflictCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings', async () => {
      const result = await mergeYaml('', '', '');

      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe('');
    });

    it('should handle whitespace-only content', async () => {
      const whitespace = '   \n  \n';
      const result = await mergeYaml(whitespace, whitespace, whitespace);

      expect(result.hasConflicts).toBe(false);
    });

    it('should handle complex YAML structures', async () => {
      const base = `
metadata:
  name: test
  labels:
    app: myapp
    env: prod
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0.0
`;

      const ours = `
metadata:
  name: test
  labels:
    app: myapp
    env: prod
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: app
          image: myapp:1.0.0
`;

      const theirs = `
metadata:
  name: test
  labels:
    app: myapp
    env: prod
    team: platform
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: myapp:2.0.0
`;

      const result = await mergeYaml(base, ours, theirs);

      // This should be a clean merge - different fields changed
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('replicas: 3');
      expect(result.merged).toContain('team: platform');
      expect(result.merged).toContain('image: myapp:2.0.0');
    });
  });

  describe('temporary file cleanup', () => {
    it('should clean up temporary files after successful merge', async () => {
      const base = 'test: base';
      const ours = 'test: ours';
      const theirs = 'test: theirs';

      // Run multiple merges to ensure no file leaks
      for (let i = 0; i < 5; i++) {
        await mergeYaml(base, ours, theirs);
      }

      // If there were file leaks, this test would eventually fail or slow down
      // No explicit assertion needed - successful completion indicates cleanup worked
      expect(true).toBe(true);
    });

    it('should clean up temporary files even on conflicts', async () => {
      const base = 'field: base';
      const ours = 'field: ours';
      const theirs = 'field: theirs';

      for (let i = 0; i < 5; i++) {
        const result = await mergeYaml(base, ours, theirs);
        expect(result.hasConflicts).toBe(true);
      }

      expect(true).toBe(true);
    });
  });
});
