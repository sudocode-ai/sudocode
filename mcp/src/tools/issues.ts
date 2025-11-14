/**
 * MCP tools for issue management
 */

import { SudocodeClient } from "../client.js";
import { Issue, IssueStatus } from "../types.js";

// Tool parameter types
export interface ReadyParams {}

export interface ListIssuesParams {
  status?: IssueStatus;
  priority?: number;
  limit?: number;
  search?: string;
  archived?: boolean;
}

export interface ShowIssueParams {
  issue_id: string;
}

export interface UpsertIssueParams {
  issue_id?: string; // If provided, update; otherwise create
  title?: string; // Required for create, optional for update
  description?: string;
  priority?: number;
  parent?: string;
  tags?: string[];
  status?: IssueStatus;
  archived?: boolean;
  // TODO: Reintroduce assignee later on when first-class agents are supported.
}

// Tool implementations

/**
 * Find issues ready to work on (no blockers) and get project status
 */
export async function ready(
  client: SudocodeClient,
  params: ReadyParams = {}
): Promise<any> {
  const readyResult = await client.exec(["ready"]);
  const statusResult = await client.exec(["status"]);

  // Redact content field from issues to keep response shorter
  if (readyResult.issues && Array.isArray(readyResult.issues)) {
    readyResult.issues = readyResult.issues.map((issue: any) => {
      const { content, ...rest } = issue;
      return rest;
    });
  }

  return {
    ready: readyResult,
    status: statusResult,
  };
}

/**
 * List all issues with optional filters
 */
export async function listIssues(
  client: SudocodeClient,
  params: ListIssuesParams = {}
): Promise<Issue[]> {
  const args = ["issue", "list"];

  if (params.status) {
    args.push("--status", params.status);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }
  if (params.search) {
    args.push("--grep", params.search);
  }
  // Default to excluding archived unless explicitly specified
  const archived = params.archived !== undefined ? params.archived : false;
  args.push("--archived", archived.toString());

  const issues = await client.exec(args);

  // Redact content field from issues to keep response shorter
  if (Array.isArray(issues)) {
    return issues.map((issue: any) => {
      const { content, ...rest } = issue;
      return rest;
    });
  }

  return issues;
}

/**
 * Show detailed issue information including relationships and feedback
 */
export async function showIssue(
  client: SudocodeClient,
  params: ShowIssueParams
): Promise<any> {
  const args = ["issue", "show", params.issue_id];
  return client.exec(args);
}

/**
 * Upsert an issue (create if no issue_id, update if issue_id provided)
 */
export async function upsertIssue(
  client: SudocodeClient,
  params: UpsertIssueParams
): Promise<Issue> {
  const isUpdate = !!params.issue_id;

  if (isUpdate) {
    // Update mode
    const args = ["issue", "update", params.issue_id!];

    if (params.status) {
      args.push("--status", params.status);
    }
    if (params.priority !== undefined) {
      args.push("--priority", params.priority.toString());
    }
    if (params.title) {
      args.push("--title", params.title);
    }
    if (params.description) {
      args.push("--description", params.description);
    }
    if (params.archived !== undefined) {
      args.push("--archived", params.archived.toString());
    }

    return await client.exec(args);
  } else {
    // Create mode
    if (!params.title) {
      throw new Error("title is required when creating a new issue");
    }

    const args = ["issue", "create", params.title];

    if (params.description) {
      args.push("--description", params.description);
    }
    if (params.priority !== undefined) {
      args.push("--priority", params.priority.toString());
    }
    if (params.parent) {
      args.push("--parent", params.parent);
    }
    if (params.tags && params.tags.length > 0) {
      args.push("--tags", params.tags.join(","));
    }

    return await client.exec(args);
  }
}
