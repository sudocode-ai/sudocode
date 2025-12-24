/**
 * Workflows API routes (mapped to /api/workflows)
 *
 * Note: All routes require X-Project-ID header via requireProject() middleware
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowStatus,
  WorkflowStep,
  WorkflowEngineType,
} from "@sudocode-ai/types/workflows";
import type { IWorkflowEngine } from "../workflow/workflow-engine.js";
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
 * Get the appropriate workflow engine based on engine type
 */
function getEngine(
  req: Request,
  engineType: WorkflowEngineType = "sequential"
): IWorkflowEngine | null {
  return req.project?.getWorkflowEngine(engineType) ?? null;
}

/**
 * Get the workflow engine for an existing workflow by looking up its config
 */
function getEngineForWorkflow(
  req: Request,
  workflowId: string
): IWorkflowEngine | null {
  const db = req.project?.db;
  if (!db) return null;

  const row = db
    .prepare("SELECT config FROM workflows WHERE id = ?")
    .get(workflowId) as { config: string } | undefined;
  if (!row) return null;

  try {
    const config = JSON.parse(row.config) as WorkflowConfig;
    const engineType = config.engineType ?? "sequential";
    console.log(
      `[workflows] getEngineForWorkflow: workflow=${workflowId}, engineType=${engineType}`
    );
    return getEngine(req, engineType);
  } catch {
    console.log(
      `[workflows] getEngineForWorkflow: workflow=${workflowId}, defaulting to sequential`
    );
    return getEngine(req, "sequential");
  }
}

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
      // Use sequential engine for listing (just for the engine availability check)
      const engine = getEngine(req, "sequential");
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
   * - config: Partial<WorkflowConfig>
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { source, config } = req.body as {
        source?: WorkflowSource;
        config?: Partial<WorkflowConfig>;
      };

      // Determine engine type from config (default to sequential)
      const engineType: WorkflowEngineType = config?.engineType ?? "sequential";

      // Validate: "goal" source requires orchestrator engine
      if (source?.type === "goal" && engineType !== "orchestrator") {
        res.status(400).json({
          success: false,
          data: null,
          message:
            "Goal-based workflows require the orchestrator engine. Set config.engineType to 'orchestrator'.",
        });
        return;
      }

      const engine = getEngine(req, engineType);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: `Workflow engine not available for type: ${engineType}`,
        });
        return;
      }

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
      broadcastWorkflowUpdate(
        req.project!.id,
        workflow.id,
        "created",
        workflow
      );

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
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        // Try sequential engine as fallback for listing
        const fallbackEngine = getEngine(req, "sequential");
        if (!fallbackEngine) {
          res.status(503).json({
            success: false,
            data: null,
            message: "Workflow engine not available",
          });
          return;
        }
        const workflow = await fallbackEngine.getWorkflow(id);
        if (!workflow) {
          res.status(404).json({
            success: false,
            data: null,
            message: `Workflow not found: ${id}`,
          });
          return;
        }
        res.json({ success: true, data: workflow });
        return;
      }

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
   *
   * Query parameters:
   * - deleteWorktree: if "true", also delete the workflow's worktree
   * - deleteBranch: if "true", also delete the workflow's branch
   */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { deleteWorktree, deleteBranch } = req.query;

      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

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

      // Track cleanup results
      const cleanupResults: {
        worktreeDeleted?: boolean;
        branchDeleted?: boolean;
        cleanupErrors?: string[];
      } = {};
      const cleanupErrors: string[] = [];

      const repoPath = req.project!.path;

      // Delete worktree if requested
      if (deleteWorktree === "true" && workflow.worktreePath) {
        try {
          // Remove git worktree registration
          execSync(`git worktree remove --force "${workflow.worktreePath}"`, {
            cwd: repoPath,
            stdio: "pipe",
          });
          cleanupResults.worktreeDeleted = true;
          console.log(
            `[workflows/:id] Deleted worktree: ${workflow.worktreePath}`
          );
        } catch (worktreeError) {
          // Worktree might already be removed, try to clean up the directory
          try {
            if (fs.existsSync(workflow.worktreePath)) {
              fs.rmSync(workflow.worktreePath, { recursive: true, force: true });
              cleanupResults.worktreeDeleted = true;
              console.log(
                `[workflows/:id] Removed worktree directory: ${workflow.worktreePath}`
              );
            }
            // Prune stale worktree entries
            execSync("git worktree prune", { cwd: repoPath, stdio: "pipe" });
          } catch (cleanupError) {
            const errorMsg =
              worktreeError instanceof Error
                ? worktreeError.message
                : String(worktreeError);
            cleanupErrors.push(`Failed to delete worktree: ${errorMsg}`);
            console.error(
              `[workflows/:id] Failed to delete worktree ${workflow.worktreePath}:`,
              worktreeError
            );
          }
        }
      }

      // Delete branch if requested
      if (deleteBranch === "true" && workflow.branchName) {
        try {
          execSync(`git branch -D "${workflow.branchName}"`, {
            cwd: repoPath,
            stdio: "pipe",
          });
          cleanupResults.branchDeleted = true;
          console.log(
            `[workflows/:id] Deleted branch: ${workflow.branchName}`
          );
        } catch (branchError) {
          const errorMsg =
            branchError instanceof Error
              ? branchError.message
              : String(branchError);
          cleanupErrors.push(`Failed to delete branch: ${errorMsg}`);
          console.error(
            `[workflows/:id] Failed to delete branch ${workflow.branchName}:`,
            branchError
          );
        }
      }

      if (cleanupErrors.length > 0) {
        cleanupResults.cleanupErrors = cleanupErrors;
      }

      // Delete from database
      const db = req.project!.db;
      db.prepare("DELETE FROM workflow_events WHERE workflow_id = ?").run(id);
      db.prepare("DELETE FROM workflows WHERE id = ?").run(id);

      // Broadcast deletion
      broadcastWorkflowUpdate(req.project!.id, id, "deleted", { id });

      res.json({
        success: true,
        data: { id, deleted: true, ...cleanupResults },
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
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

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
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

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
   *
   * Body:
   * - message?: string - Optional message to send to the orchestrator on resume
   */
  router.post("/:id/resume", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { message } = req.body as { message?: string };

      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      await engine.resumeWorkflow(id, message);

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
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

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
  router.post(
    "/:id/steps/:stepId/retry",
    async (req: Request, res: Response) => {
      try {
        const { id, stepId } = req.params;
        const { freshStart } = req.body || {};
        const engine = getEngineForWorkflow(req, id);
        if (!engine) {
          res.status(503).json({
            success: false,
            data: null,
            message: "Workflow engine not available",
          });
          return;
        }

        await engine.retryStep(id, stepId, { freshStart: freshStart === true });

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
    }
  );

  /**
   * POST /api/workflows/:id/steps/:stepId/skip - Skip a step
   *
   * Request body:
   * - reason: string (optional)
   */
  router.post(
    "/:id/steps/:stepId/skip",
    async (req: Request, res: Response) => {
      try {
        const { id, stepId } = req.params;
        const { reason } = req.body as { reason?: string };

        const engine = getEngineForWorkflow(req, id);
        if (!engine) {
          res.status(503).json({
            success: false,
            data: null,
            message: "Workflow engine not available",
          });
          return;
        }

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
    }
  );

  /**
   * GET /api/workflows/:id/events - Get workflow event history
   *
   * Query parameters:
   * - limit: number (default: 100)
   * - offset: number (default: 0)
   */
  router.get("/:id/events", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

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
  router.post(
    "/:id/escalation/respond",
    async (req: Request, res: Response) => {
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
        db.prepare(
          `
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
        ).run(
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
        const engine = getEngineForWorkflow(req, id);
        if (engine) {
          engine.emitEscalationResolved(
            id,
            escalationPayload.escalation_id,
            action as "approve" | "reject" | "custom",
            message
          );
        }

        // Trigger orchestrator wakeup if available (only on orchestrator engine)
        if (engine && "triggerEscalationWakeup" in engine) {
          try {
            await (
              engine as {
                triggerEscalationWakeup: (id: string) => Promise<void>;
              }
            ).triggerEscalationWakeup(id);
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
    }
  );

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
      const engine = getEngineForWorkflow(req, id);
      if (engine) {
        engine.emitEscalationRequested(
          id,
          escalation_id,
          message,
          options,
          context
        );
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

  // ===========================================================================
  // MCP Server Endpoints
  // These endpoints are called by the workflow MCP server instead of direct DB access
  // ===========================================================================

  /**
   * GET /api/workflows/:id/status - Get extended workflow status for orchestrator
   *
   * Returns workflow with steps, active executions, and ready steps.
   * Used by workflow_status MCP tool.
   */
  router.get("/:id/status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const engine = getEngineForWorkflow(req, id);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      const workflow = await engine.getWorkflow(id);

      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${id}`,
        });
        return;
      }

      // Get ready steps
      const readySteps = await engine.getReadySteps(id);
      const readyStepIds = readySteps.map((s) => s.id);

      // Get active executions from steps
      const db = req.project!.db;
      const activeExecutionIds = workflow.steps
        .filter((s) => s.status === "running" && s.executionId)
        .map((s) => s.executionId!);

      const activeExecutions: Array<{
        id: string;
        stepId: string;
        status: string;
        startedAt: string;
      }> = [];

      for (const execId of activeExecutionIds) {
        const exec = db
          .prepare("SELECT id, status, started_at FROM executions WHERE id = ?")
          .get(execId) as
          | { id: string; status: string; started_at: string }
          | undefined;
        if (exec) {
          const step = workflow.steps.find((s) => s.executionId === execId);
          activeExecutions.push({
            id: exec.id,
            stepId: step?.id || "",
            status: exec.status,
            startedAt: exec.started_at,
          });
        }
      }

      // Get issue titles for steps
      const issueIds = workflow.steps.map((s) => s.issueId);
      const issueTitles: Record<string, string> = {};
      if (issueIds.length > 0) {
        const placeholders = issueIds.map(() => "?").join(",");
        const issues = db
          .prepare(`SELECT id, title FROM issues WHERE id IN (${placeholders})`)
          .all(...issueIds) as { id: string; title: string }[];
        for (const issue of issues) {
          issueTitles[issue.id] = issue.title;
        }
      }

      // Build response matching WorkflowStatusResult type
      const result = {
        workflow: {
          id: workflow.id,
          title: workflow.title,
          status: workflow.status,
          source: workflow.source,
          config: workflow.config,
          worktreePath: workflow.worktreePath,
        },
        steps: workflow.steps.map((s) => ({
          id: s.id,
          issueId: s.issueId,
          issueTitle: issueTitles[s.issueId] || s.issueId,
          status: s.status,
          executionId: s.executionId,
          dependsOn: s.dependencies || [],
        })),
        activeExecutions,
        readySteps: readyStepIds,
      };

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/execute - Execute an issue within the workflow
   *
   * Used by execute_issue MCP tool.
   *
   * Request body:
   * - issue_id: string (required)
   * - agent_type?: AgentType
   * - model?: string
   * - worktree_mode: 'create_root' | 'use_root' | 'create_branch' | 'use_branch'
   * - worktree_id?: string (for use_root/use_branch)
   */
  router.post("/:id/execute", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const engine = getEngineForWorkflow(req, workflowId);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }
      const { issue_id, agent_type, model, worktree_mode, worktree_id } =
        req.body as {
          issue_id?: string;
          agent_type?: string;
          model?: string;
          worktree_mode?: string;
          worktree_id?: string;
        };

      // Validate required params
      if (!issue_id) {
        res.status(400).json({
          success: false,
          data: null,
          message: "issue_id is required",
        });
        return;
      }

      if (!worktree_mode) {
        res.status(400).json({
          success: false,
          data: null,
          message: "worktree_mode is required",
        });
        return;
      }

      // Get workflow
      const workflow = await engine.getWorkflow(workflowId);
      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      // Validate workflow is running
      if (workflow.status !== "running") {
        res.status(400).json({
          success: false,
          data: null,
          message: `Cannot execute issue: workflow is ${workflow.status}, expected running`,
        });
        return;
      }

      // Find step for this issue
      const step = workflow.steps.find((s) => s.issueId === issue_id);
      if (!step) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Issue ${issue_id} is not part of workflow ${workflowId}`,
        });
        return;
      }

      // Validate step status
      if (step.status !== "pending" && step.status !== "ready") {
        res.status(400).json({
          success: false,
          data: null,
          message: `Cannot execute step: status is ${step.status}, expected pending or ready`,
        });
        return;
      }

      // Get issue
      const db = req.project!.db;
      const issue = db
        .prepare("SELECT id, title, content FROM issues WHERE id = ?")
        .get(issue_id) as
        | { id: string; title: string; content: string }
        | undefined;

      if (!issue) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Issue not found: ${issue_id}`,
        });
        return;
      }

      // Determine worktree configuration
      let reuseWorktreePath: string | undefined;
      if (worktree_mode === "use_root" || worktree_mode === "use_branch") {
        if (!worktree_id) {
          res.status(400).json({
            success: false,
            data: null,
            message: `worktree_id is required for ${worktree_mode} mode`,
          });
          return;
        }
        // Look up the execution to get the worktree path
        const existingExecution = req
          .project!.db.prepare(
            "SELECT worktree_path FROM executions WHERE id = ?"
          )
          .get(worktree_id) as { worktree_path: string | null } | undefined;
        if (!existingExecution?.worktree_path) {
          res.status(400).json({
            success: false,
            data: null,
            message: `Execution ${worktree_id} not found or has no worktree`,
          });
          return;
        }
        reuseWorktreePath = existingExecution.worktree_path;
      } else if (
        worktree_mode === "create_root" &&
        workflow.config.reuseWorktreePath
      ) {
        // For the first execution, use workflow config's reuseWorktreePath if set
        // (e.g., when user selected an existing worktree when creating the workflow)
        reuseWorktreePath = workflow.config.reuseWorktreePath;
      }

      // Build execution config
      const agentTypeToUse =
        agent_type || workflow.config.defaultAgentType || "claude-code";
      const executionConfig = {
        mode: "worktree" as const,
        model: model || workflow.config.orchestratorModel,
        baseBranch: workflow.baseBranch,
        reuseWorktreePath,
        // Workflow-spawned executions run autonomously without terminal
        dangerouslySkipPermissions: true,
      };

      // Create prompt from issue content
      const prompt = issue.content || `Implement issue: ${issue.title}`;

      // Create execution with workflow context
      const executionService = req.project!.executionService;
      const execution = await executionService.createExecution(
        issue_id,
        executionConfig,
        prompt,
        agentTypeToUse as any,
        { workflowId, stepId: step.id }
      );

      // Update step status and execution ID
      const updatedSteps = workflow.steps.map((s) =>
        s.id === step.id
          ? { ...s, status: "running" as const, executionId: execution.id }
          : s
      );
      db.prepare(
        "UPDATE workflows SET steps = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(updatedSteps), new Date().toISOString(), workflowId);

      // Store worktree path on workflow for create_root mode
      if (worktree_mode === "create_root" && execution.worktree_path) {
        db.prepare(
          "UPDATE workflows SET worktree_path = ?, branch_name = ?, updated_at = ? WHERE id = ?"
        ).run(
          execution.worktree_path,
          execution.branch_name,
          new Date().toISOString(),
          workflowId
        );
      }

      // Emit step started event
      engine.emitStepStarted(workflowId, {
        ...step,
        status: "running",
        executionId: execution.id,
      });

      // Start execution timeout if configured (orchestrator workflows only)
      if (
        workflow.config.executionTimeoutMs &&
        "getWakeupService" in engine &&
        typeof engine.getWakeupService === "function"
      ) {
        const wakeupService = engine.getWakeupService();
        wakeupService.startExecutionTimeout(
          execution.id,
          workflowId,
          step.id,
          workflow.config.executionTimeoutMs
        );
      }

      console.log(
        `[workflows/:id/execute] Started execution ${execution.id} for issue ${issue_id} in workflow ${workflowId}`
      );

      res.json({
        success: true,
        data: {
          execution_id: execution.id,
          worktree_path: execution.worktree_path || "",
          branch_name: execution.branch_name,
          status: execution.status,
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/complete - Mark workflow as complete or failed
   *
   * Used by workflow_complete MCP tool.
   *
   * Request body:
   * - summary: string (required)
   * - status?: 'completed' | 'failed' (default: 'completed')
   */
  router.post("/:id/complete", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const engine = getEngineForWorkflow(req, workflowId);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }
      const { summary, status = "completed" } = req.body as {
        summary?: string;
        status?: "completed" | "failed";
      };

      if (!summary) {
        res.status(400).json({
          success: false,
          data: null,
          message: "summary is required",
        });
        return;
      }

      // Get workflow
      const workflow = await engine.getWorkflow(workflowId);
      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      // Update workflow status
      const now = new Date().toISOString();
      const db = req.project!.db;
      db.prepare(
        `
        UPDATE workflows
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(status, now, now, workflowId);

      // Emit workflow completed/failed event
      const updatedWorkflow = await engine.getWorkflow(workflowId);
      if (status === "completed") {
        engine.emitWorkflowCompleted(workflowId, updatedWorkflow!);
      } else {
        engine.emitWorkflowFailed(workflowId, summary);
      }

      // Broadcast update
      broadcastWorkflowUpdate(
        req.project!.id,
        workflowId,
        status,
        updatedWorkflow
      );

      res.json({
        success: true,
        data: {
          success: true,
          workflow_status: status,
          completed_at: now,
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/escalate - Create an escalation request
   *
   * Used by escalate_to_user MCP tool.
   * Creates escalation and emits event for WebSocket broadcast.
   *
   * Request body:
   * - message: string (required)
   * - options?: string[]
   * - context?: Record<string, unknown>
   */
  router.post("/:id/escalate", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const {
        message,
        options,
        context: escalationContext,
      } = req.body as {
        message?: string;
        options?: string[];
        context?: Record<string, unknown>;
      };

      if (!message) {
        res.status(400).json({
          success: false,
          data: null,
          message: "message is required",
        });
        return;
      }

      const db = req.project!.db;

      // Get workflow
      const workflowRow = db
        .prepare("SELECT * FROM workflows WHERE id = ?")
        .get(workflowId) as any;

      if (!workflowRow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      // Parse config to check autonomy level
      const config = JSON.parse(workflowRow.config) as WorkflowConfig;

      // If full_auto mode, bypass escalation
      if (config.autonomyLevel === "full_auto") {
        console.log(
          `[workflows/:id/escalate] Workflow ${workflowId} is in full_auto mode, auto-approving`
        );

        res.json({
          success: true,
          data: {
            status: "auto_approved",
            message:
              "Escalation auto-approved (workflow is in full_auto mode). " +
              "Proceed with your decision.",
          },
        });
        return;
      }

      // Check for existing pending escalation
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
        .get(workflowId, workflowId) as { payload: string } | undefined;

      if (pendingEscalation) {
        const payload = JSON.parse(pendingEscalation.payload);
        res.status(400).json({
          success: false,
          data: null,
          message:
            `Workflow already has a pending escalation (ID: ${payload.escalation_id}). ` +
            `Wait for user response or resolve the existing escalation first.`,
        });
        return;
      }

      // Generate unique escalation ID
      const escalationId = randomUUID();
      const now = new Date().toISOString();

      // Record escalation_requested event
      const eventId = randomUUID();
      db.prepare(
        `
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        eventId,
        workflowId,
        "escalation_requested",
        JSON.stringify({
          escalation_id: escalationId,
          message,
          options,
          context: escalationContext,
        }),
        now
      );

      // Emit escalation requested event for WebSocket broadcast
      const engine = getEngineForWorkflow(req, workflowId);
      if (engine) {
        engine.emitEscalationRequested(
          workflowId,
          escalationId,
          message,
          options,
          escalationContext
        );
      }

      console.log(
        `[workflows/:id/escalate] Escalation created for workflow ${workflowId}: ${escalationId}`
      );

      res.json({
        success: true,
        data: {
          status: "pending",
          escalation_id: escalationId,
          message:
            "Escalation request created. Your session will end here. " +
            "When the user responds, you will receive a follow-up message with their response. " +
            "The workflow will resume automatically.",
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/notify - Send a non-blocking notification
   *
   * Used by notify_user MCP tool.
   * Broadcasts notification via WebSocket.
   *
   * Request body:
   * - message: string (required)
   * - level?: 'info' | 'warning' | 'error' (default: 'info')
   */
  router.post("/:id/notify", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const { message, level = "info" } = req.body as {
        message?: string;
        level?: "info" | "warning" | "error";
      };

      if (!message) {
        res.status(400).json({
          success: false,
          data: null,
          message: "message is required",
        });
        return;
      }

      const db = req.project!.db;

      // Verify workflow exists
      const workflowExists = db
        .prepare("SELECT 1 FROM workflows WHERE id = ?")
        .get(workflowId);

      if (!workflowExists) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      // Record notification event (for audit trail)
      const eventId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO workflow_events (id, workflow_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        eventId,
        workflowId,
        "user_notification",
        JSON.stringify({ level, message }),
        now
      );

      // Broadcast notification via WebSocket
      broadcastWorkflowUpdate(req.project!.id, workflowId, "notification", {
        level,
        message,
        timestamp: now,
      });

      console.log(
        `[workflows/:id/notify] [${level.toUpperCase()}] Workflow ${workflowId}: ${message}`
      );

      res.json({
        success: true,
        data: {
          success: true,
          delivered: true, // We assume WebSocket delivery
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/merge - Merge a branch into the workflow worktree
   *
   * Used by merge_branch MCP tool.
   * Merges a source branch into the workflow's worktree.
   *
   * Request body:
   * - source_branch: string (required)
   * - target_branch?: string (default: current workflow branch)
   * - strategy?: 'auto' | 'squash' (default: 'auto')
   * - message?: string (custom commit message)
   */
  router.post("/:id/merge", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const { source_branch, target_branch, strategy = "auto", message } =
        req.body as {
          source_branch?: string;
          target_branch?: string;
          strategy?: "auto" | "squash";
          message?: string;
        };

      if (!source_branch) {
        res.status(400).json({
          success: false,
          data: null,
          message: "source_branch is required",
        });
        return;
      }

      const db = req.project!.db;

      // Get workflow to find worktree path
      const workflowRow = db
        .prepare("SELECT worktree_path, branch_name FROM workflows WHERE id = ?")
        .get(workflowId) as
        | { worktree_path: string | null; branch_name: string | null }
        | undefined;

      if (!workflowRow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      if (!workflowRow.worktree_path) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Workflow ${workflowId} does not have a worktree`,
        });
        return;
      }

      // If target_branch specified and different from current, checkout target first
      if (target_branch && target_branch !== workflowRow.branch_name) {
        try {
          execSync(`git checkout "${target_branch}"`, {
            cwd: workflowRow.worktree_path,
            stdio: "pipe",
          });
        } catch (checkoutError) {
          res.status(400).json({
            success: false,
            data: null,
            message: `Failed to checkout target branch: ${target_branch}`,
            error:
              checkoutError instanceof Error
                ? checkoutError.message
                : String(checkoutError),
          });
          return;
        }
      }

      // Perform merge using git commands
      try {
        let mergeCommit: string | undefined;
        let strategyUsed: "fast-forward" | "merge" | "squash";

        if (strategy === "squash") {
          // Squash merge
          execSync(`git merge --squash "${source_branch}"`, {
            cwd: workflowRow.worktree_path,
            stdio: "pipe",
          });

          // Commit with custom message or default
          const commitMessage =
            message || `Squash merge branch '${source_branch}'`;
          execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
            cwd: workflowRow.worktree_path,
            stdio: "pipe",
          });

          mergeCommit = execSync("git rev-parse HEAD", {
            cwd: workflowRow.worktree_path,
            encoding: "utf-8",
          }).trim();
          strategyUsed = "squash";
        } else {
          // Auto strategy: try fast-forward first
          try {
            execSync(
              `git merge-base --is-ancestor HEAD "${source_branch}"`,
              {
                cwd: workflowRow.worktree_path,
                stdio: "pipe",
              }
            );
            // Fast-forward is possible
            execSync(`git merge --ff-only "${source_branch}"`, {
              cwd: workflowRow.worktree_path,
              stdio: "pipe",
            });
            mergeCommit = execSync("git rev-parse HEAD", {
              cwd: workflowRow.worktree_path,
              encoding: "utf-8",
            }).trim();
            strategyUsed = "fast-forward";
          } catch {
            // Fast-forward not possible, do regular merge
            const commitMessage =
              message || `Merge branch '${source_branch}'`;
            execSync(
              `git merge --no-ff -m "${commitMessage.replace(/"/g, '\\"')}" "${source_branch}"`,
              {
                cwd: workflowRow.worktree_path,
                stdio: "pipe",
              }
            );
            mergeCommit = execSync("git rev-parse HEAD", {
              cwd: workflowRow.worktree_path,
              encoding: "utf-8",
            }).trim();
            strategyUsed = "merge";
          }
        }

        console.log(
          `[workflows/:id/merge] Merged ${source_branch} into workflow ${workflowId} (${strategyUsed})`
        );

        res.json({
          success: true,
          data: {
            success: true,
            merge_commit: mergeCommit,
            strategy_used: strategyUsed,
          },
        });
      } catch (mergeError) {
        // Check for merge conflicts
        let conflictingFiles: string[] = [];
        try {
          const conflictOutput = execSync(
            "git diff --name-only --diff-filter=U",
            {
              cwd: workflowRow.worktree_path,
              encoding: "utf-8",
            }
          );
          conflictingFiles = conflictOutput
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        } catch {
          // Not in merge state or other issue
        }

        if (conflictingFiles.length > 0) {
          // Abort the failed merge
          try {
            execSync("git merge --abort", {
              cwd: workflowRow.worktree_path,
              stdio: "pipe",
            });
          } catch {
            // Ignore abort errors
          }

          res.json({
            success: true,
            data: {
              success: false,
              strategy_used: strategy === "squash" ? "squash" : "merge",
              conflicting_files: conflictingFiles,
              error: `Merge conflict in ${conflictingFiles.length} file(s)`,
            },
          });
        } else {
          res.json({
            success: true,
            data: {
              success: false,
              strategy_used: strategy === "squash" ? "squash" : "merge",
              error:
                mergeError instanceof Error
                  ? mergeError.message
                  : String(mergeError),
            },
          });
        }
      }
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  /**
   * POST /api/workflows/:id/await-events - Register an await condition for the orchestrator
   *
   * Used by await_events MCP tool.
   * Stores condition in wakeup service (in-memory).
   * Returns immediately - orchestrator session should end after this call.
   *
   * Request body:
   * - event_types: AwaitableEventType[] (required)
   * - execution_ids?: string[]
   * - timeout_seconds?: number
   * - message?: string
   */
  router.post("/:id/await-events", async (req: Request, res: Response) => {
    try {
      const { id: workflowId } = req.params;
      const { event_types, execution_ids, timeout_seconds, message } =
        req.body as {
          event_types?: string[];
          execution_ids?: string[];
          timeout_seconds?: number;
          message?: string;
        };

      // Validate required params
      if (!event_types || event_types.length === 0) {
        res.status(400).json({
          success: false,
          data: null,
          message: "event_types is required and must be non-empty",
        });
        return;
      }

      // Validate event types
      const validEventTypes = [
        "step_completed",
        "step_failed",
        "user_response",
        "escalation_resolved",
        "timeout",
      ];
      for (const eventType of event_types) {
        if (!validEventTypes.includes(eventType)) {
          res.status(400).json({
            success: false,
            data: null,
            message: `Invalid event type: ${eventType}. Must be one of: ${validEventTypes.join(", ")}`,
          });
          return;
        }
      }

      const engine = getEngineForWorkflow(req, workflowId);
      if (!engine) {
        res.status(503).json({
          success: false,
          data: null,
          message: "Workflow engine not available",
        });
        return;
      }

      // Get workflow and validate status
      const workflow = await engine.getWorkflow(workflowId);
      if (!workflow) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Workflow not found: ${workflowId}`,
        });
        return;
      }

      if (workflow.status !== "running") {
        res.status(400).json({
          success: false,
          data: null,
          message: `Cannot await events: workflow is ${workflow.status}, expected running`,
        });
        return;
      }

      // Register await condition in wakeup service (in-memory)
      // Note: getWakeupService is available on orchestrator engines
      if (!("getWakeupService" in engine)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Await events is only supported for orchestrator workflows",
        });
        return;
      }

      const wakeupService = (
        engine as { getWakeupService: () => { registerAwait: Function } }
      ).getWakeupService();
      const awaitResult = wakeupService.registerAwait({
        workflowId,
        eventTypes: event_types,
        executionIds: execution_ids,
        timeoutSeconds: timeout_seconds,
        message,
      });

      // Broadcast status update (for UI)
      broadcastWorkflowUpdate(req.project!.id, workflowId, "awaiting", {
        await_id: awaitResult.id,
        event_types,
        message,
      });

      console.log(
        `[workflows/:id/await-events] Registered await ${awaitResult.id} for workflow ${workflowId}`,
        { eventTypes: event_types, executionIds: execution_ids }
      );

      res.json({
        success: true,
        data: {
          status: "waiting",
          await_id: awaitResult.id,
          message:
            "Session will end. You'll be woken up when events occur.",
          will_wake_on: event_types,
          timeout_at: awaitResult.timeoutAt,
        },
      });
    } catch (error) {
      handleWorkflowError(error, res);
    }
  });

  return router;
}
