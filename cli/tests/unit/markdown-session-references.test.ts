/**
 * Unit tests for Session reference parsing in markdown
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../src/db.js';
import { extractCrossReferences } from '../../src/markdown.js';
import { createSession } from '../../src/operations/sessions.js';
import { createSpec } from '../../src/operations/specs.js';
import { createIssue } from '../../src/operations/issues.js';
import type Database from 'better-sqlite3';

describe('Session Reference Parsing', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ':memory:' });

    // Create test sessions
    createSession(db, {
      id: 'SESS-001',
      session_id: 'claude-session-abc',
      title: 'Authentication Feature',
      agent_type: 'claude-code',
    });

    createSession(db, {
      id: 'SESS-002',
      session_id: 'claude-session-xyz',
      title: 'Database Migration',
      agent_type: 'claude-code',
    });
  });

  describe('extractCrossReferences - session support', () => {
    it('should extract simple session reference', () => {
      const content = 'This relates to [[SESS-001]].';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
      expect(refs[0].match).toBe('[[SESS-001]]');
    });

    it('should extract session reference with display text', () => {
      const content = 'See [[SESS-001|Auth Session]] for details.';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
      expect(refs[0].displayText).toBe('Auth Session');
    });

    it('should extract session reference with relationship type', () => {
      const content = 'This [[SESS-001]]{ implements } the feature.';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
      expect(refs[0].relationshipType).toBe('implements');
    });

    it('should extract session reference with display text and relationship type', () => {
      const content = 'See [[SESS-001|Auth Session]]{ implements } for implementation.';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
      expect(refs[0].displayText).toBe('Auth Session');
      expect(refs[0].relationshipType).toBe('implements');
    });

    it('should extract multiple session references', () => {
      const content = 'See [[SESS-001]] and [[SESS-002]] for context.';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(2);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
      expect(refs[1].id).toBe('SESS-002');
      expect(refs[1].type).toBe('session');
    });

    it('should only extract references to existing sessions', () => {
      const content = 'References: [[SESS-001]] [[SESS-999]] [[SESS-002]]';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(2);
      expect(refs.map((r) => r.id)).toEqual(['SESS-001', 'SESS-002']);
    });

    it('should determine session type without database', () => {
      const content = 'See [[SESS-001]] for details.';
      const refs = extractCrossReferences(content); // No db parameter

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-001');
      expect(refs[0].type).toBe('session');
    });

    it('should extract mixed entity references', () => {
      const content = `
        Issue: [[i-x7k9]]
        Spec: [[s-a3f2]]
        Session: [[SESS-001]]
      `;

      // Create test spec and issue for hash-based refs
      createSpec(db, {
        id: 's-a3f2',
        title: 'Test Spec',
        file_path: 'test.md',
      });

      createIssue(db, {
        id: 'i-x7k9',
        title: 'Test Issue',
        status: 'open',
      });

      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(3);
      expect(refs.find((r) => r.type === 'issue')).toBeDefined();
      expect(refs.find((r) => r.type === 'spec')).toBeDefined();
      expect(refs.find((r) => r.type === 'session')).toBeDefined();
    });

    it('should support session IDs with more than 3 digits', () => {
      // Create session with 4-digit number
      createSession(db, {
        id: 'SESS-1234',
        session_id: 'claude-session-1234',
        title: 'Test Session 1234',
        agent_type: 'claude-code',
      });

      const content = 'See [[SESS-1234]] for details.';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('SESS-1234');
      expect(refs[0].type).toBe('session');
    });

    it('should include location anchor for session references', () => {
      const content = 'Line 1\nThis relates to [[SESS-001]].\nLine 3';
      const refs = extractCrossReferences(content, db);

      expect(refs.length).toBe(1);
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.line_number).toBe(2);
    });
  });
});
