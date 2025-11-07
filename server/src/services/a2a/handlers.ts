/**
 * A2A Protocol Message Handlers
 * Handles incoming cross-repository communication messages
 */

import Database from "better-sqlite3";
import {
  A2ADiscoverMessage,
  A2ADiscoverResponse,
  A2AQueryMessage,
  A2AQueryResponse,
  A2AMutateMessage,
  A2AMutateResponse,
  A2ACapabilities,
  RemoteRepo,
  EntityType,
  CrossRepoRequest,
} from "../../types/federation.js";
import { createAuditLog } from "./audit.js";
import { evaluatePolicies, applyPolicyDecision, loadPolicies } from "../policyEngine.js";

/**
 * Handle discover message - return local capabilities
 */
export async function handleDiscover(
  db: Database.Database,
  message: A2ADiscoverMessage,
  localRepoUrl: string,
  restEndpoint: string
): Promise<A2ADiscoverResponse> {
  const startTime = Date.now();

  try {
    const capabilities: A2ACapabilities = {
      protocols: ["rest"],
      operations: [
        "query_specs",
        "query_issues",
        "create_issues",
        "create_specs",
      ],
      schemas_version: "1.0",
      endpoints: {
        rest: restEndpoint,
      },
    };

    const response: A2ADiscoverResponse = {
      type: "discover_response",
      from: localRepoUrl,
      to: message.from,
      timestamp: new Date().toISOString(),
      capabilities,
    };

    // Log successful discover
    await createAuditLog(db, {
      operation_type: "discover",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      payload: JSON.stringify(message),
      result: JSON.stringify(response),
      status: "success",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    return response;
  } catch (error) {
    // Log failed discover
    await createAuditLog(db, {
      operation_type: "discover",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      payload: JSON.stringify(message),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    throw error;
  }
}

/**
 * Handle query message - return matching issues/specs
 */
export async function handleQuery(
  db: Database.Database,
  message: A2AQueryMessage,
  localRepoUrl: string
): Promise<A2AQueryResponse> {
  const startTime = Date.now();

  try {
    // Check if remote repo is allowed to query
    const remoteRepo = db
      .prepare<[string]>(
        `
      SELECT * FROM remote_repos WHERE url = ?
    `
      )
      .get(message.from) as RemoteRepo | undefined;

    if (!remoteRepo) {
      throw new Error(`Remote repository ${message.from} is not configured`);
    }

    if (remoteRepo.trust_level === "untrusted") {
      throw new Error(
        `Remote repository ${message.from} is untrusted and cannot query`
      );
    }

    const { entity, filters = {}, limit = 50, offset = 0 } = message.query;

    // Build query based on entity type
    const results = queryEntities(db, entity, filters, limit, offset);

    const response: A2AQueryResponse = {
      type: "query_response",
      from: localRepoUrl,
      to: message.from,
      timestamp: new Date().toISOString(),
      results,
      metadata: {
        total: results.length,
        limit,
        offset,
        cached_at: new Date().toISOString(),
      },
    };

    // Log successful query
    await createAuditLog(db, {
      operation_type: "query",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      payload: JSON.stringify(message),
      result: JSON.stringify({ count: results.length }),
      status: "success",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    return response;
  } catch (error) {
    // Log failed query
    await createAuditLog(db, {
      operation_type: "query",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      payload: JSON.stringify(message),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    throw error;
  }
}

/**
 * Query entities from database
 */
function queryEntities(
  db: Database.Database,
  entityType: EntityType,
  filters: any,
  limit: number,
  offset: number
): any[] {
  const tableName = entityType === "issue" ? "issues" : "specs";

  // Build WHERE clause
  const conditions: string[] = ["archived = 0"]; // Don't return archived entities
  const params: any[] = [];

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => "?").join(",");
      conditions.push(`status IN (${placeholders})`);
      params.push(...filters.status);
    } else {
      conditions.push("status = ?");
      params.push(filters.status);
    }
  }

  if (filters.priority !== undefined) {
    if (Array.isArray(filters.priority)) {
      const placeholders = filters.priority.map(() => "?").join(",");
      conditions.push(`priority IN (${placeholders})`);
      params.push(...filters.priority);
    } else {
      conditions.push("priority = ?");
      params.push(filters.priority);
    }
  }

  if (filters.assignee) {
    conditions.push("assignee = ?");
    params.push(filters.assignee);
  }

  // Add limit and offset
  params.push(limit, offset);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT *
    FROM ${tableName}
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return db.prepare(query).all(...params) as any[];
}

/**
 * Handle mutate message - create/update entities
 */
export async function handleMutate(
  db: Database.Database,
  message: A2AMutateMessage,
  localRepoUrl: string
): Promise<A2AMutateResponse> {
  const startTime = Date.now();

  try {
    // Check if remote repo is allowed to mutate
    const remoteRepo = db
      .prepare<[string]>(
        `
      SELECT * FROM remote_repos WHERE url = ?
    `
      )
      .get(message.from) as RemoteRepo | undefined;

    if (!remoteRepo) {
      throw new Error(`Remote repository ${message.from} is not configured`);
    }

    if (remoteRepo.trust_level === "untrusted") {
      const response: A2AMutateResponse = {
        type: "mutate_response",
        from: localRepoUrl,
        to: message.from,
        timestamp: new Date().toISOString(),
        status: "rejected",
        request_id: message.metadata?.request_id || `req-${Date.now()}`,
        message: "Remote repository is untrusted and cannot create entities",
      };

      return response;
    }

    // Create request record
    const requestId = message.metadata?.request_id || `req-${Date.now()}`;

    db.prepare(
      `
      INSERT INTO cross_repo_requests (
        request_id, direction, from_repo, to_repo,
        request_type, payload, status,
        requires_approval, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      requestId,
      "incoming",
      message.from,
      localRepoUrl,
      message.operation,
      JSON.stringify(message.data),
      "pending",
      1, // Requires approval by default
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Evaluate policies for auto-approval
    const request = db.prepare("SELECT * FROM cross_repo_requests WHERE request_id = ?").get(requestId) as CrossRepoRequest;
    const policies = loadPolicies(db);
    const policyDecision = evaluatePolicies(db, request, policies);

    // Apply policy decision
    await applyPolicyDecision(db, requestId, policyDecision);

    let response: A2AMutateResponse;

    if (policyDecision.decision === "approve") {
      response = {
        type: "mutate_response",
        from: localRepoUrl,
        to: message.from,
        timestamp: new Date().toISOString(),
        status: "completed",
        request_id: requestId,
        message: `Auto-approved: ${policyDecision.reason}`,
      };
    } else if (policyDecision.decision === "reject") {
      response = {
        type: "mutate_response",
        from: localRepoUrl,
        to: message.from,
        timestamp: new Date().toISOString(),
        status: "rejected",
        request_id: requestId,
        message: `Auto-rejected: ${policyDecision.reason}`,
      };
    } else {
      response = {
        type: "mutate_response",
        from: localRepoUrl,
        to: message.from,
        timestamp: new Date().toISOString(),
        status: "pending_approval",
        request_id: requestId,
        message: `Request queued for approval: ${policyDecision.reason}`,
      };
    }

    // Log successful request creation
    await createAuditLog(db, {
      operation_type: "mutate",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      request_id: requestId,
      payload: JSON.stringify(message),
      result: JSON.stringify(response),
      status: "success",
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    return response;
  } catch (error) {
    const requestId = message.metadata?.request_id || `req-${Date.now()}`;

    // Log failed mutation
    await createAuditLog(db, {
      operation_type: "mutate",
      direction: "incoming",
      local_repo: localRepoUrl,
      remote_repo: message.from,
      request_id: requestId,
      payload: JSON.stringify(message),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    throw error;
  }
}

/**
 * Check if request should be auto-approved based on policies
 * TODO: Implement policy engine
 * @param remoteRepo - Remote repository configuration
 * @param _requestType - Type of request (unused for now)
 * @param data - Request data
 */
export function shouldAutoApprove(
  remoteRepo: RemoteRepo,
  _requestType: string,
  data: any
): boolean {
  // For now, only trusted repos with low priority can be auto-approved
  if (remoteRepo.trust_level === "trusted") {
    // Auto-approve low priority items (priority >= 2)
    if (data.priority !== undefined && data.priority >= 2) {
      return true;
    }
  }

  return false;
}
