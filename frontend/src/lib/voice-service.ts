/**
 * Voice Service - Wraps Web Speech API for browser-based voice input/output
 *
 * Provides speech recognition (STT) and speech synthesis (TTS) capabilities
 * using browser-native Web Speech API. Handles browser compatibility,
 * event management, and state tracking.
 */

import type {
  VoiceConfig,
  VoiceSupport,
  VoiceServiceState,
  SpeechOptions,
} from '@sudocode-ai/types'

// Browser API type augmentation
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

/**
 * Event types emitted by VoiceService
 */
export type VoiceServiceEventType =
  | 'transcript' // Interim or final transcript
  | 'transcriptFinal' // Final transcript only
  | 'error' // Recognition or synthesis error
  | 'statusChange' // Status changed (listening, speaking, idle, error)
  | 'listeningStart' // Started listening
  | 'listeningEnd' // Stopped listening
  | 'speakStart' // Started speaking
  | 'speakEnd' // Finished speaking

/**
 * Event handler callback
 */
export type VoiceServiceEventHandler = (data: any) => void

/**
 * Utterance queue item
 */
interface UtteranceQueueItem {
  text: string
  options: SpeechOptions
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * VoiceService - Main voice service class
 *
 * Usage:
 * ```typescript
 * const voiceService = new VoiceService()
 *
 * // Check support
 * if (!voiceService.isSupported().fullSupport) {
 *   console.warn('Voice features not fully supported')
 * }
 *
 * // Listen for events
 * voiceService.on('transcriptFinal', (transcript) => {
 *   console.log('User said:', transcript)
 * })
 *
 * // Start listening
 * await voiceService.startListening()
 *
 * // Speak text
 * await voiceService.speak('Hello, how can I help you?')
 * ```
 */
export class VoiceService {
  private recognition: any = null
  private synthesis: SpeechSynthesis | null = null
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private utteranceQueue: UtteranceQueueItem[] = []
  private isSpeakingInternal = false
  private isListeningInternal = false
  private eventHandlers: Map<VoiceServiceEventType, Set<VoiceServiceEventHandler>> =
    new Map()
  private state: VoiceServiceState = {
    isListening: false,
    isSpeaking: false,
    transcript: '',
    confidence: 0,
    error: null,
    status: 'idle',
  }

  constructor() {
    this.initializeAPIs()
  }

  /**
   * Initialize Web Speech APIs
   */
  private initializeAPIs(): void {
    // Initialize SpeechRecognition
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition()
      this.setupRecognition()
    }

    // Initialize SpeechSynthesis
    if ('speechSynthesis' in window) {
      this.synthesis = window.speechSynthesis
    }
  }

