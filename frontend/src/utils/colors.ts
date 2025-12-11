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
