import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { VoiceService, detectVoiceSupport, getVoiceService } from '@/lib/voice-service'

// Mock Web Speech API
class MockSpeechRecognition {
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = 'en-US'

  onresult: any = null
  onerror: any = null
  onstart: any = null
  onend: any = null

  start() {
    if (this.onstart) {
      // Use queueMicrotask for immediate async execution
      queueMicrotask(() => this.onstart && this.onstart())
    }
  }

  stop() {
    if (this.onend) {
      queueMicrotask(() => this.onend && this.onend())
    }
  }

  abort() {
    if (this.onend) {
      queueMicrotask(() => this.onend && this.onend())
    }
  }

  // Helper to simulate recognition results
  _simulateResult(transcript: string, isFinal: boolean, confidence = 0.9) {
    if (this.onresult) {
      const event = {
        resultIndex: 0,
        results: [
          {
            0: { transcript, confidence },
            isFinal,
            length: 1,
          },
        ],
      }
      this.onresult(event)
    }
  }

  _simulateError(error: string) {
    if (this.onerror) {
      this.onerror({ error })
    }
  }
}

class MockSpeechSynthesisUtterance {
  text = ''
  voice: any = null
  rate = 1
  pitch = 1
  volume = 1

  onstart: any = null
  onend: any = null
  onerror: any = null

  constructor(text: string) {
    this.text = text
  }
}

class MockSpeechSynthesis {
  private utterances: MockSpeechSynthesisUtterance[] = []
  private currentUtterance: MockSpeechSynthesisUtterance | null = null
  private isPaused = false

  speak(utterance: MockSpeechSynthesisUtterance) {
    this.utterances.push(utterance)
    if (!this.currentUtterance) {
      this._processNext()
    }
  }

  cancel() {
    this.utterances = []
    this.currentUtterance = null
  }

  pause() {
    this.isPaused = true
  }

  resume() {
    this.isPaused = false
  }

  getVoices() {
    return [
      {
        name: 'Test Voice 1',
        lang: 'en-US',
        default: true,
        localService: true,
        voiceURI: 'test-voice-1',
      },
      {
        name: 'Test Voice 2',
        lang: 'en-GB',
        default: false,
        localService: true,
        voiceURI: 'test-voice-2',
      },
    ]
  }

  _processNext() {
    if (this.utterances.length === 0) {
      return
    }

    this.currentUtterance = this.utterances.shift()!
    const utterance = this.currentUtterance

    if (utterance.onstart) {
      setTimeout(() => {
        if (utterance.onstart) {
          utterance.onstart()
        }
      }, 10)
    }

    // Simulate speaking time
    setTimeout(() => {
      if (utterance.onend) {
        utterance.onend()
      }
      if (this.currentUtterance === utterance) {
        this.currentUtterance = null
      }
      this._processNext()
    }, 50)
  }

  _simulateError(error: string) {
    if (this.currentUtterance && this.currentUtterance.onerror) {
      this.currentUtterance.onerror({ error })
      this.currentUtterance = null
      this._processNext()
    }
  }
}

