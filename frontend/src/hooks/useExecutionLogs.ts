/**
 * useExecutionLogs React Hook
 *
 * Fetches historical AG-UI events from the backend for displaying execution history.
 * Used for replaying completed executions.
 *
 * @module hooks/useExecutionLogs
 */

import { useState, useEffect } from 'react';
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
  events: any[]; // AG-UI events
  metadata: ExecutionLogMetadata;
}

/**
 * Hook return value
 */
export interface UseExecutionLogsResult {
  /** AG-UI events from execution logs */
  events: any[];
  /** Loading state */
  loading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Metadata about the logs */
  metadata: ExecutionLogMetadata | null;
}

/**
 * Fetch historical AG-UI events for execution replay
 *
 * Fetches AG-UI events from the backend API for displaying completed executions.
 * Events are already in AG-UI format and ready for display.
 *
 * @param executionId - ID of execution to fetch events for
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
 *       <div>Events: {events.length}, Size: {metadata?.byteSize} bytes</div>
 *       <AgentTrajectory events={events} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecutionLogs(executionId: string): UseExecutionLogsResult {
  const [events, setEvents] = useState<any[]>([]);
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

    async function fetchEvents() {
      try {
        // Fetch AG-UI events from API using axios client (automatically includes X-Project-ID header)
        // Note: axios baseURL is already '/api', so we don't include it here
        // The response interceptor unwraps the ApiResponse, so we get ExecutionLogsData directly
        const data = await api.get<ExecutionLogsData, ExecutionLogsData>(
          `/executions/${executionId}/logs`,
          {
            signal: abortController.signal,
          }
        );

        // Events are already in AG-UI format, no transformation needed
        // Ensure events is always an array (handle malformed responses)
        setEvents(data.events || []);
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

    fetchEvents();

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
