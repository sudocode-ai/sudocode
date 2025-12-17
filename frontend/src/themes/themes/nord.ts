import type { ColorTheme } from '../types'

// Nord color palette
// https://www.nordtheme.com/docs/colors-and-palettes
export const nordTheme: ColorTheme = {
  id: 'nord',
  name: 'Nord',
  category: 'dark',
  highlightTheme: 'github-dark',
  colors: {
    background: '220 16% 12%',           // Darker background
    foreground: '218 27% 94%',           // #eceff4 (nord6)
    card: '220 17% 8%',                  // Darker card
    cardForeground: '218 27% 94%',
    popover: '220 17% 8%',
    popoverForeground: '218 27% 94%',
    primary: '193 43% 50%',              // Darker frost blue for contrast
    primaryForeground: '218 27% 94%',
    secondary: '220 16% 10%',            // Darker secondary
    secondaryForeground: '218 27% 94%',
    muted: '220 16% 10%',                // Darker muted
    mutedForeground: '219 20% 45%',      // Dimmer muted text
    accent: '220 16% 10%',               // Low saturation, matches muted/secondary
    accentForeground: '218 27% 94%',
    destructive: '354 42% 45%',          // Darker aurora red
    destructiveForeground: '218 27% 94%',
    border: '220 16% 16%',               // Darker border
    input: '220 16% 16%',
    ring: '193 43% 67%',
    chart1: '193 43% 67%',               // #88c0d0 (nord8)
    chart2: '92 28% 65%',                // #a3be8c (nord14)
    chart3: '311 20% 63%',               // #b48ead (nord15 - purple)
    chart4: '40 71% 73%',                // #ebcb8b (nord13 - yellow)
    chart5: '213 32% 52%',               // #5e81ac (nord10)
  },
}
