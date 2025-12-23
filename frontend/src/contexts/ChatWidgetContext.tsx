import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

/**
 * Storage key for voice narration preference in localStorage
 */
const STORAGE_KEY_NARRATION = 'sudocode-voice-narration-enabled'

/**
 * Context value for the chat widget
 */
export interface ChatWidgetContextValue {
  /** Whether voice narration is enabled */
  narrationEnabled: boolean
  /** Enable or disable voice narration */
  setNarrationEnabled: (enabled: boolean) => void
  /** The currently focused execution ID (for narration targeting) */
  focusedExecutionId: string | null
  /** Set the focused execution ID */
  setFocusedExecutionId: (executionId: string | null) => void
  /** Whether voice input is currently recording */
  isRecording: boolean
  /** Set the recording state (used to pause narration) */
  setIsRecording: (recording: boolean) => void
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null)

interface ChatWidgetProviderProps {
  children: React.ReactNode
  /** Optional initial execution ID to focus on */
  initialExecutionId?: string | null
  /** Optional default value for narration (overrides localStorage on first render) */
  defaultNarrationEnabled?: boolean
}

/**
 * Load narration preference from localStorage
 */
function loadNarrationPreference(): boolean {
  if (typeof window === 'undefined') return false

  try {
    const stored = localStorage.getItem(STORAGE_KEY_NARRATION)
    if (stored !== null) {
      return stored === 'true'
    }
  } catch (error) {
    console.warn('[ChatWidgetContext] Failed to read from localStorage:', error)
  }

  // Default to disabled
  return false
}

/**
 * Save narration preference to localStorage
 */
function saveNarrationPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY_NARRATION, String(enabled))
  } catch (error) {
    console.warn('[ChatWidgetContext] Failed to save to localStorage:', error)
  }
}

/**
 * Provider for chat widget state including voice narration settings.
 *
 * Features:
 * - Persists narration enabled preference to localStorage
 * - Tracks focused execution for targeting narration
 * - Tracks recording state to coordinate with voice input
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ChatWidgetProvider initialExecutionId={executionId}>
 *       <ChatWidgetContent />
 *     </ChatWidgetProvider>
 *   )
 * }
 * ```
 */
export function ChatWidgetProvider({
  children,
  initialExecutionId = null,
  defaultNarrationEnabled,
}: ChatWidgetProviderProps) {
  // Load initial narration preference from localStorage
  const [narrationEnabled, setNarrationEnabledState] = useState<boolean>(() => {
    if (defaultNarrationEnabled !== undefined) {
      return defaultNarrationEnabled
    }
    return loadNarrationPreference()
  })

  // Track the focused execution (used to filter narration events)
  const [focusedExecutionId, setFocusedExecutionIdState] = useState<string | null>(
    initialExecutionId
  )

  // Track whether voice input is recording (used to pause narration)
  const [isRecording, setIsRecordingState] = useState(false)

  /**
   * Enable or disable voice narration with persistence
   */
  const setNarrationEnabled = useCallback((enabled: boolean) => {
    setNarrationEnabledState(enabled)
    saveNarrationPreference(enabled)
  }, [])

  /**
   * Set the focused execution ID
   * Used to target narration to a specific execution
   */
  const setFocusedExecutionId = useCallback((executionId: string | null) => {
    setFocusedExecutionIdState(executionId)
  }, [])

  /**
   * Set the recording state
   * Used to coordinate with voice input - pause narration while recording
   */
  const setIsRecording = useCallback((recording: boolean) => {
    setIsRecordingState(recording)
  }, [])

  // Update focused execution if initialExecutionId changes
  useEffect(() => {
    setFocusedExecutionIdState(initialExecutionId)
  }, [initialExecutionId])

  const value: ChatWidgetContextValue = {
    narrationEnabled,
    setNarrationEnabled,
    focusedExecutionId,
    setFocusedExecutionId,
    isRecording,
    setIsRecording,
  }

  return <ChatWidgetContext.Provider value={value}>{children}</ChatWidgetContext.Provider>
}

/**
 * Hook to access chat widget context
 *
 * @throws Error if used outside of ChatWidgetProvider
 *
 * @example
 * ```tsx
 * function VoiceToggle() {
 *   const { narrationEnabled, setNarrationEnabled } = useChatWidgetContext()
 *
 *   return (
 *     <VoiceNarrationToggle
 *       enabled={narrationEnabled}
 *       onToggle={setNarrationEnabled}
 *     />
 *   )
 * }
 * ```
 */
export function useChatWidgetContext(): ChatWidgetContextValue {
  const context = useContext(ChatWidgetContext)
  if (!context) {
    throw new Error('useChatWidgetContext must be used within a ChatWidgetProvider')
  }
  return context
}

/**
 * Export the storage key for testing purposes
 */
export { STORAGE_KEY_NARRATION }
