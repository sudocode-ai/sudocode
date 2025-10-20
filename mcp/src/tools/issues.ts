/**
 * MCP tools for issue management
 */

import { SudocodeClient } from "../client.js";
import { Issue, IssueStatus, IssueType } from "../types.js";

// Tool parameter types
export interface ReadyParams {
  limit?: number;
  priority?: number;
  assignee?: string;
  show_specs?: boolean;
  show_issues?: boolean;
}

export interface ListIssuesParams {
  status?: IssueStatus;
  type?: IssueType;
  priority?: number;
  assignee?: string;
  limit?: number;
}

export interface ShowIssueParams {
  issue_id: string;
}

export interface CreateIssueParams {
  title: string;
  description?: string;
  type?: IssueType;
  priority?: number;
  assignee?: string;
  parent?: string;
  tags?: string[];
  estimate?: number;
}

export interface UpdateIssueParams {
  issue_id: string;
  status?: IssueStatus;
  priority?: number;
  assignee?: string;
  type?: IssueType;
  title?: string;
  description?: string;
}

export interface CloseIssueParams {
  issue_ids: string[];
  reason?: string;
}

export interface BlockedIssuesParams {
  show_specs?: boolean;
  show_issues?: boolean;
}

// Tool implementations

/**
 * Find issues and specs ready to work on (no blockers)
 */
export async function ready(
  client: SudocodeClient,
  params: ReadyParams = {}
): Promise<any> {
  const args = ["ready"];

  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.assignee) {
    args.push("--assignee", params.assignee);
  }
  if (params.show_specs) {
    args.push("--specs");
  }
  if (params.show_issues !== false) {
    args.push("--issues");
  }

  return client.exec(args);
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
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.assignee) {
    args.push("--assignee", params.assignee);
  }
  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }

  return client.exec(args);
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
 * Create a new issue
 */
export async function createIssue(
  client: SudocodeClient,
  params: CreateIssueParams
): Promise<Issue> {
  const args = ["issue", "create", params.title];

  if (params.description) {
    args.push("--description", params.description);
  }
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.assignee) {
    args.push("--assignee", params.assignee);
  }
  if (params.parent) {
    args.push("--parent", params.parent);
  }
  if (params.tags && params.tags.length > 0) {
    args.push("--tags", params.tags.join(","));
  }
  if (params.estimate !== undefined) {
    args.push("--estimate", params.estimate.toString());
  }

  return client.exec(args);
}

/**
 * Update an existing issue
 */
export async function updateIssue(
  client: SudocodeClient,
  params: UpdateIssueParams
): Promise<Issue> {
  const args = ["issue", "update", params.issue_id];

  if (params.status) {
    args.push("--status", params.status);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.assignee) {
    args.push("--assignee", params.assignee);
  }
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.title) {
    args.push("--title", params.title);
  }
  if (params.description) {
    args.push("--description", params.description);
  }

  return client.exec(args);
}

/**
 * Close one or more issues
 */
export async function closeIssue(
  client: SudocodeClient,
  params: CloseIssueParams
): Promise<any[]> {
  const args = ["issue", "close", ...params.issue_ids];

  if (params.reason) {
    args.push("--reason", params.reason);
  }

  return client.exec(args);
}

/**
 * Get blocked issues showing what's blocking them
 */
export async function blockedIssues(
  client: SudocodeClient,
  params: BlockedIssuesParams = {}
): Promise<any> {
  const args = ["blocked"];

  if (params.show_specs) {
    args.push("--specs");
  }
  if (params.show_issues !== false) {
    args.push("--issues");
  }

  return client.exec(args);
}
