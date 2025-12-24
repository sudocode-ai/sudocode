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
// LocalStorage Keys and Persistence
// =============================================================================

const WORKFLOW_SETTINGS_KEY = 'sudocode:workflowSettings'

/**
 * Settings that persist between workflow creation sessions.
 * Does NOT include workflow source (spec, issues, goal, etc.)
 */
interface PersistedWorkflowSettings {
  onFailure: WorkflowFailureStrategy
  agentType: string
  autoCommit: boolean
  advancedOpen: boolean
  baseBranch?: string
  reuseWorktreePath?: string
}

const DEFAULT_PERSISTED_SETTINGS: PersistedWorkflowSettings = {
  onFailure: DEFAULT_WORKFLOW_CONFIG.onFailure,
  agentType: DEFAULT_WORKFLOW_CONFIG.defaultAgentType,
  autoCommit: DEFAULT_WORKFLOW_CONFIG.autoCommitAfterStep,
  advancedOpen: false,
  baseBranch: undefined,
  reuseWorktreePath: undefined,
}

/**
 * Validates persisted settings from localStorage
 */
function isValidPersistedSettings(value: unknown): value is PersistedWorkflowSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Record<string, unknown>

  // Validate onFailure
  const validFailureStrategies = ['pause', 'stop', 'skip_dependents', 'continue']
  if (typeof settings.onFailure !== 'string' || !validFailureStrategies.includes(settings.onFailure)) {
    return false
  }

  // Validate agentType
  const validAgentTypes = ['claude-code', 'codex', 'copilot', 'cursor']
  if (typeof settings.agentType !== 'string' || !validAgentTypes.includes(settings.agentType)) {
    return false
  }

  // Validate booleans
  if (typeof settings.autoCommit !== 'boolean') return false
  if (typeof settings.advancedOpen !== 'boolean') return false

  // Validate optional strings (baseBranch, reuseWorktreePath)
  if (settings.baseBranch !== undefined && typeof settings.baseBranch !== 'string') return false
  if (settings.reuseWorktreePath !== undefined && typeof settings.reuseWorktreePath !== 'string') return false

  return true
}

/**
 * Load persisted settings from localStorage
 */
function loadPersistedSettings(): PersistedWorkflowSettings {
  try {
    const saved = localStorage.getItem(WORKFLOW_SETTINGS_KEY)
    if (!saved) return DEFAULT_PERSISTED_SETTINGS

    const parsed = JSON.parse(saved)
    if (isValidPersistedSettings(parsed)) {
      return parsed
    }
  } catch (error) {
    console.warn('Failed to load workflow settings from localStorage:', error)
  }
  return DEFAULT_PERSISTED_SETTINGS
}

/**
 * Save persisted settings to localStorage
 */
