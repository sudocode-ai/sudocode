/**
 * WorkflowsPage - List view for all workflows
 * Features filtering by status and search by title
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, GitBranch, Search, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WorkflowCard, CreateWorkflowDialog } from '@/components/workflows'
import { useWorkflows, useWorkflowMutations } from '@/hooks/useWorkflows'
import type { WorkflowStatus } from '@/types/workflow'

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
  const { workflows, isLoading } = useWorkflows()
  const { create } = useWorkflowMutations()

  // State
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
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

  // Stats
  const activeCount = workflows.filter((w) =>
    ['running', 'paused'].includes(w.status)
  ).length

  const handleCreate = async (options: Parameters<typeof create>[0]) => {
    await create(options)
    setCreateDialogOpen(false)
  }

  const clearFilters = () => {
    setStatusFilter('all')
    setSearchQuery('')
  }

  const hasActiveFilters = statusFilter !== 'all' || searchQuery.trim() !== ''

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading workflows...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <span className="text-sm text-muted-foreground">
            ({workflows.length} total{activeCount > 0 && `, ${activeCount} active`})
          </span>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Workflow
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 border-b px-6 py-3 bg-muted/30">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}

        {/* Results count */}
        {hasActiveFilters && (
          <span className="text-sm text-muted-foreground">
            {filteredWorkflows.length} of {workflows.length} workflows
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {workflows.length === 0 ? (
          // No workflows at all
          <div className="flex flex-col items-center justify-center h-full text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-medium mb-2">No workflows yet</h2>
            <p className="text-muted-foreground mb-4 max-w-md">
              Workflows let you run multiple issues in sequence with dependency
              ordering. Create your first workflow to get started.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Workflow
            </Button>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          // No workflows match filters
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h2 className="text-lg font-medium mb-2">No matching workflows</h2>
            <p className="text-muted-foreground mb-4">
              No workflows match your current filters.
            </p>
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        ) : (
          // Workflow grid
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredWorkflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                onSelect={() => navigate(`/workflows/${workflow.id}`)}
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
    </div>
  )
}
