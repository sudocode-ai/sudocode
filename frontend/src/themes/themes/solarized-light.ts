import type { ColorTheme } from '../types'

// Solarized Light color palette
// https://ethanschoonover.com/solarized/
export const solarizedLightTheme: ColorTheme = {
  id: 'solarized-light',
  name: 'Solarized Light',
  category: 'light',
  highlightTheme: 'github',
  colors: {
    background: '44 87% 94%',            // #fdf6e3 (base3)
    foreground: '192 81% 14%',           // #073642 (base02)
    card: '44 100% 96%',                 // Slightly lighter
    cardForeground: '192 81% 14%',
    popover: '44 100% 96%',
    popoverForeground: '192 81% 14%',
    primary: '205 69% 49%',              // #268bd2 (blue)
    primaryForeground: '44 87% 94%',
    secondary: '44 50% 88%',             // Muted cream
    secondaryForeground: '192 81% 14%',
    muted: '44 50% 88%',
    mutedForeground: '180 9% 45%',       // #657b83 (base00)
    accent: '44 50% 88%',                // Low saturation, matches muted/secondary
    accentForeground: '192 81% 14%',
    destructive: '1 71% 52%',            // #dc322f (red)
    destructiveForeground: '44 87% 94%',
    border: '44 40% 80%',
    input: '44 40% 80%',
    ring: '205 69% 49%',
    chart1: '205 69% 49%',               // Blue
    chart2: '68 100% 30%',               // #859900 (green)
    chart3: '331 64% 52%',               // #d33682 (magenta)
    chart4: '18 89% 55%',                // #cb4b16 (orange)
    chart5: '175 59% 40%',               // #2aa198 (cyan)
  },
}
