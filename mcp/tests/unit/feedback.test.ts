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
    it('should call exec with add feedback command', async () => {
      mockClient.exec.mockResolvedValue({});

      await feedbackTools.addFeedback(mockClient, {
        issue_id: 'sg-1',
        to_id: 'sg-spec-1',
        content: 'This is unclear',
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        'feedback', 'add', 'sg-1', 'sg-spec-1',
        '--content', 'This is unclear',
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
        'feedback', 'add', 'sg-1', 'sg-spec-1',
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
        'feedback', 'add', 'sg-1', 'sg-spec-1',
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
        'feedback', 'add', 'sg-1', 'sg-spec-1',
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
        'feedback', 'add', 'sg-1', 'sg-spec-1',
        '--content', 'Needs clarification',
        '--type', 'comment',
        '--line', '42',
        '--text', 'some text',
      ]);
    });
  });
});
