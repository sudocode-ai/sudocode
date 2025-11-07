/**
 * Policy engine for automatic request approval
 *
 * Evaluates incoming cross-repo requests against configured policies
 * and automatically approves/rejects based on rules.
 */

import type Database from "better-sqlite3";
import { getRemoteRepo } from "./remoteRepo.js";
import { createAuditLog } from "./a2a/audit.js";
import type { CrossRepoRequest } from "../types/federation.js";

export interface Policy {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number; // Lower number = higher priority
  conditions: PolicyCondition[];
  action: "approve" | "reject" | "require_approval";
  reason?: string;
}

export interface PolicyCondition {
  field: PolicyField;
  operator: PolicyOperator;
  value: any;
}

export type PolicyField =
  | "remote_repo"
  | "trust_level"
  | "request_type"
  | "entity_type"
  | "operation"
  | "priority"
  | "created_by";

export type PolicyOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in";

export interface PolicyEvaluationResult {
  decision: "approve" | "reject" | "require_approval";
  matchedPolicy?: Policy;
  reason: string;
}

export interface PolicyContext {
  request: CrossRepoRequest;
  remoteRepoTrustLevel?: string;
  operation?: string;
  entityType?: string;
  priority?: number;
}

/**
 * Default policies for common scenarios
 */
export const DEFAULT_POLICIES: Policy[] = [
  {
    id: "default-trusted-repos",
    name: "Auto-approve trusted repositories",
    description: "Automatically approve all requests from trusted repositories",
    enabled: true,
    priority: 10,
    conditions: [
      { field: "trust_level", operator: "equals", value: "trusted" },
    ],
    action: "approve",
    reason: "Request from trusted repository",
  },
  {
    id: "default-verified-query",
    name: "Auto-approve queries from verified repos",
    description:
      "Automatically approve query operations from verified repositories",
    enabled: true,
    priority: 20,
    conditions: [
      { field: "trust_level", operator: "equals", value: "verified" },
      { field: "operation", operator: "equals", value: "query" },
    ],
    action: "approve",
    reason: "Query from verified repository",
  },
  {
    id: "default-untrusted-require",
    name: "Require approval for untrusted repos",
    description: "Require manual approval for all requests from untrusted repos",
    enabled: true,
    priority: 100,
    conditions: [
      { field: "trust_level", operator: "equals", value: "untrusted" },
    ],
    action: "require_approval",
    reason: "Request from untrusted repository requires manual approval",
  },
];

/**
 * Evaluate a condition against context
 */
function evaluateCondition(
  condition: PolicyCondition,
  context: PolicyContext
): boolean {
  let fieldValue: any;

  // Get field value from context
  switch (condition.field) {
    case "remote_repo":
      fieldValue = context.request.from_repo;
      break;
    case "trust_level":
      fieldValue = context.remoteRepoTrustLevel;
      break;
    case "request_type":
      fieldValue = context.request.request_type;
      break;
    case "entity_type":
      fieldValue = context.entityType;
      break;
    case "operation":
      fieldValue = context.operation;
      break;
    case "priority":
      fieldValue = context.priority;
      break;
    case "created_by":
      fieldValue = context.request.from_repo; // Using from_repo as created_by
      break;
    default:
      return false;
  }

  // Evaluate operator
  switch (condition.operator) {
    case "equals":
      return fieldValue === condition.value;
    case "not_equals":
      return fieldValue !== condition.value;
    case "contains":
      return (
        typeof fieldValue === "string" &&
        fieldValue.includes(condition.value)
      );
    case "not_contains":
      return (
        typeof fieldValue === "string" &&
        !fieldValue.includes(condition.value)
      );
    case "greater_than":
      return Number(fieldValue) > Number(condition.value);
    case "less_than":
      return Number(fieldValue) < Number(condition.value);
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case "not_in":
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
    default:
      return false;
  }
}

/**
 * Evaluate a policy against context
 */
function evaluatePolicy(policy: Policy, context: PolicyContext): boolean {
  if (!policy.enabled) {
    return false;
  }

  // All conditions must be true (AND logic)
  return policy.conditions.every((condition) =>
    evaluateCondition(condition, context)
  );
}

/**
 * Evaluate request against all policies
 */
