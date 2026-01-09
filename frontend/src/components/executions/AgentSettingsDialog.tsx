import { useState, useRef, useCallback, useEffect } from 'react'
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
import type { ExecutionConfig, ExecutionMode } from '@/types/execution'
import type { AgentInfo } from '@/types/api'
import { ClaudeCodeConfigForm, type ClaudeCodeConfig } from './ClaudeCodeConfigForm'
import { CodexConfigForm, type CodexConfig } from './CodexConfigForm'
import { CursorConfigForm, type CursorConfig } from './CursorConfigForm'
import { CopilotConfigForm, type CopilotConfig } from './CopilotConfigForm'
import { GeminiConfigForm, type GeminiConfig } from './GeminiConfigForm'
import { OpencodeConfigForm, type OpencodeConfig } from './OpencodeConfigForm'
import { AgentSelector } from './AgentSelector'
import { BranchSelector } from './BranchSelector'
import { Separator } from '@/components/ui/separator'
import { Bot, Sliders, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

// Section configuration
interface Section {
  id: string
  label: string
  icon: React.ReactNode
}

const SECTIONS: Section[] = [
  { id: 'agent', label: 'Model & Agent', icon: <Bot className="h-4 w-4" /> },
  { id: 'execution', label: 'Execution', icon: <Sliders className="h-4 w-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <Wrench className="h-4 w-4" /> },
]

interface AgentSettingsDialogProps {
  open: boolean
  config: ExecutionConfig
  onConfigChange: (updates: Partial<ExecutionConfig>) => void
  onClose: () => void
  agentType?: string
  /** Optional: Enable agent type selection within the dialog */
  onAgentTypeChange?: (agentType: string) => void
  /** Optional: List of available agents for selection */
  availableAgents?: AgentInfo[]
  /** Optional: Available branches for worktree mode */
  availableBranches?: string[]
  /** Optional: Show execution mode selector (worktree/local) */
  showModeSelector?: boolean
}

export function AgentSettingsDialog({
  open,
  config,
  onConfigChange,
  onClose,
  agentType,
  onAgentTypeChange,
  availableAgents,
  availableBranches = [],
  showModeSelector = false,
}: AgentSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<string>('agent')
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onClose()
    }
  }

  // Scroll to section when clicking navigation
  const scrollToSection = useCallback((sectionId: string) => {
    const section = sectionRefs.current[sectionId]
    if (section && contentRef.current) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(sectionId)
    }
  }, [])

  // Track active section based on scroll position
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const handleScroll = () => {
      const containerTop = content.getBoundingClientRect().top

      let currentSection = 'agent'

      for (const section of SECTIONS) {
        const element = sectionRefs.current[section.id]
        if (element) {
          const rect = element.getBoundingClientRect()
          const relativeTop = rect.top - containerTop

          // If section is at or above the top of the viewport, it's the active one
          if (relativeTop <= 20) {
            currentSection = section.id
          }
        }
      }

      setActiveSection(currentSection)
    }

    content.addEventListener('scroll', handleScroll)
    return () => content.removeEventListener('scroll', handleScroll)
  }, [])

  // Reset to first section when dialog opens
  useEffect(() => {
    if (open) {
      setActiveSection('agent')
      // Scroll to top when opening
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    }
  }, [open])

  // Render agent-specific configuration UI based on agent type
  const renderAgentSpecificConfig = () => {
    if (!agentType) {
      return (
        <p className="text-sm text-muted-foreground">
          Select an agent to see model and agent-specific settings.
        </p>
      )
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
          <CodexConfigForm
            config={(config.agentConfig ?? {}) as CodexConfig}
            onChange={(newAgentConfig) => {
              onConfigChange({ agentConfig: newAgentConfig })
            }}
          />
        )
      case 'cursor':
        return (
          <CursorConfigForm
            config={(config.agentConfig ?? {}) as CursorConfig}
            onChange={(newAgentConfig) => {
              onConfigChange({ agentConfig: newAgentConfig })
            }}
          />
        )
      case 'copilot':
        return (
          <CopilotConfigForm
            config={(config.agentConfig ?? {}) as CopilotConfig}
            onChange={(newAgentConfig) => {
              onConfigChange({ agentConfig: newAgentConfig })
            }}
          />
        )
      case 'gemini':
        return (
          <GeminiConfigForm
            config={(config.agentConfig ?? {}) as GeminiConfig}
            onChange={(newAgentConfig) => {
              onConfigChange({ agentConfig: newAgentConfig })
            }}
          />
        )
      case 'opencode':
        return (
          <OpencodeConfigForm
            config={(config.agentConfig ?? {}) as OpencodeConfig}
            onChange={(newAgentConfig) => {
              onConfigChange({ agentConfig: newAgentConfig })
            }}
          />
        )
      default:
        return (
          <p className="text-sm text-muted-foreground">
            No specific settings available for this agent.
          </p>
        )
    }
  }

  // Get the available sections based on agent type
  const getAvailableSections = () => {
    // All sections are always visible, but content adapts
    return SECTIONS
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="max-h-[85vh] max-w-4xl gap-0 p-0"
        onPointerDownOutside={(e) => {
          // Stop propagation to prevent parent components (like IssuePanel) from handling the click
          // But don't preventDefault so the dialog can still close
          e.stopPropagation()
        }}
      >
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>Advanced Agent Settings</DialogTitle>
          <DialogDescription>
            Configure advanced execution parameters for fine-tuned control.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Left Navigation Sidebar */}
          <nav className="hidden w-48 shrink-0 flex-col border-r bg-muted/30 py-4 md:flex">
            {getAvailableSections().map((section) => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-muted/50',
                  activeSection === section.id
                    ? 'border-r-2 border-primary bg-muted font-medium text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </nav>

          {/* Mobile Navigation (dropdown style) */}
          <div className="border-b px-4 pb-4 pt-4 md:hidden">
            <Select value={activeSection} onValueChange={scrollToSection}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getAvailableSections().map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    <div className="flex items-center gap-2">
                      {section.icon}
                      <span>{section.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content Area */}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-6 py-4"
            style={{ maxHeight: 'calc(85vh - 180px)' }}
          >
            <div className="space-y-8">
              {/* Section: Model & Agent */}
              <section
                id="section-agent"
                ref={(el) => {
                  sectionRefs.current['agent'] = el
                }}
                className="scroll-mt-4"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Bot className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Model & Agent</h3>
                </div>
                <div className="space-y-4">
                  {/* Agent Type Selector (optional) */}
                  {availableAgents && availableAgents.length > 0 && onAgentTypeChange && (
                    <AgentSelector
                      agents={availableAgents}
                      selectedAgent={agentType || 'claude-code'}
                      onChange={onAgentTypeChange}
                      label="AI Agent"
                      description="Select the AI coding agent to use"
                    />
                  )}
                  {renderAgentSpecificConfig()}
                </div>
              </section>

              <Separator />

              {/* Section: Execution */}
              <section
                id="section-execution"
                ref={(el) => {
                  sectionRefs.current['execution'] = el
                }}
                className="scroll-mt-4"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Execution</h3>
                </div>
                <div className="space-y-4">
                  {/* Execution Mode Selector (optional) */}
                  {showModeSelector && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="execution-mode">Execution Mode</Label>
                        <Select
                          value={config.mode || 'worktree'}
                          onValueChange={(value: ExecutionMode) =>
                            onConfigChange({ mode: value })
                          }
                        >
                          <SelectTrigger id="execution-mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="worktree">
                              <div className="flex flex-col items-start">
                                <span>Worktree (Isolated)</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="local">
                              <div className="flex flex-col items-start">
                                <span>Local (In-place)</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Worktree mode runs in an isolated git worktree. Local mode runs directly in your working directory.
                        </p>
                      </div>

                      {/* Branch Selector (only in worktree mode) */}
                      {config.mode === 'worktree' && availableBranches.length > 0 && (
                        <div className="space-y-2">
                          <Label>Target Branch</Label>
                          <BranchSelector
                            branches={availableBranches}
                            value={config.baseBranch || availableBranches[0]}
                            onChange={(branch) => onConfigChange({ baseBranch: branch })}
                            placeholder="Select branch..."
                          />
                          <p className="text-xs text-muted-foreground">
                            The branch to base the worktree on.
                          </p>
                        </div>
                      )}
                    </>
                  )}

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
              </section>

              <Separator />

              {/* Section: Advanced */}
              <section
                id="section-advanced"
                ref={(el) => {
                  sectionRefs.current['advanced'] = el
                }}
                className="scroll-mt-4"
              >
                <div className="mb-4 flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Advanced</h3>
                </div>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Advanced agent-specific settings like sandbox policies and tool permissions are
                    available in the Model & Agent section above when the agent supports them.
                  </p>
                  <div className="rounded-md border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground">
                      <strong>Tip:</strong> For Codex and Copilot agents, expand the "Advanced
                      Settings" in the Model & Agent section to configure sandbox policies, approval
                      modes, and tool permissions.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
