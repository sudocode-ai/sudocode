/**
 * CreateWorkflowDialog - Dialog for creating new workflows
 * Allows selection of workflow source and configuration
 */

import { useState, useCallback } from 'react'
import {
  FileText,
  ListTodo,
  Target,
  MessageSquare,
  ChevronDown,
  Play,
  Loader2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type {
  WorkflowSource,
  CreateWorkflowOptions,
  WorkflowConfig,
  WorkflowParallelism,
  WorkflowFailureStrategy,
} from '@/types/workflow'
import { DEFAULT_WORKFLOW_CONFIG } from '@/types/workflow'

// =============================================================================
// Types
// =============================================================================

export interface CreateWorkflowDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Callback when workflow is created */
  onCreate?: (options: CreateWorkflowOptions) => Promise<void>
  /** Default source to pre-fill (e.g., when opened from spec page) */
  defaultSource?: WorkflowSource
  /** Whether creation is in progress */
  isCreating?: boolean
}

type SourceType = 'spec' | 'issues' | 'root_issue' | 'goal'

interface FormState {
  title: string
  sourceType: SourceType
  specId: string
  issueIds: string
  rootIssueId: string
  goal: string
  parallelism: WorkflowParallelism
  maxConcurrency: number
  onFailure: WorkflowFailureStrategy
  autoCommit: boolean
  agentType: string
}

// =============================================================================
// Source Type Options
// =============================================================================

const SOURCE_TYPE_OPTIONS: Array<{
  value: SourceType
  label: string
  description: string
  icon: typeof FileText
}> = [
  {
    value: 'spec',
    label: 'From Spec',
    description: 'Run all issues implementing a spec',
    icon: FileText,
  },
  {
    value: 'issues',
    label: 'Selected Issues',
    description: 'Choose specific issues to run',
    icon: ListTodo,
  },
  {
    value: 'root_issue',
    label: 'From Root Issue',
    description: 'Run an issue and all its blockers',
    icon: Target,
  },
  {
    value: 'goal',
    label: 'From Goal',
    description: 'Describe what you want to achieve',
    icon: MessageSquare,
  },
]

// =============================================================================
// Component
// =============================================================================

