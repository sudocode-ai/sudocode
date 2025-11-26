import { createContext, useContext, useEffect, useState } from 'react'
import githubLight from 'highlight.js/styles/github.css?inline'
import githubDark from 'highlight.js/styles/github-dark.css?inline'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  actualTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// Create style elements for highlight.js themes
const lightStyle = document.createElement('style')
lightStyle.id = 'hljs-light'
lightStyle.textContent = githubLight

const darkStyle = document.createElement('style')
darkStyle.id = 'hljs-dark'
darkStyle.textContent = githubDark

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme') as Theme
    return stored || 'system'
  })

  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    let currentTheme: 'light' | 'dark'
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      root.classList.add(systemTheme)
      setActualTheme(systemTheme)
      currentTheme = systemTheme
    } else {
      root.classList.add(theme)
      setActualTheme(theme)
      currentTheme = theme
    }

    // Update highlight.js theme
    if (currentTheme === 'dark') {
      document.head.appendChild(darkStyle)
      lightStyle.remove()
    } else {
      document.head.appendChild(lightStyle)
      darkStyle.remove()
    }
  }, [theme])

  useEffect(() => {
    localStorage.setItem('theme', theme)
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        const newTheme = mediaQuery.matches ? 'dark' : 'light'
        setActualTheme(newTheme)
        window.document.documentElement.classList.remove('light', 'dark')
        window.document.documentElement.classList.add(newTheme)

        // Update highlight.js theme
        if (newTheme === 'dark') {
          document.head.appendChild(darkStyle)
          lightStyle.remove()
        } else {
          document.head.appendChild(lightStyle)
          darkStyle.remove()
        }
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
