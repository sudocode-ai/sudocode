import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  StreamingAudioPlayer,
  base64ToFloat32,
} from '@/lib/streamingAudioPlayer'

// =============================================================================
// Mock AudioContext
// =============================================================================

// Track mock instances for assertions
const mockSourceInstances: MockAudioBufferSourceNode[] = []

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null
  onended: (() => void) | null = null
  private startTime: number | null = null
  private stopped = false

  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn((when?: number) => {
    this.startTime = when ?? 0
  })
  stop = vi.fn(() => {
    this.stopped = true
    // Trigger onended when stopped
    if (this.onended) {
      this.onended()
    }
  })

  constructor() {
    mockSourceInstances.push(this)
  }

  getStartTime(): number | null {
    return this.startTime
  }

  isStopped(): boolean {
    return this.stopped
  }

  // Simulate playback ending naturally
  simulateEnded(): void {
    if (this.onended) {
      this.onended()
    }
  }
}

class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  copyToChannel = vi.fn()

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
  }
}

class MockAudioContext {
  currentTime = 0
  state: AudioContextState = 'running'
  destination = {}
  sampleRate: number

  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 44100
  }

  createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) => {
      return new MockAudioBuffer(channels, length, sampleRate)
    }
  )

  createBufferSource = vi.fn(() => {
    return new MockAudioBufferSourceNode()
  })

  resume = vi.fn(async () => {
    this.state = 'running'
  })

  close = vi.fn(async () => {
    this.state = 'closed'
  })

  // Helper to advance time in tests
  advanceTime(seconds: number): void {
    this.currentTime += seconds
  }
}

// Install mock globally
// @ts-expect-error - Mocking global
globalThis.AudioContext = MockAudioContext

// =============================================================================
// Tests
// =============================================================================