export function CreateWorkflowDialog({
  open,
  onOpenChange,
  onCreate,
  defaultSource,
  isCreating = false,
}: CreateWorkflowDialogProps) {
  // Form state
  const [form, setForm] = useState<FormState>(() => ({
    title: '',
    sourceType: defaultSource?.type || 'spec',
    specId: defaultSource?.type === 'spec' ? defaultSource.specId : '',
    issueIds: defaultSource?.type === 'issues' ? defaultSource.issueIds.join(', ') : '',
    rootIssueId: defaultSource?.type === 'root_issue' ? defaultSource.issueId : '',
    goal: defaultSource?.type === 'goal' ? defaultSource.goal : '',
    parallelism: DEFAULT_WORKFLOW_CONFIG.parallelism,
    maxConcurrency: 2,
    onFailure: DEFAULT_WORKFLOW_CONFIG.onFailure,
    autoCommit: DEFAULT_WORKFLOW_CONFIG.autoCommitAfterStep,
    agentType: DEFAULT_WORKFLOW_CONFIG.defaultAgentType,
  }))

  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Update form field
  const updateForm = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Build workflow source from form
  const buildSource = useCallback((): WorkflowSource | null => {
    switch (form.sourceType) {
      case 'spec':
        if (!form.specId.trim()) return null
        return { type: 'spec', specId: form.specId.trim() }
      case 'issues':
        const issueIds = form.issueIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (issueIds.length === 0) return null
        return { type: 'issues', issueIds }
      case 'root_issue':
        if (!form.rootIssueId.trim()) return null
        return { type: 'root_issue', issueId: form.rootIssueId.trim() }
      case 'goal':
        if (!form.goal.trim()) return null
        return { type: 'goal', goal: form.goal.trim() }
      default:
        return null
    }
  }, [form])

  // Build config from form
  const buildConfig = useCallback((): Partial<WorkflowConfig> => {
    return {
      parallelism: form.parallelism,
      maxConcurrency: form.parallelism === 'parallel' ? form.maxConcurrency : undefined,
      onFailure: form.onFailure,
      autoCommitAfterStep: form.autoCommit,
      defaultAgentType: form.agentType as WorkflowConfig['defaultAgentType'],
    }
  }, [form])

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    const source = buildSource()
    if (!source) return

    const options: CreateWorkflowOptions = {
      title: form.title || `Workflow from ${form.sourceType}`,
      source,
      config: buildConfig(),
    }

    await onCreate?.(options)
    onOpenChange(false)
  }, [buildSource, buildConfig, form.title, form.sourceType, onCreate, onOpenChange])

  // Check if form is valid
  const isValid = buildSource() !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Workflow</DialogTitle>
          <DialogDescription>
            Run multiple issues in sequence or parallel with dependency ordering.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              placeholder="My Workflow"
              value={form.title}
              onChange={(e) => updateForm('title', e.target.value)}
            />
          </div>

          {/* Source Type Selection */}
          <div className="space-y-3">
            <Label>Workflow Source</Label>
            <RadioGroup
              value={form.sourceType}
              onValueChange={(v) => updateForm('sourceType', v as SourceType)}
              className="grid grid-cols-2 gap-3"
            >
              {SOURCE_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon
                const isSelected = form.sourceType === option.value
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-muted-foreground/50'
                    )}
                  >
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{option.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {option.description}
                      </p>
                    </div>
                  </label>
                )
              })}
            </RadioGroup>
          </div>

          {/* Source-specific Input */}
          <div className="space-y-2">
            {form.sourceType === 'spec' && (
              <>
                <Label htmlFor="specId">Spec ID</Label>
                <Input
                  id="specId"
                  placeholder="s-xxxx"
                  value={form.specId}
                  onChange={(e) => updateForm('specId', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the spec ID to run all implementing issues
                </p>
              </>
            )}

            {form.sourceType === 'issues' && (
              <>
                <Label htmlFor="issueIds">Issue IDs</Label>
                <Input
                  id="issueIds"
                  placeholder="i-xxxx, i-yyyy, i-zzzz"
                  value={form.issueIds}
                  onChange={(e) => updateForm('issueIds', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of issue IDs to include
                </p>
              </>
            )}

            {form.sourceType === 'root_issue' && (
              <>
                <Label htmlFor="rootIssueId">Root Issue ID</Label>
                <Input
                  id="rootIssueId"
                  placeholder="i-xxxx"
                  value={form.rootIssueId}
                  onChange={(e) => updateForm('rootIssueId', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter issue ID to include it and all blocking issues
                </p>
              </>
            )}

            {form.sourceType === 'goal' && (
              <>
                <Label htmlFor="goal">Goal Description</Label>
                <Textarea
                  id="goal"
                  placeholder="What do you want to achieve?"
                  value={form.goal}
                  onChange={(e) => updateForm('goal', e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  The orchestrator will create issues dynamically to achieve this goal
                </p>
              </>
            )}
          </div>

          {/* Advanced Configuration */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                Advanced Configuration
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    advancedOpen && 'rotate-180'
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* Execution Mode */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Execution Mode</Label>
                  <Select
                    value={form.parallelism}
                    onValueChange={(v) => updateForm('parallelism', v as WorkflowParallelism)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="parallel">Parallel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.parallelism === 'parallel' && (
                  <div className="space-y-2">
                    <Label>Max Concurrency</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={form.maxConcurrency}
                      onChange={(e) => updateForm('maxConcurrency', parseInt(e.target.value) || 1)}
                    />
                  </div>
                )}
              </div>

              {/* On Failure */}
              <div className="space-y-2">
                <Label>On Failure</Label>
                <Select
                  value={form.onFailure}
                  onValueChange={(v) => updateForm('onFailure', v as WorkflowFailureStrategy)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pause">Pause for intervention</SelectItem>
                    <SelectItem value="stop">Stop workflow</SelectItem>
                    <SelectItem value="skip_dependents">Skip dependents</SelectItem>
                    <SelectItem value="continue">Continue with others</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Agent Type */}
              <div className="space-y-2">
                <Label>Default Agent</Label>
                <Select
                  value={form.agentType}
                  onValueChange={(v) => updateForm('agentType', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-code">Claude Code</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="copilot">Copilot</SelectItem>
                    <SelectItem value="cursor">Cursor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Auto-commit */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="autoCommit"
                  checked={form.autoCommit}
                  onCheckedChange={(checked) => updateForm('autoCommit', !!checked)}
                />
                <Label htmlFor="autoCommit" className="text-sm font-normal cursor-pointer">
                  Auto-commit after each step
                </Label>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Create & Run
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CreateWorkflowDialog
