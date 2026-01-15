/**
 * Batches API routes (mapped to /api/batches)
 *
 * Manages PR batches for grouped review and merge workflow.
 * Batches group queue entries into single PRs for atomic review.
 */

import { Router, Request, Response } from "express";
import type { CreateBatchRequest, BatchPRStatus, BatchPreview } from "@sudocode-ai/types";
import {
  listBatches,
  getBatch,
  getEnrichedBatch,
  createBatch,
  updateBatch,
  updateBatchPR,
  updateBatchStatus,
  deleteBatch,
  validateBatchEntries,
  filterMergedEntries,
} from "../services/batch-service.js";
import { GitHubPRService, GitHubPRError } from "../services/github-pr-service.js";

export function createBatchesRouter(): Router {
  const router = Router();

  /**
   * GET /api/batches - List all batches
   *
   * Query params:
   * - target_branch: Filter by target branch
   * - pr_status: Filter by PR status
   * - include_entries: Include enriched entry data (default: false)
   *
   * Response: {
   *   batches: PRBatch[];
   *   total: number;
   * }
   */
  router.get("/", (req: Request, res: Response) => {
    try {
      const targetBranch = req.query.target_branch as string | undefined;
      const prStatus = req.query.pr_status as BatchPRStatus | undefined;
      const includeEntries = req.query.include_entries === "true";

      const result = listBatches(req.project!.db, {
        targetBranch,
        prStatus,
        includeEntries,
      });

      // If includeEntries, enrich each batch
      let batches = result.batches;
      if (includeEntries) {
        batches = result.batches.map((b) => {
          const enriched = getEnrichedBatch(req.project!.db, b.id);
          return enriched || b;
        });
      }

      res.json({
        success: true,
        data: {
          batches,
          total: result.total,
        },
      });
    } catch (error) {
      console.error("Error listing batches:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to list batches",
      });
    }
  });

  /**
   * GET /api/batches/:id - Get a specific batch
   *
   * Query params:
   * - include_entries: Include enriched entry data (default: true)
   *
   * Response: { batch: EnrichedBatch }
   */
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const includeEntries = req.query.include_entries !== "false";

      let batch;
      if (includeEntries) {
        batch = getEnrichedBatch(req.project!.db, id);
      } else {
        batch = getBatch(req.project!.db, id);
      }

      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: { batch },
      });
    } catch (error) {
      console.error("Error getting batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get batch",
      });
    }
  });

  /**
   * POST /api/batches - Create a new batch
   *
   * Request body: CreateBatchRequest
   *
   * Response: { batch: PRBatch }
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const body = req.body as CreateBatchRequest;

      // Validate required fields
      if (!body.title) {
        res.status(400).json({
          success: false,
          data: null,
          message: "title is required",
        });
        return;
      }

      if (!body.entry_ids || !Array.isArray(body.entry_ids) || body.entry_ids.length === 0) {
        res.status(400).json({
          success: false,
          data: null,
          message: "entry_ids is required and must be a non-empty array",
        });
        return;
      }

      // Validate entries
      const validation = validateBatchEntries(req.project!.db, body.entry_ids);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          data: null,
          message: validation.errors.join("; "),
          error_data: { errors: validation.errors },
        });
        return;
      }

      // Filter out already merged entries
      const activeEntryIds = filterMergedEntries(req.project!.db, body.entry_ids);
      if (activeEntryIds.length === 0) {
        res.status(409).json({
          success: false,
          data: null,
          message: "All entries are already merged",
        });
        return;
      }

      const batch = createBatch(req.project!.db, {
        ...body,
        entry_ids: activeEntryIds,
      });

      res.status(201).json({
        success: true,
        data: { batch },
      });
    } catch (error) {
      console.error("Error creating batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create batch",
      });
    }
  });

  /**
   * PUT /api/batches/:id - Update a batch
   *
   * Request body: { title?: string; description?: string }
   * Note: Limited updates allowed - batch is immutable after PR creation
   *
   * Response: { batch: PRBatch }
   */
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, description } = req.body;

      const batch = updateBatch(req.project!.db, id, { title, description });

      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: { batch },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Cannot update batch")) {
        res.status(400).json({
          success: false,
          data: null,
          message: error.message,
        });
        return;
      }

      console.error("Error updating batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to update batch",
      });
    }
  });

  /**
   * DELETE /api/batches/:id - Delete a batch
   *
   * Response: { success: true }
   */
  router.delete("/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const deleted = deleteBatch(req.project!.db, id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      res.json({
        success: true,
        data: null,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Cannot delete batch")) {
        res.status(400).json({
          success: false,
          data: null,
          message: error.message,
        });
        return;
      }

      console.error("Error deleting batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete batch",
      });
    }
  });

  /**
   * POST /api/batches/:id/pr - Create GitHub PR for the batch
   *
   * Request body: { draft?: boolean }
   *
   * Response: { batch: PRBatch; pr_url: string }
   */
  router.post("/:id/pr", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { draft } = req.body;

      // Get the batch
      const batch = getEnrichedBatch(req.project!.db, id);
      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      // Check if PR already exists
      if (batch.pr_number) {
        res.status(400).json({
          success: false,
          data: null,
          message: `PR already exists for this batch: #${batch.pr_number}`,
        });
        return;
      }

      // Create the GitHub PR service
      const ghService = new GitHubPRService(req.project!.path);

      // Check gh availability
      const availability = await ghService.checkAvailability();
      if (!availability.available) {
        res.status(500).json({
          success: false,
          data: null,
          message: "GitHub CLI (gh) not available",
          error_data: availability.error,
        });
        return;
      }
      if (!availability.authenticated) {
        res.status(401).json({
          success: false,
          data: null,
          message: "GitHub CLI not authenticated. Please run 'gh auth login'",
        });
        return;
      }

      // Build PR body
      const prBody = buildPRBody(batch);

      // Create the PR
      // Note: This requires a branch to already exist with the batch changes
      // The actual branch creation would be handled by the dataplane adapter
      const branchName = `sudocode/batch-${id}`;

      try {
        const prResult = await ghService.createPR({
          title: batch.title,
          body: prBody,
          head: branchName,
          base: batch.target_branch,
          draft: draft !== false && batch.is_draft_pr,
        });

        // Update batch with PR info
        const updatedBatch = updateBatchPR(req.project!.db, id, {
          pr_number: prResult.pr_number,
          pr_url: prResult.pr_url,
          pr_status: draft !== false && batch.is_draft_pr ? "draft" : "open",
        });

        res.json({
          success: true,
          data: {
            batch: updatedBatch,
            pr_url: prResult.pr_url,
          },
        });
      } catch (error) {
        if (error instanceof GitHubPRError) {
          res.status(500).json({
            success: false,
            data: null,
            message: error.message,
            error_data: { code: error.code, details: error.details },
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error("Error creating PR for batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create PR for batch",
      });
    }
  });

  /**
   * POST /api/batches/:id/sync - Sync PR status from GitHub
   *
   * Response: { batch: PRBatch; status: BatchPRStatus }
   */
  router.post("/:id/sync", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const batch = getBatch(req.project!.db, id);
      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      if (!batch.pr_number) {
        res.status(400).json({
          success: false,
          data: null,
          message: "Batch has no associated PR",
        });
        return;
      }

      const ghService = new GitHubPRService(req.project!.path);
      const status = await ghService.getPRStatus(batch.pr_number);

      const updatedBatch = updateBatchStatus(req.project!.db, id, status);

      res.json({
        success: true,
        data: {
          batch: updatedBatch,
          status,
        },
      });
    } catch (error) {
      console.error("Error syncing batch PR status:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to sync PR status",
      });
    }
  });

  /**
   * GET /api/batches/:id/preview - Preview batch contents
   *
   * Response: BatchPreview
   */
  router.get("/:id/preview", (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const batch = getEnrichedBatch(req.project!.db, id);
      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      // Build preview
      const preview: BatchPreview = {
        dependency_order: batch.dependency_order,
        files: [], // Would need to aggregate from entries
        total_additions: batch.total_additions,
        total_deletions: batch.total_deletions,
        pr_body_preview: buildPRBody(batch),
      };

      res.json({
        success: true,
        data: preview,
      });
    } catch (error) {
      console.error("Error getting batch preview:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get batch preview",
      });
    }
  });

  /**
   * POST /api/batches/:id/promote - Promote batch entries to main branch
   *
   * Request body: { auto_merge?: boolean }
   *
   * Response: BatchPromoteResult
   */
  router.post("/:id/promote", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { auto_merge } = req.body;

      const batch = getEnrichedBatch(req.project!.db, id);
      if (!batch) {
        res.status(404).json({
          success: false,
          data: null,
          message: `Batch not found: ${id}`,
        });
        return;
      }

      // Promotion would involve merging each entry in dependency order
      // This is a placeholder - actual implementation would use the dataplane adapter
      const results = batch.dependency_order.map((entryId) => ({
        entry_id: entryId,
        success: true,
        error: undefined as string | undefined,
      }));

      // If auto_merge is true and we have a PR, merge it
      if (auto_merge && batch.pr_number) {
        try {
          const ghService = new GitHubPRService(req.project!.path);
          await ghService.mergePR(batch.pr_number, {
            strategy: batch.merge_strategy === "squash" ? "squash" : "merge",
            deleteSourceBranch: true,
          });

          updateBatchStatus(req.project!.db, id, "merged");
        } catch (error) {
          console.error("Failed to merge PR:", error);
        }
      }

      res.json({
        success: true,
        data: {
          success: results.every((r) => r.success),
          results,
          promoted_count: results.filter((r) => r.success).length,
          failed_count: results.filter((r) => !r.success).length,
        },
      });
    } catch (error) {
      console.error("Error promoting batch:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to promote batch",
      });
    }
  });

  /**
   * POST /api/batches/validate - Validate batch entries
   *
   * Request body: { entry_ids: string[] }
   *
   * Response: BatchValidationResult
   */
  router.post("/validate", (req: Request, res: Response) => {
    try {
      const { entry_ids } = req.body;

      if (!entry_ids || !Array.isArray(entry_ids)) {
        res.status(400).json({
          success: false,
          data: null,
          message: "entry_ids is required and must be an array",
        });
        return;
      }

      const result = validateBatchEntries(req.project!.db, entry_ids);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error validating batch entries:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to validate batch entries",
      });
    }
  });

  return router;
}

