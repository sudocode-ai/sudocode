/**
 * Unit tests for feedback management tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as feedbackTools from '../../src/tools/feedback.js';

describe('Feedback Tools', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      exec: vi.fn(),
    };
  });

  describe('upsertFeedback', () => {
    describe('create mode (no feedback_id)', () => {
      it('should call exec with add feedback command', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          issue_id: 'sg-1',
          spec_id: 'sg-spec-1',
          content: 'This is unclear',
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'feedback', 'add', 'sg-1', 'sg-spec-1',
          '--content', 'This is unclear',
        ]);
      });

      it('should include all optional parameters', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          issue_id: 'sg-1',
          spec_id: 'sg-spec-1',
          content: 'Needs clarification',
          type: 'comment',
          line: 42,
          agent: 'claude',
        });

        expect(mockClient.exec).toHaveBeenCalledWith([
          'feedback', 'add', 'sg-1', 'sg-spec-1',
          '--content', 'Needs clarification',
          '--type', 'comment',
          '--line', '42',
          '--agent', 'claude',
        ]);
      });

      it('should throw error if required fields are missing', async () => {
        await expect(
          feedbackTools.upsertFeedback(mockClient, {
            issue_id: 'sg-1',
          })
        ).rejects.toThrow('issue_id, spec_id, and content are required when creating feedback');
      });
    });

    describe('update mode (feedback_id provided)', () => {
      it('should call acknowledge when status is acknowledged', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          feedback_id: 'fb-1',
          status: 'acknowledged',
        });

        expect(mockClient.exec).toHaveBeenCalledWith(['feedback', 'acknowledge', 'fb-1']);
      });

      it('should call resolve when status is resolved', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          feedback_id: 'fb-1',
          status: 'resolved',
        });

        expect(mockClient.exec).toHaveBeenCalledWith(['feedback', 'resolve', 'fb-1']);
      });

      it('should call wont-fix when status is wont_fix', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          feedback_id: 'fb-1',
          status: 'wont_fix',
        });

        expect(mockClient.exec).toHaveBeenCalledWith(['feedback', 'wont-fix', 'fb-1']);
      });

      it('should call relocate when relocate is true', async () => {
        mockClient.exec.mockResolvedValue({});

        await feedbackTools.upsertFeedback(mockClient, {
          feedback_id: 'fb-1',
          relocate: true,
        });

        expect(mockClient.exec).toHaveBeenCalledWith(['feedback', 'relocate', 'fb-1']);
      });

      it('should throw error if neither status nor relocate is provided', async () => {
        await expect(
          feedbackTools.upsertFeedback(mockClient, {
            feedback_id: 'fb-1',
          })
        ).rejects.toThrow('When updating feedback, you must provide either status or relocate=true');
      });
    });
  });
});
