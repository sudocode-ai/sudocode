import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_PREFIX = 'sudocode:draft:'
const DEBOUNCE_MS = 300
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface DraftEntry {
  value: string
  ts: number
}

function readDraft(fullKey: string): string | null {
  try {
    const raw = localStorage.getItem(fullKey)
    if (!raw) return null
    const entry: DraftEntry = JSON.parse(raw)
    if (Date.now() - entry.ts > TTL_MS) {
      localStorage.removeItem(fullKey)
      return null
    }
    return entry.value
  } catch {
    return null
  }
}

function writeDraft(fullKey: string, value: string): void {
  try {
    const entry: DraftEntry = { value, ts: Date.now() }
    localStorage.setItem(fullKey, JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Persists a string value to localStorage with debounced writes.
 *
 * @param key - Cache key suffix (prefixed with `sudocode:draft:`). Pass `null` to disable caching.
 * @param defaultValue - Fallback value if no draft exists.
 */
export function usePersistedDraft(
  key: string | null,
  defaultValue: string = ''
): {
  value: string
  setValue: (v: string) => void
  clearDraft: () => void
  hasDraft: boolean
} {
  const fullKey = key !== null ? `${STORAGE_PREFIX}${key}` : null

  const [value, setValueState] = useState<string>(() => {
    if (fullKey === null) return defaultValue
    return readDraft(fullKey) ?? defaultValue
  })

  const [hasDraft] = useState<boolean>(() => {
    if (fullKey === null) return false
    return readDraft(fullKey) !== null
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullKeyRef = useRef(fullKey)
  const valueRef = useRef(value)

  // Keep refs in sync
  valueRef.current = value

  // Handle key changes: flush old key, load new key
  useEffect(() => {
    const prevKey = fullKeyRef.current
    fullKeyRef.current = fullKey

    // Flush pending write for the previous key
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      if (prevKey !== null) {
        writeDraft(prevKey, valueRef.current)
      }
    }

    // Load draft for the new key
    if (fullKey === null) {
      setValueState(defaultValue)
    } else {
      const stored = readDraft(fullKey)
      setValueState(stored ?? defaultValue)
    }
  }, [fullKey, defaultValue])

  const setValue = useCallback(
    (v: string) => {
      setValueState(v)
      valueRef.current = v
      if (fullKeyRef.current === null) return
      const currentKey = fullKeyRef.current
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        writeDraft(currentKey, v)
        timerRef.current = null
      }, DEBOUNCE_MS)
    },
    [] // stable — uses refs internally
  )

  const clearDraft = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (fullKeyRef.current !== null) {
      try {
        localStorage.removeItem(fullKeyRef.current)
      } catch {
        // ignore
      }
    }
  }, [])

  // Flush pending write on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        if (fullKeyRef.current !== null) {
          writeDraft(fullKeyRef.current, valueRef.current)
        }
      }
    }
  }, [])

  return { value, setValue, clearDraft, hasDraft }
}

/**
 * Removes all expired `sudocode:draft:*` entries from localStorage.
 * Call once on app startup.
 */
export function cleanExpiredDrafts(): void {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) {
        try {
          const raw = localStorage.getItem(key)
          if (raw) {
            const entry: DraftEntry = JSON.parse(raw)
            if (Date.now() - entry.ts > TTL_MS) {
              keysToRemove.push(key)
            }
          }
        } catch {
          keysToRemove.push(key)
        }
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // localStorage unavailable
  }
}
