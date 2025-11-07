/**
 * Quality Gates API Routes
 *
 * Endpoints for managing quality gate configuration and viewing results
 */

import express, { type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { getSchedulerConfig, updateSchedulerConfig } from "../services/scheduler-config.js";
import { QualityGateService } from "../services/quality-gate.js";

export function createQualityGatesRouter(db: Database.Database, repoRoot: string) {
  const router = express.Router();
  const qualityGateService = new QualityGateService(db, repoRoot);

  /**
   * GET /api/quality-gates/config
   * Get current quality gates configuration
   */
  router.get("/config", (_req: Request, res: Response) => {
    try {
      const config = getSchedulerConfig(db);

      res.status(200).json({
        success: true,
        data: {
          enabled: config.qualityGatesEnabled,
          config: config.qualityGatesConfig || null,
        },
      });
    } catch (error: any) {
      console.error("[Quality Gates API] Failed to get config:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get quality gates configuration",
        error_data: error.message,
      });
    }
  });

  /**
   * PUT /api/quality-gates/config
   * Update quality gates configuration
   */
  router.put("/config", (req: Request, res: Response) => {
    try {
      const { enabled, config } = req.body;

      // Validate input
      if (enabled !== undefined && typeof enabled !== "boolean") {
        res.status(400).json({
          success: false,
          message: "enabled must be a boolean",
        });
        return;
      }

      // Update configuration
      const updated = updateSchedulerConfig(db, {
        qualityGatesEnabled: enabled,
        qualityGatesConfig: config,
      });

      res.status(200).json({
        success: true,
        data: {
          enabled: updated.qualityGatesEnabled,
          config: updated.qualityGatesConfig || null,
        },
      });
    } catch (error: any) {
      console.error("[Quality Gates API] Failed to update config:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update quality gates configuration",
        error_data: error.message,
      });
    }
  });

  /**
   * GET /api/quality-gates/execution/:executionId
   * Get quality gate results for an execution
   */
  router.get("/execution/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      const result = qualityGateService.getResults(executionId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "No quality gate results found for this execution",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error(
        `[Quality Gates API] Failed to get results for execution ${req.params.executionId}:`,
        error
      );
      res.status(500).json({
        success: false,
        message: "Failed to get quality gate results",
        error_data: error.message,
      });
    }
  });

  /**
   * DELETE /api/quality-gates/execution/:executionId
   * Delete quality gate results for an execution
   */
  router.delete("/execution/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      qualityGateService.deleteResults(executionId);

      res.status(200).json({
        success: true,
        data: null,
      });
    } catch (error: any) {
      console.error(
        `[Quality Gates API] Failed to delete results for execution ${req.params.executionId}:`,
        error
      );
      res.status(500).json({
        success: false,
        message: "Failed to delete quality gate results",
        error_data: error.message,
      });
    }
  });

  return router;
}
