import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IssueEditor } from './IssueEditor';
import type { Issue, IssueStatus } from '@sudocode/types';

interface CreateIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: Partial<Issue>) => void;
  isCreating?: boolean;
  defaultStatus?: IssueStatus;
}

export function CreateIssueDialog({
  isOpen,
  onClose,
  onCreate,
  isCreating = false,
  defaultStatus,
}: CreateIssueDialogProps) {
  const [hasChanges, setHasChanges] = useState(false);

  const handleSave = (data: Partial<Issue>) => {
    onCreate(data);
    setHasChanges(false);
  };

  const handleCancel = () => {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close?'
      );
      if (!confirmed) return;
    }
    setHasChanges(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Issue</DialogTitle>
        </DialogHeader>
        <IssueEditor
          issue={
            defaultStatus
              ? ({ status: defaultStatus, priority: 2 } as Issue)
              : null
          }
          onSave={handleSave}
          onCancel={handleCancel}
          isLoading={isCreating}
        />
      </DialogContent>
    </Dialog>
  );
}
