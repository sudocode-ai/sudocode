/**
 * Tests for execution_mode in config field
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase as initCliDatabase } from '@sudocode-ai/cli/dist/db.js';
import { initDatabase as initServerDatabase } from '../../../src/services/db.js';
import type { ExecutionConfig } from '../../../src/services/execution-service.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('Execution Mode Config', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    // Create temp database file
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-test-'));
    dbPath = path.join(tempDir, 'test.db');

    // Initialize CLI tables first (issues, specs, etc.)
    db = initCliDatabase({ path: dbPath });

    // Then initialize server tables (executions, etc.)
    initServerDatabase({ path: dbPath });
  });

  afterEach(() => {
    db.close();
    // Clean up temp directory and all files (including WAL files)
    const tempDir = path.dirname(dbPath);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Schema Structure', () => {
    it('should have config column in executions table', () => {
      const result = db.prepare(`
        SELECT name FROM pragma_table_info('executions')
        WHERE name = 'config'
      `).get();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'config');
    });
  });

  describe('Config Field Storage', () => {
    it('should store execution_mode in config JSON', () => {
      const executionId = 'test-exec-1';
      const config: ExecutionConfig = {
        execution_mode: 'structured',
        terminal_enabled: false,
      };

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string };

      const parsedConfig: ExecutionConfig = JSON.parse(result.config);
      expect(parsedConfig.execution_mode).toBe('structured');
      expect(parsedConfig.terminal_enabled).toBe(false);
    });

    it('should handle null config gracefully', () => {
      const executionId = 'test-exec-2';

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code');

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string | null };

      expect(result.config).toBeNull();
    });
  });

  describe('Execution Mode Values', () => {
    it('should store all valid execution_mode values in config', () => {
      const modes: Array<'structured' | 'interactive' | 'hybrid'> = ['structured', 'interactive', 'hybrid'];

      modes.forEach((mode, index) => {
        const executionId = `test-exec-${index}`;
        const config: ExecutionConfig = {
          execution_mode: mode,
          terminal_enabled: mode !== 'structured',
        };

        db.prepare(`
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type, config
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

        const result = db.prepare(`
          SELECT config FROM executions WHERE id = ?
        `).get(executionId) as { config: string };

        const parsedConfig: ExecutionConfig = JSON.parse(result.config);
        expect(parsedConfig.execution_mode).toBe(mode);
      });
    });

    it('should store terminal_enabled boolean values in config', () => {
      const values = [true, false];

      values.forEach((value, index) => {
        const executionId = `test-exec-terminal-${index}`;
        const config: ExecutionConfig = {
          execution_mode: 'hybrid',
          terminal_enabled: value,
        };

        db.prepare(`
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type, config
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

        const result = db.prepare(`
          SELECT config FROM executions WHERE id = ?
        `).get(executionId) as { config: string };

        const parsedConfig: ExecutionConfig = JSON.parse(result.config);
        expect(parsedConfig.terminal_enabled).toBe(value);
      });
    });
  });

  describe('Data Operations', () => {
    it('should be able to query executions and parse config', () => {
      // Create executions with different modes
      const configs = [
        { execution_mode: 'structured' as const, terminal_enabled: false },
        { execution_mode: 'interactive' as const, terminal_enabled: true },
        { execution_mode: 'hybrid' as const, terminal_enabled: true },
      ];

      configs.forEach((config, index) => {
        db.prepare(`
          INSERT INTO executions (
            id, target_branch, branch_name, status, agent_type, config
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(`exec-${index + 1}`, 'main', `test-${index + 1}`, 'pending', 'claude-code', JSON.stringify(config));
      });

      // Query all executions
      const allExecutions = db.prepare(`
        SELECT id, config FROM executions
      `).all() as Array<{ id: string; config: string }>;

      expect(allExecutions).toHaveLength(3);

      // Filter for interactive mode in application code
      const interactiveExecutions = allExecutions.filter(exec => {
        const config: ExecutionConfig = JSON.parse(exec.config);
        return config.execution_mode === 'interactive';
      });

      expect(interactiveExecutions).toHaveLength(1);
      expect(interactiveExecutions[0].id).toBe('exec-2');
    });

    it('should be able to update config', () => {
      const executionId = 'test-exec-update';
      const initialConfig: ExecutionConfig = {
        execution_mode: 'structured',
        terminal_enabled: false,
      };

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(initialConfig));

      // Update config
      const updatedConfig: ExecutionConfig = {
        execution_mode: 'interactive',
        terminal_enabled: true,
      };

      db.prepare(`
        UPDATE executions SET config = ? WHERE id = ?
      `).run(JSON.stringify(updatedConfig), executionId);

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string };

      const parsedConfig: ExecutionConfig = JSON.parse(result.config);
      expect(parsedConfig.execution_mode).toBe('interactive');
      expect(parsedConfig.terminal_enabled).toBe(true);
    });

    it('should preserve additional config fields', () => {
      const executionId = 'test-exec-additional';
      const config: ExecutionConfig = {
        execution_mode: 'hybrid',
        terminal_enabled: true,
        baseBranch: 'develop',
        customField: 'custom value',
      };

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string };

      const parsedConfig: ExecutionConfig = JSON.parse(result.config);
      expect(parsedConfig.execution_mode).toBe('hybrid');
      expect(parsedConfig.terminal_enabled).toBe(true);
      expect(parsedConfig.baseBranch).toBe('develop');
      expect(parsedConfig.customField).toBe('custom value');
    });
  });

  describe('Config JSON Features', () => {
    it('should store complete execution configuration', () => {
      const executionId = 'test-exec-complete';
      const config: ExecutionConfig = {
        execution_mode: 'hybrid',
        terminal_enabled: true,
        baseBranch: 'main',
      };

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string };

      const parsedConfig: ExecutionConfig = JSON.parse(result.config);
      expect(parsedConfig.execution_mode).toBe('hybrid');
      expect(parsedConfig.terminal_enabled).toBe(true);
      expect(parsedConfig.baseBranch).toBe('main');
    });

    it('should handle empty config object', () => {
      const executionId = 'test-exec-empty';
      const config: ExecutionConfig = {};

      db.prepare(`
        INSERT INTO executions (
          id, target_branch, branch_name, status, agent_type, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(executionId, 'main', 'test-branch', 'pending', 'claude-code', JSON.stringify(config));

      const result = db.prepare(`
        SELECT config FROM executions WHERE id = ?
      `).get(executionId) as { config: string };

      const parsedConfig: ExecutionConfig = JSON.parse(result.config);
      expect(parsedConfig.execution_mode).toBeUndefined();
      expect(parsedConfig.terminal_enabled).toBeUndefined();
    });
  });
});
