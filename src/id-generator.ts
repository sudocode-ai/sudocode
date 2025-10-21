/**
 * ID generation utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Metadata } from './types.js';

/**
 * Generate next spec ID
 */
export function generateSpecId(outputDir: string): string {
  const meta = readMeta(outputDir);
  const id = `${meta.id_prefix.spec}-${String(meta.next_spec_id).padStart(3, '0')}`;
  meta.next_spec_id++;
  writeMeta(outputDir, meta);
  return id;
}

/**
 * Generate next issue ID
 */
export function generateIssueId(outputDir: string): string {
  const meta = readMeta(outputDir);
  const id = `${meta.id_prefix.issue}-${String(meta.next_issue_id).padStart(3, '0')}`;
  meta.next_issue_id++;
  writeMeta(outputDir, meta);
  return id;
}

/**
 * Read metadata file
 */
function readMeta(outputDir: string): Metadata {
  const metaPath = path.join(outputDir, 'meta.json');

  if (!fs.existsSync(metaPath)) {
    // Create default metadata if not exists
    const defaultMeta: Metadata = {
      version: '1.0.0',
      next_spec_id: 1,
      next_issue_id: 1,
      id_prefix: {
        spec: 'SPEC',
        issue: 'ISSUE',
      },
      last_sync: new Date().toISOString(),
      collision_log: [],
    };
    writeMeta(outputDir, defaultMeta);
    return defaultMeta;
  }

  const content = fs.readFileSync(metaPath, 'utf8');
  return JSON.parse(content) as Metadata;
}

/**
 * Write metadata file
 */
function writeMeta(outputDir: string, meta: Metadata): void {
  const metaPath = path.join(outputDir, 'meta.json');
  meta.last_sync = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Get current metadata
 */
export function getMeta(outputDir: string): Metadata {
  return readMeta(outputDir);
}

/**
 * Update metadata
 */
export function updateMeta(outputDir: string, updates: Partial<Metadata>): void {
  const meta = readMeta(outputDir);
  Object.assign(meta, updates);
  writeMeta(outputDir, meta);
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
