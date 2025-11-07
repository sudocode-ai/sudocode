/**
 * Project Agent API routes (mapped to /api/project-agent)
 *
 * Provides REST API for managing project agent lifecycle and actions.
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import { ActionManager } from "../services/project-agent-actions.js";
import {
  getRunningProjectAgentExecution,
  getProjectAgentExecution,
  listProjectAgentActions,
  listProjectAgentEvents,
} from "../services/project-agent-db.js";
import type { ProjectAgentConfig } from "@sudocode-ai/types";
import {
  ProjectAgentExecutor,
  initProjectAgentExecutor,
  getProjectAgentExecutor,
  destroyProjectAgentExecutor,
} from "../services/project-agent-executor.js";

/**
 * Create project agent router
 *
 * @param db - Database instance
 * @param repoPath - Path to git repository
 * @param executionService - Execution service instance for managing executions
 * @returns Express router with project agent endpoints
 */
export function createProjectAgentRouter(
  db: Database.Database,
  repoPath: string,
  executionService: any
): Router {
  const router = Router();

  /**
   * GET /api/project-agent/status
   *
   * Get current project agent status
   */
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.json({
          success: true,
          data: {
            status: "stopped",
            execution_id: null,
            uptime_seconds: 0,
            mode: null,
            worktree_path: null,
            activity: {
              last_event_processed: null,
              events_processed: 0,
              actions_proposed: 0,
              actions_approved: 0,
            },
            monitoring: {
              watching_executions: [],
              next_check: null,
            },
          },
        });
        return;
      }

      // Calculate uptime
      const uptimeSeconds = Math.floor(
        (new Date().getTime() - new Date(execution.started_at).getTime()) / 1000
      );

      res.json({
        success: true,
        data: {
          status: execution.status,
          execution_id: execution.execution_id,
          uptime_seconds: uptimeSeconds,
          mode: execution.mode,
          worktree_path: execution.worktree_path,
          activity: {
            last_event_processed: execution.last_activity_at,
            events_processed: execution.events_processed,
            actions_proposed: execution.actions_proposed,
            actions_approved: execution.actions_approved,
          },
          monitoring: {
            watching_executions: [], // TODO: Get from project agent state
            next_check: null, // TODO: Get from monitoring config
          },
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get project agent status:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get project agent status",
      });
    }
  });

  /**
   * POST /api/project-agent/start
   *
   * Start the project agent
   */
  router.post("/start", async (req: Request, res: Response) => {
    try {
      const configInput: Partial<ProjectAgentConfig> = req.body.config || {};

      // Check if already running
      const existing = getRunningProjectAgentExecution(db);
      if (existing) {
        res.status(400).json({
          success: false,
          error: "Project agent is already running",
          message: "Stop the current project agent before starting a new one",
        });
        return;
      }

      // Build full config with defaults
      const config: ProjectAgentConfig = {
        useWorktree: configInput.useWorktree ?? false,
        worktreePath: configInput.worktreePath,
        mode: configInput.mode || "monitoring",
        autoApprove: {
          enabled: configInput.autoApprove?.enabled ?? false,
          allowedActions: configInput.autoApprove?.allowedActions || [],
        },
        monitoring: {
          watchExecutions: configInput.monitoring?.watchExecutions ?? true,
          checkInterval: configInput.monitoring?.checkInterval ?? 60000,
          stalledExecutionThreshold: configInput.monitoring?.stalledExecutionThreshold ?? 3600000,
        },
      };

      // Initialize and start project agent executor
      const executor = initProjectAgentExecutor(db, repoPath, config, executionService);
      const execution = await executor.start();

      res.json({
        success: true,
        data: {
          execution_id: execution.execution_id,
          status: execution.status,
          mode: execution.mode,
          worktree_path: execution.worktree_path,
          created_at: execution.started_at,
        },
        message: "Project agent started successfully",
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to start project agent:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to start project agent",
      });
    }
  });

  /**
   * POST /api/project-agent/stop
   *
   * Stop the project agent
   */
  router.post("/stop", async (req: Request, res: Response) => {
    try {
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.status(400).json({
          success: false,
          error: "No running project agent",
          message: "Project agent is not currently running",
        });
        return;
      }

      // Stop project agent executor
      try {
        const executor = getProjectAgentExecutor();
        await executor.stop();
        await destroyProjectAgentExecutor();
      } catch (error) {
        console.error("[API Route] ERROR: Failed to get/stop executor:", error);
        // Continue anyway - executor might not be initialized
      }

      res.json({
        success: true,
        data: {
          execution_id: execution.execution_id,
          status: "stopped",
        },
        message: "Project agent stopped successfully",
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to stop project agent:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to stop project agent",
      });
    }
  });

  /**
   * GET /api/project-agent/config
   *
   * Get project agent configuration
   */
  router.get("/config", async (req: Request, res: Response) => {
    try {
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.status(404).json({
          success: false,
          error: "No running project agent",
          message: "Project agent is not currently running",
        });
        return;
      }

      const config = JSON.parse(execution.config_json);

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get project agent config:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get project agent configuration",
      });
    }
  });

  /**
   * PATCH /api/project-agent/config
   *
   * Update project agent configuration
   */
  router.patch("/config", async (req: Request, res: Response) => {
    try {
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.status(404).json({
          success: false,
          error: "No running project agent",
          message: "Project agent is not currently running",
        });
        return;
      }

      // TODO: Implement config update logic
      // This should validate and update the configuration

      res.json({
        success: true,
        data: req.body,
        message: "Configuration update requested (implementation pending)",
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to update project agent config:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to update project agent configuration",
      });
    }
  });

  /**
   * GET /api/project-agent/actions
   *
   * List project agent actions
   */
  router.get("/actions", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const execution = getRunningProjectAgentExecution(db);

      const actions = listProjectAgentActions(db, {
        projectAgentExecutionId: execution?.id,
        status: status as any,
        limit,
      });

      res.json({
        success: true,
        data: {
          actions,
          total: actions.length,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to list actions:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to list actions",
      });
    }
  });

  /**
   * GET /api/project-agent/actions/:id
   *
   * Get a specific action
   */
  router.get("/actions/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const action = await db.prepare(
        "SELECT * FROM project_agent_actions WHERE id = ?"
      ).get(id);

      if (!action) {
        res.status(404).json({
          success: false,
          error: "Action not found",
        });
        return;
      }

      res.json({
        success: true,
        data: action,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get action:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get action",
      });
    }
  });

  /**
   * POST /api/project-agent/actions/:id/approve
   *
   * Approve an action
   */
  router.post("/actions/:id/approve", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.status(400).json({
          success: false,
          error: "No running project agent",
        });
        return;
      }

      const config = JSON.parse(execution.config_json);
      const actionManager = new ActionManager(db, config, repoPath, executionService);

      await actionManager.approveAction(id);

      const action = actionManager.getAction(id);

      res.json({
        success: true,
        data: {
          action_id: id,
          status: action?.status || "approved",
          approved_at: action?.approved_at || new Date().toISOString(),
          execution_started: action?.status === "executing" || action?.status === "completed",
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to approve action:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to approve action",
      });
    }
  });

  /**
   * POST /api/project-agent/actions/:id/reject
   *
   * Reject an action
   */
  router.post("/actions/:id/reject", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const execution = getRunningProjectAgentExecution(db);

      if (!execution) {
        res.status(400).json({
          success: false,
          error: "No running project agent",
        });
        return;
      }

      const config = JSON.parse(execution.config_json);
      const actionManager = new ActionManager(db, config, repoPath, executionService);

      await actionManager.rejectAction(id, reason);

      const action = actionManager.getAction(id);

      res.json({
        success: true,
        data: {
          action_id: id,
          status: action?.status || "rejected",
          rejected_at: action?.rejected_at || new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to reject action:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to reject action",
      });
    }
  });

  /**
   * GET /api/project-agent/events
   *
   * List project agent events
   */
  router.get("/events", async (req: Request, res: Response) => {
    try {
      const eventType = req.query.event_type as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const execution = getRunningProjectAgentExecution(db);

      const events = listProjectAgentEvents(db, {
        projectAgentExecutionId: execution?.id,
        eventType,
        limit,
      });

      res.json({
        success: true,
        data: {
          events,
          total: events.length,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to list events:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to list events",
      });
    }
  });

  return router;
}
