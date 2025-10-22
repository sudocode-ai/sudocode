/**
 * Unit tests for spec management tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as specTools from '../../src/tools/specs.js';

describe('Spec Tools', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      exec: vi.fn(),
    };
  });

  describe('listSpecs', () => {
    it('should call exec with list command', async () => {
      mockClient.exec.mockResolvedValue([]);

      await specTools.listSpecs(mockClient);

      expect(mockClient.exec).toHaveBeenCalledWith(['spec', 'list']);
    });

    it('should include filter parameters', async () => {
      mockClient.exec.mockResolvedValue([]);

      await specTools.listSpecs(mockClient, {
        status: 'approved',
        type: 'api',
        priority: 1,
        limit: 10,
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'spec', 'list',
        '--status', 'approved',
        '--type', 'api',
        '--priority', '1',
        '--limit', '10',
      ]);
    });
  });

  describe('showSpec', () => {
    it('should call exec with show command and spec ID', async () => {
      mockClient.exec.mockResolvedValue({});

      await specTools.showSpec(mockClient, { spec_id: 'sg-spec-1' });

      expect(mockClient.exec).toHaveBeenCalledWith(['spec', 'show', 'sg-spec-1']);
    });
  });

  describe('upsertSpec', () => {
    describe('create mode (no spec_id)', () => {
      it('should call exec with create command', async () => {
        mockClient.exec.mockResolvedValue({});

        await specTools.upsertSpec(mockClient, { title: 'New Spec' });

        expect(mockClient.exec).toHaveBeenCalledWith(['spec', 'create', 'New Spec']);
      });

      it('should include all optional parameters', async () => {
        mockClient.exec.mockResolvedValue({});

        await specTools.upsertSpec(mockClient, {
          title: 'API Spec',
          type: 'api',
          priority: 1,
          description: 'API specification',
          design: 'REST API design',
          file_path: '/specs/api.md',
          parent: 'sg-spec-parent',
          tags: ['api', 'v1'],
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'spec', 'create', 'API Spec',
          '--type', 'api',
          '--priority', '1',
          '--description', 'API specification',
          '--design', 'REST API design',
          '--file-path', '/specs/api.md',
          '--parent', 'sg-spec-parent',
          '--tags', 'api,v1',
        ]);
      });

      it('should throw error if title is missing', async () => {
        await expect(specTools.upsertSpec(mockClient, {})).rejects.toThrow(
          'title is required when creating a new spec'
        );
      });
    });

    describe('update mode (spec_id provided)', () => {
      it('should throw error for update (not yet supported)', async () => {
        await expect(
          specTools.upsertSpec(mockClient, {
            spec_id: 'sg-spec-1',
            title: 'Updated Spec',
          })
        ).rejects.toThrow('Spec update is not yet supported');
      });
    });
  });
});
