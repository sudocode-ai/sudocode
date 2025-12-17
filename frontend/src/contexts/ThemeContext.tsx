import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import githubLight from 'highlight.js/styles/github.css?inline'
import githubDark from 'highlight.js/styles/github-dark.css?inline'
import {
  type ColorTheme,
  getThemeById,
  getDefaultTheme,
  applyThemeToRoot,
  lightThemes,
  darkThemes,
} from '@/themes'

type Mode = 'light' | 'dark' | 'system'

interface ThemeContextType {
  // Mode (light/dark/system)
  mode: Mode
  setMode: (mode: Mode) => void
  actualMode: 'light' | 'dark'

  // Color themes
  lightTheme: ColorTheme
  darkTheme: ColorTheme
  activeTheme: ColorTheme
  setLightTheme: (themeId: string) => void
  setDarkTheme: (themeId: string) => void

  // Available themes
  availableLightThemes: ColorTheme[]
  availableDarkThemes: ColorTheme[]

  // Legacy compatibility
  theme: Mode
  setTheme: (theme: Mode) => void
  actualTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// Storage keys
const STORAGE_KEY_MODE = 'sudocode-theme-mode'
const STORAGE_KEY_LIGHT_THEME = 'sudocode-light-theme'
const STORAGE_KEY_DARK_THEME = 'sudocode-dark-theme'
const LEGACY_STORAGE_KEY = 'theme'

// Create style element for highlight.js themes
let hljsStyleEl: HTMLStyleElement | null = null

function getHljsStyleElement(): HTMLStyleElement {
  if (!hljsStyleEl) {
    hljsStyleEl = document.createElement('style')
    hljsStyleEl.id = 'hljs-theme'
    document.head.appendChild(hljsStyleEl)
  }
  return hljsStyleEl
}

function applyHighlightTheme(theme: ColorTheme) {
  const styleEl = getHljsStyleElement()
  // Use github-dark for dark themes, github for light themes
  styleEl.textContent = theme.category === 'dark' ? githubDark : githubLight
}

// Default theme IDs
const DEFAULT_LIGHT_THEME = 'default-light'
const DEFAULT_DARK_THEME = 'github-dark'

// Migrate from legacy localStorage format
function migrateFromLegacy(): { mode: Mode; lightThemeId: string; darkThemeId: string } {
  const legacyTheme = localStorage.getItem(LEGACY_STORAGE_KEY) as Mode | null

  // Check if already migrated
  const existingMode = localStorage.getItem(STORAGE_KEY_MODE)
  if (existingMode) {
    return {
      mode: existingMode as Mode,
      lightThemeId: localStorage.getItem(STORAGE_KEY_LIGHT_THEME) || DEFAULT_LIGHT_THEME,
      darkThemeId: localStorage.getItem(STORAGE_KEY_DARK_THEME) || DEFAULT_DARK_THEME,
    }
  }

  // Migrate from legacy
  if (legacyTheme) {
    localStorage.setItem(STORAGE_KEY_MODE, legacyTheme)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }

  return {
    mode: legacyTheme || 'system',
    lightThemeId: DEFAULT_LIGHT_THEME,
    darkThemeId: DEFAULT_DARK_THEME,
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from storage (with migration)
  const [initialState] = useState(() => migrateFromLegacy())

  const [mode, setModeState] = useState<Mode>(initialState.mode)
  const [lightThemeId, setLightThemeIdState] = useState(initialState.lightThemeId)
  const [darkThemeId, setDarkThemeIdState] = useState(initialState.darkThemeId)

  // Resolve actual mode (system -> light/dark)
  const [actualMode, setActualMode] = useState<'light' | 'dark'>(() => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return mode
  })

  // Resolve themes
  const lightTheme = useMemo(
    () => getThemeById(lightThemeId) || getDefaultTheme('light'),
    [lightThemeId]
  )
  const darkTheme = useMemo(
    () => getThemeById(darkThemeId) || getDefaultTheme('dark'),
    [darkThemeId]
  )
  const activeTheme = useMemo(
    () => (actualMode === 'dark' ? darkTheme : lightTheme),
    [actualMode, darkTheme, lightTheme]
  )

  // Setters with persistence
  const setMode = useCallback((newMode: Mode) => {
    setModeState(newMode)
    localStorage.setItem(STORAGE_KEY_MODE, newMode)
  }, [])

  const setLightTheme = useCallback((themeId: string) => {
    const theme = getThemeById(themeId)
    if (theme && theme.category === 'light') {
      setLightThemeIdState(themeId)
      localStorage.setItem(STORAGE_KEY_LIGHT_THEME, themeId)
    }
  }, [])

  const setDarkTheme = useCallback((themeId: string) => {
    const theme = getThemeById(themeId)
    if (theme && theme.category === 'dark') {
      setDarkThemeIdState(themeId)
      localStorage.setItem(STORAGE_KEY_DARK_THEME, themeId)
    }
  }, [])

  // Apply theme when activeTheme changes
  useEffect(() => {
    applyThemeToRoot(activeTheme)
    applyHighlightTheme(activeTheme)
  }, [activeTheme])

  // Update actualMode when mode changes
  useEffect(() => {
    if (mode === 'system') {
      const systemMode = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      setActualMode(systemMode)
    } else {
      setActualMode(mode)
    }
  }, [mode])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (mode === 'system') {
        const newMode = mediaQuery.matches ? 'dark' : 'light'
        setActualMode(newMode)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [mode])

  const value = useMemo(
    () => ({
      mode,
      setMode,
      actualMode,
      lightTheme,
      darkTheme,
      activeTheme,
      setLightTheme,
      setDarkTheme,
      availableLightThemes: lightThemes,
      availableDarkThemes: darkThemes,
      // Legacy compatibility
      theme: mode,
      setTheme: setMode,
      actualTheme: actualMode,
    }),
    [mode, setMode, actualMode, lightTheme, darkTheme, activeTheme, setLightTheme, setDarkTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
