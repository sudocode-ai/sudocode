import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { executionsApi } from '@/lib/api'
import type {
  ExecutionConfig,
  ExecutionPrepareResult,
  WorktreeMode,
  CLIExecutionMode,
  CleanupMode,
  TerminalConfig,
} from '@/types/execution'
import { getDefaultTerminalConfig, requiresTerminal, validateTerminalConfig } from '@/types/execution'
import { AlertCircle, Info } from 'lucide-react'

interface ExecutionConfigDialogProps {
  issueId: string
  open: boolean
  onStart: (config: ExecutionConfig, prompt: string) => void
  onCancel: () => void
}

export function ExecutionConfigDialog({
  issueId,
  open,
  onStart,
  onCancel,
}: ExecutionConfigDialogProps) {
  const [loading, setLoading] = useState(true)
  const [prepareResult, setPrepareResult] = useState<ExecutionPrepareResult | null>(null)
  const [prompt, setPrompt] = useState('')
  const [config, setConfig] = useState<ExecutionConfig>({
    mode: 'worktree',
    cleanupMode: 'manual',
    execution_mode: 'structured', // Default to structured mode
    terminal_config: getDefaultTerminalConfig(),
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [terminalConfigErrors, setTerminalConfigErrors] = useState<string[]>([])

  // Load template preview when dialog opens
  useEffect(() => {
    if (!open) return

    const loadPreview = async () => {
      setLoading(true)
      try {
        const result = await executionsApi.prepare(issueId)
        setPrepareResult(result)
        setPrompt(result.renderedPrompt)
        setConfig({ ...config, ...result.defaultConfig })
      } catch (error) {
        console.error('Failed to prepare execution:', error)
      } finally {
        setLoading(false)
      }
    }

    loadPreview()
  }, [open, issueId])

  const updateConfig = (updates: Partial<ExecutionConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)

    // Validate terminal config if in interactive or hybrid mode
    if (requiresTerminal(newConfig.execution_mode) && newConfig.terminal_config) {
      const errors = validateTerminalConfig(newConfig.terminal_config)
      setTerminalConfigErrors(errors)
    } else {
      setTerminalConfigErrors([])
    }
  }

  const updateTerminalConfig = (updates: Partial<TerminalConfig>) => {
    const newTerminalConfig = { ...config.terminal_config!, ...updates }
    updateConfig({ terminal_config: newTerminalConfig })
  }

  const handleStart = () => {
    // Strip terminal_config if not needed
    const finalConfig = { ...config }
    if (!requiresTerminal(config.execution_mode)) {
      delete finalConfig.terminal_config
    }
    onStart(finalConfig, prompt)
  }

  const hasErrors = prepareResult?.errors && prepareResult.errors.length > 0
  const hasWarnings = prepareResult?.warnings && prepareResult.warnings.length > 0
  const canStart = !loading && !hasErrors && terminalConfigErrors.length === 0 && prompt.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Agent Execution</DialogTitle>
          <DialogDescription>
            Configure settings and review the prompt before starting the agent.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading template...</div>
        ) : (
          <div className="space-y-6">
            {/* Errors */}
            {hasErrors && (
              <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-destructive">Errors</p>
                    {prepareResult.errors!.map((error, i) => (
                      <p key={i} className="text-sm text-destructive/90">
                        {error}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Warnings */}
            {hasWarnings && (
              <div className="rounded-lg border border-yellow-500 bg-yellow-500/10 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-5 w-5 text-yellow-600" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-yellow-600">Warnings</p>
                    {prepareResult.warnings!.map((warning, i) => (
                      <p key={i} className="text-sm text-yellow-600/90">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Related Context */}
            {prepareResult &&
              ((prepareResult.relatedSpecs?.length ?? 0) > 0 ||
                (prepareResult.relatedFeedback?.length ?? 0) > 0) && (
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="mb-2 text-sm font-medium">Context Included</p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {(prepareResult.relatedSpecs?.length ?? 0) > 0 && (
                      <p>• {prepareResult.relatedSpecs.length} related spec(s)</p>
                    )}
                    {(prepareResult.relatedFeedback?.length ?? 0) > 0 && (
                      <p>• {prepareResult.relatedFeedback.length} feedback item(s)</p>
                    )}
                  </div>
                </div>
              )}

            {/* Worktree Mode */}
            <div className="space-y-2">
              <Label htmlFor="mode">Worktree Mode</Label>
              <Select
                value={config.mode}
                onValueChange={(value) => updateConfig({ mode: value as WorktreeMode })}
              >
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worktree">
                    Worktree (Recommended) - Isolated git worktree
                  </SelectItem>
                  <SelectItem value="local">Local - Run in current directory</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Base Branch (only for worktree mode) */}
            {config.mode === 'worktree' && prepareResult?.availableBranches && (
              <div className="space-y-2">
                <Label htmlFor="baseBranch">Base Branch</Label>
                <Select
                  value={config.baseBranch}
                  onValueChange={(value) => updateConfig({ baseBranch: value })}
                >
                  <SelectTrigger id="baseBranch">
                    <SelectValue placeholder="Select base branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {prepareResult.availableBranches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Model Selection */}
            {prepareResult?.availableModels && (
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Select
                  value={config.model}
                  onValueChange={(value) => updateConfig({ model: value })}
                >
                  <SelectTrigger id="model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {prepareResult.availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* CLI Execution Mode */}
            <div className="space-y-2">
              <Label htmlFor="execution-mode">CLI Execution Mode</Label>
              <Select
                value={config.execution_mode}
                onValueChange={(value) => updateConfig({ execution_mode: value as CLIExecutionMode })}
              >
                <SelectTrigger id="execution-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="structured">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Structured</span>
                      <span className="text-xs text-muted-foreground">
                        Automated JSON output with parsed events
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="interactive">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Interactive</span>
                      <span className="text-xs text-muted-foreground">
                        Full terminal emulation with real-time interaction
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="hybrid">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Hybrid</span>
                      <span className="text-xs text-muted-foreground">
                        Both terminal view and structured parsing
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.execution_mode === 'structured' &&
                  'Recommended for automated workflows and background executions.'}
                {config.execution_mode === 'interactive' &&
                  'Recommended when you need to respond to prompts or see colorful output.'}
                {config.execution_mode === 'hybrid' &&
                  'Best of both worlds - structured parsing with live terminal view.'}
              </p>
            </div>

            {/* Terminal Configuration (only for interactive/hybrid) */}
            {requiresTerminal(config.execution_mode) && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                <Label>Terminal Configuration</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cols" className="text-xs text-muted-foreground">
                      Columns
                    </Label>
                    <input
                      id="cols"
                      type="number"
                      min="20"
                      max="500"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                      value={config.terminal_config?.cols ?? 80}
                      onChange={(e) =>
                        updateTerminalConfig({ cols: parseInt(e.target.value) || 80 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rows" className="text-xs text-muted-foreground">
                      Rows
                    </Label>
                    <input
                      id="rows"
                      type="number"
                      min="10"
                      max="100"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                      value={config.terminal_config?.rows ?? 24}
                      onChange={(e) =>
                        updateTerminalConfig({ rows: parseInt(e.target.value) || 24 })
                      }
                    />
                  </div>
                </div>
                {terminalConfigErrors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {terminalConfigErrors.map((error, i) => (
                      <p key={i} className="text-xs text-destructive">
                        {error}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Standard terminal size is 80×24. Adjust for your needs.
                </p>
              </div>
            )}

            {/* Cleanup Mode */}
            <div className="space-y-2">
              <Label htmlFor="cleanup">Cleanup Mode</Label>
              <Select
                value={config.cleanupMode}
                onValueChange={(value) => updateConfig({ cleanupMode: value as CleanupMode })}
              >
                <SelectTrigger id="cleanup">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto - Clean up after completion</SelectItem>
                  <SelectItem value="manual">Manual - Keep for review</SelectItem>
                  <SelectItem value="never">Never - Persist permanently</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Advanced Options Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? '▼' : '▶'} Advanced Options
            </button>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="space-y-4 border-l-2 border-muted pl-4">
                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (ms)</Label>
                  <input
                    id="timeout"
                    type="number"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={config.timeout ?? ''}
                    onChange={(e) =>
                      updateConfig({
                        timeout: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    placeholder="No timeout"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxTokens">Max Tokens</Label>
                  <input
                    id="maxTokens"
                    type="number"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={config.maxTokens ?? ''}
                    onChange={(e) =>
                      updateConfig({
                        maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    placeholder="Model default"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="temperature">Temperature</Label>
                  <input
                    id="temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={config.temperature ?? ''}
                    onChange={(e) =>
                      updateConfig({
                        temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    placeholder="Model default"
                  />
                </div>
              </div>
            )}

            {/* Prompt Editor */}
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder="Edit the generated prompt..."
              />
              <p className="text-xs text-muted-foreground">
                Review and edit the generated prompt before starting the agent.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={!canStart}>
            Start Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
