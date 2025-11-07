/**
 * Unit tests for Session operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../../src/db.js';
import {
  createSession,
  getSession,
  getSessionBySessionId,
  updateSession,
  deleteSession,
  listSessions,
  searchSessions,
} from '../../../src/operations/sessions.js';
import type Database from 'better-sqlite3';

describe('Session Operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ':memory:' });
  });

  describe('createSession', () => {
    it('should create a session with all fields', () => {
      const session = createSession(db, {
        id: 'SESS-001',
        session_id: 'claude-session-abc123',
        title: 'Test Session',
        description: 'A test session description',
        agent_type: 'claude-code',
      });

      expect(session.id).toBe('SESS-001');
      expect(session.session_id).toBe('claude-session-abc123');
      expect(session.title).toBe('Test Session');
      expect(session.description).toBe('A test session description');
      expect(session.agent_type).toBe('claude-code');
      expect(session.archived).toBe(0);
    });

    it('should create a session with minimal fields', () => {
      const session = createSession(db, {
        id: 'SESS-002',
        session_id: 'claude-session-xyz789',
        title: 'Minimal Session',
        agent_type: 'codex',
      });

      expect(session.id).toBe('SESS-002');
      expect(session.description).toBeNull();
      expect(session.agent_type).toBe('codex');
    });

    it('should upsert on duplicate ID (idempotent import)', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'First',
        agent_type: 'claude-code',
      });

      // Second call with same ID should update, not error (UPSERT behavior)
      const updated = createSession(db, {
        id: 'SESS-001',
        session_id: 'session-xyz',
        title: 'Updated Title',
        agent_type: 'codex',
      });

      expect(updated).toBeDefined();
      expect(updated.title).toBe('Updated Title');
      expect(updated.session_id).toBe('session-xyz');

      // Verify only one session exists
      const allSessions = listSessions(db);
      expect(allSessions.length).toBe(1);
    });

    it('should enforce unique session_id constraint', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-duplicate',
        title: 'First',
        agent_type: 'claude-code',
      });

      expect(() => {
        createSession(db, {
          id: 'SESS-002',
          session_id: 'session-duplicate',
          title: 'Second',
          agent_type: 'claude-code',
        });
      }).toThrow();
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test Session',
        agent_type: 'claude-code',
      });

      const session = getSession(db, 'SESS-001');
      expect(session).toBeDefined();
      expect(session?.id).toBe('SESS-001');
    });

    it('should return null for non-existent session', () => {
      const session = getSession(db, 'SESS-999');
      expect(session).toBeNull();
    });
  });

  describe('getSessionBySessionId', () => {
    it('should retrieve session by Claude session_id', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'claude-session-unique',
        title: 'Test Session',
        agent_type: 'claude-code',
      });

      const session = getSessionBySessionId(db, 'claude-session-unique');
      expect(session).toBeDefined();
      expect(session?.id).toBe('SESS-001');
      expect(session?.session_id).toBe('claude-session-unique');
    });

    it('should return null for non-existent session_id', () => {
      const session = getSessionBySessionId(db, 'non-existent');
      expect(session).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update session title', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Original Title',
        agent_type: 'claude-code',
      });

      const updated = updateSession(db, 'SESS-001', {
        title: 'New Title',
      });

      expect(updated.title).toBe('New Title');
      expect(updated.session_id).toBe('session-abc');
    });

    it('should update session description', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const updated = updateSession(db, 'SESS-001', {
        description: 'New description',
      });

      expect(updated.description).toBe('New description');
    });

    it('should archive session', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const updated = updateSession(db, 'SESS-001', {
        archived: true,
      });

      expect(updated.archived).toBe(1);
      expect(updated.archived_at).toBeTruthy();
    });

    it('should unarchive session', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
        archived: true,
        archived_at: new Date().toISOString(),
      });

      const updated = updateSession(db, 'SESS-001', {
        archived: false,
      });

      expect(updated.archived).toBe(0);
      expect(updated.archived_at).toBeNull();
    });

    it('should throw error for non-existent session', () => {
      expect(() => {
        updateSession(db, 'SESS-999', { title: 'New Title' });
      }).toThrow('Session not found: SESS-999');
    });

    it('should return unchanged session when no updates provided', () => {
      const original = createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const updated = updateSession(db, 'SESS-001', {});

      expect(updated.title).toBe(original.title);
      expect(updated.updated_at).toBe(original.updated_at);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const deleted = deleteSession(db, 'SESS-001');
      expect(deleted).toBe(true);

      const session = getSession(db, 'SESS-001');
      expect(session).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = deleteSession(db, 'SESS-999');
      expect(deleted).toBe(false);
    });
  });

  describe('listSessions', () => {
    beforeEach(() => {
      // Create test sessions
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-1',
        title: 'Session 1',
        agent_type: 'claude-code',
      });
      createSession(db, {
        id: 'SESS-002',
        session_id: 'session-2',
        title: 'Session 2',
        agent_type: 'codex',
      });
      createSession(db, {
        id: 'SESS-003',
        session_id: 'session-3',
        title: 'Session 3',
        agent_type: 'claude-code',
        archived: true,
      });
    });

    it('should list all sessions', () => {
      const sessions = listSessions(db);
      expect(sessions.length).toBe(3);
    });

    it('should filter by agent_type', () => {
      const sessions = listSessions(db, { agent_type: 'claude-code' });
      expect(sessions.length).toBe(2);
      expect(sessions.every((s) => s.agent_type === 'claude-code')).toBe(true);
    });

    it('should filter by archived status', () => {
      const sessions = listSessions(db, { archived: false });
      expect(sessions.length).toBe(2);
      expect(sessions.every((s) => s.archived === 0)).toBe(true);
    });

    it('should combine filters', () => {
      const sessions = listSessions(db, {
        agent_type: 'claude-code',
        archived: false,
      });
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('SESS-001');
    });

    it('should respect limit and offset', () => {
      const page1 = listSessions(db, { limit: 2 });
      expect(page1.length).toBe(2);

      const page2 = listSessions(db, { limit: 2, offset: 2 });
      expect(page2.length).toBe(1);
    });

    it('should order by created_at DESC', () => {
      const sessions = listSessions(db);
      // SESS-003 was created last, so should be first
      expect(sessions[0].id).toBe('SESS-003');
    });
  });

  describe('searchSessions', () => {
    beforeEach(() => {
      createSession(db, {
        id: 'SESS-001',
        session_id: 'session-1',
        title: 'Authentication Feature',
        description: 'Working on auth implementation',
        agent_type: 'claude-code',
      });
      createSession(db, {
        id: 'SESS-002',
        session_id: 'session-2',
        title: 'Database Migration',
        description: 'Migrating to PostgreSQL',
        agent_type: 'claude-code',
      });
      createSession(db, {
        id: 'SESS-003',
        session_id: 'session-3',
        title: 'UI Refactoring',
        description: 'Refactoring authentication UI',
        agent_type: 'codex',
      });
    });

    it('should search by title', () => {
      const results = searchSessions(db, 'Authentication Feature');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('SESS-001');
    });

    it('should search by description', () => {
      const results = searchSessions(db, 'PostgreSQL');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('SESS-002');
    });

    it('should be case-insensitive', () => {
      const results = searchSessions(db, 'authentication');
      expect(results.length).toBe(2);
    });

    it('should search with partial match', () => {
      const results = searchSessions(db, 'auth');
      expect(results.length).toBe(2);
    });

    it('should filter search results by agent_type', () => {
      const results = searchSessions(db, 'auth', { agent_type: 'claude-code' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('SESS-001');
    });

    it('should respect limit', () => {
      const results = searchSessions(db, 'Feature', { limit: 1 });
      expect(results.length).toBe(1);
    });

    it('should default to limit 50', () => {
      // Create 60 sessions with matching search term
      for (let i = 4; i <= 63; i++) {
        createSession(db, {
          id: `SESS-${String(i).padStart(3, '0')}`,
          session_id: `session-${i}`,
          title: `Test Session ${i}`,
          agent_type: 'claude-code',
        });
      }

      const results = searchSessions(db, 'Test Session');
      expect(results.length).toBe(50);
    });
  });
});
