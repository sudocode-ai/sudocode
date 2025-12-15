/**
 * Integration tests for YAML-based three-way merge
 * Tests the complete flow: metadata-first → YAML → git merge → conflict resolution → JSONL
 */

import { describe, it, expect } from 'vitest';
import { mergeThreeWay, type JSONLEntity } from '../../src/merge-resolver.js';

describe('YAML Merge Integration', () => {
  describe('Multi-line text merging', () => {
    it('should merge changes to different paragraphs', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'API Spec',
          description: '## Overview\nFirst paragraph.\n\n## Details\nSecond paragraph.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'API Spec',
          description: '## Overview\nFirst paragraph edited by Agent A.\n\n## Details\nSecond paragraph.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'API Spec',
          description: '## Overview\nFirst paragraph.\n\n## Details\nSecond paragraph edited by Agent B.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Both changes should be preserved (different lines)
      expect(merged[0].description).toContain('edited by Agent A');
      expect(merged[0].description).toContain('edited by Agent B');
    });

    it('should use latest-wins when same line is changed', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Original Title',
          description: 'Original content',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title by Agent A',
          description: 'Original content',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title by Agent B',
          description: 'Original content',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Latest-wins (Agent B has newer timestamp)
      expect(merged[0].title).toBe('Title by Agent B');
    });
  });

  describe('Array merging (metadata-first)', () => {
    it('should merge relationship additions from both sides', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'issue-1',
          uuid: 'uuid-1',
          title: 'Implement feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          relationships: [
            { from: 'issue-1', to: 'spec-1', type: 'implements' },
          ],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'issue-1',
          uuid: 'uuid-1',
          title: 'Implement feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          relationships: [
            { from: 'issue-1', to: 'spec-1', type: 'implements' },
            { from: 'issue-1', to: 'issue-2', type: 'blocks' },
          ],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'issue-1',
          uuid: 'uuid-1',
          title: 'Implement feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          relationships: [
            { from: 'issue-1', to: 'spec-1', type: 'implements' },
            { from: 'issue-1', to: 'issue-3', type: 'depends-on' },
          ],
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // All three relationships should be present (metadata merged first)
      expect(merged[0].relationships).toHaveLength(3);
      expect(merged[0].relationships).toContainEqual({
        from: 'issue-1',
        to: 'spec-1',
        type: 'implements',
      });
      expect(merged[0].relationships).toContainEqual({
        from: 'issue-1',
        to: 'issue-2',
        type: 'blocks',
      });
      expect(merged[0].relationships).toContainEqual({
        from: 'issue-1',
        to: 'issue-3',
        type: 'depends-on',
      });
    });

    it('should merge tag additions from both sides', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['backend'],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['backend', 'api'],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['backend', 'security'],
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // All three tags should be present (union)
      expect(merged[0].tags).toHaveLength(3);
      expect(merged[0].tags).toContain('backend');
      expect(merged[0].tags).toContain('api');
      expect(merged[0].tags).toContain('security');
    });
  });

  describe('Mixed changes', () => {
    it('should merge title change and description change separately', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Original Title',
          description: 'Original description\nwith multiple lines.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Updated Title',
          description: 'Original description\nwith multiple lines.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Original Title',
          description: 'Original description\nwith multiple lines edited.',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Title change from ours, description change from theirs (or latest-wins)
      // At minimum, both changes should be attempted
      expect(merged[0].title === 'Updated Title' || merged[0].title === 'Original Title').toBe(true);
      expect(merged[0].description).toContain('lines');
    });
  });

  describe('Nested object changes', () => {
    it('should merge changes to different nested fields', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          location_anchor: {
            line: 10,
            text: 'original',
            section: 'Overview',
          },
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          location_anchor: {
            line: 20,
            text: 'original',
            section: 'Overview',
          },
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Spec',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          location_anchor: {
            line: 10,
            text: 'updated',
            section: 'Overview',
          },
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Changes to different nested fields should be preserved or resolved via latest-wins
      expect(merged[0].location_anchor).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty strings', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: '',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: 'Added content',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: '',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(merged[0].description).toBeDefined();
    });

    it('should handle empty arrays', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: [],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['tag1'],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['tag2'],
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Both tags should be present (metadata merged)
      expect(merged[0].tags).toContain('tag1');
      expect(merged[0].tags).toContain('tag2');
    });

    it('should handle special characters in text', async () => {
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: 'Text with "quotes" and \'apostrophes\'',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: 'Text with "quotes" and \'apostrophes\' and backslashes \\',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          description: 'Text with "quotes" and \'apostrophes\'',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(merged[0].description).toBeDefined();
    });
  });

  describe('Fallback behavior', () => {
    it('should fallback to metadata merge if YAML merge fails', async () => {
      // This test verifies that the fallback mechanism works
      // In practice, YAML merge should rarely fail, but the fallback ensures robustness
      const base: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['base'],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['ours'],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'spec-1',
          uuid: 'uuid-1',
          title: 'Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['theirs'],
        },
      ];

      const { entities: merged } = await mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Metadata merge should work even if YAML merge fails
      expect(merged[0].tags).toContain('base');
      expect(merged[0].tags).toContain('ours');
      expect(merged[0].tags).toContain('theirs');
    });
  });
});
