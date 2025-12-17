import type { ColorTheme } from '../types'

// GitHub Light color palette
// https://primer.style/primitives/colors
export const githubLightTheme: ColorTheme = {
  id: 'github-light',
  name: 'GitHub Light',
  category: 'light',
  highlightTheme: 'github',
  colors: {
    background: '210 17% 98%',           // #f6f8fa
    foreground: '215 14% 17%',           // #24292f
    card: '210 17% 100%',                // White card
    cardForeground: '215 14% 17%',
    popover: '210 17% 100%',
    popoverForeground: '215 14% 17%',
    primary: '212 92% 45%',              // #0969da (blue)
    primaryForeground: '0 0% 100%',
    secondary: '210 14% 93%',            // Light gray
    secondaryForeground: '215 14% 17%',
    muted: '210 14% 93%',
    mutedForeground: '215 14% 45%',      // #57606a
    accent: '210 14% 93%',               // Low saturation, matches muted/secondary
    accentForeground: '215 14% 17%',
    destructive: '356 72% 51%',          // #cf222e (red)
    destructiveForeground: '0 0% 100%',
    border: '210 14% 89%',               // #d0d7de
    input: '210 14% 89%',
    ring: '212 92% 45%',
    chart1: '212 92% 45%',               // Blue
    chart2: '137 66% 36%',               // #1a7f37 (green)
    chart3: '272 51% 54%',               // #8250df (purple)
    chart4: '28 89% 52%',                // #bf8700 (orange)
    chart5: '356 72% 51%',               // Red
  },
}
