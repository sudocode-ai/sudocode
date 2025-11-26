import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { AgentInfo } from '@/types/api'
import { Info } from 'lucide-react'

export interface AgentSelectorProps {
  /**
   * List of available agents to display in dropdown
   */
  agents: AgentInfo[]

  /**
   * Currently selected agent type
   */
  selectedAgent: string

  /**
   * Callback fired when agent selection changes
   */
  onChange: (agentType: string) => void

  /**
   * Whether the selector is disabled
   */
  disabled?: boolean

  /**
   * Optional label for the selector
   */
  label?: string

  /**
   * Optional description text
   */
  description?: string
}

/**
 * AgentSelector component for selecting an AI coding agent
 *
 * Displays a dropdown of available agents with their capabilities.
 * Unimplemented agents are disabled with a "Coming Soon" badge.
 *
 * @example
 * ```tsx
 * <AgentSelector
 *   agents={availableAgents}
 *   selectedAgent="claude-code"
 *   onChange={(agentType) => setAgentType(agentType)}
 *   label="Select AI Agent"
 * />
 * ```
 */
export function AgentSelector({
  agents,
  selectedAgent,
  onChange,
  disabled = false,
  label = 'AI Agent',
  description,
}: AgentSelectorProps) {
  const selected = agents.find((a) => a.type === selectedAgent)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {label && <Label htmlFor="agent-selector">{label}</Label>}
        {description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <Select
        value={selectedAgent}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger id="agent-selector" className="w-full">
          <SelectValue>
            {selected && (
              <div className="flex items-center gap-2">
                <span>{selected.displayName}</span>
                {!selected.implemented && (
                  <Badge variant="secondary" className="text-xs">
                    Coming Soon
                  </Badge>
                )}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>

        <SelectContent>
          {agents.map((agent) => (
            <TooltipProvider key={agent.type}>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <SelectItem
                    value={agent.type}
                    disabled={!agent.implemented}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center justify-between w-full gap-4">
                      <span>{agent.displayName}</span>
                      {!agent.implemented && (
                        <Badge variant="secondary" className="text-xs ml-2">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-sm">
                  <div className="space-y-2">
                    <div>
                      <p className="font-semibold">{agent.displayName}</p>
                      {!agent.implemented && (
                        <p className="text-xs text-muted-foreground mt-1">
                          This agent is not yet fully implemented
                        </p>
                      )}
                    </div>
                    <div className="text-xs space-y-1">
                      <div>
                        <span className="font-medium">Modes:</span>{' '}
                        {agent.supportedModes.join(', ')}
                      </div>
                      <div>
                        <span className="font-medium">Streaming:</span>{' '}
                        {agent.supportsStreaming ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span className="font-medium">Structured Output:</span>{' '}
                        {agent.supportsStructuredOutput ? 'Yes' : 'No'}
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </SelectContent>
      </Select>

      {selected && !selected.implemented && (
        <p className="text-xs text-muted-foreground">
          This agent is not yet fully implemented. Please select an available agent.
        </p>
      )}
    </div>
  )
}
