import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock matchMedia
const createMatchMedia = (matches: boolean) => {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Default to light mode in tests
    window.matchMedia = createMatchMedia(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should throw error when useTheme is used outside ThemeProvider', () => {
    // Suppress console.error for this test
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTheme())
    }).toThrow('useTheme must be used within a ThemeProvider')

    consoleError.mockRestore()
  })

  it('should provide default theme as system', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.actualTheme).toBe('light')
  })

  it('should load theme from localStorage', () => {
    localStorageMock.setItem('theme', 'dark')

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.actualTheme).toBe('dark')
  })

  it('should set theme to light', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('light')
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.actualTheme).toBe('light')
    expect(localStorageMock.getItem('theme')).toBe('light')
  })

  it('should set theme to dark', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.actualTheme).toBe('dark')
    expect(localStorageMock.getItem('theme')).toBe('dark')
  })

  it('should set theme to system', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('system')
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.actualTheme).toBe('light') // Based on our mock
    expect(localStorageMock.getItem('theme')).toBe('system')
  })

  it('should use system dark theme when system is selected and OS prefers dark', () => {
    window.matchMedia = createMatchMedia(true) // OS prefers dark

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('system')
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.actualTheme).toBe('dark')
  })

  it('should persist theme changes to localStorage', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('dark')
    })
    expect(localStorageMock.getItem('theme')).toBe('dark')

    act(() => {
      result.current.setTheme('light')
    })
    expect(localStorageMock.getItem('theme')).toBe('light')

    act(() => {
      result.current.setTheme('system')
    })
    expect(localStorageMock.getItem('theme')).toBe('system')
  })

  it('should apply theme class to document root', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('dark')
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)

    act(() => {
      result.current.setTheme('light')
    })

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('should respect system preference when theme is system', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('system')
    })

    // Should match the mocked system preference (light)
    expect(result.current.actualTheme).toBe('light')
    expect(result.current.theme).toBe('system')
  })

  it('should not react to system theme changes when theme is not system', () => {
    const listeners: Array<(e: MediaQueryListEvent) => void> = []
    const mockMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          listeners.push(listener)
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    window.matchMedia = mockMatchMedia

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    })

    act(() => {
      result.current.setTheme('light')
    })

    const initialTheme = result.current.actualTheme

    // Simulate system theme change
    act(() => {
      listeners.forEach((listener) => {
        listener({ matches: true } as MediaQueryListEvent)
      })
    })

    // Should remain unchanged
    expect(result.current.actualTheme).toBe(initialTheme)
    expect(result.current.actualTheme).toBe('light')
  })
})
