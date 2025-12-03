/**
 * Workflows API routes (mapped to /api/workflows)
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStatus,
  WorkflowStep,
} from "@sudocode-ai/types";
import {
  WorkflowNotFoundError,
  WorkflowStepNotFoundError,
  WorkflowStateError,
  WorkflowCycleError,
} from "../workflow/workflow-engine.js";
import {
  broadcastWorkflowUpdate,
  broadcastWorkflowStepUpdate,
} from "../services/websocket.js";

/**
 * Helper to map workflow errors to HTTP status codes
 */
function handleWorkflowError(error: unknown, res: Response): void {
  if (error instanceof WorkflowNotFoundError) {
    res.status(404).json({
      success: false,
      data: null,
      message: error.message,
    });
    return;
  }

  if (error instanceof WorkflowStepNotFoundError) {
    res.status(404).json({
      success: false,
      data: null,
      message: error.message,
    });
    return;
  }

  if (error instanceof WorkflowStateError) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message,
    });
    return;
  }

  if (error instanceof WorkflowCycleError) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message,
      cycles: error.cycles,
    });
    return;
  }

  // Generic error
  console.error("Workflow error:", error);
  res.status(500).json({
    success: false,
    data: null,
    error_data: error instanceof Error ? error.message : String(error),
    message: "Internal server error",
  });
}

