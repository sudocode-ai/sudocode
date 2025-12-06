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
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

export interface ClaudeCodeConfig {
  model?: string
  dangerouslySkipPermissions?: boolean
  restrictToWorkDir?: boolean
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'
}

interface ClaudeCodeConfigFormProps {
  config: ClaudeCodeConfig
  onChange: (config: ClaudeCodeConfig) => void
}

const MODELS = [
  { value: 'sonnet', label: 'Claude Sonnet (Default)' },
  { value: 'opus', label: 'Claude Opus' },
  { value: 'haiku', label: 'Claude Haiku' },
]

const PERMISSION_MODES = [
  { value: 'default', label: 'Default', description: 'Standard permission prompts' },
  { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file edits' },
  { value: 'dontAsk', label: "Don't Ask", description: 'Minimal prompts' },
  { value: 'plan', label: 'Plan Mode', description: 'Plan before executing' },
  { value: 'bypassPermissions', label: 'Bypass Permissions', description: 'Skip all prompts' },
]

export function ClaudeCodeConfigForm({ config, onChange }: ClaudeCodeConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const updateConfig = (updates: Partial<ClaudeCodeConfig>) => {
    onChange({ ...config, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label htmlFor="claude-model" className="text-xs">
          Model
        </Label>
        <Select
          value={config.model || 'sonnet'}
          onValueChange={(value) => updateConfig({ model: value })}
        >
          <SelectTrigger id="claude-model" className="h-8 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((model) => (
              <SelectItem key={model.value} value={model.value} className="text-xs">
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
          {/* Permission Mode (disabled when dangerouslySkipPermissions is enabled) */}
          <div className="space-y-2">
            <Label
              htmlFor="claude-permission-mode"
              className={`text-xs ${config.dangerouslySkipPermissions ? 'text-muted-foreground' : ''}`}
            >
              Permission Mode
            </Label>
            <Select
              value={config.permissionMode || 'default'}
              onValueChange={(value) =>
                updateConfig({
                  permissionMode: value as ClaudeCodeConfig['permissionMode'],
                })
              }
              disabled={config.dangerouslySkipPermissions}
            >
              <SelectTrigger
                id="claude-permission-mode"
                className="h-8 text-xs"
                disabled={config.dangerouslySkipPermissions}
              >
                <SelectValue placeholder="Select permission mode" />
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
            {config.dangerouslySkipPermissions && (
              <p className="text-[10px] text-muted-foreground">
                Disabled when Skip Permission Prompts is enabled
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
