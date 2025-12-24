/**
 * WorkflowsPage - List view for all workflows
 * Features filtering by status and search by title
 */

import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Filter, Trash2, Network, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
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
  WorkflowCard,
  CreateWorkflowDialog,
  DeleteWorkflowDialog,
  DeleteAllWorkflowsDialog,
} from '@/components/workflows'
import type { DeleteWorkflowOptions, DeleteAllWorkflowsOptions } from '@/components/workflows'
import { useWorkflows, useWorkflowMutations, workflowKeys } from '@/hooks/useWorkflows'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { useProject } from '@/hooks/useProject'
import { useProjectById } from '@/hooks/useProjects'
import { workflowsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import type { Workflow, WorkflowStatus } from '@/types/workflow'
import { Badge } from '@/components/ui/badge'

// Inactive statuses that can be bulk deleted
const INACTIVE_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled']

// Status filter options
const STATUS_FILTER_OPTIONS: Array<{ value: WorkflowStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function WorkflowsPage() {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const queryClient = useQueryClient()
  const { data: workflows = [], isLoading } = useWorkflows()
  const { create, start, delete: deleteWorkflow, isDeleting } = useWorkflowMutations()
  const { data: repoInfo } = useRepositoryInfo()
  const { currentProjectId } = useProject()
  const { data: currentProject } = useProjectById(currentProjectId)

  // State
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(null)
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isDeletingAll, setIsDeletingAll] = useState(false)
  const [deletionProgress, setDeletionProgress] = useState<
    { current: number; total: number } | undefined
  >()

  // Get inactive workflows (completed, failed, cancelled)
  const inactiveWorkflows = useMemo(() => {
    return workflows.filter((workflow: Workflow) =>
      INACTIVE_STATUSES.includes(workflow.status as WorkflowStatus)
    )
  }, [workflows])

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow: Workflow) => {
      // Status filter
      if (statusFilter !== 'all' && workflow.status !== statusFilter) {
        return false
      }

      // Search filter (title or source)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const title = workflow.title.toLowerCase()
        const sourceText =
          workflow.source.type === 'goal'
            ? workflow.source.goal.toLowerCase()
            : workflow.source.type === 'spec'
              ? workflow.source.specId.toLowerCase()
              : ''

        if (!title.includes(query) && !sourceText.includes(query)) {
          return false
        }
      }

      return true
    })
  }, [workflows, statusFilter, searchQuery])

  const handleCreate = async (options: Parameters<typeof create>[0]) => {
    const workflow = await create(options)
    // Start the workflow immediately after creation
    await start(workflow.id)
    setCreateDialogOpen(false)
    // Navigate to the workflow detail page
    navigate(paths.workflow(workflow.id))
  }

  const handleDeleteClick = (workflow: Workflow) => {
    setWorkflowToDelete(workflow)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async (options: DeleteWorkflowOptions) => {
    if (!workflowToDelete) return
    await deleteWorkflow(workflowToDelete.id, {
      deleteWorktree: options.deleteWorktree,
      deleteBranch: options.deleteBranch,
    })
    setDeleteDialogOpen(false)
    setWorkflowToDelete(null)
  }

  const handleDeleteAllConfirm = useCallback(
    async (options: DeleteAllWorkflowsOptions) => {
      if (inactiveWorkflows.length === 0) return

      setIsDeletingAll(true)
      setDeletionProgress({ current: 0, total: inactiveWorkflows.length })

      let successCount = 0
      let failCount = 0

      for (let i = 0; i < inactiveWorkflows.length; i++) {
        const workflow = inactiveWorkflows[i]
        setDeletionProgress({ current: i + 1, total: inactiveWorkflows.length })

        try {
          // Call API directly to avoid individual toasts from mutation
          await workflowsApi.delete(workflow.id, {
            deleteWorktree: options.deleteWorktrees,
            deleteBranch: options.deleteBranches,
          })
          successCount++
        } catch (error) {
          console.error(`Failed to delete workflow ${workflow.id}:`, error)
          failCount++
        }
      }

      // Invalidate queries after all deletions
      queryClient.invalidateQueries({ queryKey: workflowKeys.all })

      setIsDeletingAll(false)
      setDeletionProgress(undefined)
      setDeleteAllDialogOpen(false)

      if (failCount === 0) {
        toast.success(`Deleted ${successCount} workflow${successCount !== 1 ? 's' : ''}`)
      } else {
        toast.warning(
          `Deleted ${successCount} workflow${successCount !== 1 ? 's' : ''}, ${failCount} failed`
        )
      }
    },
    [inactiveWorkflows, queryClient]
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading workflows...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with filters */}
      <div className="flex items-center justify-between gap-4 border-b p-4">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Workflows</h1>
            <Badge variant="secondary">{workflows.length}</Badge>
          </div>
          {(currentProject || repoInfo) && (
            <div className="flex flex-col gap-0.5 pl-3 text-sm">
              {currentProject && (
                <div className="font-medium text-foreground">{currentProject.name}</div>
              )}
              {repoInfo && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">{repoInfo.name}</span>
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>{repoInfo.branch}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Create button - right side */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Search */}
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as WorkflowStatus | 'all')}
          >
            <SelectTrigger className="w-[160px]">
              <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Delete All Inactive */}
          {inactiveWorkflows.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setDeleteAllDialogOpen(true)}
              className="hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {inactiveWorkflows.length}
            </Button>
          )}

          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Workflow
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {workflows.length === 0 ? (
          // No workflows at all
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Network className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="mb-2 text-lg font-medium">No workflows yet</h2>
            <p className="mb-4 max-w-md text-muted-foreground">
              Workflows let you run multiple issues in sequence with dependency ordering. Create
              your first workflow to get started.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Workflow
            </Button>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          // No workflows match filters
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Search className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="mb-2 text-lg font-medium">No matching workflows</h2>
            <p className="mb-4 text-muted-foreground">No workflows match your current filters.</p>
          </div>
        ) : (
          // Workflow grid
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredWorkflows.map((workflow: Workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                onSelect={() => navigate(paths.workflow(workflow.id))}
                onDelete={() => handleDeleteClick(workflow)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <CreateWorkflowDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreate}
      />

      {/* Delete Dialog */}
      <DeleteWorkflowDialog
        workflow={workflowToDelete}
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setWorkflowToDelete(null)
        }}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />

      {/* Delete All Inactive Workflows Dialog */}
      <DeleteAllWorkflowsDialog
        open={deleteAllDialogOpen}
        onOpenChange={setDeleteAllDialogOpen}
        onConfirm={handleDeleteAllConfirm}
        inactiveCount={inactiveWorkflows.length}
        isDeleting={isDeletingAll}
        deletionProgress={deletionProgress}
      />
    </div>
  )
}
