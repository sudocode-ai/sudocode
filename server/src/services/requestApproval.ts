/**
 * Request Approval Service
 * Handles approval/rejection of cross-repo mutation requests
 */

import Database from "better-sqlite3";
import type { CrossRepoRequest, RequestStatus } from "../types/federation.js";

/**
 * Get a request by ID
 */
export function getRequest(
  db: Database.Database,
  requestId: string
): CrossRepoRequest | undefined {
  const request = db
    .prepare<[string]>(
      `
    SELECT * FROM cross_repo_requests WHERE request_id = ?
  `
    )
    .get(requestId) as any;

  if (!request) return undefined;

  return {
    ...request,
    requires_approval: Boolean(request.requires_approval),
  };
}

/**
 * List pending requests
 */
export function listPendingRequests(
  db: Database.Database,
  direction?: "incoming" | "outgoing"
): CrossRepoRequest[] {
  let query = `
    SELECT * FROM cross_repo_requests
    WHERE status = 'pending'
  `;
  const params: any[] = [];

  if (direction) {
    query += " AND direction = ?";
    params.push(direction);
  }

  query += " ORDER BY created_at DESC";

  const requests = db.prepare<any[]>(query).all(...params) as any[];

  return requests.map((req) => ({
    ...req,
    requires_approval: Boolean(req.requires_approval),
  }));
}

/**
 * List all requests with optional filters
 */
export function listRequests(
  db: Database.Database,
  filters?: {
    status?: RequestStatus;
    direction?: "incoming" | "outgoing";
    from_repo?: string;
    to_repo?: string;
    limit?: number;
  }
): CrossRepoRequest[] {
  let query = "SELECT * FROM cross_repo_requests";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters?.direction) {
    conditions.push("direction = ?");
    params.push(filters.direction);
  }

  if (filters?.from_repo) {
    conditions.push("from_repo = ?");
    params.push(filters.from_repo);
  }

  if (filters?.to_repo) {
    conditions.push("to_repo = ?");
    params.push(filters.to_repo);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY created_at DESC";

  if (filters?.limit) {
    query += " LIMIT ?";
    params.push(filters.limit);
  }

  const requests = db.prepare<any[]>(query).all(...params) as any[];

  return requests.map((req) => ({
    ...req,
    requires_approval: Boolean(req.requires_approval),
  }));
}

/**
 * Approve a request
 */
export function approveRequest(
  db: Database.Database,
  requestId: string,
  approver: string
): CrossRepoRequest {
  const request = getRequest(db, requestId);
  if (!request) {
    throw new Error(`Request ${requestId} not found`);
  }

  if (request.status !== "pending") {
    throw new Error(
      `Request ${requestId} is not pending (status: ${request.status})`
    );
  }

  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE cross_repo_requests
    SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?
    WHERE request_id = ?
  `
  ).run("approved", approver, now, now, requestId);

  return getRequest(db, requestId)!;
}

/**
 * Reject a request
 */
export function rejectRequest(
  db: Database.Database,
  requestId: string,
  reason: string
): CrossRepoRequest {
  const request = getRequest(db, requestId);
  if (!request) {
    throw new Error(`Request ${requestId} not found`);
  }

  if (request.status !== "pending") {
    throw new Error(
      `Request ${requestId} is not pending (status: ${request.status})`
    );
  }

  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE cross_repo_requests
    SET status = ?, rejection_reason = ?, updated_at = ?, completed_at = ?
    WHERE request_id = ?
  `
  ).run("rejected", reason, now, now, requestId);

  return getRequest(db, requestId)!;
}

/**
 * Mark request as completed
 */
export function completeRequest(
  db: Database.Database,
  requestId: string,
  result: any
): CrossRepoRequest {
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE cross_repo_requests
    SET status = ?, result = ?, updated_at = ?, completed_at = ?
    WHERE request_id = ?
  `
  ).run("completed", JSON.stringify(result), now, now, requestId);

  return getRequest(db, requestId)!;
}

/**
 * Mark request as failed
 */
export function failRequest(
  db: Database.Database,
  requestId: string,
  error: string
): CrossRepoRequest {
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE cross_repo_requests
    SET status = ?, result = ?, updated_at = ?, completed_at = ?
    WHERE request_id = ?
  `
  ).run("failed", JSON.stringify({ error }), now, now, requestId);

  return getRequest(db, requestId)!;
}

/**
 * Execute approved request (create issue or spec)
 */
export async function executeApprovedRequest(
  db: Database.Database,
  requestId: string
): Promise<{ id: string; uuid: string; canonical_ref: string }> {
  const request = getRequest(db, requestId);
  if (!request) {
    throw new Error(`Request ${requestId} not found`);
  }

  if (request.status !== "approved") {
    throw new Error(`Request ${requestId} is not approved (status: ${request.status})`);
  }

  const data = JSON.parse(request.payload);

  // TODO: Actually create the issue/spec using the CLI operations
  // For now, return a mock result
  // This will be implemented when we integrate with the issue/spec services

  const mockId = `${request.request_type === "create_issue" ? "issue" : "spec"}-${Date.now()}`;
  const mockUuid = `uuid-${Date.now()}`;

  const result = {
    id: mockId,
    uuid: mockUuid,
    canonical_ref: `${request.to_repo}#${mockId}`,
    title: data.title,
  };

  completeRequest(db, requestId, result);

  return result;
}