export function createWorkflowsRouter(): Router {
  const router = Router();

  /**
   * GET /api/workflows - List all workflows
   *
   * Query parameters:
   * - limit: number (default: 50)
   * - offset: number (default: 0)
   * - status: WorkflowStatus | WorkflowStatus[] (filter by status)
   * - sortBy: 'created_at' | 'updated_at' (default: 'created_at')
   * - order: 'asc' | 'desc' (default: 'desc')
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      // Parse query parameters
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : 0;
      const sortBy = (req.query.sortBy as string) || "created_at";
      const order = (req.query.order as string) || "desc";

      // Parse status filter (can be single value or array)
      let statusFilter: WorkflowStatus[] | undefined;
      if (req.query.status) {
        const statusParam = req.query.status;
        if (Array.isArray(statusParam)) {
          statusFilter = statusParam as WorkflowStatus[];
        } else {
          statusFilter = [statusParam as WorkflowStatus];
        }
      }

      // Query workflows directly from database
      const db = req.project!.db;
      let query = `
        SELECT * FROM workflows
        WHERE 1=1
      `;
      const params: any[] = [];

      if (statusFilter && statusFilter.length > 0) {
        const placeholders = statusFilter.map(() => "?").join(", ");
        query += ` AND status IN (${placeholders})`;
        params.push(...statusFilter);
      }

      // Validate sortBy to prevent SQL injection
      const validSortColumns = ["created_at", "updated_at"];
      const sortColumn = validSortColumns.includes(sortBy)
        ? sortBy
        : "created_at";
      const sortOrder = order === "asc" ? "ASC" : "DESC";
      query += ` ORDER BY ${sortColumn} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params) as any[];

      // Parse JSON fields
      const workflows: Workflow[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        source: JSON.parse(row.source),
        status: row.status,
        steps: JSON.parse(row.steps || "[]"),
        worktreePath: row.worktree_path,
        branchName: row.branch_name,
        baseBranch: row.base_branch,
        currentStepIndex: row.current_step_index,
        orchestratorExecutionId: row.orchestrator_execution_id,
        orchestratorSessionId: row.orchestrator_session_id,
        config: JSON.parse(row.config),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      }));

      res.json({
        success: true,
        data: workflows,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows - Create a new workflow
   *
   * Request body:
   * - source: WorkflowSource (required)
   * - config: Partial<WorkflowConfig> (optional)
   * - title: string (optional override)
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { source, config } = req.body as {
        source?: WorkflowSource;
        config?: Partial<WorkflowConfig>;
      };

      // Validate source
      if (!source || !source.type) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source is required and must have a type",
        });
        return;
      }

      // Validate source type
      const validSourceTypes = ["spec", "issues", "root_issue", "goal"];
      if (!validSourceTypes.includes(source.type)) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Invalid source type: ${source.type}. Must be one of: ${validSourceTypes.join(", ")}`,
        });
        return;
      }

      // Validate source-specific fields
      if (source.type === "spec" && !("specId" in source)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source.specId is required for spec source type",
        });
        return;
      }

      if (source.type === "issues" && !("issueIds" in source)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source.issueIds is required for issues source type",
        });
        return;
      }

      if (source.type === "root_issue" && !("issueId" in source)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source.issueId is required for root_issue source type",
        });
        return;
      }

      if (source.type === "goal" && !("goal" in source)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source.goal is required for goal source type",
        });
        return;
      }

      // Create workflow
      const workflow = await engine.createWorkflow(source, config);

      // Broadcast creation
      broadcastWorkflowUpdate(req.project!.id, workflow.id, "created", workflow);

      res.status(201).json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * GET /api/workflows/:id - Get a specific workflow
   */
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;
      const workflow = await engine.getWorkflow(id);

      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * DELETE /api/workflows/:id - Delete a workflow
   */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;

      // Check if workflow exists
      const workflow = await engine.getWorkflow(id);
      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Cancel if running before deleting
      if (workflow.status === "running" || workflow.status === "paused") {
        await engine.cancelWorkflow(id);
      }

      // Delete from database
      const db = req.project!.db;
      db.prepare("DELETE FROM workflow_events WHERE workflow_id = ?").run(id);
      db.prepare("DELETE FROM workflows WHERE id = ?").run(id);

      // Broadcast deletion
      broadcastWorkflowUpdate(req.project!.id, id, "deleted", { id });

      res.json({
        success: true,
        data: { id, deleted: true },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/start - Start a pending workflow
   */
  router.post("/:id/start", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;
      await engine.startWorkflow(id);

      const workflow = await engine.getWorkflow(id);
      broadcastWorkflowUpdate(req.project!.id, id, "started", workflow);

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/pause - Pause a running workflow
   */
  router.post("/:id/pause", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;
      await engine.pauseWorkflow(id);

      const workflow = await engine.getWorkflow(id);
      broadcastWorkflowUpdate(req.project!.id, id, "paused", workflow);

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/resume - Resume a paused workflow
   */
  router.post("/:id/resume", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;
      await engine.resumeWorkflow(id);

      const workflow = await engine.getWorkflow(id);
      broadcastWorkflowUpdate(req.project!.id, id, "resumed", workflow);

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/cancel - Cancel a workflow
   */
  router.post("/:id/cancel", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;
      await engine.cancelWorkflow(id);

      const workflow = await engine.getWorkflow(id);
      broadcastWorkflowUpdate(req.project!.id, id, "cancelled", workflow);

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/steps/:stepId/retry - Retry a failed step
   */
  router.post("/:id/steps/:stepId/retry", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id, stepId } = req.params;
      await engine.retryStep(id, stepId);

      const workflow = await engine.getWorkflow(id);
      const step = workflow?.steps.find((s: WorkflowStep) => s.id === stepId);

      if (step) {
        broadcastWorkflowStepUpdate(req.project!.id, id, "started", {
          workflow,
          step,
        });
      }

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/steps/:stepId/skip - Skip a step
   *
   * Request body:
   * - reason: string (optional)
   */
  router.post("/:id/steps/:stepId/skip", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id, stepId } = req.params;
      const { reason } = req.body as { reason?: string };

      await engine.skipStep(id, stepId, reason);

      const workflow = await engine.getWorkflow(id);
      const step = workflow?.steps.find((s: WorkflowStep) => s.id === stepId);

      if (step) {
        broadcastWorkflowStepUpdate(req.project!.id, id, "skipped", {
          workflow,
          step,
          reason,
        });
      }

      res.json({
        success: true,
        data: workflow,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * GET /api/workflows/:id/events - Get workflow event history
   *
   * Query parameters:
   * - limit: number (default: 100)
   * - offset: number (default: 0)
   */
  router.get("/:id/events", async (req: Request, res: Response) => {
    try {
      const engine = req.project!.workflowEngine;
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const { id } = req.params;

      // Check if workflow exists
      const workflow = await engine.getWorkflow(id);
      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Parse query parameters
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 100;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : 0;

      // Query events from database
      const db = req.project!.db;
      const rows = db
        .prepare(
          `
          SELECT * FROM workflow_events
          WHERE workflow_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(id, limit, offset) as any[];

      // Parse JSON fields
      const events = rows.map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        type: row.type,
        stepId: row.step_id,
        executionId: row.execution_id,
        payload: JSON.parse(row.payload || "{}"),
        createdAt: row.created_at,
        processedAt: row.processed_at,
      }));

      res.json({
        success: true,
        data: events,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * GET /api/workflows/:id/escalation - Get pending escalation for workflow
   */
  router.get("/:id/escalation", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = req.project!.db;

      // Check if workflow exists
      const workflowExists = db
        .prepare("SELECT 1 FROM workflows WHERE id = ?")
        .get(id);

      if (!workflowExists) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Query for pending escalation (same logic as respond endpoint)
      const pendingEscalation = db
        .prepare(
          `
          SELECT payload FROM workflow_events
          WHERE workflow_id = ?
            AND type = 'escalation_requested'
            AND json_extract(payload, '$.escalation_id') NOT IN (
              SELECT json_extract(payload, '$.escalation_id')
              FROM workflow_events
              WHERE workflow_id = ?
                AND type = 'escalation_resolved'
            )
          ORDER BY created_at DESC
          LIMIT 1
        `
        )
        .get(id, id) as { payload: string } | undefined;

      if (!pendingEscalation) {
        res.json({
          success: true,
          data: { hasPendingEscalation: false },
        });
        return;
      }

      const payload = JSON.parse(pendingEscalation.payload) as {
        escalation_id: string;
        message: string;
        options?: string[];
        context?: Record<string, unknown>;
      };

      res.json({
        success: true,
        data: {
          hasPendingEscalation: true,
          escalation: {
            requestId: payload.escalation_id,
            message: payload.message,
            options: payload.options,
            context: payload.context,
          },
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/escalation/respond - Respond to a pending escalation
   *
   * Request body:
   * - action: 'approve' | 'reject' | 'custom' (required)
   * - message: string (optional)
   */
  router.post("/:id/escalation/respond", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action, message } = req.body as {
        action?: string;
        message?: string;
      };

      // Validate action
      const validActions = ["approve", "reject", "custom"];
      if (!action || !validActions.includes(action)) {
        res.status(400).json({
          success: false,
          data: null,
          message: `action is required and must be one of: ${validActions.join(", ")}`,
        });
        return;
      }

      // Get workflow from database
      const db = req.project!.db;
      const workflowRow = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(id) as any;

      if (!workflowRow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Check for pending escalation by querying events
      const pendingEscalation = db.prepare(`
        SELECT payload FROM workflow_events
        WHERE workflow_id = ?
          AND type = 'escalation_requested'
          AND json_extract(payload, '$.escalation_id') NOT IN (
            SELECT json_extract(payload, '$.escalation_id')
            FROM workflow_events
            WHERE workflow_id = ?
              AND type = 'escalation_resolved'
          )
        ORDER BY created_at DESC
        LIMIT 1
      `).get(id, id) as { payload: string } | undefined;

      if (!pendingEscalation) {
        res.status(400).json({
          success: false,
          data: null,
          message: `No pending escalation for workflow: ${id}`,
        });
        return;
      }

      // Parse escalation data from event
      const escalationPayload = JSON.parse(pendingEscalation.payload) as {
        escalation_id: string;
        message: string;
        options?: string[];
        context?: Record<string, unknown>;
      };

      const now = new Date().toISOString();

      // Record escalation_resolved event
      const eventId = randomUUID();
      db.prepare(`
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        eventId,
        id,
        "escalation_resolved",
        JSON.stringify({
          escalation_id: escalationPayload.escalation_id,
          action,
          message,
          responded_at: now,
        }),
        now
      );

      // Emit escalation resolved event for WebSocket broadcast
      const engine = req.project!.workflowEngine;
      if (engine) {
        engine.emitEscalationResolved(
          id,
          escalationPayload.escalation_id,
          action as "approve" | "reject" | "custom",
          message
        );
      }

      // Trigger orchestrator wakeup if available
      if (engine && "triggerEscalationWakeup" in engine) {
        try {
          await (engine as { triggerEscalationWakeup: (id: string) => Promise<void> }).triggerEscalationWakeup(id);
        } catch (wakeupError) {
          console.error("Failed to trigger escalation wakeup:", wakeupError);
          // Don't fail the response - escalation is still resolved
        }
      }

      // Parse and return workflow
      const workflow: Workflow = {
        id: workflowRow.id,
        title: workflowRow.title,
        source: JSON.parse(workflowRow.source),
        status: workflowRow.status,
        steps: JSON.parse(workflowRow.steps || "[]"),
        worktreePath: workflowRow.worktree_path,
        branchName: workflowRow.branch_name,
        baseBranch: workflowRow.base_branch,
        currentStepIndex: workflowRow.current_step_index,
        orchestratorExecutionId: workflowRow.orchestrator_execution_id,
        orchestratorSessionId: workflowRow.orchestrator_session_id,
        config: JSON.parse(workflowRow.config),
        createdAt: workflowRow.created_at,
        updatedAt: workflowRow.updated_at,
        startedAt: workflowRow.started_at,
        completedAt: workflowRow.completed_at,
      };

      // Broadcast update
      broadcastWorkflowUpdate(req.project!.id, id, "updated", workflow);

      res.json({
        success: true,
        data: {
          workflow,
          escalation: {
            id: escalationPayload.escalation_id,
            action,
            message,
            resolvedAt: now,
          },
        },
        message: `Escalation resolved with action: ${action}`,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/escalation/notify - Internal endpoint for MCP tool to notify of new escalation
   *
   * This endpoint is called by the workflow MCP server when an escalation is created.
   * It broadcasts the escalation_requested event via WebSocket.
   *
   * Request body:
   * - escalation_id: string (required)
   * - message: string (required)
   * - options?: string[]
   * - context?: Record<string, unknown>
   */
  router.post("/:id/escalation/notify", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { escalation_id, message, options, context } = req.body as {
        escalation_id?: string;
        message?: string;
        options?: string[];
        context?: Record<string, unknown>;
      };

      if (!escalation_id || !message) {
        res.status(400).json({
          success: false,
          data: null,
          message: "escalation_id and message are required",
        });
        return;
      }

      // Verify workflow exists
      const db = req.project!.db;
      const workflowExists = db
        .prepare("SELECT 1 FROM workflows WHERE id = ?")
        .get(id);

      if (!workflowExists) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Emit escalation requested event for WebSocket broadcast
      const engine = req.project!.workflowEngine;
      if (engine) {
        engine.emitEscalationRequested(id, escalation_id, message, options, context);
      }

      res.json({
        success: true,
        data: { notified: true },
        message: "Escalation notification broadcast",
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  return router;
}
