/**
 * Color utilities for generating consistent colors from IDs
 */

/**
 * Simple string hash function (djb2)
 */
function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0 // Convert to unsigned 32-bit integer
}

/**
 * Generates an HSL color from a string ID.
 * Uses consistent hashing to ensure the same ID always produces the same color.
 * Keeps saturation high and varies hue/lightness for visually distinct colors.
 *
 * @param id - The string ID to hash (e.g., workflow ID)
 * @returns HSL color string (e.g., "hsl(240, 75%, 60%)")
 */
export function getColorFromId(id: string): string {
  const hash = hashString(id)

  // Use different bits of the hash for different color components
  const hue = hash % 360 // 0-359
  const saturation = 65 + (hash >> 8) % 25 // 65-89% (high saturation)
  const lightness = 45 + (hash >> 16) % 20 // 45-64% (medium lightness for good contrast)

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

/**
 * Generates an HSL color with adjusted lightness for dark mode.
 * In dark mode, we want slightly lighter colors for better visibility.
 *
 * @param id - The string ID to hash
 * @param isDarkMode - Whether dark mode is active
 * @returns HSL color string
 */
export function getColorFromIdWithMode(id: string, isDarkMode: boolean): string {
  const hash = hashString(id)

  const hue = hash % 360
  const saturation = 65 + (hash >> 8) % 25

  // Adjust lightness based on mode
  const baseLightness = isDarkMode ? 55 : 45
  const lightnessRange = isDarkMode ? 15 : 20
  const lightness = baseLightness + (hash >> 16) % lightnessRange

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

/**
 * Predefined palette of visually distinct colors for agent overlays.
 * These colors work well in both light and dark themes and provide
 * good visual distinction when multiple agents are working simultaneously.
 */
export const AGENT_COLOR_PALETTE = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
] as const

/**
 * Gets a consistent color for an agent/execution from the predefined palette.
 * Uses deterministic hashing so the same ID always returns the same color.
 *
 * @param executionId - The execution ID to get a color for
 * @returns Hex color string from the palette
 */
export function getAgentColor(executionId: string): string {
  const hash = hashString(executionId)
  return AGENT_COLOR_PALETTE[hash % AGENT_COLOR_PALETTE.length]
}

/**
 * Gets the CSS class name for an agent color based on its index in the palette.
 * Useful for applying Tailwind classes.
 *
 * @param executionId - The execution ID
 * @returns Object with bg, text, and border Tailwind color classes
 */
export function getAgentColorClasses(executionId: string): {
  bg: string
  text: string
  border: string
  ring: string
} {
  const hash = hashString(executionId)
  const index = hash % AGENT_COLOR_PALETTE.length

  const colorMap: Record<number, { bg: string; text: string; border: string; ring: string }> = {
    0: { bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500', ring: 'ring-blue-500' },
    1: { bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500', ring: 'ring-emerald-500' },
    2: { bg: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-500', ring: 'ring-amber-500' },
    3: { bg: 'bg-red-500', text: 'text-red-500', border: 'border-red-500', ring: 'ring-red-500' },
    4: { bg: 'bg-violet-500', text: 'text-violet-500', border: 'border-violet-500', ring: 'ring-violet-500' },
    5: { bg: 'bg-pink-500', text: 'text-pink-500', border: 'border-pink-500', ring: 'ring-pink-500' },
    6: { bg: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-500', ring: 'ring-cyan-500' },
    7: { bg: 'bg-lime-500', text: 'text-lime-500', border: 'border-lime-500', ring: 'ring-lime-500' },
    8: { bg: 'bg-orange-500', text: 'text-orange-500', border: 'border-orange-500', ring: 'ring-orange-500' },
    9: { bg: 'bg-indigo-500', text: 'text-indigo-500', border: 'border-indigo-500', ring: 'ring-indigo-500' },
  }

  return colorMap[index]
}
