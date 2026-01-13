/**
 * Claude Code Configuration Form Component
 *
 * Provides UI for configuring Claude Code-specific execution settings.
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

export interface ClaudeCodeConfig {
  model?: string
  dangerouslySkipPermissions?: boolean
  restrictToWorkDir?: boolean
  permissionMode?: 'default' | 'plan' | 'bypassPermissions'
}

interface ClaudeCodeConfigFormProps {
  config: ClaudeCodeConfig
  onChange: (config: ClaudeCodeConfig) => void
}

// Special value for "let agent decide" - will be converted to undefined when saving
const DEFAULT_MODEL_VALUE = '__default__'

// Default option shown while loading or if API fails
const DEFAULT_MODEL_OPTION = { value: DEFAULT_MODEL_VALUE, label: 'Default (Agent Decides)' }

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', description: 'Standard permission prompts' },
  { value: 'plan', label: 'Plan Mode', description: 'Read-only planning before execution' },
  {
    value: 'bypassPermissions',
    label: 'Bypass Permissions',
    description: 'Skip all prompts (YOLO mode)',
  },
]

/**
 * Format a model ID into a human-readable label
 * e.g., "claude-sonnet-4-20250514" -> "Claude Sonnet 4"
 */
function formatModelName(modelId: string): string {
  // Handle common short names
  const shortNames: Record<string, string> = {
    sonnet: 'Claude Sonnet',
    opus: 'Claude Opus',
    haiku: 'Claude Haiku',
  }

  if (shortNames[modelId.toLowerCase()]) {
    return shortNames[modelId.toLowerCase()]
  }

  // Parse full model IDs like "claude-sonnet-4-20250514"
  const match = modelId.match(/^claude[_-]?(sonnet|opus|haiku)[_-]?(\d+(?:\.\d+)?)?/i)
  if (match) {
    const modelType = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
    const version = match[2] || ''
    return `Claude ${modelType}${version ? ` ${version}` : ''}`
  }

  // Fallback: capitalize and clean up
  return modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ModelOption {
  value: string
  label: string
}

export function ClaudeCodeConfigForm({ config, onChange }: ClaudeCodeConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Start with just the default option while loading
  const [models, setModels] = useState<ModelOption[]>([DEFAULT_MODEL_OPTION])
  const [modelsLoading, setModelsLoading] = useState(true)

  // Fetch available models from the agent
  useEffect(() => {
    let cancelled = false

    async function fetchModels() {
      try {
        // Use axios directly - /agents endpoints don't use ApiResponse wrapper
        const response = await axios.get<{ models: string[]; cached: boolean; fallback?: boolean }>(
          '/api/agents/claude-code/models'
        )

        if (cancelled) return

        const data = response.data

        if (data.models && data.models.length > 0) {
          // Filter out "default" from API response (we add our own Default option)
          // and build model options
          const apiModels = data.models
            .filter((model: string) => model.toLowerCase() !== 'default')
            .map((model: string) => ({
              value: model,
              label: formatModelName(model),
            }))

          // Always include our Default option first, then dynamic models from API
          setModels([DEFAULT_MODEL_OPTION, ...apiModels])
        }
      } catch (error) {
        // Keep just the default option on error
        console.warn('Failed to fetch models:', error)
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

  const updateConfig = (updates: Partial<ClaudeCodeConfig>) => {
    onChange({ ...config, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="claude-model" className="flex items-center gap-1 text-xs">
          Model
          {modelsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </Label>
        <Select
          value={config.model || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateConfig({ model: value === DEFAULT_MODEL_VALUE ? undefined : value })
          }
        >
          <SelectTrigger id="claude-model" className="h-8 text-xs">
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

      {/* Restrict to Workdir */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="claude-restrict-workdir" className="text-xs font-medium">
            Restrict to Working Directory
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Block file operations outside the worktree/project directory
          </p>
        </div>
        <Switch
          id="claude-restrict-workdir"
          checked={config.restrictToWorkDir ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ restrictToWorkDir: checked })}
        />
      </div>

      {/* Skip Permissions */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="claude-skip-permissions" className="text-xs font-medium">
            Skip Permission Prompts
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Auto-approve all tool operations (faster but less safe)
          </p>
        </div>
        <Switch
          id="claude-skip-permissions"
          checked={config.dangerouslySkipPermissions ?? false}
          onCheckedChange={(checked: boolean) =>
            updateConfig({ dangerouslySkipPermissions: checked })
          }
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
          {/* Session Mode */}
          <div className="space-y-2">
            <Label htmlFor="claude-session-mode" className="text-xs">
              Session Mode
            </Label>
            <Select
              value={config.permissionMode || 'default'}
              onValueChange={(value) =>
                updateConfig({
                  permissionMode: value as ClaudeCodeConfig['permissionMode'],
                })
              }
            >
              <SelectTrigger id="claude-session-mode" className="h-8 text-xs">
                <SelectValue placeholder="Select session mode" />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_MODES.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    <div>
                      <div>{option.label}</div>
                      <div className="text-[10px] text-muted-foreground">{option.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
