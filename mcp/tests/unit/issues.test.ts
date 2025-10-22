/**
 * Unit tests for issue management tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as issueTools from '../../src/tools/issues.js';

describe('Issue Tools', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      exec: vi.fn(),
    };
  });

  describe('ready', () => {
    it('should call exec with ready and status commands', async () => {
      mockClient.exec
        .mockResolvedValueOnce({ issues: [] })  // ready result
        .mockResolvedValueOnce({ specs: { total: 5 }, issues: { total: 10 } });  // status result

      const result = await issueTools.ready(mockClient);

      expect(mockClient.exec).toHaveBeenCalledWith(['ready']);
      expect(mockClient.exec).toHaveBeenCalledWith(['status']);
      expect(result).toEqual({
        ready: { issues: [] },
        status: { specs: { total: 5 }, issues: { total: 10 } },
      });
    });

    it('should redact content field from issues', async () => {
      mockClient.exec
        .mockResolvedValueOnce({
          issues: [
            { id: 'sg-1', title: 'Test Issue', content: 'Long content...', priority: 2 },
            { id: 'sg-2', title: 'Another Issue', content: 'More content...', priority: 1 },
          ]
        })
        .mockResolvedValueOnce({ specs: { total: 5 }, issues: { total: 10 } });

      const result = await issueTools.ready(mockClient);

      // Verify content field is removed
      expect(result.ready.issues[0]).not.toHaveProperty('content');
      expect(result.ready.issues[1]).not.toHaveProperty('content');
      // Verify other fields are preserved
      expect(result.ready.issues[0]).toEqual({ id: 'sg-1', title: 'Test Issue', priority: 2 });
      expect(result.ready.issues[1]).toEqual({ id: 'sg-2', title: 'Another Issue', priority: 1 });
    });
  });

  describe('listIssues', () => {
    it('should call exec with list command', async () => {
      mockClient.exec.mockResolvedValue([]);

      await issueTools.listIssues(mockClient);

      expect(mockClient.exec).toHaveBeenCalledWith(['issue', 'list']);
    });

    it('should include filter parameters', async () => {
      mockClient.exec.mockResolvedValue([]);

      await issueTools.listIssues(mockClient, {
        status: 'open',
        type: 'bug',
        priority: 1,
        assignee: 'bob',
        limit: 20,
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'issue', 'list',
        '--status', 'open',
        '--type', 'bug',
        '--priority', '1',
        '--assignee', 'bob',
        '--limit', '20',
      ]);
    });
  });

  describe('showIssue', () => {
    it('should call exec with show command and issue ID', async () => {
      mockClient.exec.mockResolvedValue({});

      await issueTools.showIssue(mockClient, { issue_id: 'sg-1' });

      expect(mockClient.exec).toHaveBeenCalledWith(['issue', 'show', 'sg-1']);
    });
  });

  describe('upsertIssue', () => {
    describe('create mode (no issue_id)', () => {
      it('should call exec with create command', async () => {
        mockClient.exec.mockResolvedValue({});

        await issueTools.upsertIssue(mockClient, { title: 'Test Issue' });

        expect(mockClient.exec).toHaveBeenCalledWith(['issue', 'create', 'Test Issue']);
      });

      it('should include all optional parameters', async () => {
        mockClient.exec.mockResolvedValue({});

        await issueTools.upsertIssue(mockClient, {
          title: 'Test Issue',
          description: 'Test description',
          type: 'bug',
          priority: 1,
          assignee: 'alice',
          parent: 'sg-epic-1',
          tags: ['urgent', 'security'],
          estimate: 120,
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'issue', 'create', 'Test Issue',
          '--description', 'Test description',
          '--type', 'bug',
          '--priority', '1',
          '--assignee', 'alice',
          '--parent', 'sg-epic-1',
          '--tags', 'urgent,security',
          '--estimate', '120',
        ]);
      });

      it('should throw error if title is missing', async () => {
        await expect(issueTools.upsertIssue(mockClient, {})).rejects.toThrow(
          'title is required when creating a new issue'
        );
      });
    });

    describe('update mode (issue_id provided)', () => {
      it('should call exec with update command', async () => {
        mockClient.exec.mockResolvedValue({});

        await issueTools.upsertIssue(mockClient, {
          issue_id: 'sg-1',
          status: 'in_progress',
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'issue', 'update', 'sg-1',
          '--status', 'in_progress',
        ]);
      });

      it('should include multiple update fields', async () => {
        mockClient.exec.mockResolvedValue({});

        await issueTools.upsertIssue(mockClient, {
          issue_id: 'sg-1',
          status: 'in_progress',
          priority: 0,
          assignee: 'bob',
          title: 'Updated Title',
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'issue', 'update', 'sg-1',
          '--status', 'in_progress',
          '--priority', '0',
          '--assignee', 'bob',
          '--title', 'Updated Title',
        ]);
      });

      it('should support closing issues via status', async () => {
        mockClient.exec.mockResolvedValue({});

        await issueTools.upsertIssue(mockClient, {
          issue_id: 'sg-1',
          status: 'closed',
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'issue', 'update', 'sg-1',
          '--status', 'closed',
        ]);
      });
    });
  });
});
