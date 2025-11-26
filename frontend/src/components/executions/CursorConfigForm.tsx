/**
 * Cursor Configuration Form Component
 *
 * Provides UI for configuring Cursor-specific execution settings.
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

export interface CursorConfig {
  force?: boolean
  model?: 'auto' | 'sonnet-4.5' | 'sonnet-4.5-thinking' | 'gpt-5' | 'opus-4.1' | 'grok' | string
}

interface CursorConfigFormProps {
  config: CursorConfig
  onChange: (config: CursorConfig) => void
}

const MODELS = [
  { value: 'auto', label: 'Auto (Recommended)', description: 'Let Cursor choose the best model' },
  { value: 'sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'Balanced performance' },
  {
    value: 'sonnet-4.5-thinking',
    label: 'Claude Sonnet 4.5 (Thinking)',
    description: 'Extended reasoning',
  },
  { value: 'gpt-5', label: 'GPT-5', description: 'OpenAI GPT-5' },
  { value: 'opus-4.1', label: 'Claude Opus 4.1', description: 'Most capable' },
  { value: 'grok', label: 'Grok', description: 'xAI Grok' },
]

export function CursorConfigForm({ config, onChange }: CursorConfigFormProps) {
  const updateConfig = (updates: Partial<CursorConfig>) => {
    onChange({ ...config, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="cursor-model" className="text-xs">
          Model
        </Label>
        <Select
          value={config.model || 'auto'}
          onValueChange={(value) => updateConfig({ model: value })}
        >
          <SelectTrigger id="cursor-model" className="h-8 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((model) => (
              <SelectItem key={model.value} value={model.value} className="text-xs">
                <div>
                  <div>{model.label}</div>
                  <div className="text-[10px] text-muted-foreground">{model.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Choose which AI model Cursor should use for code generation
        </p>
      </div>

      {/* Force Auto-Approval */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="cursor-force" className="text-xs font-medium">
            Auto-Approve Actions
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Automatically approve all tool executions without prompts
          </p>
        </div>
        <Switch
          id="cursor-force"
          checked={config.force ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ force: checked })}
        />
      </div>
    </div>
  )
}
