/**
 * Codex Configuration Form Component
 *
 * Provides UI for configuring OpenAI Codex-specific execution settings.
 */

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import axios from 'axios'

export interface CodexConfig {
  model?: string
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  askForApproval?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  fullAuto?: boolean
  search?: boolean
  json?: boolean
  color?: 'always' | 'never' | 'auto'
}

interface CodexConfigFormProps {
  config: CodexConfig
  onChange: (config: CodexConfig) => void
}

// Special value for "let agent decide" - will be converted to undefined when saving
const DEFAULT_MODEL_VALUE = '__default__'

// Default option shown while loading or if API fails
const DEFAULT_MODEL_OPTION = { value: DEFAULT_MODEL_VALUE, label: 'Default (Agent Decides)' }

/**
 * Format a model ID into a human-readable label
 */
function formatModelName(modelId: string): string {
  // Handle common patterns
  if (modelId.includes('gpt')) {
    return modelId.toUpperCase().replace(/-/g, ' ')
  }
  if (modelId.includes('o1') || modelId.includes('o3')) {
    return modelId.toUpperCase()
  }
  // Fallback: capitalize and clean up
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ModelOption {
  value: string
  label: string
}

const SANDBOX_OPTIONS = [
  { value: 'read-only', label: 'Read Only', description: 'Can only read files' },
  { value: 'workspace-write', label: 'Workspace Write', description: 'Can write to workspace' },
  { value: 'danger-full-access', label: 'Full Access', description: 'Unrestricted access' },
]

const APPROVAL_OPTIONS = [
  { value: 'untrusted', label: 'Untrusted', description: 'Ask for every action' },
  { value: 'on-failure', label: 'On Failure', description: 'Ask only when operations fail' },
  { value: 'on-request', label: 'On Request', description: 'Ask when agent requests approval' },
  { value: 'never', label: 'Never', description: 'Never ask for approval' },
]

export function CodexConfigForm({ config, onChange }: CodexConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [models, setModels] = useState<ModelOption[]>([DEFAULT_MODEL_OPTION])
  const [modelsLoading, setModelsLoading] = useState(true)

  // Fetch available models from the agent
  useEffect(() => {
    let cancelled = false

    async function fetchModels() {
      try {
        // Use axios directly - /agents endpoints don't use ApiResponse wrapper
        const response = await axios.get<{ models: string[]; cached: boolean; fallback?: boolean }>(
          '/api/agents/codex/models'
        )

        if (cancelled) return

        const data = response.data

        if (data.models && data.models.length > 0) {
          // Filter out "default" from API response (we add our own Default option)
          const apiModels = data.models
            .filter((model: string) => model.toLowerCase() !== 'default')
            .map((model: string) => ({
              value: model,
              label: formatModelName(model),
            }))

          setModels([DEFAULT_MODEL_OPTION, ...apiModels])
        }
      } catch (error) {
        // Keep just the default option on error
        console.warn('Failed to fetch Codex models:', error)
      } finally {
        if (!cancelled) {
          setModelsLoading(false)
        }
      }
    }

    fetchModels()

    return () => {
      cancelled = true
    }
  }, [])

  const validateConfig = (newConfig: CodexConfig): Record<string, string> => {
    const newErrors: Record<string, string> = {}

    // Validate fullAuto conflicts with sandbox/approval
    if (newConfig.fullAuto && (newConfig.sandbox || newConfig.askForApproval)) {
      newErrors.fullAuto = 'Full Auto mode conflicts with custom sandbox or approval settings'
    }

    return newErrors
  }

  const updateConfig = (updates: Partial<CodexConfig>) => {
    const newConfig = { ...config, ...updates }
    const validationErrors = validateConfig(newConfig)
    setErrors(validationErrors)
    onChange(newConfig)
  }

  return (
    <div className="space-y-4">
      {/* Validation Errors */}
      {Object.keys(errors).length > 0 && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {Object.values(errors).map((error, i) => (
            <div key={i}>{error}</div>
          ))}
        </div>
      )}
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="codex-model" className="text-xs flex items-center gap-1">
          Model
          {modelsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </Label>
        <Select
          value={config.model || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateConfig({ model: value === DEFAULT_MODEL_VALUE ? undefined : value })
          }
        >
          <SelectTrigger id="codex-model" className="h-8 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.value || 'default'} value={model.value} className="text-xs">
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Full Auto Mode */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="codex-full-auto" className="text-xs font-medium">
            Full Auto Mode
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Workspace write + auto-approve on failure
          </p>
        </div>
        <Switch
          id="codex-full-auto"
          checked={config.fullAuto ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ fullAuto: checked })}
        />
      </div>

      {/* Web Search */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="codex-search" className="text-xs font-medium">
            Web Search
          </Label>
          <p className="text-[10px] text-muted-foreground">Enable web browsing capability</p>
        </div>
        <Switch
          id="codex-search"
          checked={config.search ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ search: checked })}
        />
      </div>

      {/* JSON Output */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="codex-json" className="text-xs font-medium">
            JSON Output
          </Label>
          <p className="text-[10px] text-muted-foreground">Structured output format</p>
        </div>
        <Switch
          id="codex-json"
          checked={config.json ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ json: checked })}
        />
      </div>

      {/* Advanced Settings */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted">
          <span>Advanced Settings</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          {/* Sandbox Policy (disabled when fullAuto is enabled) */}
          <div className="space-y-2">
            <Label
              htmlFor="codex-sandbox"
              className={`text-xs ${config.fullAuto ? 'text-muted-foreground' : ''}`}
            >
              Sandbox Policy
            </Label>
            <Select
              value={config.sandbox || 'workspace-write'}
              onValueChange={(value) =>
                updateConfig({
                  sandbox: value as CodexConfig['sandbox'],
                })
              }
              disabled={config.fullAuto}
            >
              <SelectTrigger id="codex-sandbox" className="h-8 text-xs" disabled={config.fullAuto}>
                <SelectValue placeholder="Select sandbox policy" />
              </SelectTrigger>
              <SelectContent>
                {SANDBOX_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    <div>
                      <div>{option.label}</div>
                      <div className="text-[10px] text-muted-foreground">{option.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {config.fullAuto && (
              <p className="text-[10px] text-muted-foreground">
                Disabled when Full Auto Mode is enabled
              </p>
            )}
          </div>

          {/* Approval Policy (disabled when fullAuto is enabled) */}
          <div className="space-y-2">
            <Label
              htmlFor="codex-approval"
              className={`text-xs ${config.fullAuto ? 'text-muted-foreground' : ''}`}
            >
              Approval Policy
            </Label>
            <Select
              value={config.askForApproval || 'on-failure'}
              onValueChange={(value) =>
                updateConfig({
                  askForApproval: value as CodexConfig['askForApproval'],
                })
              }
              disabled={config.fullAuto}
            >
              <SelectTrigger id="codex-approval" className="h-8 text-xs" disabled={config.fullAuto}>
                <SelectValue placeholder="Select approval policy" />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    <div>
                      <div>{option.label}</div>
                      <div className="text-[10px] text-muted-foreground">{option.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {config.fullAuto && (
              <p className="text-[10px] text-muted-foreground">
                Disabled when Full Auto Mode is enabled
              </p>
            )}
          </div>

          {/* Color Output */}
          <div className="space-y-2">
            <Label htmlFor="codex-color" className="text-xs">
              Color Output
            </Label>
            <Select
              value={config.color || 'auto'}
              onValueChange={(value) =>
                updateConfig({
                  color: value as CodexConfig['color'],
                })
              }
            >
              <SelectTrigger id="codex-color" className="h-8 text-xs">
                <SelectValue placeholder="Select color mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">
                  Auto
                </SelectItem>
                <SelectItem value="always" className="text-xs">
                  Always
                </SelectItem>
                <SelectItem value="never" className="text-xs">
                  Never
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
