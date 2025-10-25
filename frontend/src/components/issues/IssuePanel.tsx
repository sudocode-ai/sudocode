import { useState } from 'react';
import type { Issue } from '@sudocode/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IssueEditor } from './IssueEditor';
import { DeleteIssueDialog } from './DeleteIssueDialog';

interface IssuePanelProps {
  issue: Issue;
  onClose?: () => void;
  onUpdate?: (data: Partial<Issue>) => void;
  onDelete?: () => void;
  isUpdating?: boolean;
  isDeleting?: boolean;
}

const priorityLabels: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
};

const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  needs_review: 'Needs Review',
  closed: 'Closed',
};

export function IssuePanel({
  issue,
  onClose,
  onUpdate,
  onDelete,
  isUpdating = false,
  isDeleting = false,
}: IssuePanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleUpdate = (data: Partial<Issue>) => {
    onUpdate?.(data);
    setIsEditing(false);
  };

  const handleDelete = () => {
    onDelete?.();
    setShowDeleteDialog(false);
  };

  if (isEditing) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Edit Issue</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueEditor
              issue={issue}
              onSave={handleUpdate}
              onCancel={() => setIsEditing(false)}
              isLoading={isUpdating}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle>{issue.title}</CardTitle>
              <div className="mt-2 text-sm text-muted-foreground">
                {issue.id}
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Status
              </div>
              <div className="text-sm">
                {statusLabels[issue.status] || issue.status}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Priority
              </div>
              <div className="text-sm">
                {priorityLabels[issue.priority] || issue.priority}
              </div>
            </div>
          </div>

          {/* Description */}
          {issue.description && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Description
              </div>
              <div className="text-sm whitespace-pre-wrap">
                {issue.description}
              </div>
            </div>
          )}

          {/* Content */}
          {issue.content && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Details
              </div>
              <div className="text-sm whitespace-pre-wrap prose prose-sm max-w-none">
                {issue.content}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="border-t pt-4 space-y-2">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Created:</span>{' '}
              {new Date(issue.created_at).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Updated:</span>{' '}
              {new Date(issue.updated_at).toLocaleString()}
            </div>
            {issue.closed_at && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Closed:</span>{' '}
                {new Date(issue.closed_at).toLocaleString()}
              </div>
            )}
          </div>

          {/* Assignee */}
          {issue.assignee && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Assignee
              </div>
              <div className="text-sm">{issue.assignee}</div>
            </div>
          )}

          {/* Parent */}
          {issue.parent_id && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Parent Issue
              </div>
              <div className="text-sm">{issue.parent_id}</div>
            </div>
          )}

          {/* Actions */}
          {(onUpdate || onDelete) && (
            <div className="border-t pt-4 flex gap-2">
              {onUpdate && (
                <Button
                  onClick={() => setIsEditing(true)}
                  variant="default"
                  disabled={isUpdating || isDeleting}
                >
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="destructive"
                  disabled={isUpdating || isDeleting}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteIssueDialog
        issue={issue}
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}

export default IssuePanel;
