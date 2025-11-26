/**
 * Copilot Configuration Form Component
 *
 * Provides UI for configuring GitHub Copilot-specific execution settings.
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

export interface CopilotConfig {
  model?: string
  allowAllTools?: boolean
  allowTool?: string
  denyTool?: string
  copilotPath?: string
}

interface CopilotConfigFormProps {
  config: CopilotConfig
  onChange: (config: CopilotConfig) => void
}

const MODELS = [
  { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (Default)', description: 'Latest Anthropic model' },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Anthropic Sonnet 4' },
  { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', description: 'Fast responses' },
  { value: 'gpt-5', label: 'GPT-5', description: 'Latest OpenAI model' },
  { value: 'gpt-5.1', label: 'GPT-5.1', description: 'Latest OpenAI model' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: 'Optimized for code' },
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Google\'s latest model' },
]

const COMMON_TOOLS = [
  { value: 'bash', label: 'Bash', description: 'Execute shell commands' },
  { value: 'read_file', label: 'Read File', description: 'Read file contents' },
  { value: 'write_file', label: 'Write File', description: 'Write to files' },
  { value: 'list_directory', label: 'List Directory', description: 'List directory contents' },
  { value: 'search_files', label: 'Search Files', description: 'Search in files' },
  { value: 'web_search', label: 'Web Search', description: 'Search the web' },
]

export function CopilotConfigForm({ config, onChange }: CopilotConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateConfig = (newConfig: CopilotConfig): Record<string, string> => {
    const newErrors: Record<string, string> = {}

    // Validate tool permissions conflicts
    if (newConfig.allowAllTools && newConfig.allowTool) {
      newErrors.allowTool = 'allowTool is ignored when allowAllTools is enabled'
    }

    if (newConfig.allowAllTools && newConfig.denyTool) {
      newErrors.denyTool = 'denyTool takes precedence over allowAllTools'
    }

    return newErrors
  }

  const updateConfig = (updates: Partial<CopilotConfig>) => {
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
        <Label htmlFor="copilot-model" className="text-xs">
          Model
        </Label>
        <Select
          value={config.model || 'claude-sonnet-4.5'}
          onValueChange={(value) => updateConfig({ model: value })}
        >
          <SelectTrigger id="copilot-model" className="h-8 text-xs">
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
          Choose which AI model Copilot should use. Leave default to use your account setting.
        </p>
      </div>

      {/* Allow All Tools */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="copilot-allow-all-tools" className="text-xs font-medium">
            Allow All Tools
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Automatically approve all tool executions without prompts
          </p>
        </div>
        <Switch
          id="copilot-allow-all-tools"
          checked={config.allowAllTools ?? true}
          onCheckedChange={(checked: boolean) => updateConfig({ allowAllTools: checked })}
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
          {/* Allow Specific Tools (disabled when allowAllTools is enabled) */}
          <div className="space-y-2">
            <Label
              htmlFor="copilot-allow-tool"
              className={`text-xs ${config.allowAllTools ? 'text-muted-foreground' : ''}`}
            >
              Allow Specific Tools
            </Label>
            <input
              id="copilot-allow-tool"
              type="text"
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              value={config.allowTool || ''}
              onChange={(e) => updateConfig({ allowTool: e.target.value })}
              placeholder="bash,read_file,write_file"
              disabled={config.allowAllTools}
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated list of allowed tools (e.g., bash,read_file)
            </p>
            {config.allowAllTools && (
              <p className="text-[10px] text-destructive">
                Ignored when Allow All Tools is enabled
              </p>
            )}
          </div>

          {/* Deny Specific Tools */}
          <div className="space-y-2">
            <Label htmlFor="copilot-deny-tool" className="text-xs">
              Deny Specific Tools
            </Label>
            <input
              id="copilot-deny-tool"
              type="text"
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              value={config.denyTool || ''}
              onChange={(e) => updateConfig({ denyTool: e.target.value })}
              placeholder="bash,web_search"
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated list of denied tools. Takes precedence over allow settings.
            </p>
          </div>

          {/* Custom Copilot Path */}
          <div className="space-y-2">
            <Label htmlFor="copilot-path" className="text-xs">
              Custom Copilot CLI Path
            </Label>
            <input
              id="copilot-path"
              type="text"
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
              value={config.copilotPath || ''}
              onChange={(e) => updateConfig({ copilotPath: e.target.value })}
              placeholder="copilot"
            />
            <p className="text-[10px] text-muted-foreground">
              Path to Copilot CLI executable. Leave empty to use system default.
            </p>
          </div>

          {/* Common Tools Reference */}
          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
            <Label className="text-xs font-medium">Common Tool Names</Label>
            <div className="grid grid-cols-2 gap-1">
              {COMMON_TOOLS.map((tool) => (
                <div key={tool.value} className="text-[10px]">
                  <code className="rounded bg-muted px-1 py-0.5">{tool.value}</code>
                  <span className="ml-1 text-muted-foreground">{tool.label}</span>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
