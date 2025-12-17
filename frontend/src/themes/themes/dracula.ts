import type { ColorTheme } from '../types'

// Dracula color palette
// https://draculatheme.com/contribute
export const draculaTheme: ColorTheme = {
  id: 'dracula',
  name: 'Dracula',
  category: 'dark',
  highlightTheme: 'github-dark',
  colors: {
    background: '231 15% 10%',           // Darker background
    foreground: '60 30% 96%',            // #f8f8f2
    card: '232 14% 7%',                  // Darker card
    cardForeground: '60 30% 96%',
    popover: '232 14% 7%',
    popoverForeground: '60 30% 96%',
    primary: '265 89% 58%',              // Darker purple for contrast
    primaryForeground: '60 30% 96%',
    secondary: '231 15% 8%',             // Darker secondary
    secondaryForeground: '60 30% 96%',
    muted: '232 14% 8%',                 // Darker muted
    mutedForeground: '60 10% 50%',       // Dimmer muted text
    accent: '232 14% 8%',                // Low saturation, matches muted/secondary
    accentForeground: '60 30% 96%',
    destructive: '0 85% 50%',            // Darker red
    destructiveForeground: '60 30% 96%',
    border: '231 15% 14%',               // Darker border
    input: '231 15% 14%',
    ring: '265 89% 78%',
    chart1: '191 97% 77%',               // #8be9fd (cyan)
    chart2: '135 94% 65%',               // #50fa7b (green)
    chart3: '265 89% 78%',               // #bd93f9 (purple)
    chart4: '31 100% 71%',               // #ffb86c (orange)
    chart5: '326 100% 74%',              // #ff79c6 (pink)
  },
}