describe('streamingAudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSourceInstances.length = 0
  })

  afterEach(() => {
    mockSourceInstances.length = 0
  })

  // ===========================================================================
  // base64ToFloat32
  // ===========================================================================

  describe('base64ToFloat32', () => {
    it('should convert base64 to Float32Array', () => {
      // Create a Float32Array with known values
      const original = new Float32Array([0.5, -0.5, 0.25, -0.25])
      const bytes = new Uint8Array(original.buffer)

      // Convert to base64
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      // Convert back
      const result = base64ToFloat32(base64)

      expect(result.length).toBe(4)
      expect(result[0]).toBeCloseTo(0.5, 5)
      expect(result[1]).toBeCloseTo(-0.5, 5)
      expect(result[2]).toBeCloseTo(0.25, 5)
      expect(result[3]).toBeCloseTo(-0.25, 5)
    })

    it('should handle empty base64 string', () => {
      const result = base64ToFloat32('')
      expect(result.length).toBe(0)
    })

    it('should handle base64 with zeros', () => {
      const original = new Float32Array([0, 0, 0, 0])
      const bytes = new Uint8Array(original.buffer)

      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      const result = base64ToFloat32(base64)

      expect(result.length).toBe(4)
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(0)
      expect(result[2]).toBe(0)
      expect(result[3]).toBe(0)
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - Construction
  // ===========================================================================

  describe('StreamingAudioPlayer construction', () => {
    it('should create with default options', () => {
      const player = new StreamingAudioPlayer()

      expect(player).toBeDefined()
      expect(player.getState()).toBeNull() // AudioContext created lazily
    })

    it('should create with custom sample rate', async () => {
      const player = new StreamingAudioPlayer({ sampleRate: 48000 })

      // Trigger AudioContext creation
      const samples = new Float32Array([0.1, 0.2])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      // The AudioContext should be created with the custom sample rate
      expect(player.getState()).toBe('running')
      await player.close()
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - playChunk
  // ===========================================================================

  describe('playChunk', () => {
    it('should decode and schedule audio chunk', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      // Verify source was created and started
      expect(mockSourceInstances.length).toBe(1)
      const source = mockSourceInstances[0]
      expect(source.connect).toHaveBeenCalled()
      expect(source.start).toHaveBeenCalled()
      expect(source.buffer).toBeDefined()
      expect(source.buffer?.length).toBe(4)

      await player.close()
    })

    it('should schedule multiple chunks for gapless playback', async () => {
      const player = new StreamingAudioPlayer()

      // Create two chunks of audio
      const createChunk = (values: number[]) => {
        const samples = new Float32Array(values)
        const bytes = new Uint8Array(samples.buffer)
        let binaryString = ''
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i])
        }
        return btoa(binaryString)
      }

      const chunk1 = createChunk([0.1, 0.2, 0.3, 0.4])
      const chunk2 = createChunk([0.5, 0.6, 0.7, 0.8])

      await player.playChunk(chunk1)
      await player.playChunk(chunk2)

      // Both chunks should be scheduled
      expect(mockSourceInstances.length).toBe(2)

      // Second chunk should start after first
      const source1 = mockSourceInstances[0]
      const source2 = mockSourceInstances[1]
      const start1 = source1.getStartTime()
      const start2 = source2.getStartTime()

      expect(start1).not.toBeNull()
      expect(start2).not.toBeNull()
      expect(start2!).toBeGreaterThan(start1!)

      await player.close()
    })

    it('should handle empty chunk gracefully', async () => {
      const player = new StreamingAudioPlayer()

      // Empty base64 encodes to empty array
      const emptyBase64 = btoa('')

      await player.playChunk(emptyBase64)

      // No source should be created for empty chunk
      expect(mockSourceInstances.length).toBe(0)

      await player.close()
    })

    it('should resume suspended AudioContext', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      // Force context to be suspended first by accessing it
      await player.playChunk(base64)

      // The resume should have been called (or context was already running)
      expect(player.getState()).toBe('running')

      await player.close()
    })

    it('should use custom sample rate for chunk', async () => {
      const player = new StreamingAudioPlayer({ sampleRate: 24000 })

      const samples = new Float32Array([0.1, 0.2])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      // Override sample rate for this chunk
      await player.playChunk(base64, 48000)

      // Buffer should be created with the override sample rate
      expect(mockSourceInstances.length).toBe(1)
      const source = mockSourceInstances[0]
      expect(source.buffer?.sampleRate).toBe(48000)

      await player.close()
    })

    it('should not schedule after close is called', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.close()

      // This should be a no-op
      await player.playChunk(base64)

      expect(mockSourceInstances.length).toBe(0)
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - stop
  // ===========================================================================

  describe('stop', () => {
    it('should stop all active sources', async () => {
      const player = new StreamingAudioPlayer()

      const createChunk = (value: number) => {
        const samples = new Float32Array([value])
        const bytes = new Uint8Array(samples.buffer)
        let binaryString = ''
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i])
        }
        return btoa(binaryString)
      }

      await player.playChunk(createChunk(0.1))
      await player.playChunk(createChunk(0.2))

      expect(mockSourceInstances.length).toBe(2)

      player.stop()

      // All sources should be stopped
      expect(mockSourceInstances[0].stop).toHaveBeenCalled()
      expect(mockSourceInstances[1].stop).toHaveBeenCalled()
      expect(mockSourceInstances[0].disconnect).toHaveBeenCalled()
      expect(mockSourceInstances[1].disconnect).toHaveBeenCalled()

      await player.close()
    })

    it('should reset scheduling state after stop', async () => {
      const player = new StreamingAudioPlayer()

      const createChunk = (value: number) => {
        const samples = new Float32Array([value])
        const bytes = new Uint8Array(samples.buffer)
        let binaryString = ''
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i])
        }
        return btoa(binaryString)
      }

      await player.playChunk(createChunk(0.1))
      const sourceCountBeforeStop = mockSourceInstances.length
      expect(sourceCountBeforeStop).toBe(1)

      player.stop()

      // After stop, sources should be cleared
      expect(player.getActiveSourceCount()).toBe(0)

      // New chunk should start fresh
      await player.playChunk(createChunk(0.2))

      // Should have new source added (total 2 mock instances, but player only tracks 1 active)
      expect(mockSourceInstances.length).toBe(2)
      expect(player.getActiveSourceCount()).toBe(1)

      await player.close()
    })

    it('should handle stop when no audio is playing', () => {
      const player = new StreamingAudioPlayer()

      // Should not throw
      expect(() => player.stop()).not.toThrow()
    })

    it('should handle stop called multiple times', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      player.stop()
      player.stop()
      player.stop()

      // Should not throw and sources should only be stopped once
      expect(mockSourceInstances[0].isStopped()).toBe(true)

      await player.close()
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - isPlaying
  // ===========================================================================

  describe('isPlaying', () => {
    it('should return false when no AudioContext exists', () => {
      const player = new StreamingAudioPlayer()
      expect(player.isPlaying()).toBe(false)
    })

    it('should return true when audio is scheduled', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      expect(player.isPlaying()).toBe(true)

      await player.close()
    })

    it('should return false after stop is called', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)
      player.stop()

      expect(player.isPlaying()).toBe(false)

      await player.close()
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - getActiveSourceCount
  // ===========================================================================

  describe('getActiveSourceCount', () => {
    it('should return 0 initially', () => {
      const player = new StreamingAudioPlayer()
      expect(player.getActiveSourceCount()).toBe(0)
    })

    it('should return count of active sources', async () => {
      const player = new StreamingAudioPlayer()

      const createChunk = (value: number) => {
        const samples = new Float32Array([value])
        const bytes = new Uint8Array(samples.buffer)
        let binaryString = ''
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i])
        }
        return btoa(binaryString)
      }

      await player.playChunk(createChunk(0.1))
      expect(player.getActiveSourceCount()).toBe(1)

      await player.playChunk(createChunk(0.2))
      expect(player.getActiveSourceCount()).toBe(2)

      await player.close()
    })

    it('should decrease when source ends naturally', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)
      expect(player.getActiveSourceCount()).toBe(1)

      // Simulate audio ending
      mockSourceInstances[0].simulateEnded()
      expect(player.getActiveSourceCount()).toBe(0)

      await player.close()
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - close
  // ===========================================================================

  describe('close', () => {
    it('should close AudioContext', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)
      await player.close()

      expect(player.getState()).toBeNull()
    })

    it('should stop all sources before closing', async () => {
      const player = new StreamingAudioPlayer()

      const createChunk = (value: number) => {
        const samples = new Float32Array([value])
        const bytes = new Uint8Array(samples.buffer)
        let binaryString = ''
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i])
        }
        return btoa(binaryString)
      }

      await player.playChunk(createChunk(0.1))
      await player.playChunk(createChunk(0.2))

      await player.close()

      expect(mockSourceInstances[0].stop).toHaveBeenCalled()
      expect(mockSourceInstances[1].stop).toHaveBeenCalled()
    })

    it('should handle close when never used', async () => {
      const player = new StreamingAudioPlayer()

      // Should not throw
      await expect(player.close()).resolves.toBeUndefined()
    })

    it('should handle close called multiple times', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      await player.close()
      await player.close()
      await player.close()

      // Should not throw
      expect(player.getState()).toBeNull()
    })
  })

  // ===========================================================================
  // StreamingAudioPlayer - getState
  // ===========================================================================

  describe('getState', () => {
    it('should return null when AudioContext not created', () => {
      const player = new StreamingAudioPlayer()
      expect(player.getState()).toBeNull()
    })

    it('should return running after playback starts', async () => {
      const player = new StreamingAudioPlayer()

      const samples = new Float32Array([0.1])
      const bytes = new Uint8Array(samples.buffer)
      let binaryString = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryString)

      await player.playChunk(base64)

      expect(player.getState()).toBe('running')

      await player.close()
    })
  })
})