/**
 * Build PR body from batch data
 */
function buildPRBody(batch: {
  title: string;
  description?: string;
  entries: Array<{ issueId: string; issueTitle: string; status: string }>;
  dependency_order: string[];
  total_files: number;
  total_additions: number;
  total_deletions: number;
}): string {
  let body = `## PR Batch: ${batch.title}\n\n`;

  if (batch.description) {
    body += `${batch.description}\n\n`;
  }

  body += `### Issues Included\n\n`;
  body += `| Issue | Title | Status |\n`;
  body += `|-------|-------|--------|\n`;

  for (const entry of batch.entries) {
    body += `| ${entry.issueId} | ${entry.issueTitle} | ${entry.status} |\n`;
  }

  body += `\n### Merge Order\n\n`;
  body += `Changes will be merged in the following order to respect dependencies:\n`;

  batch.dependency_order.forEach((entryId, index) => {
    const entry = batch.entries.find((e) => e.issueId === entryId);
    body += `${index + 1}. ${entryId}${entry ? ` - ${entry.issueTitle}` : ""}\n`;
  });

  body += `\n### Changes Summary\n\n`;
  body += `- **Files changed:** ${batch.total_files}\n`;
  body += `- **Additions:** +${batch.total_additions}\n`;
  body += `- **Deletions:** -${batch.total_deletions}\n`;

  body += `\n---\n*Created by sudocode PR Batches*`;

  return body;
}
