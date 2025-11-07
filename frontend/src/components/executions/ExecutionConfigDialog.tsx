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
import { Switch } from '@/components/ui/switch'
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
  ExecutionMode,
  CleanupMode,
} from '@/types/execution'
import type { VoiceConfig } from '@sudocode-ai/types'
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
  })
  const [showAdvanced, setShowAdvanced] = useState(false)

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
    setConfig({ ...config, ...updates })
  }

  const updateVoiceConfig = (updates: Partial<VoiceConfig>) => {
    setConfig({
      ...config,
      voice: { ...config.voice, ...updates } as VoiceConfig,
    })
  }

  const handleStart = () => {
    onStart(config, prompt)
  }

  const hasErrors = prepareResult?.errors && prepareResult.errors.length > 0
  const hasWarnings = prepareResult?.warnings && prepareResult.warnings.length > 0
  const canStart = !loading && !hasErrors && prompt.trim().length > 0

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

            {/* Execution Mode */}
            <div className="space-y-2">
              <Label htmlFor="mode">Execution Mode</Label>
              <Select
                value={config.mode}
                onValueChange={(value) => updateConfig({ mode: value as ExecutionMode })}
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

                {/* Voice Settings */}
                <div className="space-y-3 border-t pt-3">
                  <h4 className="text-sm font-medium">Voice Settings</h4>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="voice-enabled" className="cursor-pointer">
                      Enable Voice Features
                    </Label>
                    <Switch
                      id="voice-enabled"
                      checked={config.voice?.enabled ?? false}
                      onCheckedChange={(enabled) =>
                        updateVoiceConfig({ enabled, inputEnabled: enabled, outputEnabled: enabled })
                      }
                    />
                  </div>

                  {config.voice?.enabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="voice-input" className="cursor-pointer">
                          Voice Input (Speech-to-Text)
                        </Label>
                        <Switch
                          id="voice-input"
                          checked={config.voice?.inputEnabled ?? false}
                          onCheckedChange={(inputEnabled) => updateVoiceConfig({ inputEnabled })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="voice-output" className="cursor-pointer">
                          Voice Output (Text-to-Speech)
                        </Label>
                        <Switch
                          id="voice-output"
                          checked={config.voice?.outputEnabled ?? false}
                          onCheckedChange={(outputEnabled) => updateVoiceConfig({ outputEnabled })}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="voice-rate">Speech Rate ({config.voice?.rate ?? 1}x)</Label>
                        <input
                          id="voice-rate"
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.1"
                          className="w-full"
                          value={config.voice?.rate ?? 1}
                          onChange={(e) =>
                            updateVoiceConfig({ rate: parseFloat(e.target.value) })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="voice-pitch">Speech Pitch ({config.voice?.pitch ?? 1})</Label>
                        <input
                          id="voice-pitch"
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          className="w-full"
                          value={config.voice?.pitch ?? 1}
                          onChange={(e) =>
                            updateVoiceConfig({ pitch: parseFloat(e.target.value) })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="auto-speak" className="cursor-pointer">
                          Auto-speak agent messages
                        </Label>
                        <Switch
                          id="auto-speak"
                          checked={config.voice?.autoSpeak ?? true}
                          onCheckedChange={(autoSpeak) => updateVoiceConfig({ autoSpeak })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="interrupt-input" className="cursor-pointer">
                          Interrupt on user input
                        </Label>
                        <Switch
                          id="interrupt-input"
                          checked={config.voice?.interruptOnInput ?? true}
                          onCheckedChange={(interruptOnInput) =>
                            updateVoiceConfig({ interruptOnInput })
                          }
                        />
                      </div>
                    </>
                  )}
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
