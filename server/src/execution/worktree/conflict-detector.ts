/**
 * Conflict Detector
 *
 * Detects and classifies merge conflicts between branches without modifying the working tree.
 * Distinguishes between auto-resolvable JSONL conflicts and manual code conflicts.
 *
 * @module execution/worktree/conflict-detector
 */

import { GitSyncCli } from './git-sync-cli.js';

/**
 * Comprehensive conflict report
 */
export interface ConflictReport {
  hasConflicts: boolean;
  codeConflicts: CodeConflict[];
  jsonlConflicts: JSONLConflict[];
  totalFiles: number;
  summary: string;
}

/**
 * Code conflict requiring manual resolution
 */
export interface CodeConflict {
  filePath: string;
  conflictType: 'content' | 'delete' | 'rename' | 'mode';
  description: string;
  canAutoResolve: boolean;
  resolutionStrategy?: string;
}

/**
 * JSONL conflict that can be auto-resolved using merge-resolver
 */
export interface JSONLConflict {
  filePath: string;
  entityType: 'issue' | 'spec';
  conflictCount: number;
  canAutoResolve: boolean; // Always true for JSONL
}

/**
 * ConflictDetector - Detects and classifies merge conflicts
 *
 * Uses GitSyncCli to perform dry-run merge detection and classifies
 * conflicts as either auto-resolvable JSONL conflicts or manual code conflicts.
 */
export class ConflictDetector {
  private gitSync: GitSyncCli;

  constructor(repoPath: string) {
    this.gitSync = new GitSyncCli(repoPath);
  }

  /**
   * Detect all conflicts between two branches
   *
   * @param sourceBranch - Source branch to merge from
   * @param targetBranch - Target branch to merge into
   * @returns Comprehensive conflict report
   */
  detectConflicts(
    sourceBranch: string,
    targetBranch: string
  ): ConflictReport {
    // Use GitSyncCli to check for merge conflicts
    const conflictCheck = this.gitSync.checkMergeConflicts(
      sourceBranch,
      targetBranch
    );

    if (!conflictCheck.hasConflicts) {
      return {
        hasConflicts: false,
        codeConflicts: [],
        jsonlConflicts: [],
        totalFiles: 0,
        summary: 'No conflicts detected',
      };
    }

    // Classify each conflicting file
    const codeConflicts: CodeConflict[] = [];
    const jsonlConflicts: JSONLConflict[] = [];

    for (const filePath of conflictCheck.conflictingFiles) {
      if (this.isJSONLFile(filePath)) {
        jsonlConflicts.push(this.classifyJSONLConflict(filePath));
      } else {
        codeConflicts.push(this.classifyCodeConflict(filePath));
      }
    }

    const totalFiles = codeConflicts.length + jsonlConflicts.length;
    const summary = this.generateSummary(codeConflicts, jsonlConflicts);

    return {
      hasConflicts: true,
      codeConflicts,
      jsonlConflicts,
      totalFiles,
      summary,
    };
  }

  /**
   * Check if file is a JSONL file in .sudocode directory
   *
   * @param filePath - File path to check
   * @returns true if JSONL file in .sudocode/
   */
  private isJSONLFile(filePath: string): boolean {
    return (
      filePath.endsWith('.jsonl') &&
      (filePath.includes('.sudocode/') || filePath.startsWith('.sudocode/'))
    );
  }

  /**
   * Classify a JSONL conflict
   *
   * @param filePath - Path to JSONL file
   * @returns JSONL conflict object
   */
  private classifyJSONLConflict(filePath: string): JSONLConflict {
    // Determine entity type from file name
    let entityType: 'issue' | 'spec' = 'issue';

    if (filePath.includes('issues.jsonl')) {
      entityType = 'issue';
    } else if (filePath.includes('specs.jsonl')) {
      entityType = 'spec';
    }

    return {
      filePath,
      entityType,
      conflictCount: 1, // We don't have line-level detail from merge-tree
      canAutoResolve: true, // JSONL conflicts are always auto-resolvable
    };
  }

  /**
   * Classify a code conflict
   *
   * @param filePath - Path to conflicting file
   * @returns Code conflict object
   */
  private classifyCodeConflict(filePath: string): CodeConflict {
    // Default to content conflict (most common)
    // More sophisticated detection would require deeper merge-tree parsing
    // to distinguish between delete, rename, and mode conflicts
    return {
      filePath,
      conflictType: 'content',
      description: 'Both branches modified the same lines',
      canAutoResolve: false, // Code conflicts require manual resolution
      resolutionStrategy: 'Manually review and merge changes, or choose one version',
    };
  }

  /**
   * Generate human-readable summary of conflicts
   *
   * @param codeConflicts - List of code conflicts
   * @param jsonlConflicts - List of JSONL conflicts
   * @returns Summary string
   */
  private generateSummary(
    codeConflicts: CodeConflict[],
    jsonlConflicts: JSONLConflict[]
  ): string {
    const parts: string[] = [];

    if (jsonlConflicts.length > 0) {
      parts.push(
        `${jsonlConflicts.length} JSONL conflict${jsonlConflicts.length > 1 ? 's' : ''} (auto-resolvable)`
      );
    }

    if (codeConflicts.length > 0) {
      parts.push(
        `${codeConflicts.length} code conflict${codeConflicts.length > 1 ? 's' : ''} (manual resolution required)`
      );
    }

    return parts.join(', ');
  }
}
