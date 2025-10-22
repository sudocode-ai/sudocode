/**
 * Unit tests for relationship management tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as relationshipTools from '../../src/tools/relationships.js';

describe('Relationship Tools', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      exec: vi.fn(),
    };
  });

  describe('link', () => {
    it('should call exec with link command', async () => {
      mockClient.exec.mockResolvedValue({});

      await relationshipTools.link(mockClient, {
        from_id: 'sg-1',
        to_id: 'sg-2',
      });

      expect(mockClient.exec).toHaveBeenCalledWith(['link', 'sg-1', 'sg-2']);
    });

    it('should include relationship type', async () => {
      mockClient.exec.mockResolvedValue({});

      await relationshipTools.link(mockClient, {
        from_id: 'sg-1',
        to_id: 'sg-2',
        type: 'blocks',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'link', 'sg-1', 'sg-2',
        '--type', 'blocks',
      ]);
    });

    it('should support all relationship types', async () => {
      const types: Array<relationshipTools.RelationshipType> = [
        'blocks',
        'implements',
        'references',
        'depends-on',
        'discovered-from',
        'related',
      ];

      for (const type of types) {
        mockClient.exec.mockClear();
        mockClient.exec.mockResolvedValue({});

        await relationshipTools.link(mockClient, {
          from_id: 'sg-1',
          to_id: 'sg-2',
          type,
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'link', 'sg-1', 'sg-2',
          '--type', type,
        ]);
      }
    });
  });
});
