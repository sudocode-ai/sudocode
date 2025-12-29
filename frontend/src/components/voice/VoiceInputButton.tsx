import { useCallback } from 'react'
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useVoiceInput, type UseVoiceInputOptions } from '@/hooks/useVoiceInput'
import { cn } from '@/lib/utils'
import type { VoiceInputState } from '@sudocode-ai/types'

export interface VoiceInputButtonProps {
  /** Callback when transcription completes - receives the transcribed text */
  onTranscription: (text: string) => void
  /** Callback when recording starts */
  onRecordingStart?: () => void
  /** Callback for interim results during recording (browser mode only) */
  onInterimResult?: (text: string) => void
  /** Whether the button is disabled */
  disabled?: boolean
  /** Optional className for the button */
  className?: string
  /** Size of the button */
  size?: 'sm' | 'default'
  /** Whether to show duration while recording */
  showDuration?: boolean
  /** Language for transcription */
  language?: string
}

/**
 * Format seconds into M:SS format
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Get tooltip content based on current state
 */
function getTooltipContent(
  state: VoiceInputState,
  isSupported: boolean,
  hasPermission: boolean | null,
  errorMessage?: string
): string {
  if (!isSupported) {
    return 'Voice input is not supported in this browser'
  }
  if (hasPermission === false) {
    return 'Microphone access denied. Click to retry.'
  }

  switch (state) {
    case 'recording':
      return 'Click to stop recording'
    case 'transcribing':
      return 'Transcribing...'
    case 'error':
      return errorMessage || 'An error occurred. Click to retry.'
    default:
      return 'Click to start voice input'
  }
}

/**
 * Voice input button component
 *
 * Provides a microphone button that records audio and transcribes it to text.
 * Shows visual feedback for recording, transcribing, and error states.
 *
 * @example
 * ```tsx
 * <VoiceInputButton
 *   onTranscription={(text) => setPrompt(text)}
 *   disabled={isSubmitting}
 * />
 * ```
 */
export function VoiceInputButton({
  onTranscription,
  onRecordingStart,
  onInterimResult,
  disabled = false,
  className,
  size = 'default',
  showDuration = true,
  language = 'en',
}: VoiceInputButtonProps) {
  const options: UseVoiceInputOptions = {
    language,
    onTranscription,
    onInterimResult,
  }

  const {
    state,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    hasPermission,
    duration,
    isSupported,
  } = useVoiceInput(options)

  const handleClick = useCallback(async () => {
    if (state === 'recording') {
      await stopRecording()
    } else if (state === 'idle' || state === 'error') {
      onRecordingStart?.()
      await startRecording()
    }
    // Do nothing if transcribing
  }, [state, startRecording, stopRecording, onRecordingStart])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cancel recording on Escape
      if (e.key === 'Escape' && state === 'recording') {
        e.preventDefault()
        cancelRecording()
      }
    },
    [state, cancelRecording]
  )

  // Determine button appearance based on state
  const isRecording = state === 'recording'
  const isTranscribing = state === 'transcribing'
  const isError = state === 'error'
  const isDisabled = disabled || isTranscribing || !isSupported

  // Button size classes
  const sizeClasses = size === 'sm' ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const iconSizeStop = size === 'sm' ? 'h-3 w-3' : 'h-3 w-3'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={isRecording ? 'destructive' : isError ? 'outline' : 'ghost'}
          size="sm"
          className={cn(
            sizeClasses,
            'shrink-0 rounded-full transition-all duration-200',
            isRecording && 'bg-red-500 hover:bg-red-600',
            isError && 'border-destructive text-destructive',
            className
          )}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          aria-label={getTooltipContent(state, isSupported, hasPermission, error?.message)}
        >
          {isTranscribing ? (
            <Loader2 className={cn(iconSize, 'animate-spin')} />
          ) : isRecording ? (
            <Square className={cn(iconSizeStop, 'fill-current')} />
          ) : isError ? (
            <AlertCircle className={iconSize} />
          ) : (
            <Mic className={iconSize} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{getTooltipContent(state, isSupported, hasPermission, error?.message)}</span>
        {isRecording && showDuration && (
          <span className="font-mono text-xs text-muted-foreground">
            {formatDuration(duration)}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
