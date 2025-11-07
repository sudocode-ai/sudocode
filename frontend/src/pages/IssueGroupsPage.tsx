import { useState } from 'react'
import { useIssueGroups } from '@/hooks/useIssueGroups'
import { GroupCard } from '@/components/groups/GroupCard'
import { CreateGroupModal } from '@/components/groups/CreateGroupModal'
import { EditGroupModal } from '@/components/groups/EditGroupModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Search, Loader2 } from 'lucide-react'
import type { IssueGroup, CreateIssueGroupRequest, UpdateIssueGroupRequest } from '@/types/api'

type StatusFilter = 'all' | 'active' | 'paused' | 'completed'

export default function IssueGroupsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<IssueGroup | null>(null)
  const [pausingGroup, setPausingGroup] = useState<IssueGroup | null>(null)
  const [pauseReason, setPauseReason] = useState('')
  const [completingGroup, setCompletingGroup] = useState<IssueGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<IssueGroup | null>(null)

  const {
    groups,
    isLoading,
    isError,
    error,
    createGroup,
    updateGroup,
    deleteGroup,
    pauseGroup,
    resumeGroup,
    completeGroup,
    isCreating,
    isUpdating,
    isDeleting,
  } = useIssueGroups(statusFilter === 'all' ? undefined : statusFilter)

  // Filter groups by search text
  const filteredGroups = searchText
    ? groups.filter(
        (group) =>
          group.name.toLowerCase().includes(searchText.toLowerCase()) ||
          group.description?.toLowerCase().includes(searchText.toLowerCase()) ||
          group.workingBranch.toLowerCase().includes(searchText.toLowerCase())
      )
    : groups

  const handleCreate = (data: CreateIssueGroupRequest) => {
    createGroup(data, {
      onSuccess: () => {
        setShowCreateModal(false)
      },
    })
  }

  const handleUpdate = (id: string, data: UpdateIssueGroupRequest) => {
    updateGroup(
      { id, data },
      {
        onSuccess: () => {
          setEditingGroup(null)
        },
      }
    )
  }

  const handlePauseClick = (group: IssueGroup) => {
    setPausingGroup(group)
    setPauseReason('')
  }

  const handlePauseConfirm = () => {
    if (pausingGroup) {
      pauseGroup(
        { id: pausingGroup.id, reason: pauseReason || undefined },
        {
          onSuccess: () => {
            setPausingGroup(null)
            setPauseReason('')
          },
        }
      )
    }
  }

  const handleResume = (group: IssueGroup) => {
    resumeGroup(group.id)
  }

  const handleCompleteClick = (group: IssueGroup) => {
    setCompletingGroup(group)
  }

  const handleCompleteConfirm = () => {
    if (completingGroup) {
      completeGroup(completingGroup.id, {
        onSuccess: () => {
          setCompletingGroup(null)
        },
      })
    }
  }

  const handleDeleteClick = (group: IssueGroup) => {
    setDeletingGroup(group)
  }

  const handleDeleteConfirm = () => {
    if (deletingGroup) {
      deleteGroup(deletingGroup.id, {
        onSuccess: () => {
          setDeletingGroup(null)
        },
      })
    }
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">Error loading issue groups</p>
          <p className="text-sm text-muted-foreground">{error?.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Issue Groups</h1>
            <p className="text-sm text-muted-foreground">
              Organize related issues and coordinate branch sharing
            </p>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Group
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search groups..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-semibold text-muted-foreground">
                {searchText ? 'No groups match your search' : 'No issue groups yet'}
              </p>
              {!searchText && (
                <p className="text-sm text-muted-foreground">
                  Create your first group to organize related issues
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onEdit={setEditingGroup}
                onPause={handlePauseClick}
                onResume={handleResume}
                onComplete={handleCompleteClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateGroupModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
        isCreating={isCreating}
      />

      <EditGroupModal
        isOpen={!!editingGroup}
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onUpdate={handleUpdate}
        isUpdating={isUpdating}
      />

      {/* Pause Confirmation Dialog */}
      <AlertDialog open={!!pausingGroup} onOpenChange={(open) => !open && setPausingGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Group</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-4">
                <p>Are you sure you want to pause "{pausingGroup?.name}"?</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Reason (optional):</label>
                  <Input
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value)}
                    placeholder="Why is this group being paused?"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePauseConfirm}>Pause</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete Confirmation Dialog */}
      <AlertDialog
        open={!!completingGroup}
        onOpenChange={(open) => !open && setCompletingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark "{completingGroup?.name}" as completed? This will stop
              any further executions for this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCompleteConfirm}>Complete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingGroup}
        onOpenChange={(open) => !open && setDeletingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingGroup?.name}"? This action cannot be
              undone. Issues in this group will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
