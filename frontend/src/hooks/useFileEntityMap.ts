/**
 * useFileEntityMap - Hook for mapping files to their associated entities
 *
 * Builds a reverse index from files to the executions, issues, and specs
 * that reference them. Used for file highlighting on the code map.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveExecutions, type ActiveExecution } from '@/hooks/useActiveExecutions'
import { issuesApi, relationshipsApi } from '@/lib/api'
import { useProject } from '@/hooks/useProject'
import type { FileChangeStat } from '@/types/execution'

/**
 * File change statistics for a single execution
 */
export interface FileChangeInfo {
  additions: number
  deletions: number
  status: 'A' | 'M' | 'D' | 'R'
}

/**
 * Entity associations for a single file
 */
export interface FileEntityInfo {
  /** Execution IDs that have modified this file */
  executions: string[]
  /** Issue IDs linked via executions */
  issues: string[]
  /** Spec IDs linked via issue "implements" relationships */
  specs: string[]
  /** Per-execution change statistics */
  changes: Record<string, FileChangeInfo>
}

/**
 * Map from file paths to their entity associations
 */
export interface FileEntityMap {
  [filePath: string]: FileEntityInfo
}

/**
 * Result returned by useFileEntityMap hook
 */
export interface UseFileEntityMapResult {
  /** The file-to-entity mapping */
  fileEntityMap: FileEntityMap
  /** Whether the map is still loading */
  isLoading: boolean
  /** Any error that occurred */
  error: Error | null
  /** Total count of files in the map */
  fileCount: number
  /** Total count of unique executions */
  executionCount: number
}

/**
 * Hook for building a file-to-entity map from active executions.
 *
 * Maps files to their associated:
 * - Executions (via execution.changedFiles)
 * - Issues (via execution.issueId)
 * - Specs (via issue "implements" relationships)
 *
 * @example
 * ```tsx
 * function CodeMapWithHighlights() {
 *   const { fileEntityMap, isLoading } = useFileEntityMap()
 *
 *   // Use fileEntityMap to create highlights for files with active changes
 *   const filesToHighlight = Object.entries(fileEntityMap)
 *     .filter(([_, info]) => info.executions.length > 0)
 *     .map(([path, info]) => ({
 *       path,
 *       colors: info.executions.map(id => getAgentColor(id))
 *     }))
 * }
 * ```
 */
export function useFileEntityMap(): UseFileEntityMapResult {
  const { currentProjectId } = useProject()
  const { executions, isLoading: executionsLoading, error: executionsError } = useActiveExecutions()

  // Get unique issue IDs from executions
  const issueIds = useMemo(() => {
    const ids = new Set<string>()
    executions.forEach((exec) => {
      if (exec.issueId) {
        ids.add(exec.issueId)
      }
    })
    return Array.from(ids)
  }, [executions])

  // Fetch issues and their relationships to resolve spec associations
  const relationshipsQuery = useQuery({
    queryKey: ['fileEntityMap', 'relationships', currentProjectId, issueIds],
    queryFn: async () => {
      if (issueIds.length === 0) {
        return { issueToSpecs: {} as Record<string, string[]> }
      }

      // Fetch relationships for each issue to find "implements" links to specs
      const issueToSpecs: Record<string, string[]> = {}

      await Promise.all(
        issueIds.map(async (issueId) => {
          try {
            const relationships = await relationshipsApi.getForEntity(issueId, 'issue')
            // Handle both array and object response formats
            const outgoing = Array.isArray(relationships)
              ? relationships
              : relationships.outgoing || []

            // Find specs this issue implements
            const specIds = outgoing
              .filter((rel) => rel.relationship_type === 'implements' && rel.to_type === 'spec')
              .map((rel) => rel.to_id)

            issueToSpecs[issueId] = specIds
          } catch {
            // If relationship fetch fails, just skip this issue
            issueToSpecs[issueId] = []
          }
        })
      )

      return { issueToSpecs }
    },
    enabled: !!currentProjectId && issueIds.length > 0,
    staleTime: 30000, // 30 seconds
  })

  // Build the file entity map
  const fileEntityMap = useMemo(() => {
    const map: FileEntityMap = {}
    const issueToSpecs = relationshipsQuery.data?.issueToSpecs ?? {}

    executions.forEach((exec) => {
      exec.changedFiles.forEach((filePath) => {
        if (!map[filePath]) {
          map[filePath] = {
            executions: [],
            issues: [],
            specs: [],
            changes: {},
          }
        }

        const entry = map[filePath]

        // Add execution
        if (!entry.executions.includes(exec.id)) {
          entry.executions.push(exec.id)
        }

        // Add issue
        if (exec.issueId && !entry.issues.includes(exec.issueId)) {
          entry.issues.push(exec.issueId)

          // Add specs that this issue implements
          const specs = issueToSpecs[exec.issueId] ?? []
          specs.forEach((specId) => {
            if (!entry.specs.includes(specId)) {
              entry.specs.push(specId)
            }
          })
        }

        // Add change info (we don't have detailed stats from ActiveExecution,
        // so use placeholder - could be enhanced later with additional API calls)
        if (!entry.changes[exec.id]) {
          entry.changes[exec.id] = {
            additions: 0,
            deletions: 0,
            status: 'M', // Default to Modified
          }
        }
      })
    })

    return map
  }, [executions, relationshipsQuery.data])

  // Calculate counts
  const fileCount = Object.keys(fileEntityMap).length
  const executionCount = executions.length

  const isLoading = executionsLoading || relationshipsQuery.isLoading
  const error = executionsError || (relationshipsQuery.error as Error | null)

  return {
    fileEntityMap,
    isLoading,
    error,
    fileCount,
    executionCount,
  }
}

