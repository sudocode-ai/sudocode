import { expect, afterEach, vi, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Suppress noisy console warnings during tests
const originalError = console.error
const originalWarn = console.warn

// TODO: Fix underlying issues instead of suppressing warnings.
beforeAll(() => {
  console.error = (...args: any[]) => {
    // Filter out React Router future flag warnings
    if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) {
      return
    }
    // Filter out act() warnings from Radix UI components
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: An update to') &&
      args[0].includes('inside a test was not wrapped in act')
    ) {
      return
    }
    originalError.call(console, ...args)
  }

  console.warn = (...args: any[]) => {
    // Filter out React Router future flag warnings
    if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) {
      return
    }
    // Filter out DOM nesting warnings (common in markdown rendering)
    if (typeof args[0] === 'string' && args[0].includes('validateDOMNesting')) {
      return
    }
    originalWarn.call(console, ...args)
  }
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Polyfill for Radix UI pointer events (missing in jsdom)
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = vi.fn()
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = vi.fn()
}

// Polyfill for scrollIntoView (missing in jsdom)
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
}

// Polyfill for ResizeObserver (missing in jsdom)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Cleanup after each test
afterEach(() => {
  cleanup()
})
