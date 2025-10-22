/**
 * Unit tests for JSONL operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  readJSONL,
  readJSONLSync,
  writeJSONL,
  writeJSONLSync,
  updateJSONLLine,
  updateJSONLLineSync,
  deleteJSONLLine,
  deleteJSONLLineSync,
  getJSONLEntity,
  getJSONLEntitySync,
} from '../../src/jsonl.js';

const TEST_DIR = path.join(process.cwd(), 'test-temp');
const TEST_FILE = path.join(TEST_DIR, 'test.jsonl');

interface TestEntity {
  id: string;
  name: string;
  value: number;
}

describe('JSONL Operations', () => {
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('readJSONL', () => {
    it('should read JSONL file with multiple entities', async () => {
      const content = `{"id":"1","name":"First","value":100}
{"id":"2","name":"Second","value":200}
{"id":"3","name":"Third","value":300}`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      const entities = await readJSONL<TestEntity>(TEST_FILE);

      expect(entities).toHaveLength(3);
      expect(entities[0].id).toBe('1');
      expect(entities[1].name).toBe('Second');
      expect(entities[2].value).toBe(300);
    });

    it('should skip empty lines', async () => {
      const content = `{"id":"1","name":"First","value":100}

{"id":"2","name":"Second","value":200}

`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(2);
    });

    it('should return empty array for non-existent file', async () => {
      const entities = await readJSONL(path.join(TEST_DIR, 'nonexistent.jsonl'));
      expect(entities).toHaveLength(0);
    });

    it('should throw error on malformed JSON by default', async () => {
      const content = `{"id":"1","name":"First","value":100}
{invalid json}
{"id":"3","name":"Third","value":300}`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      await expect(readJSONL(TEST_FILE)).rejects.toThrow('Failed to parse JSON at line 2');
    });

    it('should skip errors when skipErrors is true', async () => {
      const content = `{"id":"1","name":"First","value":100}
{invalid json}
{"id":"3","name":"Third","value":300}`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      const entities = await readJSONL<TestEntity>(TEST_FILE, { skipErrors: true });
      expect(entities).toHaveLength(2);
      expect(entities[0].id).toBe('1');
      expect(entities[1].id).toBe('3');
    });

    it('should call onError for malformed lines', async () => {
      const content = `{"id":"1","name":"First","value":100}
{invalid json}
{"id":"3","name":"Third","value":300}`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      const errors: Array<{ lineNumber: number; line: string }> = [];
      await readJSONL(TEST_FILE, {
        skipErrors: true,
        onError: (lineNumber, line) => {
          errors.push({ lineNumber, line });
        },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].lineNumber).toBe(2);
      expect(errors[0].line).toBe('{invalid json}');
    });
  });

  describe('readJSONLSync', () => {
    it('should read JSONL file synchronously', () => {
      const content = `{"id":"1","name":"First","value":100}
{"id":"2","name":"Second","value":200}`;
      fs.writeFileSync(TEST_FILE, content, 'utf8');

      const entities = readJSONLSync<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(2);
      expect(entities[0].id).toBe('1');
    });
  });

  describe('writeJSONL', () => {
    it('should write entities to JSONL file', async () => {
      const entities: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
        { id: '3', name: 'Third', value: 300 },
      ];

      await writeJSONL(TEST_FILE, entities);

      const content = fs.readFileSync(TEST_FILE, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0])).toEqual(entities[0]);
      expect(JSON.parse(lines[1])).toEqual(entities[1]);
      expect(JSON.parse(lines[2])).toEqual(entities[2]);
    });

    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(TEST_DIR, 'nested', 'dir', 'test.jsonl');
      const entities: TestEntity[] = [{ id: '1', name: 'Test', value: 100 }];

      await writeJSONL(nestedPath, entities);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should use atomic write by default', async () => {
      const entities: TestEntity[] = [{ id: '1', name: 'Test', value: 100 }];

      await writeJSONL(TEST_FILE, entities);

      // Temp file should not exist after atomic write
      expect(fs.existsSync(`${TEST_FILE}.tmp`)).toBe(false);
      expect(fs.existsSync(TEST_FILE)).toBe(true);
    });

    it('should write empty file for empty array', async () => {
      await writeJSONL(TEST_FILE, []);

      const content = fs.readFileSync(TEST_FILE, 'utf8');
      expect(content).toBe('\n');
    });
  });

  describe('writeJSONLSync', () => {
    it('should write entities synchronously', () => {
      const entities: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
      ];

      writeJSONLSync(TEST_FILE, entities);

      const content = fs.readFileSync(TEST_FILE, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);
    });
  });

  describe('updateJSONLLine', () => {
    it('should update existing entity', async () => {
      const initial: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
        { id: '3', name: 'Third', value: 300 },
      ];

      await writeJSONL(TEST_FILE, initial);

      const updated = { id: '2', name: 'Updated', value: 999 };
      await updateJSONLLine(TEST_FILE, updated);

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(3);
      expect(entities[1]).toEqual(updated);
    });

    it('should append new entity if not found', async () => {
      const initial: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
      ];

      await writeJSONL(TEST_FILE, initial);

      const newEntity = { id: '3', name: 'New', value: 300 };
      await updateJSONLLine(TEST_FILE, newEntity);

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(3);
      expect(entities[2]).toEqual(newEntity);
    });

    it('should create file if it does not exist', async () => {
      const entity = { id: '1', name: 'First', value: 100 };
      await updateJSONLLine(TEST_FILE, entity);

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(1);
      expect(entities[0]).toEqual(entity);
    });

    it('should throw error if entity missing id field', async () => {
      const entity = { name: 'No ID', value: 100 } as any;

      await expect(updateJSONLLine(TEST_FILE, entity)).rejects.toThrow(
        'Entity missing id field'
      );
    });
  });

  describe('updateJSONLLineSync', () => {
    it('should update entity synchronously', () => {
      const initial: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
      ];

      writeJSONLSync(TEST_FILE, initial);

      const updated = { id: '1', name: 'Updated', value: 999 };
      updateJSONLLineSync(TEST_FILE, updated);

      const entities = readJSONLSync<TestEntity>(TEST_FILE);
      expect(entities[0]).toEqual(updated);
    });
  });

  describe('deleteJSONLLine', () => {
    it('should delete entity by ID', async () => {
      const initial: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
        { id: '3', name: 'Third', value: 300 },
      ];

      await writeJSONL(TEST_FILE, initial);

      const deleted = await deleteJSONLLine(TEST_FILE, '2');
      expect(deleted).toBe(true);

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(2);
      expect(entities.find((e) => e.id === '2')).toBeUndefined();
    });

    it('should return false if entity not found', async () => {
      const initial: TestEntity[] = [{ id: '1', name: 'First', value: 100 }];

      await writeJSONL(TEST_FILE, initial);

      const deleted = await deleteJSONLLine(TEST_FILE, 'nonexistent');
      expect(deleted).toBe(false);

      const entities = await readJSONL<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(1);
    });
  });

  describe('deleteJSONLLineSync', () => {
    it('should delete entity synchronously', () => {
      const initial: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
      ];

      writeJSONLSync(TEST_FILE, initial);

      const deleted = deleteJSONLLineSync(TEST_FILE, '1');
      expect(deleted).toBe(true);

      const entities = readJSONLSync<TestEntity>(TEST_FILE);
      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('2');
    });
  });

  describe('getJSONLEntity', () => {
    it('should get entity by ID', async () => {
      const entities: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
        { id: '3', name: 'Third', value: 300 },
      ];

      await writeJSONL(TEST_FILE, entities);

      const entity = await getJSONLEntity<TestEntity>(TEST_FILE, '2');
      expect(entity).not.toBeNull();
      expect(entity?.name).toBe('Second');
    });

    it('should return null if entity not found', async () => {
      const entities: TestEntity[] = [{ id: '1', name: 'First', value: 100 }];

      await writeJSONL(TEST_FILE, entities);

      const entity = await getJSONLEntity(TEST_FILE, 'nonexistent');
      expect(entity).toBeNull();
    });

    it('should return null for non-existent file', async () => {
      const entity = await getJSONLEntity(path.join(TEST_DIR, 'nonexistent.jsonl'), '1');
      expect(entity).toBeNull();
    });
  });

  describe('getJSONLEntitySync', () => {
    it('should get entity synchronously', () => {
      const entities: TestEntity[] = [
        { id: '1', name: 'First', value: 100 },
        { id: '2', name: 'Second', value: 200 },
      ];

      writeJSONLSync(TEST_FILE, entities);

      const entity = getJSONLEntitySync<TestEntity>(TEST_FILE, '1');
      expect(entity).not.toBeNull();
      expect(entity?.name).toBe('First');
    });
  });
});
