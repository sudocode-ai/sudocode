/**
 * CreateWorkflowDialog - Dialog for creating new workflows
 * Allows selection of workflow source and configuration
 */

import { useState, useCallback, useEffect } from 'react'
import { FileText, ListTodo, Target, MessageSquare, ChevronDown, Play, Loader2 } from 'lucide-react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { repositoryApi } from '@/lib/api'
import { BranchSelector } from '@/components/executions/BranchSelector'
import { useWorktrees } from '@/hooks/useWorktrees'
import { useIssues } from '@/hooks/useIssues'
import { useSpecs } from '@/hooks/useSpecs'
import { IssueSelector } from '@/components/ui/issue-selector'
import { SpecSelector } from '@/components/ui/spec-selector'
import { MultiIssueSelector } from '@/components/ui/multi-issue-selector'
import type {
  WorkflowSource,
  CreateWorkflowOptions,
  WorkflowConfig,
  WorkflowEngineType,
  WorkflowParallelism,
  WorkflowFailureStrategy,
  WorkflowAutonomyLevel,
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
  engineType: WorkflowEngineType
  sourceType: SourceType
  specId: string
  issueIds: string[]
  rootIssueId: string
  goal: string
  baseBranch: string
  createBaseBranch: boolean
  reuseWorktreePath: string | undefined
  parallelism: WorkflowParallelism
  maxConcurrency: number
  onFailure: WorkflowFailureStrategy
  autoCommit: boolean
  agentType: string
  // Orchestrator-specific options
  autonomyLevel: WorkflowAutonomyLevel
  orchestratorModel: string
}

// =============================================================================
// Source Type Options
// =============================================================================