/**
 * Extended version that fetches detailed change statistics per file.
 * This makes additional API calls to get additions/deletions/status.
 */
export function useFileEntityMapWithStats(): UseFileEntityMapResult & {
  /** Whether detailed stats are loading */
  statsLoading: boolean
} {
  const { currentProjectId } = useProject()
  const baseResult = useFileEntityMap()
  const { executions } = useActiveExecutions()

  // Fetch detailed changes for each execution
  const statsQuery = useQuery({
    queryKey: ['fileEntityMap', 'stats', currentProjectId, executions.map((e) => e.id)],
    queryFn: async () => {
      const { executionsApi } = await import('@/lib/api')
      const statsMap: Record<string, Record<string, FileChangeInfo>> = {}

      await Promise.all(
        executions.map(async (exec) => {
          try {
            const changes = await executionsApi.getChanges(exec.id)
            const snapshot = changes.current ?? changes.captured

            if (snapshot?.files) {
              snapshot.files.forEach((file: FileChangeStat) => {
                if (!statsMap[file.path]) {
                  statsMap[file.path] = {}
                }
                statsMap[file.path][exec.id] = {
                  additions: file.additions,
                  deletions: file.deletions,
                  status: file.status,
                }
              })
            }
          } catch {
            // Skip if changes fetch fails
          }
        })
      )

      return statsMap
    },
    enabled: !!currentProjectId && executions.length > 0,
    staleTime: 10000, // 10 seconds - changes update frequently
  })

  // Merge stats into file entity map
  const fileEntityMapWithStats = useMemo(() => {
    if (!statsQuery.data) {
      return baseResult.fileEntityMap
    }

    const enhancedMap: FileEntityMap = {}
    const statsMap = statsQuery.data

    // Copy base map and enhance with stats
    Object.entries(baseResult.fileEntityMap).forEach(([filePath, info]) => {
      enhancedMap[filePath] = {
        ...info,
        changes: statsMap[filePath] ?? info.changes,
      }
    })

    // Add any files from stats that weren't in base map
    Object.entries(statsMap).forEach(([filePath, execChanges]) => {
      if (!enhancedMap[filePath]) {
        enhancedMap[filePath] = {
          executions: Object.keys(execChanges),
          issues: [],
          specs: [],
          changes: execChanges,
        }
      }
    })

    return enhancedMap
  }, [baseResult.fileEntityMap, statsQuery.data])

  return {
    ...baseResult,
    fileEntityMap: fileEntityMapWithStats,
    statsLoading: statsQuery.isLoading,
  }
}
