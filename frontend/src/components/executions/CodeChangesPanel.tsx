/**
 * CodeChangesPanel Component
 *
 * Displays code changes (file list + diff statistics) for an execution.
 * Supports both committed and uncommitted changes.
 *
 * @module components/executions/CodeChangesPanel
 */

import { useExecutionChanges } from '@/hooks/useExecutionChanges';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Plus, Minus, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { FileChangeStat } from '@/types/execution';

interface CodeChangesPanelProps {
  executionId: string;
}

/**
 * Get user-friendly message for unavailability reason
 */
function getReasonMessage(reason?: string): string {
  switch (reason) {
    case 'missing_commits':
      return 'Commit information not captured';
    case 'commits_not_found':
      return 'Commits no longer exist in repository';
    case 'incomplete_execution':
      return 'Execution did not complete successfully';
    case 'git_error':
      return 'Git operation failed';
    case 'worktree_deleted_with_uncommitted_changes':
      return 'Worktree was deleted before changes were committed';
    case 'branch_deleted':
      return 'Branch no longer exists, showing captured state';
    default:
      return 'Unknown reason';
  }
}

/**
 * Get status badge color and label
 */
function getStatusBadge(status: 'A' | 'M' | 'D' | 'R') {
  switch (status) {
    case 'A':
      return { variant: 'default' as const, label: 'Added', color: 'text-green-600' };
    case 'M':
      return { variant: 'secondary' as const, label: 'Modified', color: 'text-blue-600' };
    case 'D':
      return { variant: 'destructive' as const, label: 'Deleted', color: 'text-red-600' };
    case 'R':
      return { variant: 'outline' as const, label: 'Renamed', color: 'text-purple-600' };
  }
}

/**
 * File change row component
 */
function FileChangeRow({ file }: { file: FileChangeStat }) {
  const statusBadge = getStatusBadge(file.status);

  return (
    <div className="flex items-center justify-between py-2 px-3 hover:bg-muted/50 rounded-md transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Badge variant={statusBadge.variant} className="shrink-0 w-[70px] justify-center">
          {statusBadge.label}
        </Badge>
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-mono truncate" title={file.path}>
          {file.path}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs font-mono shrink-0">
        {file.additions > 0 && (
          <span className="text-green-600 flex items-center gap-1">
            <Plus className="h-3 w-3" />
            {file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-red-600 flex items-center gap-1">
            <Minus className="h-3 w-3" />
            {file.deletions}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Code changes panel component
 */
export function CodeChangesPanel({ executionId }: CodeChangesPanelProps) {
  const { data, loading, error, refresh } = useExecutionChanges(executionId);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading code changes...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to load changes: {error.message}</span>
        </div>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  if (!data.available) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>Changes unavailable: {getReasonMessage(data.reason)}</span>
        </div>
      </Card>
    );
  }

  // Use current state if available, otherwise use captured state
  const snapshot = data.current || data.captured;
  if (!snapshot) {
    return null;
  }

  const { files, summary } = snapshot;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">Code Changes</h3>
            {snapshot.uncommitted && (
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                Uncommitted
              </Badge>
            )}
            {data.current && data.additionalCommits && data.additionalCommits > 0 && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                +{data.additionalCommits} commit{data.additionalCommits !== 1 ? 's' : ''} since completion
              </Badge>
            )}
            {data.branchName && data.branchExists === false && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                Branch deleted
              </Badge>
            )}
            {data.worktreeExists === false && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                Worktree deleted
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {summary.totalFiles} {summary.totalFiles === 1 ? 'file' : 'files'} changed
            </span>
            {summary.totalAdditions > 0 && (
              <span className="text-green-600 font-mono">+{summary.totalAdditions}</span>
            )}
            {summary.totalDeletions > 0 && (
              <span className="text-red-600 font-mono">-{summary.totalDeletions}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="h-8 w-8 p-0"
              title="Refresh changes"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        {/* Show current state info */}
        {data.current && (
          <div className="mt-2 text-xs text-muted-foreground">
            Showing current state of branch: <span className="font-mono">{data.branchName}</span>
          </div>
        )}
      </div>

      {/* File list */}
      {files.length > 0 ? (
        <div className="divide-y">
          {files.map((file) => (
            <FileChangeRow key={file.path} file={file} />
          ))}
        </div>
      ) : (
        <div className="p-6 text-center text-muted-foreground">
          No file changes detected
        </div>
      )}

      {/* Uncommitted warning */}
      {snapshot.uncommitted && files.length > 0 && (
        <div className="px-6 py-3 border-t bg-yellow-50/50 text-sm text-yellow-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              These changes were not committed. They may be lost if the worktree was deleted.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
