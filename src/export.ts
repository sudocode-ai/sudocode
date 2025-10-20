/**
 * Export SQLite data to JSONL files
 */

import type Database from 'better-sqlite3';
import type { Spec, Issue, SpecJSONL, IssueJSONL, RelationshipJSONL, FeedbackJSONL } from './types.js';
import { listSpecs } from './operations/specs.js';
import { listIssues } from './operations/issues.js';
import { getOutgoingRelationships } from './operations/relationships.js';
import { getTags } from './operations/tags.js';
import { listFeedback } from './operations/feedback.js';
import { writeJSONL } from './jsonl.js';

export interface ExportOptions {
  /**
   * Output directory for JSONL files
   */
  outputDir?: string;
  /**
   * Only export entities that have been updated since this timestamp
   */
  since?: Date;
  /**
   * Custom file names
   */
  specsFile?: string;
  issuesFile?: string;
}

/**
 * Convert a Spec to SpecJSONL format with embedded relationships and tags
 */
export function specToJSONL(
  db: Database.Database,
  spec: Spec
): SpecJSONL {
  // Get outgoing relationships
  const relationships = getOutgoingRelationships(db, spec.id, 'spec');

  // Convert to JSONL format
  const relationshipsJSONL: RelationshipJSONL[] = relationships.map((rel) => ({
    from: rel.from_id,
    to: rel.to_id,
    type: rel.relationship_type,
  }));

  // Get tags
  const tags = getTags(db, spec.id, 'spec');

  return {
    ...spec,
    relationships: relationshipsJSONL,
    tags,
  };
}

/**
 * Convert an Issue to IssueJSONL format with embedded relationships and tags
 */
export function issueToJSONL(
  db: Database.Database,
  issue: Issue
): IssueJSONL {
  // Get outgoing relationships
  const relationships = getOutgoingRelationships(db, issue.id, 'issue');

  // Convert to JSONL format
  const relationshipsJSONL: RelationshipJSONL[] = relationships.map((rel) => ({
    from: rel.from_id,
    to: rel.to_id,
    type: rel.relationship_type,
  }));

  // Get tags
  const tags = getTags(db, issue.id, 'issue');

  // Get feedback provided by this issue
  const feedbackList = listFeedback(db, { issue_id: issue.id });
  const feedbackJSONL: FeedbackJSONL[] = feedbackList.map((feedback) => ({
    id: feedback.id,
    spec_id: feedback.spec_id,
    type: feedback.feedback_type,
    content: feedback.content,
    anchor: typeof feedback.anchor === 'string' ? JSON.parse(feedback.anchor) : feedback.anchor,
    status: feedback.status,
    created_at: feedback.created_at,
  }));

  return {
    ...issue,
    relationships: relationshipsJSONL,
    tags,
    feedback: feedbackJSONL.length > 0 ? feedbackJSONL : undefined,
  };
}

/**
 * Export all specs to JSONL format
 */
export function exportSpecsToJSONL(
  db: Database.Database,
  options: ExportOptions = {}
): SpecJSONL[] {
  const { since } = options;

  // Get all specs (or only updated ones)
  const specs = listSpecs(db);

  // Filter by timestamp if requested
  const filtered = since
    ? specs.filter((spec) => new Date(spec.updated_at) > since)
    : specs;

  // Convert to JSONL format with relationships and tags
  return filtered.map((spec) => specToJSONL(db, spec));
}

/**
 * Export all issues to JSONL format
 */
export function exportIssuesToJSONL(
  db: Database.Database,
  options: ExportOptions = {}
): IssueJSONL[] {
  const { since } = options;

  // Get all issues (or only updated ones)
  const issues = listIssues(db);

  // Filter by timestamp if requested
  const filtered = since
    ? issues.filter((issue) => new Date(issue.updated_at) > since)
    : issues;

  // Convert to JSONL format with relationships and tags
  return filtered.map((issue) => issueToJSONL(db, issue));
}

/**
 * Export both specs and issues to JSONL files
 */
export async function exportToJSONL(
  db: Database.Database,
  options: ExportOptions = {}
): Promise<{ specsCount: number; issuesCount: number }> {
  const {
    outputDir = '.sudocode',
    specsFile = 'specs.jsonl',
    issuesFile = 'issues.jsonl',
  } = options;

  const specsPath = `${outputDir}/${specsFile}`;
  const issuesPath = `${outputDir}/${issuesFile}`;

  // Export specs
  const specs = exportSpecsToJSONL(db, options);
  await writeJSONL(specsPath, specs);

  // Export issues
  const issues = exportIssuesToJSONL(db, options);
  await writeJSONL(issuesPath, issues);

  return {
    specsCount: specs.length,
    issuesCount: issues.length,
  };
}

/**
 * Debouncer for export operations
 */
export class ExportDebouncer {
  private timeoutId: NodeJS.Timeout | null = null;
  private pending: boolean = false;

  constructor(
    private db: Database.Database,
    private delayMs: number = 5000,
    private options: ExportOptions = {}
  ) {}

  /**
   * Trigger an export (will be debounced)
   */
  trigger(): void {
    this.pending = true;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.execute();
    }, this.delayMs);
  }

  /**
   * Execute the export immediately
   */
  async execute(): Promise<void> {
    if (!this.pending) {
      return;
    }

    this.pending = false;
    this.timeoutId = null;

    try {
      await exportToJSONL(this.db, this.options);
    } catch (error) {
      console.error('Export failed:', error);
      throw error;
    }
  }

  /**
   * Cancel any pending export
   */
  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.pending = false;
  }

  /**
   * Check if an export is pending
   */
  isPending(): boolean {
    return this.pending;
  }

  /**
   * Wait for any pending export to complete
   */
  async flush(): Promise<void> {
    if (this.pending) {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      await this.execute();
    }
  }
}

/**
 * Create a debounced export function
 */
export function createDebouncedExport(
  db: Database.Database,
  delayMs: number = 5000,
  options: ExportOptions = {}
): ExportDebouncer {
  return new ExportDebouncer(db, delayMs, options);
}
