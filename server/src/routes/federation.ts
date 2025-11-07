/**
 * Federation API Routes
 * Handles cross-repository communication via A2A protocol
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  handleDiscover,
  handleQuery,
  handleMutate,
} from "../services/a2a/handlers.js";
import {
  getAuditLogs,
  getAuditStats,
} from "../services/a2a/audit.js";
import { createA2AClient } from "../services/a2a/client.js";
import {
  addRemoteRepo,
  getRemoteRepo,
  listRemoteRepos,
  updateRemoteRepo,
  removeRemoteRepo,
} from "../services/remoteRepo.js";
import {
  listPendingRequests,
  listRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  executeApprovedRequest,
} from "../services/requestApproval.js";
import type {
  A2ADiscoverMessage,
  A2AQueryMessage,
  A2AMutateMessage,
  TrustLevel,
} from "../types/federation.js";

/**
 * Create federation router
 */
export function createFederationRouter(
  db: Database.Database,
  localRepoUrl: string,
  restEndpoint: string
): Router {
  const router = Router();

  // Middleware to parse JSON
  router.use((req, res, next) => {
    if (req.is("application/json")) {
      next();
    } else {
      res.status(415).json({
        type: "https://sudocode.dev/errors/unsupported-media-type",
        title: "Unsupported Media Type",
        status: 415,
        detail: "Content-Type must be application/json",
        instance: req.path,
      });
    }
  });

  /**
   * GET /api/v1/federation/info
   * Return local repository capabilities (discover)
   */
  router.get("/info", async (req: Request, res: Response) => {
    try {
      // For GET requests, create a minimal discover message
      const message: A2ADiscoverMessage = {
        type: "discover",
        from: req.query.from as string || "unknown",
        to: localRepoUrl,
        timestamp: new Date().toISOString(),
      };

      const response = await handleDiscover(
        db,
        message,
        localRepoUrl,
        restEndpoint
      );

      res.json(response);
    } catch (error) {
      console.error("Federation discover error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * POST /api/v1/federation/info
   * Return local repository capabilities (discover) - A2A format
   */
  router.post("/info", async (req: Request, res: Response) => {
    try {
      const message = req.body as A2ADiscoverMessage;

      const response = await handleDiscover(
        db,
        message,
        localRepoUrl,
        restEndpoint
      );

      res.json(response);
    } catch (error) {
      console.error("Federation discover error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * POST /api/v1/federation/query
   * Query local issues/specs
   */
  router.post("/query", async (req: Request, res: Response) => {
    try {
      const message = req.body as A2AQueryMessage;

      const response = await handleQuery(db, message, localRepoUrl);

      res.json(response);
    } catch (error) {
      console.error("Federation query error:", error);

      if (
        error instanceof Error &&
        error.message.includes("not configured")
      ) {
        res.status(403).json({
          type: "https://sudocode.dev/errors/forbidden",
          title: "Forbidden",
          status: 403,
          detail: error.message,
          instance: req.path,
        });
      } else if (
        error instanceof Error &&
        error.message.includes("untrusted")
      ) {
        res.status(403).json({
          type: "https://sudocode.dev/errors/permission-denied",
          title: "Permission Denied",
          status: 403,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * POST /api/v1/federation/mutate
   * Request mutation (create issue/spec)
   */
  router.post("/mutate", async (req: Request, res: Response) => {
    try {
      const message = req.body as A2AMutateMessage;

      const response = await handleMutate(db, message, localRepoUrl);

      res.json(response);
    } catch (error) {
      console.error("Federation mutate error:", error);

      if (
        error instanceof Error &&
        error.message.includes("not configured")
      ) {
        res.status(403).json({
          type: "https://sudocode.dev/errors/forbidden",
          title: "Forbidden",
          status: 403,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * GET /api/v1/federation/requests
   * List pending requests
   */
  router.get("/requests", (req: Request, res: Response) => {
    try {
      const direction = req.query.direction as "incoming" | "outgoing" | undefined;
      const status = req.query.status as any;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const requests = status
        ? listRequests(db, { status, direction, limit })
        : listPendingRequests(db, direction);

      res.json({ requests });
    } catch (error) {
      console.error("List requests error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * GET /api/v1/federation/requests/:id
   * Get request details
   */
  router.get("/requests/:id", (req: Request, res: Response) => {
    try {
      const request = getRequest(db, req.params.id);

      if (!request) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: `Request ${req.params.id} not found`,
          instance: req.path,
        });
        return;
      }

      res.json(request);
    } catch (error) {
      console.error("Get request error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * POST /api/v1/federation/requests/:id/approve
   * Approve a pending request
   */
  router.post("/requests/:id/approve", async (req: Request, res: Response) => {
    try {
      const approver = req.body.approver || "system";

      const request = approveRequest(db, req.params.id, approver);

      // Execute the approved request
      const result = await executeApprovedRequest(db, req.params.id);

      res.json({
        request,
        result,
      });
    } catch (error) {
      console.error("Approve request error:", error);

      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: error.message,
          instance: req.path,
        });
      } else if (
        error instanceof Error &&
        error.message.includes("not pending")
      ) {
        res.status(400).json({
          type: "https://sudocode.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * POST /api/v1/federation/requests/:id/reject
   * Reject a pending request
   */
  router.post("/requests/:id/reject", (req: Request, res: Response) => {
    try {
      const reason = req.body.reason || "No reason provided";

      const request = rejectRequest(db, req.params.id, reason);

      res.json({ request });
    } catch (error) {
      console.error("Reject request error:", error);

      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: error.message,
          instance: req.path,
        });
      } else if (
        error instanceof Error &&
        error.message.includes("not pending")
      ) {
        res.status(400).json({
          type: "https://sudocode.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * Remote Repository Management
   */

  /**
   * GET /api/v1/federation/remotes
   * List all remote repositories
   */
  router.get("/remotes", (req: Request, res: Response) => {
    try {
      const trust_level = req.query.trust_level as TrustLevel | undefined;
      const sync_status = req.query.sync_status as string | undefined;

      const remotes = listRemoteRepos(db, {
        trust_level,
        sync_status,
      });

      res.json({ remotes });
    } catch (error) {
      console.error("List remotes error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * POST /api/v1/federation/remotes
   * Add a new remote repository
   */
  router.post("/remotes", (req: Request, res: Response) => {
    try {
      const {
        url,
        display_name,
        description,
        trust_level = "untrusted",
        rest_endpoint,
        ws_endpoint,
        git_url,
        auto_sync = false,
        sync_interval_minutes = 60,
        added_by = "system",
      } = req.body;

      if (!url || !display_name) {
        res.status(400).json({
          type: "https://sudocode.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: "url and display_name are required",
          instance: req.path,
        });
        return;
      }

      const remote = addRemoteRepo(db, {
        url,
        display_name,
        description,
        trust_level,
        rest_endpoint,
        ws_endpoint,
        git_url,
        auto_sync,
        sync_interval_minutes,
        added_by,
      });

      res.status(201).json(remote);
    } catch (error) {
      console.error("Add remote error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * GET /api/v1/federation/remotes/:url
   * Get a specific remote repository
   */
  router.get("/remotes/:url(*)", (req: Request, res: Response) => {
    try {
      const url = req.params.url;
      const remote = getRemoteRepo(db, url);

      if (!remote) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: `Remote repository ${url} not found`,
          instance: req.path,
        });
        return;
      }

      res.json(remote);
    } catch (error) {
      console.error("Get remote error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * PUT /api/v1/federation/remotes/:url
   * Update a remote repository
   */
  router.put("/remotes/:url(*)", (req: Request, res: Response) => {
    try {
      const url = req.params.url;
      const updates = req.body;

      const remote = updateRemoteRepo(db, url, updates);

      if (!remote) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: `Remote repository ${url} not found`,
          instance: req.path,
        });
        return;
      }

      res.json(remote);
    } catch (error) {
      console.error("Update remote error:", error);

      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * DELETE /api/v1/federation/remotes/:url
   * Remove a remote repository
   */
  router.delete("/remotes/:url(*)", (req: Request, res: Response) => {
    try {
      const url = req.params.url;
      const removed = removeRemoteRepo(db, url);

      if (!removed) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: `Remote repository ${url} not found`,
          instance: req.path,
        });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Remove remote error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * POST /api/v1/federation/remotes/:url/discover
   * Discover capabilities of a remote repository
   */
  router.post("/remotes/:url(*)/discover", async (req: Request, res: Response) => {
    try {
      const url = req.params.url;
      const client = createA2AClient(db, localRepoUrl);

      const response = await client.discover(url);

      res.json(response);
    } catch (error) {
      console.error("Discover remote error:", error);

      if (error instanceof Error && error.message.includes("not configured")) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: error.message,
          instance: req.path,
        });
      } else if (error instanceof Error && error.message.includes("unreachable")) {
        res.status(503).json({
          type: "https://sudocode.dev/errors/service-unavailable",
          title: "Service Unavailable",
          status: 503,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * POST /api/v1/federation/remotes/:url/query
   * Query a remote repository
   */
  router.post("/remotes/:url(*)/query", async (req: Request, res: Response) => {
    try {
      const url = req.params.url;
      const client = createA2AClient(db, localRepoUrl);

      const response = await client.query(url, {
        query: req.body,
      });

      res.json(response);
    } catch (error) {
      console.error("Query remote error:", error);

      if (error instanceof Error && error.message.includes("not configured")) {
        res.status(404).json({
          type: "https://sudocode.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: error.message,
          instance: req.path,
        });
      } else if (error instanceof Error && error.message.includes("unreachable")) {
        res.status(503).json({
          type: "https://sudocode.dev/errors/service-unavailable",
          title: "Service Unavailable",
          status: 503,
          detail: error.message,
          instance: req.path,
        });
      } else {
        res.status(500).json({
          type: "https://sudocode.dev/errors/internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: error instanceof Error ? error.message : String(error),
          instance: req.path,
        });
      }
    }
  });

  /**
   * Audit Logs
   */

  /**
   * GET /api/v1/federation/audit
   * Get audit logs
   */
  router.get("/audit", (req: Request, res: Response) => {
    try {
      const remote_repo = req.query.remote_repo as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const logs = remote_repo
        ? getAuditLogs(db, remote_repo, limit)
        : db.prepare(`SELECT * FROM cross_repo_audit_log ORDER BY timestamp DESC LIMIT ?`).all(limit);

      res.json({ logs });
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  /**
   * GET /api/v1/federation/audit/stats
   * Get audit statistics
   */
  router.get("/audit/stats", (req: Request, res: Response) => {
    try {
      const remote_repo = req.query.remote_repo as string | undefined;
      const since = req.query.since as string | undefined;

      const stats = getAuditStats(db, remote_repo, since);

      res.json(stats);
    } catch (error) {
      console.error("Get audit stats error:", error);
      res.status(500).json({
        type: "https://sudocode.dev/errors/internal-error",
        title: "Internal Server Error",
        status: 500,
        detail: error instanceof Error ? error.message : String(error),
        instance: req.path,
      });
    }
  });

  return router;
}