  /**
   * Setup speech recognition handlers
   */
  private setupRecognition(): void {
    if (!this.recognition) return

    // Continuous recognition
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.maxAlternatives = 1

    // Handle results
    this.recognition.onresult = (event: any) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        const confidence = event.results[i][0].confidence

        if (event.results[i].isFinal) {
          finalTranscript += transcript
          this.updateState({
            transcript: finalTranscript,
            confidence,
          })
          this.emit('transcriptFinal', {
            transcript: finalTranscript,
            confidence,
            isFinal: true,
          })
        } else {
          interimTranscript += transcript
          this.updateState({
            transcript: interimTranscript,
            confidence,
          })
          this.emit('transcript', {
            transcript: interimTranscript,
            confidence,
            isFinal: false,
          })
        }
      }
    }

    // Handle errors
    this.recognition.onerror = (event: any) => {
      const error = `Speech recognition error: ${event.error}`
      this.updateState({
        error,
        status: 'error',
      })
      this.emit('error', { error, type: 'recognition' })
    }

    // Handle start
    this.recognition.onstart = () => {
      this.isListeningInternal = true
      this.updateState({
        isListening: true,
        status: 'listening',
        error: null,
      })
      this.emit('listeningStart', {})
    }

    // Handle end
    this.recognition.onend = () => {
      this.isListeningInternal = false
      this.updateState({
        isListening: false,
        status: 'idle',
      })
      this.emit('listeningEnd', {})
    }
  }

  /**
   * Check browser support for voice features
   */
  public isSupported(): VoiceSupport {
    const recognition =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
    const synthesis = 'speechSynthesis' in window

    return {
      recognition,
      synthesis,
      fullSupport: recognition && synthesis,
    }
  }

  /**
   * Get current state
   */
  public getState(): VoiceServiceState {
    return { ...this.state }
  }

  /**
   * Update state and emit status change event
   */
  private updateState(updates: Partial<VoiceServiceState>): void {
    const oldStatus = this.state.status
    this.state = { ...this.state, ...updates }

    if (oldStatus !== this.state.status) {
      this.emit('statusChange', {
        status: this.state.status,
        message: this.state.error,
      })
    }
  }

  /**
   * Start listening for voice input
   */
  public async startListening(): Promise<void> {
    if (!this.recognition) {
      throw new Error('Speech recognition not supported')
    }

    if (this.isListeningInternal) {
      console.warn('Already listening')
      return
    }

    try {
      this.recognition.start()
    } catch (error: any) {
      const errorMessage = `Failed to start listening: ${error.message}`
      this.updateState({
        error: errorMessage,
        status: 'error',
      })
      throw new Error(errorMessage)
    }
  }

  /**
   * Stop listening for voice input
   */
  public stopListening(): void {
    if (!this.recognition || !this.isListeningInternal) {
      return
    }

    this.recognition.stop()
  }

  /**
   * Pause listening (can be resumed)
   */
  public pauseListening(): void {
    if (!this.recognition || !this.isListeningInternal) {
      return
    }

    this.recognition.abort()
  }

  /**
   * Resume listening after pause
   */
  public async resumeListening(): Promise<void> {
    return this.startListening()
  }

  /**
   * Speak text using speech synthesis
   */
  public async speak(text: string, options: SpeechOptions = {}): Promise<void> {
    if (!this.synthesis) {
      throw new Error('Speech synthesis not supported')
    }

    return new Promise((resolve, reject) => {
      this.utteranceQueue.push({ text, options, resolve, reject })

      // If not currently speaking, process the queue
      if (!this.isSpeakingInternal) {
        this.processUtteranceQueue()
      }
    })
  }

  /**
   * Process the utterance queue
   */
  private processUtteranceQueue(): void {
    if (this.utteranceQueue.length === 0 || !this.synthesis) {
      return
    }

    const item = this.utteranceQueue.shift()!
    this.currentUtterance = new SpeechSynthesisUtterance(item.text)

    // Apply options
    if (item.options.voice) {
      this.currentUtterance.voice = item.options.voice
    }
    if (item.options.rate !== undefined) {
      this.currentUtterance.rate = item.options.rate
    }
    if (item.options.pitch !== undefined) {
      this.currentUtterance.pitch = item.options.pitch
    }
    if (item.options.volume !== undefined) {
      this.currentUtterance.volume = item.options.volume
    }

    // Handle start
    this.currentUtterance.onstart = () => {
      this.isSpeakingInternal = true
      this.updateState({
        isSpeaking: true,
        status: 'speaking',
        error: null,
      })
      this.emit('speakStart', { text: item.text })
    }

    // Handle end
    this.currentUtterance.onend = () => {
      this.isSpeakingInternal = false
      this.currentUtterance = null
      this.updateState({
        isSpeaking: false,
        status: this.isListeningInternal ? 'listening' : 'idle',
      })
      this.emit('speakEnd', { text: item.text })
      item.resolve()

      // Process next in queue
      this.processUtteranceQueue()
    }

    // Handle error
    this.currentUtterance.onerror = (event: any) => {
      this.isSpeakingInternal = false
      this.currentUtterance = null
      const error = `Speech synthesis error: ${event.error}`
      this.updateState({
        isSpeaking: false,
        status: 'error',
        error,
      })
      this.emit('error', { error, type: 'synthesis' })
      item.reject(new Error(error))

      // Continue with queue despite error
      this.processUtteranceQueue()
    }

    // Speak
    this.synthesis.speak(this.currentUtterance)
  }

  /**
   * Stop speaking immediately
   */
  public stopSpeaking(): void {
    if (!this.synthesis) {
      return
    }

    this.synthesis.cancel()
    this.utteranceQueue = []
    this.currentUtterance = null
    this.isSpeakingInternal = false
    this.updateState({
      isSpeaking: false,
      status: this.isListeningInternal ? 'listening' : 'idle',
    })
  }

  /**
   * Pause speaking
   */
  public pauseSpeaking(): void {
    if (!this.synthesis || !this.isSpeakingInternal) {
      return
    }

    this.synthesis.pause()
  }

  /**
   * Resume speaking
   */
  public resumeSpeaking(): void {
    if (!this.synthesis) {
      return
    }

    this.synthesis.resume()
  }

  /**
   * Get available voices
   */
  public getAvailableVoices(): SpeechSynthesisVoice[] {
    if (!this.synthesis) {
      return []
    }

    return this.synthesis.getVoices()
  }

  /**
   * Get voice by name
   */
  public getVoiceByName(name: string): SpeechSynthesisVoice | undefined {
    return this.getAvailableVoices().find((voice) => voice.name === name)
  }

  /**
   * Apply voice configuration
   */
  public applyConfig(config: VoiceConfig): void {
    if (!config.enabled) {
      this.stopListening()
      this.stopSpeaking()
    }

    // Recognition settings
    if (this.recognition && config.inputEnabled) {
      // Language could be set here if added to config
      // this.recognition.lang = config.language || 'en-US'
    }
  }

  /**
   * Get current listening status
   */
  public get isListening(): boolean {
    return this.isListeningInternal
  }

  /**
   * Get current speaking status
   */
  public get isSpeaking(): boolean {
    return this.isSpeakingInternal
  }

  /**
   * Register event handler
   */
  public on(event: VoiceServiceEventType, handler: VoiceServiceEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  /**
   * Unregister event handler
   */
  public off(event: VoiceServiceEventType, handler: VoiceServiceEventHandler): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * Emit event to all registered handlers
   */
  private emit(event: VoiceServiceEventType, data: any): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data)
        } catch (error) {
          console.error(`Error in voice service event handler for ${event}:`, error)
        }
      })
    }
  }

  /**
   * Cleanup and dispose of resources
   */
  public dispose(): void {
    this.stopListening()
    this.stopSpeaking()
    this.eventHandlers.clear()
  }
}

/**
 * Singleton instance for global use
 */
let globalVoiceService: VoiceService | null = null

/**
 * Get or create global voice service instance
 */
export function getVoiceService(): VoiceService {
  if (!globalVoiceService) {
    globalVoiceService = new VoiceService()
  }
  return globalVoiceService
}

/**
 * Check if voice features are supported in current browser
 */
export function detectVoiceSupport(): VoiceSupport {
  const recognition =
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  const synthesis = 'speechSynthesis' in window

  return {
    recognition,
    synthesis,
    fullSupport: recognition && synthesis,
  }
}