const SOURCE_TYPE_OPTIONS: Array<{
  value: SourceType
  label: string
  description: string
  icon: typeof FileText
  /** Whether this source type requires orchestrator engine */
  orchestratorOnly?: boolean
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
    description: 'AI orchestrator creates and manages issues dynamically',
    icon: MessageSquare,
    orchestratorOnly: true,
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
    engineType:
      defaultSource?.type === 'goal' ? 'orchestrator' : DEFAULT_WORKFLOW_CONFIG.engineType,
    sourceType: defaultSource?.type || 'spec',
    specId: defaultSource?.type === 'spec' ? defaultSource.specId : '',
    issueIds: defaultSource?.type === 'issues' ? defaultSource.issueIds : [],
    rootIssueId: defaultSource?.type === 'root_issue' ? defaultSource.issueId : '',
    goal: defaultSource?.type === 'goal' ? defaultSource.goal : '',
    baseBranch: '',
    createBaseBranch: false,
    reuseWorktreePath: undefined,
    parallelism: DEFAULT_WORKFLOW_CONFIG.parallelism,
    maxConcurrency: 2,
    onFailure: DEFAULT_WORKFLOW_CONFIG.onFailure,
    autoCommit: DEFAULT_WORKFLOW_CONFIG.autoCommitAfterStep,
    agentType: DEFAULT_WORKFLOW_CONFIG.defaultAgentType,
    // Orchestrator-specific options
    autonomyLevel: DEFAULT_WORKFLOW_CONFIG.autonomyLevel,
    orchestratorModel: '',
  }))

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [availableBranches, setAvailableBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [loadingBranches, setLoadingBranches] = useState(false)

  // Fetch worktrees for branch selector
  const { worktrees } = useWorktrees()

  // Fetch issues and specs for selectors
  const { issues, isLoading: isLoadingIssues } = useIssues(false)
  const { specs, isLoading: isLoadingSpecs } = useSpecs(false)

  // Fetch branches when dialog opens
  useEffect(() => {
    if (!open) return

    let isMounted = true

    const loadBranches = async () => {
      setLoadingBranches(true)
      try {
        const branchInfo = await repositoryApi.getBranches()
        if (isMounted) {
          setAvailableBranches(branchInfo.branches)
          setCurrentBranch(branchInfo.current)

          // Set default baseBranch to current branch if not already set
          if (!form.baseBranch) {
            setForm((prev) => ({ ...prev, baseBranch: branchInfo.current }))
          }
        }
      } catch (error) {
        console.error('Failed to fetch branches:', error)
      } finally {
        if (isMounted) {
          setLoadingBranches(false)
        }
      }
    }

    loadBranches()

    return () => {
      isMounted = false
    }
  }, [open])

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
        if (form.issueIds.length === 0) return null
        return { type: 'issues', issueIds: form.issueIds }
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
    const config: Partial<WorkflowConfig> = {
      engineType: form.engineType,
      parallelism: form.parallelism,
      maxConcurrency: form.parallelism === 'parallel' ? form.maxConcurrency : undefined,
      onFailure: form.onFailure,
      autoCommitAfterStep: form.autoCommit,
      defaultAgentType: form.agentType as WorkflowConfig['defaultAgentType'],
      baseBranch: form.baseBranch.trim() || undefined,
      createBaseBranch: form.createBaseBranch || undefined,
      reuseWorktreePath: form.reuseWorktreePath,
    }

    // Add orchestrator-specific options when using orchestrator engine
    if (form.engineType === 'orchestrator') {
      config.autonomyLevel = form.autonomyLevel
      if (form.orchestratorModel.trim()) {
        config.orchestratorModel = form.orchestratorModel.trim()
      }
    }

    return config
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
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create Workflow</DialogTitle>
          <DialogDescription>
            Run multiple issues in sequence or parallel with dependency ordering.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-1">
          {/* Title */}
          <div className="flex flex-row items-center space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              placeholder="Workflow title"
              value={form.title}
              onChange={(e) => updateForm('title', e.target.value)}
            />
          </div>

          {/* Engine Type Selection */}
          <div className="space-y-3">
            <Label>Execution Mode</Label>
            <RadioGroup
              value={form.engineType}
              onValueChange={(v) => {
                const newEngineType = v as WorkflowEngineType
                updateForm('engineType', newEngineType)
                // If switching to sequential and current source is orchestrator-only, reset to spec
                if (newEngineType === 'sequential' && form.sourceType === 'goal') {
                  updateForm('sourceType', 'spec')
                }
              }}
              className="grid grid-cols-2 gap-3"
            >
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  form.engineType === 'sequential'
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/50'
                )}
              >
                <RadioGroupItem value="sequential" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">Sequential</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Server executes steps in dependency order
                  </p>
                </div>
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  form.engineType === 'orchestrator'
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/50'
                )}
              >
                <RadioGroupItem value="orchestrator" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">AI Orchestrator</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    AI agent manages workflow execution
                  </p>
                </div>
              </label>
            </RadioGroup>
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
                const isDisabled = option.orchestratorOnly && form.engineType === 'sequential'
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                      isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      isSelected && !isDisabled
                        ? 'border-primary bg-primary/5'
                        : !isDisabled && 'hover:border-muted-foreground/50'
                    )}
                  >
                    <RadioGroupItem value={option.value} className="mt-0.5" disabled={isDisabled} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{option.label}</span>
                        {option.orchestratorOnly && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">AI Only</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
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
                <Label>Spec</Label>
                <SpecSelector
                  specs={specs}
                  value={form.specId}
                  onChange={(value) => updateForm('specId', value)}
                  disabled={isLoadingSpecs || isCreating}
                  placeholder={isLoadingSpecs ? 'Loading specs...' : 'Select spec...'}
                  inModal={true}
                />
                <p className="text-xs text-muted-foreground">
                  Select the spec to run all implementing issues
                </p>
              </>
            )}

            {form.sourceType === 'issues' && (
              <>
                <Label>Issues</Label>
                <MultiIssueSelector
                  issues={issues}
                  value={form.issueIds}
                  onChange={(value) => updateForm('issueIds', value)}
                  disabled={isLoadingIssues || isCreating}
                  placeholder={isLoadingIssues ? 'Loading issues...' : 'Select issues...'}
                  inModal={true}
                />
                <p className="text-xs text-muted-foreground">
                  Select the issues to include in the workflow
                </p>
              </>
            )}

            {form.sourceType === 'root_issue' && (
              <>
                <Label>Root Issue</Label>
                <IssueSelector
                  issues={issues}
                  value={form.rootIssueId}
                  onChange={(value) => updateForm('rootIssueId', value)}
                  disabled={isLoadingIssues || isCreating}
                  placeholder={isLoadingIssues ? 'Loading issues...' : 'Select root issue...'}
                  inModal={true}
                />
                <p className="text-xs text-muted-foreground">
                  Select issue to include it and all blocking issues
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

          {/* Base Branch / Worktree Selection */}
          <div className="space-y-2">
            <Label>Base Branch or Worktree</Label>
            <BranchSelector
              branches={availableBranches}
              value={form.baseBranch}
              onChange={(branch, isNew, worktreePath) => {
                setForm((prev) => ({
                  ...prev,
                  baseBranch: branch,
                  createBaseBranch: isNew || false,
                  reuseWorktreePath: worktreePath,
                }))
              }}
              disabled={loadingBranches || isCreating}
              allowCreate={true}
              className="w-full"
              currentBranch={currentBranch}
              worktrees={worktrees}
              placeholder={loadingBranches ? 'Loading branches...' : 'Select branch or worktree...'}
              inModal={true}
            />
            <p className="text-xs text-muted-foreground">
              {form.reuseWorktreePath
                ? 'Reusing existing worktree from a previous execution.'
                : 'Select a branch to create the workflow from, or reuse an existing worktree.'}
            </p>
          </div>

          {/* Advanced Configuration */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                Advanced Configuration
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')}
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
                <Select value={form.agentType} onValueChange={(v) => updateForm('agentType', v)}>
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

              {/* Orchestrator-specific options */}
              {form.engineType === 'orchestrator' && (
                <>
                  <div className="space-y-2">
                    <Label>Autonomy Level</Label>
                    <Select
                      value={form.autonomyLevel}
                      onValueChange={(v) => updateForm('autonomyLevel', v as WorkflowAutonomyLevel)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="human_in_the_loop">Human in the Loop</SelectItem>
                        <SelectItem value="full_auto">Full Auto</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {form.autonomyLevel === 'full_auto'
                        ? 'AI makes all decisions without pausing for user input'
                        : 'AI pauses for user input on important decisions'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Orchestrator Model (optional)</Label>
                    <Input
                      placeholder="e.g., claude-sonnet-4-20250514"
                      value={form.orchestratorModel}
                      onChange={(e) => updateForm('orchestratorModel', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Specific model for the orchestrator agent (uses default if empty)
                    </p>
                  </div>
                </>
              )}

              {/* Auto-commit */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="autoCommit"
                  checked={form.autoCommit}
                  onCheckedChange={(checked) => updateForm('autoCommit', !!checked)}
                />
                <Label htmlFor="autoCommit" className="cursor-pointer text-sm font-normal">
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
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
