import { Request, Response, NextFunction } from "express";
import type { ProjectManager } from "../services/project-manager.js";
import type { ProjectContext } from "../services/project-context.js";

/**
 * Extend Express Request type to include project context
 */
declare global {
  namespace Express {
    interface Request {
      project?: ProjectContext;
    }
  }
}

/**
 * Middleware to extract and inject project context from X-Project-ID header or projectId query parameter
 *
 * Supports both header-based (for regular API calls) and query parameter-based (for SSE connections)
 * project identification. Query parameter support is necessary for SSE since EventSource cannot
 * send custom headers.
 *
 * Usage:
 *   app.use('/api/specs', requireProject(projectManager), specsRouter)
 *
 * Error Responses:
 *   - 400: Missing X-Project-ID header or projectId query parameter
 *   - 404: Project not found or not open
 */
export function requireProject(projectManager: ProjectManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Extract X-Project-ID header (case-insensitive) or projectId query parameter
    // Query parameter is used for SSE connections since EventSource cannot send custom headers
    const headerProjectId =
      req.get("X-Project-ID") ||
      req.get("x-project-id") ||
      req.headers["x-project-id"];

    const queryProjectId = req.query.projectId;

    const projectId = headerProjectId || queryProjectId;

    // Validate header/query param presence
    if (!projectId) {
      res.status(400).json({
        error: "Missing X-Project-ID header or projectId query parameter",
        message:
          "All API requests must include an X-Project-ID header or projectId query parameter",
      });
      return;
    }

    // Ensure projectId is a string (could be string[] from headers or complex from query)
    let id: string;
    if (Array.isArray(projectId)) {
      id = projectId[0] as string;
    } else if (typeof projectId === "string") {
      id = projectId;
    } else {
      // Handle ParsedQs type from query parameters
      id = String(projectId);
    }

    // Lookup project in manager
    const project = projectManager.getProject(id);

    if (!project) {
      console.error(`[requireProject] Project not found or not open: ${id}`);
      console.error(
        `[requireProject] Available projects:`,
        projectManager.getAllOpenProjects().map((p: any) => p.id)
      );
      res.status(404).json({
        error: "Project not found",
        message: `Project ${id} is not open. Please open the project first.`,
        projectId: id,
      });
      return;
    }

    // Inject project context into request
    req.project = project;

    // Continue to next middleware/route handler
    next();
  };
}

/**
 * Optional middleware that injects project context if X-Project-ID header is present,
 * but does not require it. Useful for routes that can work with or without a project.
 *
 * Usage:
 *   app.use('/api/projects', optionalProject(projectManager), projectsRouter)
 */
export function optionalProject(projectManager: ProjectManager) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Extract X-Project-ID header (case-insensitive)
    const projectId =
      req.get("X-Project-ID") ||
      req.get("x-project-id") ||
      req.headers["x-project-id"];

    // If no header, continue without injecting project
    if (!projectId) {
      next();
      return;
    }

    // Ensure projectId is a string
    const id = Array.isArray(projectId) ? projectId[0] : projectId;

    // Lookup project in manager
    const project = projectManager.getProject(id);

    // Inject if found, but don't error if not
    if (project) {
      req.project = project;
    }

    next();
  };
}
