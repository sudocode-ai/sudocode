import type { ColorTheme } from '../types'

// One Light color palette (Atom One Light)
export const oneLightTheme: ColorTheme = {
  id: 'one-light',
  name: 'One Light',
  category: 'light',
  highlightTheme: 'github',
  colors: {
    background: '230 8% 98%',            // #fafafa
    foreground: '230 8% 24%',            // #383a42
    card: '0 0% 100%',                   // White card
    cardForeground: '230 8% 24%',
    popover: '0 0% 100%',
    popoverForeground: '230 8% 24%',
    primary: '230 80% 56%',              // #4078f2 (blue)
    primaryForeground: '0 0% 100%',
    secondary: '230 8% 92%',             // Light gray
    secondaryForeground: '230 8% 24%',
    muted: '230 8% 92%',
    mutedForeground: '230 6% 44%',       // #696c77 (comment gray)
    accent: '230 8% 92%',                // Low saturation, matches muted/secondary
    accentForeground: '230 8% 24%',
    destructive: '355 65% 50%',          // #e45649 (red)
    destructiveForeground: '0 0% 100%',
    border: '230 8% 85%',
    input: '230 8% 85%',
    ring: '230 80% 56%',
    chart1: '198 66% 45%',               // #0184bc (cyan)
    chart2: '95 44% 42%',                // #50a14f (green)
    chart3: '301 63% 40%',               // #a626a4 (purple)
    chart4: '29 54% 49%',                // #c18401 (orange)
    chart5: '230 80% 56%',               // Blue
  },
}
