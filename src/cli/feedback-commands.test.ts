/**
 * Unit tests for feedback CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase } from '../db.js';
import {
  handleFeedbackAdd,
  handleFeedbackList,
  handleFeedbackShow,
  handleFeedbackAcknowledge,
  handleFeedbackResolve,
  handleFeedbackStale,
} from './feedback-commands.js';
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Feedback CLI Commands', () => {
  let db: Database.Database;
  let tempDir: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(async () => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ':memory:' });

    // Create temporary directory for files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudograph-test-'));

    // Create necessary subdirectories
    fs.mkdirSync(path.join(tempDir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'issues'), { recursive: true });

    // Create empty JSONL files
    fs.writeFileSync(path.join(tempDir, 'specs', 'specs.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'issues', 'issues.jsonl'), '', 'utf8');

    // Create meta.json
    const meta = {
      version: '1.0.0',
      next_spec_id: 1,
      next_issue_id: 1,
      id_prefix: {
        spec: 'spec',
        issue: 'issue',
      },
      last_sync: new Date().toISOString(),
      collision_log: [],
    };
    fs.writeFileSync(
      path.join(tempDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );

    // Create test spec and issue
    const { createSpec } = await import('../operations/specs.js');
    const { createIssue } = await import('../operations/issues.js');

    const specContent = `# Test Spec

This is a test specification.

## Section One

This is the first section with some content.

### Subsection

More detailed content here.

## Section Two

This is the second section.
`;

    createSpec(db, {
      id: 'spec-001',
      title: 'Test Spec',
      file_path: path.join(tempDir, 'specs', 'test.md'),
      content: specContent,
      priority: 2,
      created_by: 'test',
    });

    createIssue(db, {
      id: 'issue-001',
      title: 'Test Issue',
      description: 'Test issue description',
      content: '',
      status: 'open',
      priority: 2,
      created_by: 'test',
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    // Restore spies
    consoleLogSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
    processExitSpy?.mockRestore();

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('handleFeedbackAdd', () => {
    it('should create feedback with line number anchor', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        line: '7',
        type: 'ambiguity',
        content: 'This section needs clarification',
      };

      await handleFeedbackAdd(ctx, 'issue-001', 'spec-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created feedback'),
        expect.anything()
      );

      // Verify feedback was created in database
      const { listFeedback } = await import('../operations/feedback.js');
      const feedbackList = listFeedback(db, { issue_id: 'issue-001' });
      expect(feedbackList.length).toBe(1);
      expect(feedbackList[0].content).toBe('This section needs clarification');
    });

    it('should create feedback with text search anchor', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        text: 'first section',
        type: 'missing_requirement',
        content: 'Need more details here',
      };

      await handleFeedbackAdd(ctx, 'issue-001', 'spec-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created feedback'),
        expect.anything()
      );
    });

    it('should fail when text not found', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        text: 'nonexistent text',
        type: 'ambiguity',
        content: 'Test content',
      };

      await handleFeedbackAdd(ctx, 'issue-001', 'spec-001', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Text not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should fail when neither line nor text specified', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: 'ambiguity',
        content: 'Test content',
      };

      await handleFeedbackAdd(ctx, 'issue-001', 'spec-001', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Either --line or --text must be specified')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should output JSON format', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = {
        line: '7',
        type: 'ambiguity',
        content: 'Test content',
      };

      await handleFeedbackAdd(ctx, 'issue-001', 'spec-001', options);

      const output = consoleLogSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('handleFeedbackList', () => {
    beforeEach(async () => {
      // Create test feedback
      const { createFeedback } = await import('../operations/feedback.js');
      const { createFeedbackAnchor } = await import('../operations/feedback-anchors.js');
      const { getSpec } = await import('../operations/specs.js');

      const spec = getSpec(db, 'spec-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'ambiguity',
        content: 'Feedback 1',
        agent: 'test',
        anchor,
      });

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'missing_requirement',
        content: 'Feedback 2',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should list all feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = { limit: '50' };

      await handleFeedbackList(ctx, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 feedback item(s)')
      );
    });

    it('should filter feedback by issue', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        issue: 'issue-001',
        limit: '50',
      };

      await handleFeedbackList(ctx, options);

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('issue-001');
    });

    it('should filter feedback by type', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: 'ambiguity',
        limit: '50',
      };

      await handleFeedbackList(ctx, options);

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Feedback 1');
      expect(output).not.toContain('Feedback 2');
    });

    it('should output JSON format', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = { limit: '50' };

      await handleFeedbackList(ctx, options);

      const output = consoleLogSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should handle empty results', async () => {
      const emptyDb = initDatabase({ path: ':memory:' });
      const ctx = { db: emptyDb, outputDir: tempDir, jsonOutput: false };
      const options = { limit: '50' };

      await handleFeedbackList(ctx, options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No feedback found')
      );
    });
  });

  describe('handleFeedbackShow', () => {
    beforeEach(async () => {
      // Create test feedback
      const { createFeedback } = await import('../operations/feedback.js');
      const { createFeedbackAnchor } = await import('../operations/feedback-anchors.js');
      const { getSpec } = await import('../operations/specs.js');

      const spec = getSpec(db, 'spec-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        id: 'FB-001',
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'ambiguity',
        content: 'Test feedback content',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should show feedback details', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackShow(ctx, 'FB-001');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('FB-001');
      expect(output).toContain('Test feedback content');
      expect(output).toContain('issue-001');
      expect(output).toContain('spec-001');
    });

    it('should output JSON format', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleFeedbackShow(ctx, 'FB-001');

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe('FB-001');
    });

    it('should handle non-existent feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackShow(ctx, 'FB-999');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Feedback not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('handleFeedbackAcknowledge', () => {
    beforeEach(async () => {
      const { createFeedback } = await import('../operations/feedback.js');
      const { createFeedbackAnchor } = await import('../operations/feedback-anchors.js');
      const { getSpec } = await import('../operations/specs.js');

      const spec = getSpec(db, 'spec-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        id: 'FB-001',
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'ambiguity',
        content: 'Test feedback',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should acknowledge feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackAcknowledge(ctx, 'FB-001');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Acknowledged feedback'),
        expect.anything()
      );

      const { getFeedback } = await import('../operations/feedback.js');
      const feedback = getFeedback(db, 'FB-001');
      expect(feedback?.status).toBe('acknowledged');
    });
  });

  describe('handleFeedbackResolve', () => {
    beforeEach(async () => {
      const { createFeedback } = await import('../operations/feedback.js');
      const { createFeedbackAnchor } = await import('../operations/feedback-anchors.js');
      const { getSpec } = await import('../operations/specs.js');

      const spec = getSpec(db, 'spec-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        id: 'FB-001',
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'ambiguity',
        content: 'Test feedback',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should resolve feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = { comment: 'Fixed the issue' };

      await handleFeedbackResolve(ctx, 'FB-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Resolved feedback'),
        expect.anything()
      );

      const { getFeedback } = await import('../operations/feedback.js');
      const feedback = getFeedback(db, 'FB-001');
      expect(feedback?.status).toBe('resolved');
      expect(feedback?.resolution).toBe('Fixed the issue');
    });
  });

  describe('handleFeedbackStale', () => {
    beforeEach(async () => {
      const { createFeedback } = await import('../operations/feedback.js');
      const { createFeedbackAnchor } = await import('../operations/feedback-anchors.js');
      const { getSpec } = await import('../operations/specs.js');

      const spec = getSpec(db, 'spec-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);
      anchor.anchor_status = 'stale';

      createFeedback(db, {
        issue_id: 'issue-001',
        spec_id: 'spec-001',
        feedback_type: 'ambiguity',
        content: 'Stale feedback',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should list stale anchors', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackStale(ctx);

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Found 1 stale anchor(s)');
      expect(output).toContain('[stale]');
    });

    it('should handle no stale anchors', async () => {
      // Create a database with no stale anchors
      const emptyDb = initDatabase({ path: ':memory:' });
      const ctx = { db: emptyDb, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackStale(ctx);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ No stale anchors found')
      );
    });
  });
});
