/**
 * useExecutionChanges React Hook
 *
 * Fetches code changes (file list + diff statistics) from the backend for an execution.
 * Used for displaying what files were modified during an execution.
 *
 * @module hooks/useExecutionChanges
 */

import { useState, useEffect, useCallback } from 'react';
import { executionsApi } from '../lib/api';
import { isCancel } from 'axios';
import type { ExecutionChangesResult } from '@/types/execution';

/**
 * Hook return value
 */
export interface UseExecutionChangesResult {
  /** Execution changes data (if available) */
  data: ExecutionChangesResult | null;
  /** Loading state */
  loading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Manually refresh changes */
  refresh: () => void;
}

/**
 * Fetch code changes for an execution
 *
 * Fetches file changes and diff statistics from the backend API.
 * Handles both committed changes (commit-to-commit) and uncommitted changes (working tree).
 *
 * @param executionId - ID of execution to fetch changes for (null to skip fetching)
 * @returns Hook result with changes data, loading state, and error
 *
 * @example
 * ```tsx
 * function ExecutionChanges({ executionId }: { executionId: string }) {
 *   const { data, loading, error } = useExecutionChanges(executionId);
 *
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorDisplay error={error} />;
 *   if (!data?.available) return <div>Changes unavailable</div>;
 *
 *   return (
 *     <div>
 *       <div>{data.changes.summary.totalFiles} files changed</div>
 *       <FileList files={data.changes.files} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecutionChanges(
  executionId: string | null
): UseExecutionChangesResult {
  const [data, setData] = useState<ExecutionChangesResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Manual refresh function (stable reference)
  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    // Skip fetching if no execution ID
    if (!executionId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Capture executionId in a const to ensure type narrowing
    const currentExecutionId = executionId;

    // Reset state when execution ID changes
    setLoading(true);
    setError(null);

    // Create abort controller for cleanup
    const abortController = new AbortController();

    async function fetchChanges() {
      try {
        // Fetch execution changes from API
        const result = await executionsApi.getChanges(currentExecutionId);

        // Only update state if not aborted
        if (!abortController.signal.aborted) {
          setData(result);
        }
      } catch (err) {
        // Ignore abort/cancel errors (cleanup)
        if (isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
          console.debug('[useExecutionChanges] Request canceled for execution:', currentExecutionId);
          return;
        }

        // Set error state
        let error: Error;
        if (err instanceof Error) {
          error = err;
        } else {
          error = new Error('Unknown error fetching execution changes');
        }

        // Only update state if not aborted
        if (!abortController.signal.aborted) {
          setError(error);
        }
        console.error('[useExecutionChanges] Error:', error);
      } finally {
        // Only set loading to false if not aborted
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchChanges();

    // Cleanup function - abort fetch on unmount or ID change
    return () => {
      abortController.abort();
    };
  }, [executionId, refreshTrigger]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
