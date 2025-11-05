/**
 * useExecutionLogs React Hook
 *
 * Fetches historical execution logs from the backend and transforms them to AG-UI events.
 * Used for displaying execution history and replaying past runs.
 *
 * @module hooks/useExecutionLogs
 */

import { useState, useEffect } from 'react';
import { parseExecutionLogs } from '../../../server/src/execution/output/claude-to-ag-ui.js';
import type { AgUiEvent } from '../../../server/src/execution/output/claude-to-ag-ui.js';

/**
 * Metadata about execution logs
 */
export interface ExecutionLogMetadata {
  lineCount: number;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * API response shape from GET /api/executions/:id/logs
 */
interface ExecutionLogsResponse {
  success: boolean;
  data: {
    executionId: string;
    logs: string[];
    metadata: ExecutionLogMetadata;
  };
  message?: string;
}

/**
 * Hook return value
 */
export interface UseExecutionLogsResult {
  /** Parsed AG-UI events from execution logs */
  events: AgUiEvent[];
  /** Loading state */
  loading: boolean;
  /** Error if fetch or parse failed */
  error: Error | null;
  /** Metadata about the logs */
  metadata: ExecutionLogMetadata | null;
}

/**
 * Fetch and parse historical execution logs
 *
 * Fetches raw execution logs from the backend API and transforms them
 * to AG-UI events for display in the UI.
 *
 * @param executionId - ID of execution to fetch logs for
 * @returns Hook result with events, loading state, error, and metadata
 *
 * @example
 * ```tsx
 * function ExecutionHistory({ executionId }: { executionId: string }) {
 *   const { events, loading, error, metadata } = useExecutionLogs(executionId);
 *
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorDisplay error={error} />;
 *
 *   return (
 *     <div>
 *       <div>Lines: {metadata?.lineCount}, Size: {metadata?.byteSize} bytes</div>
 *       <AgentTrajectory events={events} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecutionLogs(executionId: string): UseExecutionLogsResult {
  const [events, setEvents] = useState<AgUiEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [metadata, setMetadata] = useState<ExecutionLogMetadata | null>(null);

  useEffect(() => {
    // Reset state when execution ID changes
    setLoading(true);
    setError(null);
    setEvents([]);
    setMetadata(null);

    // Create abort controller for cleanup
    const abortController = new AbortController();

    async function fetchAndParseLogs() {
      try {
        // Fetch raw logs from API
        const response = await fetch(`/api/executions/${executionId}/logs`, {
          signal: abortController.signal,
        });

        // Handle HTTP errors
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Execution not found: ${executionId}`);
          }
          throw new Error(
            `Failed to fetch execution logs: ${response.status} ${response.statusText}`
          );
        }

        // Parse JSON response
        const data: ExecutionLogsResponse = await response.json();

        if (!data.success) {
          throw new Error(data.message || 'Failed to fetch execution logs');
        }

        // Transform raw logs to AG-UI events
        const parsedEvents = await parseExecutionLogs(data.data.logs);

        // Update state
        setEvents(parsedEvents);
        setMetadata(data.data.metadata);
      } catch (err) {
        // Ignore abort errors (cleanup)
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        // Set error state
        const error =
          err instanceof Error
            ? err
            : new Error('Unknown error fetching execution logs');

        setError(error);
        console.error('[useExecutionLogs] Error:', error);
      } finally {
        // Only set loading to false if not aborted
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchAndParseLogs();

    // Cleanup function - abort fetch on unmount or ID change
    return () => {
      abortController.abort();
    };
  }, [executionId]);

  return {
    events,
    loading,
    error,
    metadata,
  };
}
