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

  describe('addFeedback', () => {
    it('should call exec with add feedback command (with issue_id)', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'This is unclear',
      });

      // CLI args: feedback add <target-id> [issue-id]
      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1', 'sg-1',
        '--content', 'This is unclear',
      ]);
    });

    it('should call exec without issue_id for anonymous feedback', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        to_id: 'sg-spec-1',
        content: 'Anonymous feedback',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1',
        '--content', 'Anonymous feedback',
      ]);
    });

    it('should include type parameter when provided', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'Needs clarification',
        type: 'comment',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1', 'sg-1',
        '--content', 'Needs clarification',
        '--type', 'comment',
      ]);
    });

    it('should include line parameter when provided', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'Fix this line',
        line: 42,
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1', 'sg-1',
        '--content', 'Fix this line',
        '--line', '42',
      ]);
    });

    it('should include text parameter when provided', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'This text needs updating',
        text: 'original text',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1', 'sg-1',
        '--content', 'This text needs updating',
        '--text', 'original text',
      ]);
    });

    it('should include all optional parameters when provided', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'Needs clarification',
        type: 'comment',
        line: 42,
        text: 'some text',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-spec-1', 'sg-1',
        '--content', 'Needs clarification',
        '--type', 'comment',
        '--line', '42',
        '--text', 'some text',
      ]);
    });

  });
});
