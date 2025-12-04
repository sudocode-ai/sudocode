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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ExecutionConfig, CleanupMode } from '@/types/execution'
import { ClaudeCodeConfigForm, type ClaudeCodeConfig } from './ClaudeCodeConfigForm'
import { CodexConfigForm, type CodexConfig } from './CodexConfigForm'
import { CursorConfigForm, type CursorConfig } from './CursorConfigForm'
import { CopilotConfigForm, type CopilotConfig } from './CopilotConfigForm'
import { Separator } from '@/components/ui/separator'

interface AgentSettingsDialogProps {
  open: boolean
  config: ExecutionConfig
  onConfigChange: (updates: Partial<ExecutionConfig>) => void
  onClose: () => void
  agentType?: string
}

export function AgentSettingsDialog({
  open,
  config,
  onConfigChange,
  onClose,
  agentType,
}: AgentSettingsDialogProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onClose()
    }
  }

  // Render agent-specific configuration UI based on agent type
  const renderAgentSpecificConfig = () => {
    if (!agentType) {
      return null
    }

    switch (agentType) {
      case 'claude-code':
        return (
          <>
            <div>
              <h3 className="mb-3 text-sm font-medium">Claude Code Configuration</h3>
              <ClaudeCodeConfigForm
                config={(config.agentConfig ?? {}) as ClaudeCodeConfig}
                onChange={(newAgentConfig) => {
                  onConfigChange({ agentConfig: newAgentConfig })
                }}
              />
            </div>
            <Separator />
          </>
        )
      case 'codex':
        return (
          <>
            <div>
              <h3 className="mb-3 text-sm font-medium">Codex Configuration</h3>
              <CodexConfigForm
                config={(config.agentConfig ?? {}) as CodexConfig}
                onChange={(newAgentConfig) => {
                  onConfigChange({ agentConfig: newAgentConfig })
                }}
              />
            </div>
            <Separator />
          </>
        )
      case 'cursor':
        return (
          <>
            <div>
              <h3 className="mb-3 text-sm font-medium">Cursor Configuration</h3>
              <CursorConfigForm
                config={(config.agentConfig ?? {}) as CursorConfig}
                onChange={(newAgentConfig) => {
                  onConfigChange({ agentConfig: newAgentConfig })
                }}
              />
            </div>
            <Separator />
          </>
        )
      case 'copilot':
        return (
          <>
            <div>
              <h3 className="mb-3 text-sm font-medium">Copilot Configuration</h3>
              <CopilotConfigForm
                config={(config.agentConfig ?? {}) as CopilotConfig}
                onChange={(newAgentConfig) => {
                  onConfigChange({ agentConfig: newAgentConfig })
                }}
              />
            </div>
            <Separator />
          </>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => {
          // Stop propagation to prevent parent components (like IssuePanel) from handling the click
          // But don't preventDefault so the dialog can still close
          e.stopPropagation()
        }}
      >
        <DialogHeader>
          <DialogTitle>Advanced Agent Settings</DialogTitle>
          <DialogDescription>
            Configure advanced execution parameters for fine-tuned control.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Agent-Specific Configuration */}
          {renderAgentSpecificConfig()}

          {/* General Execution Settings */}
          <div>
            <h3 className="mb-3 text-sm font-medium">Execution Settings</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cleanupMode">Worktree Cleanup Mode</Label>
                <Select
                  value={config.cleanupMode ?? 'manual'}
                  onValueChange={(value) => onConfigChange({ cleanupMode: value as CleanupMode })}
                >
                  <SelectTrigger id="cleanupMode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto Cleanup</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Auto: cleanup on successful completion. Manual: user must cleanup. Never: no
                  auto-cleanup (for debugging).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (ms)</Label>
                <input
                  id="timeout"
                  type="number"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={config.timeout ?? ''}
                  onChange={(e) =>
                    onConfigChange({
                      timeout: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  placeholder="No timeout"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum execution time in milliseconds. Leave empty for no timeout.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <input
                  id="maxTokens"
                  type="number"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={config.maxTokens ?? ''}
                  onChange={(e) =>
                    onConfigChange({
                      maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  placeholder="Model default"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of tokens to generate. Leave empty to use model default.
                </p>
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
                    onConfigChange({
                      temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="Model default"
                />
                <p className="text-xs text-muted-foreground">
                  Controls randomness (0-2). Lower is more focused, higher is more creative.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
