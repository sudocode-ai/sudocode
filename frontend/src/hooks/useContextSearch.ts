import { useState, useEffect, useRef, useCallback } from 'react'
import { filesApi, specsApi, issuesApi } from '@/lib/api'
import type { ContextSearchResult, FileSearchResult, Issue, Spec } from '@/types/api'

const DEBOUNCE_MS = 300
const RECENT_MENTIONS_KEY = 'sudocode:recentMentions'
const RECENT_MENTIONS_LIMIT = 20
const RECENT_BOOST_HOURS = 24

interface UseContextSearchParams {
  query: string
  projectId: string
  enabled: boolean
}

interface UseContextSearchResult {
  results: ContextSearchResult[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

interface RecentMentions {
  [entityId: string]: number // timestamp
}

/**
 * Get recent mentions from localStorage
 */
function getRecentMentions(): RecentMentions {
  try {
    const stored = localStorage.getItem(RECENT_MENTIONS_KEY)
    if (!stored) return {}
    return JSON.parse(stored)
  } catch (error) {
    console.warn('Failed to load recent mentions:', error)
    return {}
  }
}

/**
 * Save recent mention to localStorage
 */
export function saveRecentMention(entityId: string): void {
  try {
    const recent = getRecentMentions()
    recent[entityId] = Date.now()

    // Keep only the most recent 20
    const sorted = Object.entries(recent)
      .sort(([, a], [, b]) => b - a)
      .slice(0, RECENT_MENTIONS_LIMIT)

    localStorage.setItem(RECENT_MENTIONS_KEY, JSON.stringify(Object.fromEntries(sorted)))
  } catch (error) {
    console.warn('Failed to save recent mention:', error)
  }
}

/**
 * Check if entity was recently used (within 24 hours)
 */
function wasRecentlyUsed(entityId: string, recentMentions: RecentMentions): boolean {
  const timestamp = recentMentions[entityId]
  if (!timestamp) return false

  const hoursSince = (Date.now() - timestamp) / (1000 * 60 * 60)
  return hoursSince < RECENT_BOOST_HOURS
}

/**
 * Convert file search result to context search result
 */
function fileToContextResult(file: FileSearchResult): ContextSearchResult {
  return {
    type: 'file',
    filePath: file.path,
    fileName: file.name,
    displayText: file.name,
    secondaryText: file.path,
    insertText: file.path,
    matchScore: file.matchType === 'exact' ? 100 : file.matchType === 'prefix' ? 75 : 50,
  }
}

/**
 * Convert spec to context search result
 */
function specToContextResult(spec: Spec, query: string): ContextSearchResult {
  const lowerQuery = query.toLowerCase()
  const lowerTitle = spec.title.toLowerCase()
  const lowerSpecId = spec.id.toLowerCase()

  let matchScore = 50 // default contains match
  if (lowerTitle === lowerQuery || lowerSpecId === lowerQuery) {
    matchScore = 100 // exact match
  } else if (lowerTitle.startsWith(lowerQuery)) {
    matchScore = 75 // prefix match
  }

  return {
    type: 'spec',
    entityId: spec.id,
    title: spec.title,
    displayText: spec.title,
    secondaryText: spec.id,
    insertText: `[[${spec.id}]]`,
    matchScore,
  }
}

/**
 * Convert issue to context search result
 */
function issueToContextResult(issue: Issue, query: string): ContextSearchResult {
  const lowerQuery = query.toLowerCase()
  const lowerTitle = issue.title.toLowerCase()
  const lowerIssueId = issue.id.toLowerCase()

  let matchScore = 50 // default contains match
  if (lowerTitle === lowerQuery || lowerIssueId === lowerQuery) {
    matchScore = 100 // exact match
  } else if (lowerTitle.startsWith(lowerQuery)) {
    matchScore = 75 // prefix match
  }

  return {
    type: 'issue',
    entityId: issue.id,
    title: issue.title,
    displayText: issue.title,
    secondaryText: issue.id,
    insertText: `[[${issue.id}]]`,
    matchScore,
  }
}

/**
 * Rank and merge results
 */
function rankResults(results: ContextSearchResult[], recentMentions: RecentMentions): ContextSearchResult[] {
  const RECENT_BOOST = 10

  // Apply recent boost
  const boosted = results.map((result) => {
    const entityId = result.entityId || result.filePath
    const wasRecent = entityId && wasRecentlyUsed(entityId, recentMentions)
    return {
      ...result,
      matchScore: (result.matchScore || 50) + (wasRecent ? RECENT_BOOST : 0),
    }
  })

  // Sort by match score (descending), then by length (shorter first), then alphabetically
  return boosted.sort((a, b) => {
    // Primary: match score
    if ((b.matchScore || 0) !== (a.matchScore || 0)) {
      return (b.matchScore || 0) - (a.matchScore || 0)
    }

    // Secondary: shorter display text
    if (a.displayText.length !== b.displayText.length) {
      return a.displayText.length - b.displayText.length
    }

    // Tertiary: alphabetical
    return a.displayText.localeCompare(b.displayText)
  })
}

/**
 * Hook for unified context search across files, specs, and issues
 */
export function useContextSearch(params: UseContextSearchParams): UseContextSearchResult {
  const { query, enabled } = params
  const [results, setResults] = useState<ContextSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim() || !enabled) {
        setResults([])
        setIsLoading(false)
        return
      }

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController()

      // Only show loading state if we don't have results yet
      // This prevents flickering when typing - keeps previous results visible
      setIsLoading(results.length === 0)
      setError(null)

      try {
        // Search all sources in parallel
        const [fileResults, allSpecs, allIssues] = await Promise.all([
          filesApi.search(searchQuery, { limit: 20 }).catch((err) => {
            if (err.name !== 'AbortError' && err.name !== 'CanceledError') {
              console.warn('File search failed:', err)
            }
            return [] as FileSearchResult[]
          }),
          specsApi.getAll().catch((err) => {
            if (err.name !== 'AbortError' && err.name !== 'CanceledError') {
              console.warn('Specs search failed:', err)
            }
            return [] as Spec[]
          }),
          issuesApi.getAll().catch((err) => {
            if (err.name !== 'AbortError' && err.name !== 'CanceledError') {
              console.warn('Issues search failed:', err)
            }
            return [] as Issue[]
          }),
        ])

        // Filter specs and issues client-side
        const lowerQuery = searchQuery.toLowerCase()
        const filteredSpecs = allSpecs.filter(
          (spec) =>
            spec.title.toLowerCase().includes(lowerQuery) || spec.id.toLowerCase().includes(lowerQuery)
        )
        const filteredIssues = allIssues.filter(
          (issue) =>
            issue.title.toLowerCase().includes(lowerQuery) || issue.id.toLowerCase().includes(lowerQuery)
        )

        // Convert to context results
        const fileContextResults = fileResults.map(fileToContextResult)
        const specContextResults = filteredSpecs.map((spec) => specToContextResult(spec, searchQuery))
        const issueContextResults = filteredIssues.map((issue) => issueToContextResult(issue, searchQuery))

        // Merge all results
        const allResults = [...fileContextResults, ...specContextResults, ...issueContextResults]

        // Get recent mentions for ranking boost
        const recentMentions = getRecentMentions()

        // Rank and limit results
        const ranked = rankResults(allResults, recentMentions)

        // Limit: 5 per type, 15 total
        const limited: ContextSearchResult[] = []
        const counts = { file: 0, spec: 0, issue: 0 }
        const limits = { file: 5, spec: 5, issue: 5 }

        for (const result of ranked) {
          if (limited.length >= 15) break
          if (counts[result.type] < limits[result.type]) {
            limited.push(result)
            counts[result.type]++
          }
        }

        setResults(limited)
        setIsLoading(false)
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && (err as Error).name !== 'CanceledError') {
          console.error('Context search failed:', err)
          setError(err as Error)
        }
        setIsLoading(false)
      }
    },
    [enabled]
  )

  const refetch = useCallback(() => {
    performSearch(query)
  }, [query, performSearch])

  // Debounced search effect
  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // If query is empty or disabled, clear results immediately
    if (!query.trim() || !enabled) {
      setResults([])
      setIsLoading(false)
      return
    }

    // Don't set loading immediately - keep previous results visible while typing
    // The loading state will be set by performSearch when it actually executes

    // Debounce the actual search
    debounceTimerRef.current = setTimeout(() => {
      performSearch(query)
    }, DEBOUNCE_MS)

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [query, enabled, performSearch])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return {
    results,
    isLoading,
    error,
    refetch,
  }
}
