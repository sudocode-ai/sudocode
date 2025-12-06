/**
 * WorkflowsPage - List view for all workflows
 * Features filtering by status and search by title
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, GitBranch, Search, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WorkflowCard, CreateWorkflowDialog, DeleteWorkflowDialog } from '@/components/workflows'
import type { DeleteWorkflowOptions } from '@/components/workflows'
import { useWorkflows, useWorkflowMutations } from '@/hooks/useWorkflows'
import type { Workflow, WorkflowStatus } from '@/types/workflow'
import { Badge } from '@/components/ui/badge'

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
  const { data: workflows = [], isLoading } = useWorkflows()
  const { create, delete: deleteWorkflow, isDeleting } = useWorkflowMutations()

  // State
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(null)
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

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
    await create(options)
    setCreateDialogOpen(false)
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
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <Badge variant="secondary">{workflows.length}</Badge>
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
            <GitBranch className="mb-4 h-12 w-12 text-muted-foreground/50" />
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
                onSelect={() => navigate(`/workflows/${workflow.id}`)}
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
    </div>
  )
}