export function evaluatePolicies(
  db: Database.Database,
  request: CrossRepoRequest,
  policies: Policy[] = DEFAULT_POLICIES
): PolicyEvaluationResult {
  // Build context for evaluation
  const remote = getRemoteRepo(db, request.from_repo);

  // Parse request payload to extract details
  let payload: any = {};
  try {
    payload = JSON.parse(request.payload);
  } catch (e) {
    // Ignore parse errors
  }

  // Extract operation and entity type from request_type (e.g., "create_issue" -> "create", "issue")
  const [operation, entityType] = request.request_type.split("_");

  const context: PolicyContext = {
    request,
    remoteRepoTrustLevel: remote?.trust_level,
    operation,
    entityType,
    priority: payload.priority,
  };

  // Sort policies by priority (lower number = higher priority)
  const sortedPolicies = [...policies].sort((a, b) => a.priority - b.priority);

  // Evaluate policies in priority order
  for (const policy of sortedPolicies) {
    if (evaluatePolicy(policy, context)) {
      return {
        decision: policy.action,
        matchedPolicy: policy,
        reason: policy.reason || `Matched policy: ${policy.name}`,
      };
    }
  }

  // Default: require manual approval if no policy matches
  return {
    decision: "require_approval",
    reason: "No matching policy found - requires manual approval",
  };
}

/**
 * Apply policy decision to a request
 */
export async function applyPolicyDecision(
  db: Database.Database,
  requestId: string,
  decision: PolicyEvaluationResult
): Promise<void> {
  const now = new Date().toISOString();

  if (decision.decision === "approve") {
    // Auto-approve the request
    db.prepare(`
      UPDATE cross_repo_requests
      SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE request_id = ?
    `).run("approved", "policy-engine", now, now, requestId);

    // Log the decision
    const request = db.prepare("SELECT from_repo, to_repo FROM cross_repo_requests WHERE request_id = ?").get(requestId) as any;
    await createAuditLog(db, {
      operation_type: "auto_approve",
      direction: "incoming",
      local_repo: request.to_repo,
      remote_repo: request.from_repo,
      request_id: requestId,
      status: "success",
      timestamp: now,
    });
  } else if (decision.decision === "reject") {
    // Auto-reject the request
    db.prepare(`
      UPDATE cross_repo_requests
      SET status = ?, rejection_reason = ?, completed_at = ?, updated_at = ?
      WHERE request_id = ?
    `).run("rejected", decision.reason, now, now, requestId);

    // Log the decision
    const request = db.prepare("SELECT from_repo, to_repo FROM cross_repo_requests WHERE request_id = ?").get(requestId) as any;
    await createAuditLog(db, {
      operation_type: "auto_reject",
      direction: "incoming",
      local_repo: request.to_repo,
      remote_repo: request.from_repo,
      request_id: requestId,
      status: "success",
      timestamp: now,
    });
  }
  // If "require_approval", do nothing - leave as pending
}

/**
 * Load policies from database or config
 */
export function loadPolicies(_db: Database.Database): Policy[] {
  // For now, return default policies
  // In the future, this could load from a policies table
  return DEFAULT_POLICIES;
}

/**
 * Save policies to database
 */
export function savePolicies(_db: Database.Database, _policies: Policy[]): void {
  // TODO: Implement policy storage in database
  // For now, policies are in-memory only
}

/**
 * Validate a policy
 */
export function validatePolicy(policy: Policy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!policy.id) {
    errors.push("Policy ID is required");
  }

  if (!policy.name) {
    errors.push("Policy name is required");
  }

  if (!["approve", "reject", "require_approval"].includes(policy.action)) {
    errors.push("Invalid action - must be approve, reject, or require_approval");
  }

  if (!Array.isArray(policy.conditions) || policy.conditions.length === 0) {
    errors.push("At least one condition is required");
  }

  for (const condition of policy.conditions) {
    if (!["remote_repo", "trust_level", "request_type", "entity_type", "operation", "priority", "created_by"].includes(condition.field)) {
      errors.push(`Invalid field: ${condition.field}`);
    }

    if (!["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "in", "not_in"].includes(condition.operator)) {
      errors.push(`Invalid operator: ${condition.operator}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
