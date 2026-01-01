import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  getSupportedMimeType,
  isMimeTypeSupported,
  isMediaRecorderSupported,
} from '@/lib/voice'

describe('voice utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isMediaRecorderSupported', () => {
    it('should return true when MediaRecorder and getUserMedia are available', () => {
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      } as unknown as Navigator

      expect(isMediaRecorderSupported()).toBe(true)
    })

    it('should return false when MediaRecorder is not available', () => {
      // @ts-expect-error Testing undefined MediaRecorder
      global.MediaRecorder = undefined
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      } as unknown as Navigator

      expect(isMediaRecorderSupported()).toBe(false)
    })

    it('should return false when navigator.mediaDevices is not available', () => {
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {} as Navigator

      expect(isMediaRecorderSupported()).toBe(false)
    })

    it('should return false when getUserMedia is not available', () => {
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {
        mediaDevices: {},
      } as unknown as Navigator

      expect(isMediaRecorderSupported()).toBe(false)
    })
  })

  describe('checkMicrophonePermission', () => {
    it('should return true when permission is granted', async () => {
      global.navigator = {
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
      } as unknown as Navigator

      const result = await checkMicrophonePermission()
      expect(result).toBe(true)
    })

    it('should return false when permission is denied', async () => {
      global.navigator = {
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'denied' }),
        },
      } as unknown as Navigator

      const result = await checkMicrophonePermission()
      expect(result).toBe(false)
    })

    it('should return null when permission is prompt', async () => {
      global.navigator = {
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'prompt' }),
        },
      } as unknown as Navigator

      const result = await checkMicrophonePermission()
      expect(result).toBeNull()
    })

    it('should return null when Permissions API is not available', async () => {
      global.navigator = {} as Navigator

      const result = await checkMicrophonePermission()
      expect(result).toBeNull()
    })

    it('should return null when query throws (Safari)', async () => {
      global.navigator = {
        permissions: {
          query: vi.fn().mockRejectedValue(new Error('Not supported')),
        },
      } as unknown as Navigator

      const result = await checkMicrophonePermission()
      expect(result).toBeNull()
    })
  })

  describe('requestMicrophonePermission', () => {
    it('should return true when permission is granted', async () => {
      const mockStop = vi.fn()
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: mockStop }],
          }),
        },
      } as unknown as Navigator

      const result = await requestMicrophonePermission()

      expect(result).toBe(true)
      expect(mockStop).toHaveBeenCalled()
    })

    it('should return false when permission is denied', async () => {
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      } as unknown as Navigator

      const result = await requestMicrophonePermission()
      expect(result).toBe(false)
    })

    it('should return false when MediaRecorder is not supported', async () => {
      // @ts-expect-error Testing undefined MediaRecorder
      global.MediaRecorder = undefined
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      } as unknown as Navigator

      const result = await requestMicrophonePermission()
      expect(result).toBe(false)
    })

    it('should stop all tracks after getting permission', async () => {
      const mockStop = vi.fn()
      global.MediaRecorder = class {} as unknown as typeof MediaRecorder
      global.navigator = {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: mockStop }, { stop: mockStop }],
          }),
        },
      } as unknown as Navigator

      await requestMicrophonePermission()

      expect(mockStop).toHaveBeenCalledTimes(2)
    })
  })

  describe('getSupportedMimeType', () => {
    it('should return first supported MIME type', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockImplementation((type: string) => {
          return type === 'audio/webm;codecs=opus'
        }),
      } as unknown as typeof MediaRecorder

      const result = getSupportedMimeType()
      expect(result).toBe('audio/webm;codecs=opus')
    })

    it('should return audio/webm when opus not supported', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockImplementation((type: string) => {
          return type === 'audio/webm'
        }),
      } as unknown as typeof MediaRecorder

      const result = getSupportedMimeType()
      expect(result).toBe('audio/webm')
    })

    it('should return audio/ogg when webm not supported', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockImplementation((type: string) => {
          return type === 'audio/ogg'
        }),
      } as unknown as typeof MediaRecorder

      const result = getSupportedMimeType()
      expect(result).toBe('audio/ogg')
    })

    it('should return audio/mp4 when ogg not supported', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockImplementation((type: string) => {
          return type === 'audio/mp4'
        }),
      } as unknown as typeof MediaRecorder

      const result = getSupportedMimeType()
      expect(result).toBe('audio/mp4')
    })

    it('should return empty string when no types supported', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockReturnValue(false),
      } as unknown as typeof MediaRecorder

      const result = getSupportedMimeType()
      expect(result).toBe('')
    })

    it('should return empty string when MediaRecorder not available', () => {
      // @ts-expect-error Testing undefined MediaRecorder
      global.MediaRecorder = undefined

      const result = getSupportedMimeType()
      expect(result).toBe('')
    })
  })

  describe('isMimeTypeSupported', () => {
    it('should return true for supported MIME type', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockReturnValue(true),
      } as unknown as typeof MediaRecorder

      expect(isMimeTypeSupported('audio/webm')).toBe(true)
    })

    it('should return false for unsupported MIME type', () => {
      global.MediaRecorder = {
        isTypeSupported: vi.fn().mockReturnValue(false),
      } as unknown as typeof MediaRecorder

      expect(isMimeTypeSupported('audio/unsupported')).toBe(false)
    })

    it('should return false when MediaRecorder not available', () => {
      // @ts-expect-error Testing undefined MediaRecorder
      global.MediaRecorder = undefined

      expect(isMimeTypeSupported('audio/webm')).toBe(false)
    })

    it('should call isTypeSupported with the correct argument', () => {
      const mockIsTypeSupported = vi.fn().mockReturnValue(true)
      global.MediaRecorder = {
        isTypeSupported: mockIsTypeSupported,
      } as unknown as typeof MediaRecorder

      isMimeTypeSupported('audio/ogg')

      expect(mockIsTypeSupported).toHaveBeenCalledWith('audio/ogg')
    })
  })
})
