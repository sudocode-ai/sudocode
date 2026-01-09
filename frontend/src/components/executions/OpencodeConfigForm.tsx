/**
 * Opencode Configuration Form Component
 *
 * Provides UI for configuring Opencode-specific execution settings.
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
import { Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import axios from 'axios'

export interface OpencodeConfig {
  model?: string
  dangerouslySkipPermissions?: boolean
}

interface OpencodeConfigFormProps {
  config: OpencodeConfig
  onChange: (config: OpencodeConfig) => void
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
  const shortNames: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'gpt-4': 'GPT-4',
    'claude-sonnet': 'Claude Sonnet',
    'claude-opus': 'Claude Opus',
  }

  if (shortNames[modelId.toLowerCase()]) {
    return shortNames[modelId.toLowerCase()]
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

export function OpencodeConfigForm({ config, onChange }: OpencodeConfigFormProps) {
  const [models, setModels] = useState<ModelOption[]>([DEFAULT_MODEL_OPTION])
  const [modelsLoading, setModelsLoading] = useState(true)

  // Fetch available models from the agent
  useEffect(() => {
    let cancelled = false

    async function fetchModels() {
      try {
        // Use axios directly - /agents endpoints don't use ApiResponse wrapper
        const response = await axios.get<{ models: string[]; cached: boolean; fallback?: boolean }>(
          '/api/agents/opencode/models'
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
        console.warn('Failed to fetch Opencode models:', error)
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

  const updateConfig = (updates: Partial<OpencodeConfig>) => {
    onChange({ ...config, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="opencode-model" className="text-xs flex items-center gap-1">
          Model
          {modelsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </Label>
        <Select
          value={config.model || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateConfig({ model: value === DEFAULT_MODEL_VALUE ? undefined : value })
          }
        >
          <SelectTrigger id="opencode-model" className="h-8 text-xs">
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

      {/* Skip Permissions */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="opencode-skip-permissions" className="text-xs font-medium">
            Skip Permission Prompts
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Auto-approve all tool operations (faster but less safe)
          </p>
        </div>
        <Switch
          id="opencode-skip-permissions"
          checked={config.dangerouslySkipPermissions ?? false}
          onCheckedChange={(checked: boolean) =>
            updateConfig({ dangerouslySkipPermissions: checked })
          }
        />
      </div>
    </div>
  )
}
