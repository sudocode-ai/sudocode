import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Use vi.hoisted for mocks
const {
  mockKokoroTTS,
  mockKokoroVoices,
  mockApiGet,
  mockApiPut,
} = vi.hoisted(() => ({
  mockKokoroTTS: {
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    progress: 0,
    error: null as string | null,
    isReady: false,
    isPlaying: false,
    load: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn(),
    availableVoices: [],
  },
  mockKokoroVoices: [
    { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'female' },
    { id: 'am_adam', name: 'Adam', language: 'en-US', gender: 'male' },
  ],
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
}))

vi.mock('@/hooks/useKokoroTTS', () => ({
  useKokoroTTS: () => mockKokoroTTS,
}))

vi.mock('@/lib/kokoroTTS', () => ({
  getAvailableVoices: () => mockKokoroVoices,
}))

vi.mock('@/lib/api', () => ({
  default: {
    get: mockApiGet,
    put: mockApiPut,
    post: vi.fn(),
  },
}))

vi.mock('@/hooks/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ updateInfo: null }),
  useUpdateMutations: () => ({
    installUpdate: { mutateAsync: vi.fn(), isPending: false },
    restartServer: { handleRestart: vi.fn(), restartState: 'idle' },
  }),
}))

vi.mock('@/hooks/useVoiceConfig', () => ({
  clearVoiceConfigCache: vi.fn(),
}))

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    mode: 'dark',
    setMode: vi.fn(),
    actualMode: 'dark',
    lightTheme: { id: 'light', name: 'Light', colors: { background: '0 0% 100%', primary: '0 0% 0%' } },
    darkTheme: { id: 'dark', name: 'Dark', colors: { background: '0 0% 0%', primary: '0 0% 100%' } },
    setLightTheme: vi.fn(),
    setDarkTheme: vi.fn(),
    availableLightThemes: [],
    availableDarkThemes: [],
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { SettingsDialog } from '@/components/layout/SettingsDialog'

describe('SettingsDialog - Kokoro TTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock state
    mockKokoroTTS.status = 'idle'
    mockKokoroTTS.progress = 0
    mockKokoroTTS.error = null
    mockKokoroTTS.isReady = false
    mockKokoroTTS.isPlaying = false
    mockKokoroTTS.load.mockReset()
    mockKokoroTTS.speak.mockReset()

    // Mock API responses
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/version') {
        return Promise.resolve({ cli: '0.1.0', server: '0.1.0', frontend: '0.1.0' })
      }
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'browser' },
          },
        })
      }
      return Promise.resolve({})
    })
    mockApiPut.mockResolvedValue({})
  })

  it('should render the Voice tab', async () => {
    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    // Click on Voice tab
    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('Voice Input')).toBeInTheDocument()
      expect(screen.getByText('Voice Narration')).toBeInTheDocument()
    })
  })

  it('should show TTS provider selector when narration is enabled', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'browser' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    // Click on Voice tab
    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('TTS Provider')).toBeInTheDocument()
    })
  })

  it('should show Kokoro model status panel when Kokoro provider is selected', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    // Click on Voice tab
    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('Kokoro Model')).toBeInTheDocument()
    })
  })

  it('should show Load Model button when status is idle', async () => {
    mockKokoroTTS.status = 'idle'
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load model/i })).toBeInTheDocument()
    })
  })

  it('should call load when Load Model button is clicked', async () => {
    mockKokoroTTS.status = 'idle'
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    const loadButton = await screen.findByRole('button', { name: /load model/i })
    await userEvent.click(loadButton)

    expect(mockKokoroTTS.load).toHaveBeenCalled()
  })

  it('should show progress bar when status is loading', async () => {
    mockKokoroTTS.status = 'loading'
    mockKokoroTTS.progress = 45
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(screen.getByText(/Downloading.*45%/)).toBeInTheDocument()
    })
  })

  it('should show Ready status when model is loaded', async () => {
    mockKokoroTTS.status = 'ready'
    mockKokoroTTS.isReady = true
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument()
      expect(screen.getByText(/cached for faster loading/i)).toBeInTheDocument()
    })
  })

  it('should show error state with Retry button', async () => {
    mockKokoroTTS.status = 'error'
    mockKokoroTTS.error = 'Network error'
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })

  it('should call load when Retry button is clicked', async () => {
    mockKokoroTTS.status = 'error'
    mockKokoroTTS.error = 'Failed'
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    const retryButton = await screen.findByRole('button', { name: /retry/i })
    await userEvent.click(retryButton)

    expect(mockKokoroTTS.load).toHaveBeenCalled()
  })

  it('should show Kokoro voice description when Kokoro is selected', async () => {
    mockKokoroTTS.status = 'ready'
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro', defaultVoice: 'af_heart' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      // Check for Kokoro-specific voice description
      expect(screen.getByText(/High-quality Kokoro voice/i)).toBeInTheDocument()
    })
  })

  it('should call speak when Test Narration is clicked with Kokoro provider', async () => {
    mockKokoroTTS.status = 'ready'
    mockKokoroTTS.speak.mockResolvedValue(undefined)
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true, speed: 1.0 },
            tts: { provider: 'kokoro', defaultVoice: 'af_heart' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    const testButton = await screen.findByRole('button', { name: /test narration/i })
    await userEvent.click(testButton)

    expect(mockKokoroTTS.speak).toHaveBeenCalledWith(
      'Voice narration is working correctly.',
      expect.objectContaining({
        voice: 'af_heart',
        speed: 1.0,
      })
    )
  })

  it('should disable Test Narration button when Kokoro is playing', async () => {
    mockKokoroTTS.status = 'ready'
    mockKokoroTTS.isPlaying = true
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/voice/config') {
        return Promise.resolve({
          settings: {
            enabled: true,
            narration: { enabled: true },
            tts: { provider: 'kokoro' },
          },
        })
      }
      return Promise.resolve({})
    })

    render(<SettingsDialog isOpen={true} onClose={vi.fn()} />)

    const voiceTab = screen.getByRole('button', { name: /voice/i })
    await userEvent.click(voiceTab)

    await waitFor(() => {
      const playingButton = screen.getByRole('button', { name: /playing/i })
      expect(playingButton).toBeDisabled()
    })
  })
})
