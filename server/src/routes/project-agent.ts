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
import { getProgressReportingService } from "../services/progress-reporting.js";
import { getCacheManager } from "../services/cache-manager.js";
import {
  getAvailablePresets,
  getPresetConfig,
  getPresetComparison,
  suggestPreset,
  mergeWithPreset,
  type ConfigPreset,
} from "../services/config-presets.js";
import { getMetricsService } from "../services/metrics.js";

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

  /**
   * GET /api/project-agent/report
   *
   * Generate and retrieve project progress report
   * Query params:
   * - format: "json" | "markdown" (default: "json")
   * - period: number of days (default: 7)
   * - save: boolean - whether to save to file (default: false)
   */
  router.get("/report", async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || "json";
      const periodDays = req.query.period ? parseInt(req.query.period as string) : 7;
      const save = req.query.save === "true";

      const reportingService = getProgressReportingService(db, repoPath);
      const report = await reportingService.generateReport({ periodDays });

      if (save) {
        const filepath = await reportingService.saveReport(
          report,
          format === "markdown" ? "markdown" : "json"
        );
        res.json({
          success: true,
          data: report,
          saved_to: filepath,
        });
      } else if (format === "markdown") {
        const markdown = reportingService.formatAsMarkdown(report);
        res.setHeader("Content-Type", "text/markdown");
        res.send(markdown);
      } else {
        res.json({
          success: true,
          data: report,
        });
      }
    } catch (error) {
      console.error("[API Route] ERROR: Failed to generate report:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to generate report",
      });
    }
  });

  /**
   * GET /api/project-agent/cache/stats
   *
   * Get cache statistics for performance monitoring
   */
  router.get("/cache/stats", async (req: Request, res: Response) => {
    try {
      const cache = getCacheManager();
      const stats = cache.getStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get cache stats:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get cache stats",
      });
    }
  });

  /**
   * POST /api/project-agent/cache/clear
   *
   * Clear all cache entries
   */
  router.post("/cache/clear", async (req: Request, res: Response) => {
    try {
      const cache = getCacheManager();
      cache.clear();

      res.json({
        success: true,
        message: "Cache cleared successfully",
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to clear cache:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to clear cache",
      });
    }
  });

  /**
   * GET /api/project-agent/presets
   *
   * List all available configuration presets
   */
  router.get("/presets", async (req: Request, res: Response) => {
    try {
      const presets = getAvailablePresets();

      res.json({
        success: true,
        data: {
          presets,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to list presets:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to list presets",
      });
    }
  });

  /**
   * GET /api/project-agent/presets/:preset
   *
   * Get configuration for a specific preset
   */
  router.get("/presets/:preset", async (req: Request, res: Response) => {
    try {
      const preset = req.params.preset as ConfigPreset;

      if (!["conservative", "balanced", "aggressive"].includes(preset)) {
        res.status(400).json({
          success: false,
          error: "Invalid preset. Must be: conservative, balanced, or aggressive",
        });
        return;
      }

      const config = getPresetConfig(preset);

      res.json({
        success: true,
        data: {
          preset,
          config,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get preset:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get preset",
      });
    }
  });

  /**
   * GET /api/project-agent/presets/comparison
   *
   * Get comparison matrix of all presets
   */
  router.get("/presets/comparison/matrix", async (req: Request, res: Response) => {
    try {
      const comparison = getPresetComparison();

      res.json({
        success: true,
        data: {
          comparison,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get preset comparison:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get preset comparison",
      });
    }
  });

  /**
   * POST /api/project-agent/presets/suggest
   *
   * Suggest appropriate preset based on current or provided config
   */
  router.post("/presets/suggest", async (req: Request, res: Response) => {
    try {
      const config = req.body.config as ProjectAgentConfig;

      if (!config) {
        res.status(400).json({
          success: false,
          error: "Config is required in request body",
        });
        return;
      }

      const suggestion = suggestPreset(config);

      res.json({
        success: true,
        data: suggestion,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to suggest preset:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to suggest preset",
      });
    }
  });

  /**
   * GET /api/project-agent/metrics/dashboard
   *
   * Get comprehensive dashboard metrics
   * Query params:
   * - period: number of days (default: 7)
   */
  router.get("/metrics/dashboard", async (req: Request, res: Response) => {
    try {
      const periodDays = req.query.period ? parseInt(req.query.period as string) : 7;

      const metricsService = getMetricsService(db);
      const metrics = await metricsService.getDashboardMetrics({ periodDays });

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get dashboard metrics:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get dashboard metrics",
      });
    }
  });

  /**
   * GET /api/project-agent/metrics/action-breakdown
   *
   * Get action type breakdown for visualization
   * Query params:
   * - period: number of days (default: 7)
   */
  router.get("/metrics/action-breakdown", async (req: Request, res: Response) => {
    try {
      const periodDays = req.query.period ? parseInt(req.query.period as string) : 7;

      const metricsService = getMetricsService(db);
      const breakdown = await metricsService.getActionTypeBreakdown(periodDays);

      res.json({
        success: true,
        data: {
          breakdown,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get action breakdown:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get action breakdown",
      });
    }
  });

  /**
   * GET /api/project-agent/metrics/activity
   *
   * Get recent activity log
   * Query params:
   * - limit: number of items (default: 20)
   */
  router.get("/metrics/activity", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      const metricsService = getMetricsService(db);
      const activity = await metricsService.getRecentActivity(limit);

      res.json({
        success: true,
        data: {
          activity,
        },
      });
    } catch (error) {
      console.error("[API Route] ERROR: Failed to get activity:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to get activity",
      });
    }
  });

  return router;
}
