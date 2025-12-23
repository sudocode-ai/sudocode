import { useEffect, useCallback, useRef } from 'react'
import { useChatWidgetContext } from '@/contexts/ChatWidgetContext'
import { useVoiceNarration } from '@/hooks/useVoiceNarration'
import { VoiceNarrationToggle, VoiceSpeakingIndicator } from '@/components/voice'
import { cn } from '@/lib/utils'

export interface ChatWidgetContentProps {
  /** The execution ID to display/narrate */
  executionId: string
  /** Optional header content to render before the narration toggle */
  headerContent?: React.ReactNode
  /** Main content to display in the widget body */
  children: React.ReactNode
  /** Optional className for the container */
  className?: string
  /** Optional callback when narration state changes */
  onNarrationStateChange?: (isSpeaking: boolean, isPaused: boolean) => void
}

/**
 * Chat widget content with voice narration integration.
 *
 * Features:
 * - VoiceNarrationToggle in the header area (next to minimize/close buttons)
 * - VoiceSpeakingIndicator below header when speaking
 * - Automatic pause/resume based on voice input recording state
 * - Only narrates the focused/selected execution
 * - Stops narration when switching executions
 *
 * @example
 * ```tsx
 * <ChatWidgetProvider initialExecutionId={execution.id}>
 *   <ChatWidgetContent executionId={execution.id}>
 *     <ExecutionMonitor executionId={execution.id} />
 *   </ChatWidgetContent>
 * </ChatWidgetProvider>
 * ```
 */
export function ChatWidgetContent({
  executionId,
  headerContent,
  children,
  className,
  onNarrationStateChange,
}: ChatWidgetContentProps) {
  const {
    narrationEnabled,
    setNarrationEnabled,
    focusedExecutionId,
    setFocusedExecutionId,
    isRecording,
  } = useChatWidgetContext()

  // Initialize the voice narration hook
  const {
    isSpeaking,
    isPaused,
    currentText,
    skip,
    stop,
    pause,
    resume,
    setEnabled,
    isSupported,
  } = useVoiceNarration({
    executionId,
    enabled: narrationEnabled && focusedExecutionId === executionId,
    onStart: () => {
      onNarrationStateChange?.(true, false)
    },
    onEnd: () => {
      onNarrationStateChange?.(false, false)
    },
    onError: (error) => {
      console.error('[ChatWidgetContent] Narration error:', error)
    },
  })

  // Track execution ID in ref for cleanup
  const executionIdRef = useRef(executionId)
  executionIdRef.current = executionId

  // Update focused execution when this component mounts or executionId changes
  useEffect(() => {
    setFocusedExecutionId(executionId)

    return () => {
      // When unmounting, clear the focused execution if we're still the focused one
      // Use the ref to get the current executionId at cleanup time
      // We don't clear here to avoid race conditions - parent manages focus switching
    }
  }, [executionId, setFocusedExecutionId])

  // Stop narration when switching executions
  useEffect(() => {
    if (focusedExecutionId !== executionId) {
      stop()
    }
  }, [focusedExecutionId, executionId, stop])

  // Pause narration when voice input starts recording, resume when it stops
  useEffect(() => {
    if (isRecording) {
      if (isSpeaking && !isPaused) {
        pause()
      }
    } else {
      if (isPaused) {
        resume()
      }
    }
  }, [isRecording, isSpeaking, isPaused, pause, resume])

  // Sync enabled state with context
  useEffect(() => {
    setEnabled(narrationEnabled && focusedExecutionId === executionId)
  }, [narrationEnabled, focusedExecutionId, executionId, setEnabled])

  // Handle toggle click
  const handleToggle = useCallback(
    (enabled: boolean) => {
      setNarrationEnabled(enabled)
      if (!enabled) {
        stop()
      }
    },
    [setNarrationEnabled, stop]
  )

  // Handle skip current narration
  const handleSkip = useCallback(() => {
    skip()
  }, [skip])

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header area with narration toggle */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        {/* Left side: custom header content */}
        <div className="flex-1">{headerContent}</div>

        {/* Right side: narration toggle (before close/minimize buttons) */}
        {isSupported && (
          <VoiceNarrationToggle
            enabled={narrationEnabled}
            onToggle={handleToggle}
            isSpeaking={isSpeaking}
            disabled={focusedExecutionId !== executionId}
          />
        )}
      </div>

      {/* Speaking indicator (shown below header when speaking) */}
      <VoiceSpeakingIndicator
        text={currentText}
        isSpeaking={isSpeaking && focusedExecutionId === executionId}
        onSkip={handleSkip}
        className="mx-3 mt-2"
      />

      {/* Main content area */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