function savePersistedSettings(settings: PersistedWorkflowSettings): void {
  try {
    if (isValidPersistedSettings(settings)) {
      localStorage.setItem(WORKFLOW_SETTINGS_KEY, JSON.stringify(settings))
    }
  } catch (error) {
    console.warn('Failed to save workflow settings to localStorage:', error)
  }
}

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
    description:
      "Run all issues implementing a spec (Note: must have issues with 'implements' relationships)",
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
  // Load persisted settings from localStorage
  const [persistedSettings] = useState<PersistedWorkflowSettings>(() => loadPersistedSettings())

  // Form state - loads persisted settings for non-source fields
  const [form, setForm] = useState<FormState>(() => ({
    title: '',
    // Orchestrator disabled for now - always use sequential
    engineType: 'sequential',
    sourceType: defaultSource?.type === 'goal' ? 'spec' : defaultSource?.type || 'spec',
    specId: defaultSource?.type === 'spec' ? defaultSource.specId : '',
    issueIds: defaultSource?.type === 'issues' ? defaultSource.issueIds : [],
    rootIssueId: defaultSource?.type === 'root_issue' ? defaultSource.issueId : '',
    goal: defaultSource?.type === 'goal' ? defaultSource.goal : '',
    baseBranch: persistedSettings.baseBranch || '',
    createBaseBranch: false,
    reuseWorktreePath: persistedSettings.reuseWorktreePath,
    parallelism: 'sequential', // Parallel disabled for now
    maxConcurrency: 2,
    onFailure: persistedSettings.onFailure,
    autoCommit: persistedSettings.autoCommit,
    agentType: persistedSettings.agentType,
    // Orchestrator-specific options
    autonomyLevel: DEFAULT_WORKFLOW_CONFIG.autonomyLevel,
    orchestratorModel: '',
  }))

  const [advancedOpen, setAdvancedOpen] = useState(() => persistedSettings.advancedOpen)
  const [availableBranches, setAvailableBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [loadingBranches, setLoadingBranches] = useState(false)

  // Fetch worktrees for branch selector
  const { worktrees } = useWorktrees()

  // Fetch issues and specs for selectors
  const { issues, isLoading: isLoadingIssues } = useIssues(false)
  const { specs, isLoading: isLoadingSpecs } = useSpecs(false)

  // Reset form source fields when dialog opens with defaultSource
  useEffect(() => {
    if (!open) return

    // Update form with defaultSource values when dialog opens
    if (defaultSource) {
      setForm((prev) => ({
        ...prev,
        sourceType: defaultSource.type === 'goal' ? 'spec' : defaultSource.type,
        specId: defaultSource.type === 'spec' ? defaultSource.specId : prev.specId,
        issueIds: defaultSource.type === 'issues' ? defaultSource.issueIds : prev.issueIds,
        rootIssueId: defaultSource.type === 'root_issue' ? defaultSource.issueId : prev.rootIssueId,
        goal: defaultSource.type === 'goal' ? defaultSource.goal : prev.goal,
      }))
    }
  }, [open, defaultSource])

  // Fetch branches when dialog opens and validate persisted worktree
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

          // Validate persisted settings against available branches/worktrees
          setForm((prev) => {
            // Check if persisted worktree still exists
            const worktreeStillExists =
              prev.reuseWorktreePath && worktrees?.some((wt) => wt.worktree_path === prev.reuseWorktreePath)

            // Check if persisted branch still exists
            const branchStillExists =
              prev.baseBranch && branchInfo.branches.includes(prev.baseBranch)

            // If worktree exists, keep it; if branch exists, use it; otherwise fall back to current
            if (worktreeStillExists) {
              return prev // Keep the persisted worktree
            } else if (branchStillExists) {
              return { ...prev, reuseWorktreePath: undefined } // Keep branch, clear invalid worktree
            } else {
              // Fall back to current branch
              return { ...prev, baseBranch: branchInfo.current, reuseWorktreePath: undefined }
            }
          })
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
  }, [open, worktrees])

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

    // Save settings to localStorage (excluding workflow source)
    savePersistedSettings({
      onFailure: form.onFailure,
      agentType: form.agentType,
      autoCommit: form.autoCommit,
      advancedOpen,
      baseBranch: form.baseBranch || undefined,
      reuseWorktreePath: form.reuseWorktreePath,
    })

    await onCreate?.(options)
    onOpenChange(false)
  }, [buildSource, buildConfig, form.title, form.sourceType, form.onFailure, form.agentType, form.autoCommit, form.baseBranch, form.reuseWorktreePath, advancedOpen, onCreate, onOpenChange])

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

        <div className="flex-1 space-y-4 overflow-y-auto px-1">
          {/* Title - hidden, using default titles */}

          {/* Engine Type Selection - hidden, defaulting to sequential */}

          {/* Source Type Selection */}
          <div className="space-y-3">
            <Label>Workflow Source</Label>
            <RadioGroup
              value={form.sourceType}
              onValueChange={(v) => updateForm('sourceType', v as SourceType)}
              className="flex flex-col gap-2"
            >
              {SOURCE_TYPE_OPTIONS
                // Filter out orchestrator-only options since orchestrator is disabled
                .filter((option) => !option.orchestratorOnly)
                .map((option) => {
                  const Icon = option.icon
                  const isSelected = form.sourceType === option.value
                  const isDisabled = false
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
                      <RadioGroupItem
                        value={option.value}
                        className="mt-0.5"
                        disabled={isDisabled}
                      />
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
          <Collapsible
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            className="my-4 rounded-md border"
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 rounded-b-none hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    advancedOpen && 'rotate-180'
                  )}
                />
                <span className="text-muted-foreground">Advanced Options</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t px-4 py-4">
              {/* Execution Mode - parallel disabled for now, only sequential supported */}

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

              {/* Orchestrator-specific options - hidden while orchestrator is disabled */}

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
