/**
 * Stacks API routes (mapped to /api/stacks)
 *
 * Manages stacks for stacked diffs workflow.
 * Stacks can be auto-generated from issue dependencies or manually created.
 */

import { Router, Request, Response } from "express";
import {
  listStacks,
  getStack,
  createStack,
  updateStack,
  deleteStack,
  addToStack,
  removeFromStack,
} from "../services/stack-service.js";

export function createStacksRouter(): Router {
  const router = Router();

  /**
   * GET /api/stacks - List all stacks
   *
   * Query params:
   * - include_auto: Include auto-detected stacks (default: true)
   * - include_manual: Include manual stacks (default: true)
   *
   * Response: {
   *   stacks: StackInfo[];
   *   auto_count: number;
   *   manual_count: number;
   * }
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      const includeAuto = req.query.include_auto !== "false";
      const includeManual = req.query.include_manual !== "false";

      const allStacks = listStacks(req.project!.db);

      // Filter based on query params
      const filteredStacks = allStacks.filter((stackInfo) => {
        if (stackInfo.stack.is_auto && !includeAuto) return false;
        if (!stackInfo.stack.is_auto && !includeManual) return false;
        return true;
      });

      const autoCount = allStacks.filter((s) => s.stack.is_auto).length;
      const manualCount = allStacks.filter((s) => !s.stack.is_auto).length;

      res.json({
        success: true,
        data: {
          stacks: filteredStacks,
          auto_count: autoCount,
          manual_count: manualCount,
        },
      });
    } catch (error) {
      console.error("Error listing stacks:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list stacks",
      });
    }
  });

  /**
   * GET /api/stacks/:id - Get a specific stack
   *
   * Response: StackInfo
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const stackInfo = getStack(req.project!.db, id);

      if (!stackInfo) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Stack not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: stackInfo,
      });
    } catch (error) {
      console.error("Error getting stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get stack",
      });
    }
  });

  /**
   * POST /api/stacks - Create a manual stack
   *
   * Request body: {
   *   name?: string;
   *   issue_ids: string[];
   *   root_issue_id?: string;
   * }
   *
   * Response: Stack
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { name, issue_ids, root_issue_id } = req.body;

      if (!issue_ids || !Array.isArray(issue_ids) || issue_ids.length === 0) {
        res.status(400).json({
          success: false,
          data: null,
          message: "issue_ids is required and must be a non-empty array",
        });
        return;
      }

      const stack = createStack(req.project!.db, {
        name,
        issueIds: issue_ids,
        rootIssueId: root_issue_id,
      });

      res.status(201).json({
        success: true,
        data: stack,
      });
    } catch (error) {
      console.error("Error creating stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create stack",
      });
    }
  });

  /**
   * PUT /api/stacks/:id - Update a stack
   *
   * Request body: {
   *   name?: string;
   *   issue_order?: string[];
   *   root_issue_id?: string | null;
   *   add_issues?: string[];
   *   remove_issues?: string[];
   * }
   *
   * Response: Stack
   */
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, issue_order, root_issue_id, add_issues, remove_issues } =
        req.body;

      // Check if stack exists
      const existing = getStack(req.project!.db, id);
      if (!existing) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Stack not found: ${id}`,
        });
        return;
      }

      // Cannot modify auto-generated stacks
      if (existing.stack.is_auto) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Cannot modify auto-generated stacks",
        });
        return;
      }

      let result = existing.stack;

      // Handle add_issues
      if (add_issues && Array.isArray(add_issues)) {
        for (const issueId of add_issues) {
          const updated = addToStack(req.project!.db, id, issueId);
          if (updated) result = updated;
        }
      }

      // Handle remove_issues
      if (remove_issues && Array.isArray(remove_issues)) {
        for (const issueId of remove_issues) {
          const updated = removeFromStack(req.project!.db, id, issueId);
          if (updated) result = updated;
        }
      }

      // Handle direct updates
      const updates: { name?: string; issueOrder?: string[]; rootIssueId?: string | null } = {};
      if (name !== undefined) updates.name = name;
      if (issue_order !== undefined) updates.issueOrder = issue_order;
      if (root_issue_id !== undefined) updates.rootIssueId = root_issue_id;

      if (Object.keys(updates).length > 0) {
        const updated = updateStack(req.project!.db, id, updates);
        if (updated) result = updated;
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error updating stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to update stack",
      });
    }
  });

  /**
   * DELETE /api/stacks/:id - Delete a manual stack
   *
   * Response: { success: true }
   */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if stack exists
      const existing = getStack(req.project!.db, id);
      if (!existing) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Stack not found: ${id}`,
        });
        return;
      }

      // Cannot delete auto-generated stacks
      if (existing.stack.is_auto) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Cannot delete auto-generated stacks",
        });
        return;
      }

      const deleted = deleteStack(req.project!.db, id);

      if (deleted) {
        res.json({
          success: true,
          data: null,
        });
      } else {
        res.status(500).json({
          success: false,
          data: null,
          message: "Failed to delete stack",
        });
      }
    } catch (error) {
      console.error("Error deleting stack:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete stack",
      });
    }
  });

  return router;
}
