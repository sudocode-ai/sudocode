/**
 * Unit tests for Sessions service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../src/services/db.js';
import {
  getAllSessions,
  getSessionById,
  getSessionByClaudeSessionId,
  createNewSession,
  updateExistingSession,
  deleteExistingSession,
} from '../../src/services/sessions.js';
import type Database from 'better-sqlite3';

describe('Sessions Service', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create a fresh in-memory database for each test
    db = initDatabase({ path: ':memory:' });
  });

  describe('createNewSession', () => {
    it('should create a session with all fields', () => {
      const session = createNewSession(db, {
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
    });

    it('should create a session with minimal fields', () => {
      const session = createNewSession(db, {
        id: 'SESS-002',
        session_id: 'claude-session-xyz789',
        title: 'Minimal Session',
        agent_type: 'codex',
      });

      expect(session.id).toBe('SESS-002');
      expect(session.description).toBeNull();
      expect(session.agent_type).toBe('codex');
    });
  });

  describe('getSessionById', () => {
    it('should retrieve an existing session', () => {
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test Session',
        agent_type: 'claude-code',
      });

      const session = getSessionById(db, 'SESS-001');
      expect(session).toBeDefined();
      expect(session?.id).toBe('SESS-001');
    });

    it('should return null for non-existent session', () => {
      const session = getSessionById(db, 'SESS-999');
      expect(session).toBeNull();
    });
  });

  describe('getSessionByClaudeSessionId', () => {
    it('should retrieve session by Claude session_id', () => {
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'claude-session-unique',
        title: 'Test Session',
        agent_type: 'claude-code',
      });

      const session = getSessionByClaudeSessionId(db, 'claude-session-unique');
      expect(session).toBeDefined();
      expect(session?.id).toBe('SESS-001');
      expect(session?.session_id).toBe('claude-session-unique');
    });

    it('should return null for non-existent session_id', () => {
      const session = getSessionByClaudeSessionId(db, 'non-existent');
      expect(session).toBeNull();
    });
  });

  describe('updateExistingSession', () => {
    it('should update session title', () => {
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Original Title',
        agent_type: 'claude-code',
      });

      const updated = updateExistingSession(db, 'SESS-001', {
        title: 'New Title',
      });

      expect(updated.title).toBe('New Title');
      expect(updated.session_id).toBe('session-abc');
    });

    it('should archive session', () => {
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const updated = updateExistingSession(db, 'SESS-001', {
        archived: true,
      });

      expect(updated.archived).toBe(1);
      expect(updated.archived_at).toBeTruthy();
    });

    it('should throw error for non-existent session', () => {
      expect(() => {
        updateExistingSession(db, 'SESS-999', { title: 'New Title' });
      }).toThrow('Session not found: SESS-999');
    });
  });

  describe('deleteExistingSession', () => {
    it('should delete an existing session', () => {
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'session-abc',
        title: 'Test',
        agent_type: 'claude-code',
      });

      const deleted = deleteExistingSession(db, 'SESS-001');
      expect(deleted).toBe(true);

      const session = getSessionById(db, 'SESS-001');
      expect(session).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = deleteExistingSession(db, 'SESS-999');
      expect(deleted).toBe(false);
    });
  });

  describe('getAllSessions', () => {
    beforeEach(() => {
      // Create test sessions
      createNewSession(db, {
        id: 'SESS-001',
        session_id: 'session-1',
        title: 'Session 1',
        agent_type: 'claude-code',
      });
      createNewSession(db, {
        id: 'SESS-002',
        session_id: 'session-2',
        title: 'Session 2',
        agent_type: 'codex',
      });
      createNewSession(db, {
        id: 'SESS-003',
        session_id: 'session-3',
        title: 'Session 3',
        agent_type: 'claude-code',
        archived: true,
      });
    });

    it('should list all sessions', () => {
      const sessions = getAllSessions(db);
      expect(sessions.length).toBe(3);
    });

    it('should filter by agent_type', () => {
      const sessions = getAllSessions(db, { agent_type: 'claude-code' });
      expect(sessions.length).toBe(2);
      expect(sessions.every((s) => s.agent_type === 'claude-code')).toBe(true);
    });

    it('should filter by archived status', () => {
      const sessions = getAllSessions(db, { archived: false });
      expect(sessions.length).toBe(2);
      expect(sessions.every((s) => s.archived === 0)).toBe(true);
    });

    it('should combine filters', () => {
      const sessions = getAllSessions(db, {
        agent_type: 'claude-code',
        archived: false,
      });
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('SESS-001');
    });
  });
});
