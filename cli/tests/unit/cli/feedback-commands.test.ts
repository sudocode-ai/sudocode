/**
 * Unit tests for feedback CLI command handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase } from '../../../src/db.js';
import {
  handleFeedbackAdd,
  handleFeedbackList,
  handleFeedbackShow,
  handleFeedbackDismiss,
  handleFeedbackStale,
  handleFeedbackRelocate,
} from '../../../src/cli/feedback-commands.js';
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

    // Create config.json
    const config = {
      version: '1.0.0',
      id_prefix: {
        spec: 'spec',
        issue: 'issue',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create test spec and issue
    const { createSpec } = await import('../../../src/operations/specs.js');
    const { createIssue } = await import('../../../src/operations/issues.js');

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
      id: 's-001',
      title: 'Test Spec',
      file_path: path.join(tempDir, 'specs', 'test.md'),
      content: specContent,
      priority: 2,
    });

    createIssue(db, {
      id: 'i-001',
      title: 'Test Issue',
      description: 'Test issue description',
      content: '',
      status: 'open',
      priority: 2,
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
        type: 'comment',
        content: 'This section needs clarification',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created feedback'),
        expect.anything()
      );

      // Verify feedback was created in database
      const { listFeedback } = await import('../../../src/operations/feedback.js');
      const feedbackList = listFeedback(db, { from_id: 'i-001' });
      expect(feedbackList.length).toBe(1);
      expect(feedbackList[0].content).toBe('This section needs clarification');
    });

    it('should create feedback with text search anchor', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        text: 'first section',
        type: 'request',
        content: 'Need more details here',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created feedback'),
        expect.anything()
      );
    });

    it('should fail when text not found', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        text: 'nonexistent text',
        type: 'comment',
        content: 'Test content',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Text not found')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should create feedback without anchor when neither line nor text specified', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: 'comment',
        content: 'General feedback without specific location',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      // Should succeed - general feedback is now allowed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Created feedback'),
        expect.anything()
      );
    });

    it('should output JSON format', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };
      const options = {
        line: '7',
        type: 'comment',
        content: 'Test content',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      const output = consoleLogSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should export to JSONL after adding feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        line: '7',
        type: 'comment',
        content: 'Feedback that should be exported',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      // Check that JSONL file was created and contains the feedback
      const jsonlPath = path.join(tempDir, 'issues.jsonl');
      expect(fs.existsSync(jsonlPath)).toBe(true);

      const jsonlContent = fs.readFileSync(jsonlPath, 'utf8');
      const issues = jsonlContent
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      const issueWithFeedback = issues.find((i: any) => i.id === 'i-001');
      expect(issueWithFeedback).toBeDefined();
      expect(issueWithFeedback.feedback).toBeDefined();
      expect(issueWithFeedback.feedback.length).toBe(1);
      expect(issueWithFeedback.feedback[0].content).toBe('Feedback that should be exported');
    });
  });

  describe('handleFeedbackList', () => {
    beforeEach(async () => {
      // Create test feedback
      const { createFeedback } = await import('../../../src/operations/feedback.js');
      const { createFeedbackAnchor } = await import('../../../src/operations/feedback-anchors.js');
      const { getSpec } = await import('../../../src/operations/specs.js');

      const spec = getSpec(db, 's-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        from_id: 'i-001',
        to_id: 's-001',
        feedback_type: 'comment',
        content: 'Feedback 1',
        agent: 'test',
        anchor,
      });

      createFeedback(db, {
        from_id: 'i-001',
        to_id: 's-001',
        feedback_type: 'request',
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
        issue: 'i-001',
        limit: '50',
      };

      await handleFeedbackList(ctx, options);

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('i-001');
    });

    it('should filter feedback by type', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        type: 'comment',
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
      const { createFeedback } = await import('../../../src/operations/feedback.js');
      const { createFeedbackAnchor } = await import('../../../src/operations/feedback-anchors.js');
      const { getSpec } = await import('../../../src/operations/specs.js');

      const spec = getSpec(db, 's-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        id: 'FB-001',
        from_id: 'i-001',
        to_id: 's-001',
        feedback_type: 'comment',
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
      expect(output).toContain('i-001');
      expect(output).toContain('s-001');
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

  describe('handleFeedbackDismiss', () => {
    beforeEach(async () => {
      const { createFeedback } = await import('../../../src/operations/feedback.js');
      const { createFeedbackAnchor } = await import('../../../src/operations/feedback-anchors.js');
      const { getSpec } = await import('../../../src/operations/specs.js');

      const spec = getSpec(db, 's-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);

      createFeedback(db, {
        id: 'FB-001',
        from_id: 'i-001',
        to_id: 's-001',
        feedback_type: 'comment',
        content: 'Test feedback',
        agent: 'test',
        anchor,
      });

      consoleLogSpy.mockClear();
    });

    it('should dismiss feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = { comment: 'Noted, will address later' };

      await handleFeedbackDismiss(ctx, 'FB-001', options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Dismissed feedback'),
        expect.anything()
      );

      const { getFeedback } = await import('../../../src/operations/feedback.js');
      const feedback = getFeedback(db, 'FB-001');
      expect(feedback?.dismissed).toBe(true);
    });

    it('should export to JSONL after dismissing feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {};

      await handleFeedbackDismiss(ctx, 'FB-001', options);

      // Check that JSONL file contains the dismissed feedback
      const jsonlPath = path.join(tempDir, 'issues.jsonl');
      expect(fs.existsSync(jsonlPath)).toBe(true);

      const jsonlContent = fs.readFileSync(jsonlPath, 'utf8');
      const issues = jsonlContent
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      const issueWithFeedback = issues.find((i: any) => i.id === 'i-001');
      expect(issueWithFeedback).toBeDefined();
      expect(issueWithFeedback.feedback).toBeDefined();
      expect(issueWithFeedback.feedback.length).toBe(1);
      expect(issueWithFeedback.feedback[0].id).toBe('FB-001');
      expect(issueWithFeedback.feedback[0].dismissed).toBe(true);
    });
  });

  describe('handleFeedbackStale', () => {
    beforeEach(async () => {
      const { createFeedback } = await import('../../../src/operations/feedback.js');
      const { createFeedbackAnchor } = await import('../../../src/operations/feedback-anchors.js');
      const { getSpec } = await import('../../../src/operations/specs.js');

      const spec = getSpec(db, 's-001');
      if (!spec) throw new Error('Spec not found');

      const anchor = createFeedbackAnchor(spec.content, 7);
      anchor.anchor_status = 'stale';

      createFeedback(db, {
        from_id: 'i-001',
        to_id: 's-001',
        feedback_type: 'comment',
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

  describe('handleFeedbackRelocate', () => {
    let createdFeedbackId: string;

    beforeEach(async () => {
      // Create feedback using handleFeedbackAdd
      const ctx = { db, outputDir: tempDir, jsonOutput: false };
      const options = {
        line: '5',
        type: 'comment',
        content: 'This needs to be fixed',
      };

      await handleFeedbackAdd(ctx, 'i-001', 's-001', options);

      // Get the ID of the created feedback
      const { listFeedback } = await import('../../../src/operations/feedback.js');
      const feedbacks = listFeedback(db, { from_id: 'i-001' });
      createdFeedbackId = feedbacks[0].id;

      consoleLogSpy.mockClear();
    });

    it('should relocate feedback to new line number', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '10' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Relocated feedback anchor'),
        expect.anything()
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('New location:')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('line 10')
      );

      // Verify feedback was updated in database
      const { getFeedback } = await import('../../../src/operations/feedback.js');
      const updated = getFeedback(db, createdFeedbackId);
      expect(updated).toBeDefined();

      const anchor = typeof updated!.anchor === 'string' ? JSON.parse(updated!.anchor) : updated!.anchor;
      expect(anchor.line_number).toBe(10);
      expect(anchor.anchor_status).toBe('relocated');
      expect(anchor.original_location).toBeDefined();
    });

    it('should preserve original location when relocating', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      // Get original anchor details
      const { getFeedback } = await import('../../../src/operations/feedback.js');
      const original = getFeedback(db, createdFeedbackId);
      const originalAnchor = typeof original!.anchor === 'string' ? JSON.parse(original!.anchor) : original!.anchor;

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '15' });

      // Verify original location is preserved
      const relocated = getFeedback(db, createdFeedbackId);
      const relocatedAnchor = typeof relocated!.anchor === 'string' ? JSON.parse(relocated!.anchor) : relocated!.anchor;

      expect(relocatedAnchor.original_location).toBeDefined();
      expect(relocatedAnchor.original_location.line_number).toBe(originalAnchor.line_number);
    });

    it('should handle non-existent feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, 'non-existent', { line: '10' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Feedback not found: non-existent')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle invalid line number', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: 'invalid' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Invalid line number')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle negative line number', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '-5' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Invalid line number')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle zero line number', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '0' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Invalid line number')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should output JSON when jsonOutput is true', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: true };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '12' });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.id).toBe(createdFeedbackId);
      expect(parsed.to_id).toBe('s-001');
      expect(parsed.from_id).toBe('i-001');

      const anchor = typeof parsed.anchor === 'string' ? JSON.parse(parsed.anchor) : parsed.anchor;
      expect(anchor.line_number).toBe(12);
      expect(anchor.anchor_status).toBe('relocated');
    });

    it('should export to JSONL after relocating feedback', async () => {
      const ctx = { db, outputDir: tempDir, jsonOutput: false };

      await handleFeedbackRelocate(ctx, createdFeedbackId, { line: '14' });

      // Check that JSONL file contains the relocated feedback
      const jsonlPath = path.join(tempDir, 'issues.jsonl');
      expect(fs.existsSync(jsonlPath)).toBe(true);

      const jsonlContent = fs.readFileSync(jsonlPath, 'utf8');
      const issues = jsonlContent
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      const issueWithFeedback = issues.find((i: any) => i.id === 'i-001');
      expect(issueWithFeedback).toBeDefined();
      expect(issueWithFeedback.feedback).toBeDefined();
      expect(issueWithFeedback.feedback.length).toBeGreaterThan(0);

      const relocatedFeedback = issueWithFeedback.feedback.find((f: any) => f.id === createdFeedbackId);
      expect(relocatedFeedback).toBeDefined();
      expect(relocatedFeedback.anchor.line_number).toBe(14);
      expect(relocatedFeedback.anchor.anchor_status).toBe('relocated');
    });
  });
});
