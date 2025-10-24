/**
 * JSONL (JSON Lines) reader and writer
 * Supports reading and writing .jsonl files for specs and issues
 */

import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";
import type { SpecJSONL, IssueJSONL } from "./types.js";

export type JSONLEntity = SpecJSONL | IssueJSONL | Record<string, any>;

export interface ReadJSONLOptions {
  /**
   * Skip malformed lines instead of throwing
   */
  skipErrors?: boolean;
  /**
   * Custom error handler for malformed lines
   */
  onError?: (lineNumber: number, line: string, error: Error) => void;
}

export interface WriteJSONLOptions {
  /**
   * Use atomic write (write to temp file, then rename)
   */
  atomic?: boolean;
}

/**
 * Read a JSONL file and parse all lines
 * Uses streaming for memory efficiency with large files
 */
export async function readJSONL<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  options: ReadJSONLOptions = {}
): Promise<T[]> {
  const { skipErrors = false, onError } = options;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const entities: T[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;

    // Skip empty lines
    if (line.trim() === "") {
      continue;
    }

    try {
      const entity = JSON.parse(line) as T;
      entities.push(entity);
    } catch (error) {
      const parseError = error as Error;

      if (onError) {
        onError(lineNumber, line, parseError);
      }

      if (!skipErrors) {
        throw new Error(
          `Failed to parse JSON at line ${lineNumber}: ${parseError.message}`
        );
      }
    }
  }

  return entities;
}

/**
 * Read a JSONL file synchronously (for smaller files)
 */
export function readJSONLSync<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  options: ReadJSONLOptions = {}
): T[] {
  const { skipErrors = false, onError } = options;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const entities: T[] = [];
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (line === "") {
      continue;
    }

    try {
      const entity = JSON.parse(line) as T;
      entities.push(entity);
    } catch (error) {
      const parseError = error as Error;

      if (onError) {
        onError(lineNumber, line, parseError);
      }

      if (!skipErrors) {
        throw new Error(
          `Failed to parse JSON at line ${lineNumber}: ${parseError.message}`
        );
      }
    }
  }

  return entities;
}

/**
 * Write entities to a JSONL file
 * Each entity is written as a single line of JSON
 * Entities are sorted by created_at date to minimize merge conflicts
 */
export async function writeJSONL<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entities: T[],
  options: WriteJSONLOptions = {}
): Promise<void> {
  const { atomic = true } = options;

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const targetPath = atomic ? `${filePath}.tmp` : filePath;

  // Sort entities by created_at date to minimize merge conflicts
  const sortedEntities = [...entities].sort((a, b) => {
    const aDate = (a as any).created_at;
    const bDate = (b as any).created_at;

    // Handle missing created_at fields - put them at the end
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;

    // Compare dates as strings (ISO 8601 format sorts lexicographically)
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  // Write each entity as a line
  const lines = sortedEntities.map((entity) => JSON.stringify(entity));
  const content = lines.join("\n") + "\n";

  fs.writeFileSync(targetPath, content, "utf8");

  // Atomic rename if requested
  if (atomic) {
    fs.renameSync(targetPath, filePath);
  }
}

/**
 * Write entities to a JSONL file synchronously
 * Entities are sorted by created_at date to minimize merge conflicts
 */
export function writeJSONLSync<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entities: T[],
  options: WriteJSONLOptions = {}
): void {
  const { atomic = true } = options;

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const targetPath = atomic ? `${filePath}.tmp` : filePath;

  // Sort entities by created_at date to minimize merge conflicts
  const sortedEntities = [...entities].sort((a, b) => {
    const aDate = (a as any).created_at;
    const bDate = (b as any).created_at;

    // Handle missing created_at fields - put them at the end
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;

    // Compare dates as strings (ISO 8601 format sorts lexicographically)
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  // Write each entity as a line
  const lines = sortedEntities.map((entity) => JSON.stringify(entity));
  const content = lines.join("\n") + "\n";

  fs.writeFileSync(targetPath, content, "utf8");

  // Atomic rename if requested
  if (atomic) {
    fs.renameSync(targetPath, filePath);
  }
}

/**
 * Update a single line in a JSONL file by entity ID
 * If the entity doesn't exist, append it
 * If it exists, replace the line
 */
export async function updateJSONLLine<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entity: T,
  idField: string = "id"
): Promise<void> {
  const entityId = (entity as any)[idField];

  if (!entityId) {
    throw new Error(`Entity missing ${idField} field`);
  }

  // Read existing entities
  const entities = await readJSONL<T>(filePath, { skipErrors: true });

  // Find and update or append
  const index = entities.findIndex((e: any) => e[idField] === entityId);

  if (index >= 0) {
    // Replace existing
    entities[index] = entity;
  } else {
    // Append new
    entities.push(entity);
  }

  // Write back
  await writeJSONL(filePath, entities);
}

/**
 * Update a single line in a JSONL file synchronously
 */
export function updateJSONLLineSync<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entity: T,
  idField: string = "id"
): void {
  const entityId = (entity as any)[idField];

  if (!entityId) {
    throw new Error(`Entity missing ${idField} field`);
  }

  // Read existing entities
  const entities = readJSONLSync<T>(filePath, { skipErrors: true });

  // Find and update or append
  const index = entities.findIndex((e: any) => e[idField] === entityId);

  if (index >= 0) {
    // Replace existing
    entities[index] = entity;
  } else {
    // Append new
    entities.push(entity);
  }

  // Write back
  writeJSONLSync(filePath, entities);
}

/**
 * Delete an entity from a JSONL file by ID
 */
export async function deleteJSONLLine<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entityId: string,
  idField: string = "id"
): Promise<boolean> {
  // Read existing entities
  const entities = await readJSONL<T>(filePath, { skipErrors: true });

  // Filter out the entity
  const initialLength = entities.length;
  const filtered = entities.filter((e: any) => e[idField] !== entityId);

  if (filtered.length === initialLength) {
    return false; // Nothing deleted
  }

  // Write back
  await writeJSONL(filePath, filtered);
  return true;
}

/**
 * Delete an entity from a JSONL file synchronously
 */
export function deleteJSONLLineSync<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entityId: string,
  idField: string = "id"
): boolean {
  // Read existing entities
  const entities = readJSONLSync<T>(filePath, { skipErrors: true });

  // Filter out the entity
  const initialLength = entities.length;
  const filtered = entities.filter((e: any) => e[idField] !== entityId);

  if (filtered.length === initialLength) {
    return false; // Nothing deleted
  }

  // Write back
  writeJSONLSync(filePath, filtered);
  return true;
}

/**
 * Get a single entity from a JSONL file by ID
 */
export async function getJSONLEntity<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entityId: string,
  idField: string = "id"
): Promise<T | null> {
  const entities = await readJSONL<T>(filePath, { skipErrors: true });
  return entities.find((e: any) => e[idField] === entityId) ?? null;
}

/**
 * Get a single entity from a JSONL file synchronously
 */
export function getJSONLEntitySync<T extends JSONLEntity = JSONLEntity>(
  filePath: string,
  entityId: string,
  idField: string = "id"
): T | null {
  const entities = readJSONLSync<T>(filePath, { skipErrors: true });
  return entities.find((e: any) => e[idField] === entityId) ?? null;
}
