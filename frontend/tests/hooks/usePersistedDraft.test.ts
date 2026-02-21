import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersistedDraft, cleanExpiredDrafts } from '@/hooks/usePersistedDraft'

const PREFIX = 'sudocode:draft:'
const DEBOUNCE_MS = 300
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 1. Basic state behavior
// ---------------------------------------------------------------------------
describe('basic state', () => {
  it('returns defaultValue when no draft exists', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key', 'hello'))
    expect(result.current.value).toBe('hello')
    expect(result.current.hasDraft).toBe(false)
  })

  it('returns empty string when no defaultValue and no draft', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    expect(result.current.value).toBe('')
  })

  it('setValue updates value synchronously', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('new value'))
    expect(result.current.value).toBe('new value')
  })
})

// ---------------------------------------------------------------------------
// 2. localStorage persistence with debounce
// ---------------------------------------------------------------------------
describe('debounced persistence', () => {
  it('does not write to localStorage immediately on setValue', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('draft text'))
    expect(localStorage.getItem(`${PREFIX}test-key`)).toBeNull()
  })

  it('writes to localStorage after debounce delay', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('draft text'))
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS))
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}test-key`)!)
    expect(stored.value).toBe('draft text')
    expect(stored.ts).toBeTypeOf('number')
  })

  it('resets debounce timer on rapid setValue calls', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('first'))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.setValue('second'))
    act(() => vi.advanceTimersByTime(200))
    // Only 400ms total — first debounce was reset, second hasn't fired
    expect(localStorage.getItem(`${PREFIX}test-key`)).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    // Now 300ms since last setValue
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}test-key`)!)
    expect(stored.value).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// 3. Draft restoration on mount
// ---------------------------------------------------------------------------
describe('draft restoration', () => {
  it('restores a cached draft on mount', () => {
    localStorage.setItem(
      `${PREFIX}test-key`,
      JSON.stringify({ value: 'cached draft', ts: Date.now() })
    )
    const { result } = renderHook(() => usePersistedDraft('test-key', 'default'))
    expect(result.current.value).toBe('cached draft')
    expect(result.current.hasDraft).toBe(true)
  })

  it('draft takes precedence over defaultValue', () => {
    localStorage.setItem(
      `${PREFIX}test-key`,
      JSON.stringify({ value: 'saved', ts: Date.now() })
    )
    const { result } = renderHook(() => usePersistedDraft('test-key', 'fallback'))
    expect(result.current.value).toBe('saved')
  })
})

