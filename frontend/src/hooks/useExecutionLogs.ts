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
import api from '../lib/api';
import { isCancel } from 'axios';

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
 * API response shape from GET /api/executions/:id/logs (after axios interceptor unwrapping)
 * The outer ApiResponse wrapper is removed by the interceptor, so we get this directly
 */
interface ExecutionLogsData {
  executionId: string;
  logs: string[];
  metadata: ExecutionLogMetadata;
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
        // Fetch raw logs from API using axios client (automatically includes X-Project-ID header)
        // Note: axios baseURL is already '/api', so we don't include it here
        // The response interceptor unwraps the ApiResponse, so we get ExecutionLogsData directly
        const data = await api.get<ExecutionLogsData, ExecutionLogsData>(
          `/executions/${executionId}/logs`,
          {
            signal: abortController.signal,
          }
        );

        // Transform raw logs to AG-UI events
        const parsedEvents = await parseExecutionLogs(data.logs);

        // Update state
        setEvents(parsedEvents);
        setMetadata(data.metadata);
      } catch (err) {
        // Ignore abort/cancel errors (cleanup)
        // Check for axios cancellation or browser AbortError
        if (isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
          console.debug('[useExecutionLogs] Request canceled for execution:', executionId);
          return;
        }

        // Set error state - axios wraps errors differently
        let error: Error;
        if (err instanceof Error) {
          error = err;
        } else {
          error = new Error('Unknown error fetching execution logs');
        }

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
