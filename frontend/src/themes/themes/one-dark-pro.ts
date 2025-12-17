import type { ColorTheme } from '../types'

// One Dark Pro color palette
// https://github.com/Binaryify/OneDark-Pro
export const oneDarkProTheme: ColorTheme = {
  id: 'one-dark-pro',
  name: 'One Dark Pro',
  category: 'dark',
  highlightTheme: 'github-dark',
  colors: {
    background: '220 13% 10%',           // Darker background
    foreground: '220 14% 92%',           // Light text for dark theme
    card: '220 13% 7%',                  // Darker card background
    cardForeground: '220 14% 92%',
    popover: '220 13% 7%',
    popoverForeground: '220 14% 92%',
    primary: '207 82% 66%',              // #61afef (blue)
    primaryForeground: '220 13% 10%',
    secondary: '220 13% 8%',             // Darker secondary
    secondaryForeground: '220 14% 92%',
    muted: '220 13% 8%',                 // Darker muted background
    mutedForeground: '220 10% 50%',      // Dimmer muted text
    accent: '220 13% 8%',                // Low saturation, matches muted/secondary
    accentForeground: '220 14% 92%',
    destructive: '355 65% 55%',          // Darker red
    destructiveForeground: '220 14% 92%',
    border: '220 13% 14%',               // Darker border
    input: '220 13% 14%',
    ring: '207 82% 66%',
    chart1: '187 47% 55%',               // #56b6c2 (cyan)
    chart2: '95 38% 62%',                // #98c379 (green)
    chart3: '286 60% 67%',               // #c678dd (purple)
    chart4: '29 54% 61%',                // #d19a66 (orange)
    chart5: '207 82% 66%',               // #61afef (blue)
  },
}
