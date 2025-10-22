/**
 * Unit tests for Feedback operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../../src/db.js';
import {
  createFeedback,
  getFeedback,
  updateFeedback,
  deleteFeedback,
  updateFeedbackStatus,
  listFeedback,
  getFeedbackForIssue,
  getFeedbackForSpec,
  getOpenFeedbackForSpec,
  countFeedbackByStatus,
  generateFeedbackId,
} from '../../../src/operations/feedback.js';
import { createSpec, deleteSpec } from '../../../src/operations/specs.js';
import { createIssue, deleteIssue } from '../../../src/operations/issues.js';
import type Database from 'better-sqlite3';
import type { FeedbackAnchor } from '../../../src/types.js';

describe('Feedback Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ':memory:' });

    // Create test spec and issue for foreign key constraints
    createSpec(db, {
      id: 'spec-001',
      title: 'Test Spec',
      file_path: 'specs/test.md',
      content: 'Test content',
      priority: 2,
    });

    createIssue(db, {
      id: 'issue-001',
      title: 'Test Issue',
    });
  });

  describe('generateFeedbackId', () => {
    it('should generate FB-001 for first feedback', () => {
      const id = generateFeedbackId(db);
      expect(id).toBe('FB-001');
    });

    it('should increment feedback IDs', () => {
      const anchor: FeedbackAnchor = {
        section_heading: 'Introduction',
        line_number: 10,
        anchor_status: 'valid',
      };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'First feedback',
        agent: 'claude-code',
        anchor,
      });

      const id = generateFeedbackId(db);
      expect(id).toBe('FB-002');
    });

    it('should handle custom IDs', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      createFeedback(db, {
        id: 'FB-005',
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Custom ID',
        agent: 'claude-code',
        anchor,
      });

      const id = generateFeedbackId(db);
      expect(id).toBe('FB-006');
    });
  });

  describe('createFeedback', () => {
    it('should create feedback with all fields', () => {
      const anchor: FeedbackAnchor = {
        section_heading: 'Authentication',
        section_level: 2,
        line_number: 45,
        line_offset: 3,
        text_snippet: 'token refresh logic',
        context_before: 'implement JWT',
        context_after: 'with expiration',
        anchor_status: 'valid',
      };

      const feedback = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Token rotation policy not specified',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      expect(feedback.id).toMatch(/^FB-\d{3}$/);
      expect(feedback.issue_id).toBe('issue-001');
      expect(feedback.spec_id).toBe('spec-001');
      expect(feedback.feedback_type).toBe('comment');
      expect(feedback.content).toBe('Token rotation policy not specified');
      expect(feedback.agent).toBe('claude-code');
      expect(feedback.status).toBe('open');

      const parsedAnchor = JSON.parse(feedback.anchor);
      expect(parsedAnchor.section_heading).toBe('Authentication');
      expect(parsedAnchor.line_number).toBe(45);
      expect(parsedAnchor.anchor_status).toBe('valid');
    });

    it('should create feedback with defaults', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const feedback = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'request',
        content: 'Simple question',
        agent: 'claude-code',
        anchor,
      });

      expect(feedback.status).toBe('open');
      expect(feedback.resolution).toBeNull();
    });

    it('should throw error on invalid foreign key', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      expect(() => {
        createFeedback(db, {
          issue_id: 'invalid-issue',
          spec_id: 'spec-001',
          feedback_type: 'comment',
          content: 'Test',
          agent: 'claude-code',
          anchor,
        });
      }).toThrow('Constraint violation');
    });

    it('should validate feedback_type', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      expect(() => {
        createFeedback(db, {
          issue_id: 'issue-001',
          spec_id: 'spec-001',
          feedback_type: 'invalid' as any,
          content: 'Test',
          agent: 'claude-code',
          anchor,
        });
      }).toThrow();
    });

    it('should validate status', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      expect(() => {
        createFeedback(db, {
          issue_id: 'issue-001',
          spec_id: 'spec-001',
          feedback_type: 'comment',
          content: 'Test',
          agent: 'claude-code',
          anchor,
          status: 'invalid' as any,
        });
      }).toThrow();
    });
  });

  describe('getFeedback', () => {
    it('should retrieve feedback by ID', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Test feedback',
        agent: 'claude-code',
        anchor,
      });

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toBe('Test feedback');
    });

    it('should return null for non-existent ID', () => {
      const feedback = getFeedback(db, 'FB-999');
      expect(feedback).toBeNull();
    });
  });

  describe('updateFeedback', () => {
    it('should update content', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Original content',
        agent: 'claude-code',
        anchor,
      });

      const updated = updateFeedback(db, created.id, {
        content: 'Updated content',
      });

      expect(updated.content).toBe('Updated content');
    });

    it('should update status and resolution', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      const updated = updateFeedback(db, created.id, {
        status: 'resolved',
        resolution: 'Updated spec section 3.2',
      });

      expect(updated.status).toBe('resolved');
      expect(updated.resolution).toBe('Updated spec section 3.2');
    });

    it('should update anchor', () => {
      const anchor: FeedbackAnchor = {
        line_number: 10,
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      const newAnchor: FeedbackAnchor = {
        line_number: 15,
        anchor_status: 'relocated',
        original_location: {
          line_number: 10,
        },
      };

      const updated = updateFeedback(db, created.id, {
        anchor: newAnchor,
      });

      const parsedAnchor = JSON.parse(updated.anchor);
      expect(parsedAnchor.line_number).toBe(15);
      expect(parsedAnchor.anchor_status).toBe('relocated');
      expect(parsedAnchor.original_location.line_number).toBe(10);
    });

    it('should throw error for non-existent ID', () => {
      expect(() => {
        updateFeedback(db, 'FB-999', { content: 'Test' });
      }).toThrow('Feedback not found');
    });
  });

  describe('updateFeedbackStatus', () => {
    it('should update status with resolution', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      const updated = updateFeedbackStatus(
        db,
        created.id,
        'acknowledged',
        'Will address in next iteration'
      );

      expect(updated.status).toBe('acknowledged');
      expect(updated.resolution).toBe('Will address in next iteration');
    });
  });

  describe('deleteFeedback', () => {
    it('should delete feedback', () => {
      const anchor: FeedbackAnchor = {
        anchor_status: 'valid',
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      const deleted = deleteFeedback(db, created.id);
      expect(deleted).toBe(true);

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      const deleted = deleteFeedback(db, 'FB-999');
      expect(deleted).toBe(false);
    });
  });

  describe('listFeedback', () => {
    beforeEach(() => {
      createSpec(db, {
        id: 'spec-002',
        title: 'Another Spec',
        file_path: 'specs/another.md',
        content: 'Content',
        priority: 2,
      });

      createIssue(db, {
        id: 'issue-002',
        title: 'Another Issue',
      });

      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Feedback 1',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-002',
        feedback_type: 'suggestion',
        content: 'Feedback 2',
        agent: 'claude-code',
        anchor,
        status: 'resolved',
      });

      createFeedback(db, {
        issue_id: 'issue-002',
        spec_id: 'spec-001',
        feedback_type: 'request',
        content: 'Feedback 3',
        agent: 'cursor',
        anchor,
        status: 'open',
      });
    });

    it('should list all feedback', () => {
      const feedback = listFeedback(db);
      expect(feedback).toHaveLength(3);
    });

    it('should filter by issue_id', () => {
      const feedback = listFeedback(db, { issue_id: 'issue-001' });
      expect(feedback).toHaveLength(2);
      expect(feedback.every(f => f.issue_id === 'issue-001')).toBe(true);
    });

    it('should filter by spec_id', () => {
      const feedback = listFeedback(db, { spec_id: 'spec-001' });
      expect(feedback).toHaveLength(2);
      expect(feedback.every(f => f.spec_id === 'spec-001')).toBe(true);
    });

    it('should filter by status', () => {
      const feedback = listFeedback(db, { status: 'open' });
      expect(feedback).toHaveLength(2);
      expect(feedback.every(f => f.status === 'open')).toBe(true);
    });

    it('should filter by feedback_type', () => {
      const feedback = listFeedback(db, { feedback_type: 'comment' });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].feedback_type).toBe('comment');
    });

    it('should combine filters', () => {
      const feedback = listFeedback(db, {
        issue_id: 'issue-001',
        status: 'open',
      });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].content).toBe('Feedback 1');
    });

    it('should respect limit', () => {
      const feedback = listFeedback(db, { limit: 2 });
      expect(feedback).toHaveLength(2);
    });
  });

  describe('getFeedbackForIssue', () => {
    it('should get all feedback for an issue', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Feedback 1',
        agent: 'claude-code',
        anchor,
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Feedback 2',
        agent: 'claude-code',
        anchor,
      });

      const feedback = getFeedbackForIssue(db, 'issue-001');
      expect(feedback).toHaveLength(2);
    });
  });

  describe('getFeedbackForSpec', () => {
    it('should get all feedback for a spec', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Feedback 1',
        agent: 'claude-code',
        anchor,
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Feedback 2',
        agent: 'claude-code',
        anchor,
      });

      const feedback = getFeedbackForSpec(db, 'spec-001');
      expect(feedback).toHaveLength(2);
    });
  });

  describe('getOpenFeedbackForSpec', () => {
    it('should get only open feedback for a spec', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Open feedback',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Resolved feedback',
        agent: 'claude-code',
        anchor,
        status: 'resolved',
      });

      const feedback = getOpenFeedbackForSpec(db, 'spec-001');
      expect(feedback).toHaveLength(1);
      expect(feedback[0].status).toBe('open');
    });
  });

  describe('countFeedbackByStatus', () => {
    it('should count all feedback by status', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Open 1',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'suggestion',
        content: 'Open 2',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'request',
        content: 'Resolved',
        agent: 'claude-code',
        anchor,
        status: 'resolved',
      });

      const counts = countFeedbackByStatus(db);
      expect(counts.open).toBe(2);
      expect(counts.resolved).toBe(1);
      expect(counts.acknowledged).toBe(0);
      expect(counts.wont_fix).toBe(0);
    });

    it('should count feedback for specific spec', () => {
      createSpec(db, {
        id: 'spec-002',
        title: 'Another Spec',
        file_path: 'specs/another.md',
        content: 'Content',
        priority: 2,
      });

      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Spec 1',
        agent: 'claude-code',
        anchor,
        status: 'open',
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-002',
        feedback_type: 'suggestion',
        content: 'Spec 2',
        agent: 'claude-code',
        anchor,
        status: 'resolved',
      });

      const counts = countFeedbackByStatus(db, 'spec-001');
      expect(counts.open).toBe(1);
      expect(counts.resolved).toBe(0);
    });
  });

  describe('Foreign key constraints', () => {
    it('should cascade delete when issue is deleted', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      deleteIssue(db, 'issue-001');

      const feedback = getFeedbackForIssue(db, 'issue-001');
      expect(feedback).toHaveLength(0);
    });

    it('should cascade delete when spec is deleted', () => {
      const anchor: FeedbackAnchor = { anchor_status: 'valid' };

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Test',
        agent: 'claude-code',
        anchor,
      });

      deleteSpec(db, 'spec-001');

      const feedback = getFeedbackForSpec(db, 'spec-001');
      expect(feedback).toHaveLength(0);
    });
  });

  describe('Anchor JSON serialization', () => {
    it('should correctly serialize and deserialize complex anchors', () => {
      const anchor: FeedbackAnchor = {
        section_heading: 'Implementation Details',
        section_level: 3,
        line_number: 127,
        line_offset: 5,
        text_snippet: 'async function handleAuth',
        context_before: 'Authentication flow:',
        context_after: 'return tokens;',
        content_hash: 'abc123',
        anchor_status: 'relocated',
        last_verified_at: '2025-01-15T10:30:00Z',
        original_location: {
          line_number: 120,
          section_heading: 'Auth Implementation',
        },
      };

      const created = createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'comment',
        content: 'Performance concern',
        agent: 'claude-code',
        anchor,
      });

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).not.toBeNull();

      const parsedAnchor = JSON.parse(retrieved!.anchor);
      expect(parsedAnchor).toEqual(anchor);
    });
  });
});
