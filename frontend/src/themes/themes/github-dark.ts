import type { ColorTheme } from '../types'

// GitHub Dark color palette
// https://primer.style/primitives/colors
export const githubDarkTheme: ColorTheme = {
  id: 'github-dark',
  name: 'GitHub Dark',
  category: 'dark',
  highlightTheme: 'github-dark',
  colors: {
    background: '215 28% 7%',            // #0d1117
    foreground: '212 14% 93%',           // Light text for dark theme
    card: '215 21% 9%',                  // Darker card
    cardForeground: '212 14% 93%',
    popover: '215 21% 9%',
    popoverForeground: '212 14% 93%',
    primary: '212 100% 55%',             // Darker blue for contrast
    primaryForeground: '212 14% 93%',
    secondary: '215 14% 12%',            // Darker secondary
    secondaryForeground: '212 14% 93%',
    muted: '215 14% 12%',                // Darker muted
    mutedForeground: '212 9% 50%',       // Dimmer muted text
    accent: '215 14% 12%',               // Low saturation, matches muted/secondary
    accentForeground: '212 14% 93%',
    destructive: '356 72% 50%',          // Darker red
    destructiveForeground: '212 14% 93%',
    border: '215 14% 16%',               // Darker border
    input: '215 14% 16%',
    ring: '212 100% 67%',
    chart1: '212 100% 67%',              // #58a6ff (blue)
    chart2: '140 100% 73%',              // #7ee787 (green)
    chart3: '286 100% 77%',              // #d2a8ff (purple)
    chart4: '39 100% 74%',               // #ffc152 (orange)
    chart5: '326 100% 74%',              // #ff7b72 (coral)
  },
}
