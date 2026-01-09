/**
 * Gemini Configuration Form Component
 *
 * Provides UI for configuring Google Gemini CLI-specific execution settings.
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

export interface GeminiConfig {
  model?: string
  sandbox?: boolean
  yolo?: boolean
}

interface GeminiConfigFormProps {
  config: GeminiConfig
  onChange: (config: GeminiConfig) => void
}

// Special value for "let agent decide" - will be converted to undefined when saving
const DEFAULT_MODEL_VALUE = '__default__'

// Default option shown while loading or if API fails
const DEFAULT_MODEL_OPTION = { value: DEFAULT_MODEL_VALUE, label: 'Default (Agent Decides)' }

/**
 * Format a model ID into a human-readable label
 */
function formatModelName(modelId: string): string {
  // Handle Gemini model patterns
  const shortNames: Record<string, string> = {
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-2.0-pro': 'Gemini 2.0 Pro',
    'gemini-1.5-flash': 'Gemini 1.5 Flash',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
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

export function GeminiConfigForm({ config, onChange }: GeminiConfigFormProps) {
  const [models, setModels] = useState<ModelOption[]>([DEFAULT_MODEL_OPTION])
  const [modelsLoading, setModelsLoading] = useState(true)

  // Fetch available models from the agent
  useEffect(() => {
    let cancelled = false

    async function fetchModels() {
      try {
        // Use axios directly - /agents endpoints don't use ApiResponse wrapper
        const response = await axios.get<{ models: string[]; cached: boolean; fallback?: boolean }>(
          '/api/agents/gemini/models'
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
        console.warn('Failed to fetch Gemini models:', error)
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

  const updateConfig = (updates: Partial<GeminiConfig>) => {
    onChange({ ...config, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="gemini-model" className="text-xs flex items-center gap-1">
          Model
          {modelsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </Label>
        <Select
          value={config.model || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateConfig({ model: value === DEFAULT_MODEL_VALUE ? undefined : value })
          }
        >
          <SelectTrigger id="gemini-model" className="h-8 text-xs">
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

      {/* Sandbox Mode */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="gemini-sandbox" className="text-xs font-medium">
            Sandbox Mode
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Run in isolated sandbox environment
          </p>
        </div>
        <Switch
          id="gemini-sandbox"
          checked={config.sandbox ?? false}
          onCheckedChange={(checked: boolean) => updateConfig({ sandbox: checked })}
        />
      </div>

      {/* YOLO Mode (Skip Permissions) */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="gemini-yolo" className="text-xs font-medium">
            YOLO Mode
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Auto-approve all tool operations (faster but less safe)
          </p>
        </div>
        <Switch
          id="gemini-yolo"
          checked={config.yolo ?? false}
          onCheckedChange={(checked: boolean) => updateConfig({ yolo: checked })}
        />
      </div>
    </div>
  )
}