describe('VoiceService', () => {
  let mockRecognition: MockSpeechRecognition
  let mockSynthesis: MockSpeechSynthesis

  beforeEach(() => {
    // Setup mocks
    mockRecognition = new MockSpeechRecognition()
    mockSynthesis = new MockSpeechSynthesis()

    // @ts-ignore
    global.window = {
      SpeechRecognition: vi.fn(() => mockRecognition),
      speechSynthesis: mockSynthesis,
    }

    // @ts-ignore
    global.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('detectVoiceSupport', () => {
    it('should detect full support when both APIs are available', () => {
      const support = detectVoiceSupport()
      expect(support.recognition).toBe(true)
      expect(support.synthesis).toBe(true)
      expect(support.fullSupport).toBe(true)
    })

    it('should detect partial support when only synthesis is available', () => {
      // @ts-ignore
      delete global.window.SpeechRecognition

      const support = detectVoiceSupport()
      expect(support.recognition).toBe(false)
      expect(support.synthesis).toBe(true)
      expect(support.fullSupport).toBe(false)
    })
  })

  describe('VoiceService instance', () => {
    let service: VoiceService

    beforeEach(() => {
      service = new VoiceService()
    })

    afterEach(() => {
      service.dispose()
    })

    describe('isSupported', () => {
      it('should return support status', () => {
        const support = service.isSupported()
        expect(support.fullSupport).toBe(true)
      })
    })

    describe('speech recognition', () => {
      it('should start listening', async () => {
        const startHandler = vi.fn()
        service.on('listeningStart', startHandler)

        await service.startListening()

        // Wait for microtask queue to flush
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(service.isListening).toBe(true)
        expect(startHandler).toHaveBeenCalled()
      })

      it('should stop listening', async () => {
        const endHandler = vi.fn()
        service.on('listeningEnd', endHandler)

        await service.startListening()
        service.stopListening()

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(service.isListening).toBe(false)
        expect(endHandler).toHaveBeenCalled()
      })

      it('should emit interim transcripts', async () => {
        const transcriptHandler = vi.fn()
        service.on('transcript', transcriptHandler)

        await service.startListening()
        mockRecognition._simulateResult('hello', false, 0.8)

        expect(transcriptHandler).toHaveBeenCalledWith({
          transcript: 'hello',
          confidence: 0.8,
          isFinal: false,
        })
      })

      it('should emit final transcripts', async () => {
        const finalHandler = vi.fn()
        service.on('transcriptFinal', finalHandler)

        await service.startListening()
        mockRecognition._simulateResult('hello world', true, 0.95)

        expect(finalHandler).toHaveBeenCalledWith({
          transcript: 'hello world',
          confidence: 0.95,
          isFinal: true,
        })
      })

      it('should handle recognition errors', async () => {
        const errorHandler = vi.fn()
        service.on('error', errorHandler)

        await service.startListening()
        mockRecognition._simulateError('no-speech')

        expect(errorHandler).toHaveBeenCalledWith({
          error: expect.stringContaining('no-speech'),
          type: 'recognition',
        })
      })

      it('should update state during listening', async () => {
        await service.startListening()
        await new Promise((resolve) => setTimeout(resolve, 10))

        const state = service.getState()
        expect(state.isListening).toBe(true)
        expect(state.status).toBe('listening')
      })
    })

    describe('speech synthesis', () => {
      it('should speak text', async () => {
        const startHandler = vi.fn()
        const endHandler = vi.fn()

        service.on('speakStart', startHandler)
        service.on('speakEnd', endHandler)

        const promise = service.speak('Hello world')

        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(startHandler).toHaveBeenCalledWith({ text: 'Hello world' })
        expect(service.isSpeaking).toBe(true)

        await promise

        expect(endHandler).toHaveBeenCalledWith({ text: 'Hello world' })
        expect(service.isSpeaking).toBe(false)
      })

      it('should queue multiple utterances', async () => {
        const promise1 = service.speak('First')
        const promise2 = service.speak('Second')
        const promise3 = service.speak('Third')

        await Promise.all([promise1, promise2, promise3])

        expect(service.isSpeaking).toBe(false)
      })

      it('should apply speech options', async () => {
        const voices = mockSynthesis.getVoices()

        await service.speak('Test', {
          voice: voices[1],
          rate: 1.5,
          pitch: 1.2,
          volume: 0.8,
        })

        // The utterance should have been created with these options
        // This is a basic test - in a real scenario, we'd inspect the utterance
        expect(service.isSpeaking).toBe(false) // Should complete
      })

      it('should stop speaking', async () => {
        const promise = service.speak('Long text that will be interrupted')

        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(service.isSpeaking).toBe(true)

        service.stopSpeaking()

        expect(service.isSpeaking).toBe(false)
      })

      it('should get available voices', () => {
        const voices = service.getAvailableVoices()

        expect(voices).toHaveLength(2)
        expect(voices[0].name).toBe('Test Voice 1')
        expect(voices[1].name).toBe('Test Voice 2')
      })

      it('should get voice by name', () => {
        const voice = service.getVoiceByName('Test Voice 2')

        expect(voice).toBeDefined()
        expect(voice?.name).toBe('Test Voice 2')
        expect(voice?.lang).toBe('en-GB')
      })

      it('should handle synthesis errors', async () => {
        const errorHandler = vi.fn()
        service.on('error', errorHandler)

        const promise = service.speak('Error test')

        await new Promise((resolve) => setTimeout(resolve, 20))
        mockSynthesis._simulateError('synthesis-failed')

        await expect(promise).rejects.toThrow('synthesis-failed')
        expect(errorHandler).toHaveBeenCalledWith({
          error: expect.stringContaining('synthesis-failed'),
          type: 'synthesis',
        })
      })
    })

    describe('state management', () => {
      it('should track combined listening and speaking state', async () => {
        await service.startListening()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(service.getState().status).toBe('listening')

        const speakPromise = service.speak('Test')
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(service.getState().status).toBe('speaking')

        await speakPromise
        expect(service.getState().status).toBe('listening')

        service.stopListening()
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(service.getState().status).toBe('idle')
      })

      it('should emit status change events', async () => {
        const statusHandler = vi.fn()
        service.on('statusChange', statusHandler)

        await service.startListening()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(statusHandler).toHaveBeenCalledWith({
          status: 'listening',
          message: null,
        })
      })
    })

    describe('event handling', () => {
      it('should register and emit events', () => {
        const handler = vi.fn()
        service.on('transcriptFinal', handler)

        // Manually emit (normally done internally)
        service['emit']('transcriptFinal', { test: 'data' })

        expect(handler).toHaveBeenCalledWith({ test: 'data' })
      })

      it('should unregister event handlers', () => {
        const handler = vi.fn()
        service.on('transcriptFinal', handler)
        service.off('transcriptFinal', handler)

        service['emit']('transcriptFinal', { test: 'data' })

        expect(handler).not.toHaveBeenCalled()
      })

      it('should handle multiple handlers for same event', () => {
        const handler1 = vi.fn()
        const handler2 = vi.fn()

        service.on('transcriptFinal', handler1)
        service.on('transcriptFinal', handler2)

        service['emit']('transcriptFinal', { test: 'data' })

        expect(handler1).toHaveBeenCalled()
        expect(handler2).toHaveBeenCalled()
      })
    })

    describe('configuration', () => {
      it('should apply voice config', () => {
        service.applyConfig({
          enabled: true,
          inputEnabled: true,
          outputEnabled: true,
          rate: 1.5,
          pitch: 1.2,
          volume: 0.9,
        })

        // Config is applied - no specific assertions needed
        // as we don't expose internal state
      })

      it('should stop services when disabled', async () => {
        await service.startListening()
        await new Promise((resolve) => setTimeout(resolve, 10))

        service.applyConfig({
          enabled: false,
          inputEnabled: false,
          outputEnabled: false,
        })

        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(service.isListening).toBe(false)
        expect(service.isSpeaking).toBe(false)
      })
    })

    describe('cleanup', () => {
      it('should dispose of all resources', async () => {
        const handler = vi.fn()
        service.on('transcriptFinal', handler)

        await service.startListening()
        await new Promise((resolve) => setTimeout(resolve, 10))

        service.dispose()

        // Wait for async cleanup
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(service.isListening).toBe(false)
        expect(service.isSpeaking).toBe(false)

        // Events should not fire after disposal
        service['emit']('transcriptFinal', { test: 'data' })
        expect(handler).not.toHaveBeenCalled()
      })
    })
  })

  describe('getVoiceService singleton', () => {
    it('should return the same instance', () => {
      const service1 = getVoiceService()
      const service2 = getVoiceService()

      expect(service1).toBe(service2)
    })
  })
})
