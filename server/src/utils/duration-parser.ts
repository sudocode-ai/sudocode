/**
 * Parse a duration string in format "72h", "168h", etc. into hours
 * @param duration Duration string (e.g., "72h", "168h")
 * @returns Number of hours
 * @throws Error if format is invalid
 */
export function parseKeepAliveDuration(duration: string): number {
  const match = duration.match(/^(\d+)h$/);
  if (!match) {
    throw new Error(
      'Invalid duration format. Use format like "72h" or "168h"'
    );
  }
  return parseInt(match[1], 10);
}
