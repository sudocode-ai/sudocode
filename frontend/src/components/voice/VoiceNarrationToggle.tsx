import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface VoiceNarrationToggleProps {
  /** Whether voice narration is enabled */
  enabled: boolean
  /** Callback when the toggle is clicked */
  onToggle: (enabled: boolean) => void
  /** Whether speech is currently playing */
  isSpeaking?: boolean
  /** Whether the toggle is disabled */
  disabled?: boolean
  /** Optional className for the button */
  className?: string
}

/**
 * Animated sound wave bar for speaking indicator
 */
function SoundWaveBar({ delay }: { delay: number }) {
  return (
    <div
      className="w-0.5 rounded-full bg-current"
      style={{
        animation: `voiceToggleSoundwave 0.6s ease-in-out ${delay}ms infinite`,
      }}
    />
  )
}

/**
 * Compact sound wave visualization for the toggle button
 */
function CompactSoundWave() {
  const delays = [0, 80, 160, 80, 0]

  return (
    <div className="flex h-3 items-end gap-px">
      {delays.map((delay, i) => (
        <SoundWaveBar key={i} delay={delay} />
      ))}
    </div>
  )
}

/**
 * Get tooltip content based on current state
 */
function getTooltipContent(enabled: boolean, isSpeaking: boolean): string {
  if (!enabled) {
    return 'Enable voice narration'
  }
  if (isSpeaking) {
    return 'Voice narration active - Click to disable'
  }
  return 'Voice narration enabled - Click to disable'
}

/**
 * Voice narration toggle component
 *
 * Provides a toggle button for enabling/disabling voice narration
 * in the chat widget header. Shows an animated sound wave when
 * speech is currently playing.
 *
 * Features:
 * - Toggle between enabled (speaker icon) and disabled (muted icon)
 * - Animated sound wave visualization when actively speaking
 * - Tooltip explaining current state
 * - Full keyboard accessibility
 *
 * @example
 * ```tsx
 * <VoiceNarrationToggle
 *   enabled={narrationEnabled}
 *   onToggle={(enabled) => setNarrationEnabled(enabled)}
 *   isSpeaking={isNarrating}
 * />
 * ```
 */
export function VoiceNarrationToggle({
  enabled,
  onToggle,
  isSpeaking = false,
  disabled = false,
  className,
}: VoiceNarrationToggleProps) {
  const handleClick = () => {
    onToggle(!enabled)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Toggle on Enter or Space
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle(!enabled)
    }
  }

  const tooltipText = getTooltipContent(enabled, isSpeaking)

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 w-8 shrink-0 rounded-full p-0 transition-colors duration-200',
              enabled && 'text-primary hover:text-primary/80',
              !enabled && 'text-muted-foreground hover:text-foreground',
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            aria-label={tooltipText}
            aria-pressed={enabled}
          >
            {enabled ? (
              <div className="flex items-center gap-0.5">
                <Volume2 className="h-4 w-4 shrink-0" />
                {isSpeaking && <CompactSoundWave />}
              </div>
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{tooltipText}</span>
        </TooltipContent>
      </Tooltip>

      {/* CSS for sound wave animation - uses unique keyframe name to avoid conflicts */}
      <style>{`
        @keyframes voiceToggleSoundwave {
          0%, 100% {
            height: 3px;
          }
          50% {
            height: 12px;
          }
        }
      `}</style>
    </>
  )
}
