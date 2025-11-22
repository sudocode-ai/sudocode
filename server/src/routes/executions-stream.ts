/**
 * Execution Stream Routes
 *
 * SSE endpoint for streaming execution events to clients.
 * Integrates with TransportManager to broadcast AG-UI events.
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 *
 * @module routes/executions-stream
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";

/**
 * Create execution stream routes
 *
 * Note: TransportManager is accessed via req.project which is injected
 * by the requireProject() middleware
 *
 * @returns Express router with SSE endpoints
 *
 * @example
 * ```typescript
 * const router = createExecutionStreamRoutes();
 * app.use('/api/executions', requireProject(projectManager), router);
 * ```
 */
export function createExecutionStreamRoutes(): Router {
  const router = Router();

  /**
   * SSE endpoint for execution event stream
   *
   * GET /api/executions/:executionId/stream
   *
   * Establishes SSE connection and streams execution events to client.
   * Events are filtered to only include events for the specified execution.
   *
   * @param executionId - Execution ID to stream events for
   */
  router.get("/:executionId/stream", (req: Request, res: Response) => {
    const { executionId } = req.params;

    // TODO: Add authentication/authorization check
    // Verify user has permission to access this execution

    // Generate unique client ID
    const clientId = randomUUID();

    // Get buffered events for replay
    const bufferedEvents = req.project!.transportManager!.getBufferedEvents(executionId);
    const replayEvents = bufferedEvents.map((buffered) => ({
      event: buffered.event.type,
      data: buffered.event,
    }));

    // Establish SSE connection through transport manager
    // This will set appropriate headers, send connection acknowledgment, and replay buffered events
    req.project!.transportManager!
      .getSseTransport()
      .handleConnection(clientId, res, executionId, replayEvents);
  });

  return router;
}
