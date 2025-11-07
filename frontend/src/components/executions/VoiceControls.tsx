/**
 * VoiceControls Component
 *
 * Provides UI controls for voice input/output features in an execution.
 * Displays microphone status, transcript, and toggle buttons for voice features.
 */

import { useEffect, useState } from 'react'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { useVoiceContext } from '@/contexts/VoiceContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import type { VoiceConfig } from '@sudocode-ai/types'

/**
 * Component props
 */
export interface VoiceControlsProps {
  /**
   * Execution ID
   */
  executionId: string

  /**
   * Callback when voice input is received
   */
  onVoiceInput?: (transcript: string) => void

  /**
   * Initial voice configuration
   */
  initialConfig?: VoiceConfig

  /**
   * Disable all controls
   */
  disabled?: boolean

  /**
   * Compact mode (smaller UI)
   */
  compact?: boolean
}

/**
 * VoiceControls Component
 */
export function VoiceControls({
  executionId,
  onVoiceInput,
  initialConfig,
  disabled = false,
  compact = false,
}: VoiceControlsProps) {
  const { isSupported } = useVoiceContext()

  const {
    isEnabled,
    isListening,
    isSpeaking,
    transcript,
    interimTranscript,
    confidence,
    error,
    toggleVoiceInput,
    toggleVoiceOutput,
    startListening,
    stopListening,
    config,
  } = useVoiceInput({
    executionId,
    initialConfig,
    onTranscript: (text, conf) => {
      console.log('Final transcript:', text, 'confidence:', conf)
      onVoiceInput?.(text)
    },
    onInterimTranscript: (text) => {
      console.log('Interim transcript:', text)
    },
    onError: (err) => {
      console.error('Voice error:', err)
    },
  })

  const [showTranscript, setShowTranscript] = useState(true)

  // Auto-hide transcript after 10 seconds of inactivity
  useEffect(() => {
    if (transcript && !interimTranscript && !isListening) {
      const timeout = setTimeout(() => setShowTranscript(false), 10000)
      return () => clearTimeout(timeout)
    } else if (interimTranscript || isListening) {
      setShowTranscript(true)
    }
  }, [transcript, interimTranscript, isListening])

  // Handle microphone toggle
  const handleMicToggle = async () => {
    if (!config.inputEnabled) {
      // Enabling input - update config first
      toggleVoiceInput()
    } else if (isListening) {
      // Already listening - stop
      stopListening()
    } else {
      // Input enabled but not listening - start
      await startListening()
    }
  }

  // Don't render if not supported
  if (!isSupported) {
    return (
      <Card className="p-3 bg-muted/50 border-dashed">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>Voice features not supported in this browser</span>
        </div>
      </Card>
    )
  }

  // Compact mode - just show toggle buttons
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={config.inputEnabled ? 'default' : 'outline'}
          onClick={handleMicToggle}
          disabled={disabled}
          title={config.inputEnabled ? (isListening ? 'Stop listening' : 'Start listening') : 'Enable voice input'}
        >
          {isListening ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : config.inputEnabled ? (
            <Mic className="h-4 w-4" />
          ) : (
            <MicOff className="h-4 w-4" />
          )}
        </Button>

        <Button
          size="sm"
          variant={config.outputEnabled ? 'default' : 'outline'}
          onClick={toggleVoiceOutput}
          disabled={disabled}
          title={config.outputEnabled ? 'Disable voice output' : 'Enable voice output'}
        >
          {isSpeaking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : config.outputEnabled ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </Button>
      </div>
    )
  }

  // Full mode - show complete UI
  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Voice Controls</h3>
          {isListening && (
            <Badge variant="default" className="animate-pulse">
              Listening
            </Badge>
          )}
          {isSpeaking && (
            <Badge variant="secondary" className="animate-pulse">
              Speaking
            </Badge>
          )}
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2">
          {config.inputEnabled && (
            <Badge variant="outline" className="text-xs">
              Input ON
            </Badge>
          )}
          {config.outputEnabled && (
            <Badge variant="outline" className="text-xs">
              Output ON
            </Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={config.inputEnabled ? 'default' : 'outline'}
          onClick={handleMicToggle}
          disabled={disabled}
          className="flex-1"
        >
          {isListening ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Stop Listening
            </>
          ) : config.inputEnabled ? (
            <>
              <Mic className="h-4 w-4 mr-2" />
              Start Listening
            </>
          ) : (
            <>
              <MicOff className="h-4 w-4 mr-2" />
              Enable Input
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant={config.outputEnabled ? 'default' : 'outline'}
          onClick={toggleVoiceOutput}
          disabled={disabled}
          className="flex-1"
        >
          {config.outputEnabled ? (
            <>
              <Volume2 className="h-4 w-4 mr-2" />
              Output ON
            </>
          ) : (
            <>
              <VolumeX className="h-4 w-4 mr-2" />
              Output OFF
            </>
          )}
        </Button>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Transcript display */}
      {showTranscript && (transcript || interimTranscript) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Transcript</span>
            {confidence > 0 && (
              <span className="text-xs text-muted-foreground">
                {Math.round(confidence * 100)}% confidence
              </span>
            )}
          </div>

          <div className="p-3 rounded-md bg-muted/50 border border-border">
            {interimTranscript ? (
              <p className="text-sm text-muted-foreground italic">{interimTranscript}</p>
            ) : (
              <p className="text-sm">{transcript}</p>
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      {!config.inputEnabled && !config.outputEnabled && (
        <p className="text-xs text-muted-foreground">
          Enable voice input to speak to the agent, or voice output to hear agent responses.
        </p>
      )}
    </Card>
  )
}
