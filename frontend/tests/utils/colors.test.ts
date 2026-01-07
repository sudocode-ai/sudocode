import { describe, it, expect } from 'vitest'
import {
  getColorFromId,
  getColorFromIdWithMode,
  getAgentColor,
  getAgentColorClasses,
  AGENT_COLOR_PALETTE,
} from '@/utils/colors'

describe('colors', () => {
  describe('getColorFromId', () => {
    it('should return a valid HSL color string', () => {
      const color = getColorFromId('wf-001')
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    })

    it('should return consistent colors for the same ID', () => {
      const color1 = getColorFromId('wf-abc123')
      const color2 = getColorFromId('wf-abc123')
      expect(color1).toBe(color2)
    })

    it('should return different colors for different IDs', () => {
      const color1 = getColorFromId('wf-001')
      const color2 = getColorFromId('wf-002')
      const color3 = getColorFromId('wf-xyz')

      // At least two of the three should be different
      const uniqueColors = new Set([color1, color2, color3])
      expect(uniqueColors.size).toBeGreaterThan(1)
    })

    it('should have saturation in the expected range (65-89%)', () => {
      const testIds = ['wf-001', 'wf-abc', 'workflow-test', 'another-id']

      for (const id of testIds) {
        const color = getColorFromId(id)
        const match = color.match(/hsl\(\d+, (\d+)%, \d+%\)/)
        expect(match).not.toBeNull()
        const saturation = parseInt(match![1], 10)
        expect(saturation).toBeGreaterThanOrEqual(65)
        expect(saturation).toBeLessThanOrEqual(89)
      }
    })

    it('should have lightness in the expected range (45-64%)', () => {
      const testIds = ['wf-001', 'wf-abc', 'workflow-test', 'another-id']

      for (const id of testIds) {
        const color = getColorFromId(id)
        const match = color.match(/hsl\(\d+, \d+%, (\d+)%\)/)
        expect(match).not.toBeNull()
        const lightness = parseInt(match![1], 10)
        expect(lightness).toBeGreaterThanOrEqual(45)
        expect(lightness).toBeLessThanOrEqual(64)
      }
    })

    it('should have hue in valid range (0-359)', () => {
      const testIds = ['wf-001', 'wf-abc', 'workflow-test', 'another-id']

      for (const id of testIds) {
        const color = getColorFromId(id)
        const match = color.match(/hsl\((\d+), \d+%, \d+%\)/)
        expect(match).not.toBeNull()
        const hue = parseInt(match![1], 10)
        expect(hue).toBeGreaterThanOrEqual(0)
        expect(hue).toBeLessThanOrEqual(359)
      }
    })
  })

  describe('getColorFromIdWithMode', () => {
    it('should return different lightness for dark mode vs light mode', () => {
      const lightColor = getColorFromIdWithMode('wf-001', false)
      const darkColor = getColorFromIdWithMode('wf-001', true)

      // Extract lightness values
      const lightMatch = lightColor.match(/hsl\(\d+, \d+%, (\d+)%\)/)
      const darkMatch = darkColor.match(/hsl\(\d+, \d+%, (\d+)%\)/)

      expect(lightMatch).not.toBeNull()
      expect(darkMatch).not.toBeNull()

      const lightLightness = parseInt(lightMatch![1], 10)
      const darkLightness = parseInt(darkMatch![1], 10)

      // Dark mode should have higher lightness for better visibility
      expect(darkLightness).toBeGreaterThanOrEqual(lightLightness)
    })

    it('should maintain same hue regardless of mode', () => {
      const lightColor = getColorFromIdWithMode('wf-001', false)
      const darkColor = getColorFromIdWithMode('wf-001', true)

      const lightMatch = lightColor.match(/hsl\((\d+), \d+%, \d+%\)/)
      const darkMatch = darkColor.match(/hsl\((\d+), \d+%, \d+%\)/)

      expect(lightMatch![1]).toBe(darkMatch![1])
    })
  })

  describe('getAgentColor', () => {
    it('should return a color from the palette', () => {
      const color = getAgentColor('exec-001')
      expect(AGENT_COLOR_PALETTE).toContain(color)
    })

    it('should return consistent colors for the same ID', () => {
      const color1 = getAgentColor('exec-abc123')
      const color2 = getAgentColor('exec-abc123')
      expect(color1).toBe(color2)
    })

    it('should distribute colors across the palette for different IDs', () => {
      const testIds = [
        'exec-001',
        'exec-002',
        'exec-003',
        'exec-abc',
        'exec-xyz',
        'exec-test',
        'exec-hello',
        'exec-world',
      ]
      const colors = testIds.map((id) => getAgentColor(id))
      const uniqueColors = new Set(colors)

      // With 8 different IDs, we should get at least 3 unique colors
      expect(uniqueColors.size).toBeGreaterThanOrEqual(3)
    })

    it('should return valid hex color format', () => {
      const color = getAgentColor('exec-001')
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  describe('getAgentColorClasses', () => {
    it('should return Tailwind classes for each color property', () => {
      const classes = getAgentColorClasses('exec-001')

      expect(classes).toHaveProperty('bg')
      expect(classes).toHaveProperty('text')
      expect(classes).toHaveProperty('border')
      expect(classes).toHaveProperty('ring')

      expect(classes.bg).toMatch(/^bg-\w+-500$/)
      expect(classes.text).toMatch(/^text-\w+-500$/)
      expect(classes.border).toMatch(/^border-\w+-500$/)
      expect(classes.ring).toMatch(/^ring-\w+-500$/)
    })

    it('should return consistent classes for the same ID', () => {
      const classes1 = getAgentColorClasses('exec-abc123')
      const classes2 = getAgentColorClasses('exec-abc123')
      expect(classes1).toEqual(classes2)
    })

    it('should have matching bg and text colors', () => {
      const classes = getAgentColorClasses('exec-001')
      // Extract color name from bg class (e.g., 'blue' from 'bg-blue-500')
      const bgColor = classes.bg.match(/bg-(\w+)-500/)?.[1]
      const textColor = classes.text.match(/text-(\w+)-500/)?.[1]
      expect(bgColor).toBe(textColor)
    })
  })

  describe('AGENT_COLOR_PALETTE', () => {
    it('should have at least 8 colors', () => {
      expect(AGENT_COLOR_PALETTE.length).toBeGreaterThanOrEqual(8)
    })

    it('should contain only valid hex colors', () => {
      for (const color of AGENT_COLOR_PALETTE) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })

    it('should have unique colors', () => {
      const uniqueColors = new Set(AGENT_COLOR_PALETTE)
      expect(uniqueColors.size).toBe(AGENT_COLOR_PALETTE.length)
    })
  })
})