// ---------------------------------------------------------------------------
// 4. TTL expiry
// ---------------------------------------------------------------------------
describe('TTL expiry', () => {
  it('discards drafts older than 7 days on read', () => {
    localStorage.setItem(
      `${PREFIX}test-key`,
      JSON.stringify({ value: 'old draft', ts: Date.now() - SEVEN_DAYS_MS - 1 })
    )
    const { result } = renderHook(() => usePersistedDraft('test-key', 'default'))
    expect(result.current.value).toBe('default')
    expect(result.current.hasDraft).toBe(false)
    // Key should be cleaned up
    expect(localStorage.getItem(`${PREFIX}test-key`)).toBeNull()
  })

  it('keeps drafts within the 7-day window', () => {
    localStorage.setItem(
      `${PREFIX}test-key`,
      JSON.stringify({ value: 'recent draft', ts: Date.now() - SEVEN_DAYS_MS + 60000 })
    )
    const { result } = renderHook(() => usePersistedDraft('test-key', 'default'))
    expect(result.current.value).toBe('recent draft')
    expect(result.current.hasDraft).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. clearDraft
// ---------------------------------------------------------------------------
describe('clearDraft', () => {
  it('removes the key from localStorage', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('draft'))
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS))
    expect(localStorage.getItem(`${PREFIX}test-key`)).not.toBeNull()
    act(() => result.current.clearDraft())
    expect(localStorage.getItem(`${PREFIX}test-key`)).toBeNull()
  })

  it('cancels pending debounce so it does not re-write', () => {
    const { result } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('draft'))
    // Debounce is pending — now clear before it fires
    act(() => result.current.clearDraft())
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS + 100))
    // The debounced write should NOT have fired
    expect(localStorage.getItem(`${PREFIX}test-key`)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. key = null (disabled mode)
// ---------------------------------------------------------------------------
describe('disabled mode (key = null)', () => {
  it('does not read from localStorage', () => {
    localStorage.setItem(
      `${PREFIX}some-key`,
      JSON.stringify({ value: 'cached', ts: Date.now() })
    )
    const { result } = renderHook(() => usePersistedDraft(null, 'default'))
    expect(result.current.value).toBe('default')
    expect(result.current.hasDraft).toBe(false)
  })

  it('does not write to localStorage on setValue', () => {
    const { result } = renderHook(() => usePersistedDraft(null))
    act(() => result.current.setValue('something'))
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS + 100))
    // No keys should have been written
    expect(localStorage.length).toBe(0)
  })

  it('setValue still updates the value in state', () => {
    const { result } = renderHook(() => usePersistedDraft(null))
    act(() => result.current.setValue('new'))
    expect(result.current.value).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// 7. Key change (e.g. switching issues)
// ---------------------------------------------------------------------------
describe('key change', () => {
  it('flushes old key and loads new key when key changes', () => {
    // Pre-populate a draft for key B
    localStorage.setItem(
      `${PREFIX}key-b`,
      JSON.stringify({ value: 'draft for B', ts: Date.now() })
    )

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePersistedDraft(k),
      { initialProps: { k: 'key-a' } }
    )

    // Type something for key A
    act(() => result.current.setValue('draft for A'))
    // Switch to key B before debounce fires
    rerender({ k: 'key-b' })

    // Old key A should have been flushed
    const storedA = JSON.parse(localStorage.getItem(`${PREFIX}key-a`)!)
    expect(storedA.value).toBe('draft for A')
    // Value should now be the draft for key B
    expect(result.current.value).toBe('draft for B')
  })

  it('loads defaultValue when new key has no draft', () => {
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePersistedDraft(k, 'fallback'),
      { initialProps: { k: 'key-a' } }
    )
    act(() => result.current.setValue('something'))
    rerender({ k: 'key-c' })
    expect(result.current.value).toBe('fallback')
  })
})

// ---------------------------------------------------------------------------
// 8. Unmount flushes pending writes
// ---------------------------------------------------------------------------
describe('unmount behavior', () => {
  it('flushes pending debounce write on unmount', () => {
    const { result, unmount } = renderHook(() => usePersistedDraft('test-key'))
    act(() => result.current.setValue('unsaved'))
    // Debounce hasn't fired yet — unmount
    unmount()
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}test-key`)!)
    expect(stored.value).toBe('unsaved')
  })
})

// ---------------------------------------------------------------------------
// 9. cleanExpiredDrafts utility
// ---------------------------------------------------------------------------
describe('cleanExpiredDrafts', () => {
  it('removes expired draft keys', () => {
    localStorage.setItem(
      `${PREFIX}old`,
      JSON.stringify({ value: 'old', ts: Date.now() - SEVEN_DAYS_MS - 1 })
    )
    localStorage.setItem(
      `${PREFIX}recent`,
      JSON.stringify({ value: 'recent', ts: Date.now() })
    )
    localStorage.setItem('unrelated-key', 'keep me')

    cleanExpiredDrafts()

    expect(localStorage.getItem(`${PREFIX}old`)).toBeNull()
    expect(localStorage.getItem(`${PREFIX}recent`)).not.toBeNull()
    expect(localStorage.getItem('unrelated-key')).toBe('keep me')
  })

  it('removes malformed draft entries', () => {
    localStorage.setItem(`${PREFIX}bad`, 'not-json')
    cleanExpiredDrafts()
    expect(localStorage.getItem(`${PREFIX}bad`)).toBeNull()
  })

  it('no-ops when localStorage is empty', () => {
    expect(() => cleanExpiredDrafts()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 10. Resilience to corrupt localStorage data
// ---------------------------------------------------------------------------
describe('corrupt data handling', () => {
  it('returns defaultValue when stored value is corrupt JSON', () => {
    localStorage.setItem(`${PREFIX}test-key`, 'not-json')
    const { result } = renderHook(() => usePersistedDraft('test-key', 'safe'))
    expect(result.current.value).toBe('safe')
    expect(result.current.hasDraft).toBe(false)
  })
})
