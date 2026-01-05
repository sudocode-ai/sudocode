import { Volume2, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface VoiceSpeakingIndicatorProps {
  /** The text currently being spoken */
  text: string | null
  /** Whether speech is currently playing */
  isSpeaking: boolean
  /** Callback to skip the current narration */
  onSkip?: () => void
  /** Optional className for the container */
  className?: string
}

/**
 * Animated sound wave bar component
 */
function SoundWaveBar({ delay, className }: { delay: number; className?: string }) {
  return (
    <div
      className={cn('w-0.5 rounded-full bg-primary', className)}
      style={{
        animation: `soundwave 0.8s ease-in-out ${delay}ms infinite`,
      }}
    />
  )
}

/**
 * Animated sound wave visualization
 */
function SoundWaveVisualization() {
  // Staggered delays for wave effect
  const delays = [0, 100, 200, 300, 200, 100, 0]

  return (
    <div className="flex h-4 items-end gap-0.5">
      {delays.map((delay, i) => (
        <SoundWaveBar key={i} delay={delay} />
      ))}
    </div>
  )
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Voice speaking indicator component
 *
 * Shows a visual indicator when text-to-speech is active, displaying
 * the current narration text with an animated sound wave visualization
 * and an optional skip button.
 *
 * Features:
 * - Animated sound wave visualization
 * - Truncated text display for long narrations
 * - Skip button to interrupt current speech
 * - Smooth fade in/out transitions
 * - Only visible when isSpeaking is true
 *
 * @example
 * ```tsx
 * <VoiceSpeakingIndicator
 *   text="Reading the login component..."
 *   isSpeaking={isNarrating}
 *   onSkip={() => speechSynthesis.cancel()}
 * />
 * ```
 */
export function VoiceSpeakingIndicator({
  text,
  isSpeaking,
  onSkip,
  className,
}: VoiceSpeakingIndicatorProps) {
  // Don't render if not speaking or no text
  if (!isSpeaking || !text) {
    return null
  }

  const displayText = truncateText(text, 50)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
        className
      )}
    >
      {/* Speaker icon */}
      <Volume2 className="h-4 w-4 shrink-0 text-primary" />

      {/* Sound wave visualization */}
      <SoundWaveVisualization />

      {/* Narration text */}
      <span className="flex-1 truncate text-sm text-muted-foreground" title={text}>
        "{displayText}"
      </span>

      {/* Skip button */}
      {onSkip && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="h-6 shrink-0 px-2 text-xs"
          aria-label="Skip narration"
        >
          <SkipForward className="mr-1 h-3 w-3" />
          Skip
        </Button>
      )}

      {/* CSS for sound wave animation */}
      <style>{`
        @keyframes soundwave {
          0%, 100% {
            height: 4px;
          }
          50% {
            height: 16px;
          }
        }
      `}</style>
    </div>
  )
}
