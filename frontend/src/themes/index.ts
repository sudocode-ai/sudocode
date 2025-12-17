import { defaultLightTheme } from './themes/default-light'
import { defaultDarkTheme } from './themes/default-dark'
import { draculaTheme } from './themes/dracula'
import { oneDarkProTheme } from './themes/one-dark-pro'
import { nordTheme } from './themes/nord'
import { githubDarkTheme } from './themes/github-dark'
import { githubLightTheme } from './themes/github-light'
import { oneLightTheme } from './themes/one-light'
import { solarizedLightTheme } from './themes/solarized-light'
import type { ColorTheme, ThemeColors } from './types'
import { CSS_VAR_MAP } from './types'

// Export types
export type { ColorTheme, ThemeColors, ThemeCategory } from './types'
export { CSS_VAR_MAP } from './types'

// All available themes
export const allThemes: ColorTheme[] = [
  defaultLightTheme,
  githubLightTheme,
  oneLightTheme,
  solarizedLightTheme,
  defaultDarkTheme,
  githubDarkTheme,
  draculaTheme,
  oneDarkProTheme,
  nordTheme,
]

// Themes by category
export const lightThemes = allThemes.filter((t) => t.category === 'light')
export const darkThemes = allThemes.filter((t) => t.category === 'dark')

// Get theme by ID
export function getThemeById(id: string): ColorTheme | undefined {
  return allThemes.find((t) => t.id === id)
}

// Get default theme for a category
export function getDefaultTheme(category: 'light' | 'dark'): ColorTheme {
  return category === 'light' ? defaultLightTheme : defaultDarkTheme
}

// Apply theme CSS variables to the document root
export function applyThemeToRoot(theme: ColorTheme): void {
  const root = document.documentElement

  // Apply category class for Tailwind dark mode
  root.classList.remove('light', 'dark')
  root.classList.add(theme.category)

  // Apply all CSS variables
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const value = theme.colors[key as keyof ThemeColors]
    if (value) {
      root.style.setProperty(cssVar, value)
    }
  }
}

// Export individual themes for direct import
export {
  defaultLightTheme,
  defaultDarkTheme,
  draculaTheme,
  oneDarkProTheme,
  nordTheme,
  githubDarkTheme,
  githubLightTheme,
  oneLightTheme,
  solarizedLightTheme,
}
