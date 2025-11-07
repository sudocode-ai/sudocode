/**
 * Unit tests for policy engine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../src/services/db.js";
import {
  evaluatePolicies,
  applyPolicyDecision,
  validatePolicy,
  DEFAULT_POLICIES,
  type Policy,
} from "../../../src/services/policyEngine.js";
import type { CrossRepoRequest } from "../../../src/types/federation.js";
import type Database from "better-sqlite3";

describe("Policy Engine", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Add test remote repos
    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/trusted/repo", "Trusted Repo", "trusted", "http://test.com", "2025-01-01", "test", 0, 60, "unknown");

    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/verified/repo", "Verified Repo", "verified", "http://test.com", "2025-01-01", "test", 0, 60, "unknown");

    db.prepare(`
      INSERT INTO remote_repos (url, display_name, trust_level, rest_endpoint, added_at, added_by, auto_sync, sync_interval_minutes, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("github.com/untrusted/repo", "Untrusted Repo", "untrusted", "http://test.com", "2025-01-01", "test", 0, 60, "unknown");
  });

  describe("evaluatePolicies", () => {
    it("should auto-approve requests from trusted repos", () => {
      const request: CrossRepoRequest = {
        request_id: "req-1",
        direction: "incoming",
        from_repo: "github.com/trusted/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({ title: "Test", priority: 2 }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request);

      expect(result.decision).toBe("approve");
      expect(result.reason).toContain("trusted");
      expect(result.matchedPolicy?.id).toBe("default-trusted-repos");
    });

    it("should auto-approve queries from verified repos", () => {
      const request: CrossRepoRequest = {
        request_id: "req-2",
        direction: "incoming",
        from_repo: "github.com/verified/repo",
        to_repo: "local",
        request_type: "query_issue",
        payload: JSON.stringify({ filters: {} }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request);

      expect(result.decision).toBe("approve");
      expect(result.reason).toContain("verified");
      expect(result.matchedPolicy?.id).toBe("default-verified-query");
    });

    it("should require approval for untrusted repos", () => {
      const request: CrossRepoRequest = {
        request_id: "req-3",
        direction: "incoming",
        from_repo: "github.com/untrusted/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({ title: "Test" }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request);

      expect(result.decision).toBe("require_approval");
      expect(result.reason).toContain("untrusted");
      expect(result.matchedPolicy?.id).toBe("default-untrusted-require");
    });

    it("should require approval for verified repos with mutations", () => {
      const request: CrossRepoRequest = {
        request_id: "req-4",
        direction: "incoming",
        from_repo: "github.com/verified/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({ title: "Test" }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request);

      // Should not match verified-query policy (operation is "create", not "query")
      // Should fall through to require_approval
      expect(result.decision).toBe("require_approval");
    });

    it("should respect policy priority order", () => {
      const customPolicies: Policy[] = [
        {
          id: "high-priority",
          name: "High Priority",
          enabled: true,
          priority: 1,
          conditions: [
            { field: "request_type", operator: "contains", value: "create" },
          ],
          action: "reject",
          reason: "High priority rejection",
        },
        {
          id: "low-priority",
          name: "Low Priority",
          enabled: true,
          priority: 100,
          conditions: [
            { field: "request_type", operator: "contains", value: "create" },
          ],
          action: "approve",
          reason: "Low priority approval",
        },
      ];

      const request: CrossRepoRequest = {
        request_id: "req-5",
        direction: "incoming",
        from_repo: "github.com/verified/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({ title: "Test" }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, customPolicies);

      // Should match high-priority policy first
      expect(result.decision).toBe("reject");
      expect(result.matchedPolicy?.id).toBe("high-priority");
    });

    it("should handle disabled policies", () => {
      const customPolicies: Policy[] = [
        {
          id: "disabled-policy",
          name: "Disabled",
          enabled: false,
          priority: 1,
          conditions: [
            { field: "trust_level", operator: "equals", value: "trusted" },
          ],
          action: "approve",
        },
      ];

      const request: CrossRepoRequest = {
        request_id: "req-6",
        direction: "incoming",
        from_repo: "github.com/trusted/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({ title: "Test" }),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, customPolicies);

      // Should not match disabled policy
      expect(result.decision).toBe("require_approval");
      expect(result.matchedPolicy).toBeUndefined();
    });
  });

  describe("Policy Conditions", () => {
    it("should evaluate 'equals' operator correctly", () => {
      const policy: Policy = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "equals", value: "trusted" },
        ],
        action: "approve",
      };

      const request: CrossRepoRequest = {
        request_id: "req-7",
        direction: "incoming",
        from_repo: "github.com/trusted/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({}),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, [policy]);

      expect(result.decision).toBe("approve");
    });

    it("should evaluate 'contains' operator correctly", () => {
      const policy: Policy = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "request_type", operator: "contains", value: "issue" },
        ],
        action: "approve",
      };

      const request: CrossRepoRequest = {
        request_id: "req-8",
        direction: "incoming",
        from_repo: "github.com/trusted/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({}),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, [policy]);

      expect(result.decision).toBe("approve");
    });

    it("should evaluate 'in' operator correctly", () => {
      const policy: Policy = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "in", value: ["trusted", "verified"] },
        ],
        action: "approve",
      };

      const request: CrossRepoRequest = {
        request_id: "req-9",
        direction: "incoming",
        from_repo: "github.com/verified/repo",
        to_repo: "local",
        request_type: "create_issue",
        payload: JSON.stringify({}),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, [policy]);

      expect(result.decision).toBe("approve");
    });

    it("should require all conditions to match (AND logic)", () => {
      const policy: Policy = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "equals", value: "trusted" },
          { field: "operation", operator: "equals", value: "query" },
        ],
        action: "approve",
      };

      const request: CrossRepoRequest = {
        request_id: "req-10",
        direction: "incoming",
        from_repo: "github.com/trusted/repo",
        to_repo: "local",
        request_type: "create_issue", // Operation is "create", not "query"
        payload: JSON.stringify({}),
        status: "pending",
        requires_approval: true,
        created_at: "2025-01-01",
        updated_at: "2025-01-01",
      };

      const result = evaluatePolicies(db, request, [policy]);

      // Should not match because operation doesn't match
      expect(result.decision).not.toBe("approve");
    });
  });

  describe("applyPolicyDecision", () => {
    it("should auto-approve request", async () => {
      const requestId = "req-approve";
      db.prepare(`
        INSERT INTO cross_repo_requests (
          request_id, direction, from_repo, to_repo,
          request_type, payload, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        "incoming",
        "github.com/trusted/repo",
        "local",
        "create_issue",
        JSON.stringify({ title: "Test" }),
        "pending",
        "2025-01-01",
        "2025-01-01"
      );

      await applyPolicyDecision(db, requestId, {
        decision: "approve",
        reason: "Test approval",
      });

      const updated = db.prepare("SELECT * FROM cross_repo_requests WHERE request_id = ?").get(requestId) as any;

      expect(updated.status).toBe("approved");
      expect(updated.approved_by).toBe("policy-engine");
      expect(updated.approved_at).toBeTruthy();
    });

    it("should auto-reject request", async () => {
      const requestId = "req-reject";
      db.prepare(`
        INSERT INTO cross_repo_requests (
          request_id, direction, from_repo, to_repo,
          request_type, payload, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        "incoming",
        "github.com/untrusted/repo",
        "local",
        "create_issue",
        JSON.stringify({ title: "Test" }),
        "pending",
        "2025-01-01",
        "2025-01-01"
      );

      await applyPolicyDecision(db, requestId, {
        decision: "reject",
        reason: "Test rejection",
      });

      const updated = db.prepare("SELECT * FROM cross_repo_requests WHERE request_id = ?").get(requestId) as any;

      expect(updated.status).toBe("rejected");
      expect(updated.rejection_reason).toBe("Test rejection");
      expect(updated.completed_at).toBeTruthy();
    });

    it("should leave pending for require_approval", async () => {
      const requestId = "req-pending";
      db.prepare(`
        INSERT INTO cross_repo_requests (
          request_id, direction, from_repo, to_repo,
          request_type, payload, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        "incoming",
        "github.com/verified/repo",
        "local",
        "create_issue",
        JSON.stringify({ title: "Test" }),
        "pending",
        "2025-01-01",
        "2025-01-01"
      );

      await applyPolicyDecision(db, requestId, {
        decision: "require_approval",
        reason: "Needs review",
      });

      const updated = db.prepare("SELECT * FROM cross_repo_requests WHERE request_id = ?").get(requestId) as any;

      expect(updated.status).toBe("pending");
      expect(updated.approved_by).toBeNull();
    });
  });

  describe("validatePolicy", () => {
    it("should validate correct policy", () => {
      const policy: Policy = {
        id: "test",
        name: "Test Policy",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "equals", value: "trusted" },
        ],
        action: "approve",
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject policy without ID", () => {
      const policy: Policy = {
        id: "",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "equals", value: "trusted" },
        ],
        action: "approve",
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Policy ID is required");
    });

    it("should reject policy with invalid action", () => {
      const policy: any = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "trust_level", operator: "equals", value: "trusted" },
        ],
        action: "invalid",
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid action"))).toBe(true);
    });

    it("should reject policy with no conditions", () => {
      const policy: Policy = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [],
        action: "approve",
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("condition"))).toBe(true);
    });

    it("should reject policy with invalid field", () => {
      const policy: any = {
        id: "test",
        name: "Test",
        enabled: true,
        priority: 1,
        conditions: [
          { field: "invalid_field", operator: "equals", value: "test" },
        ],
        action: "approve",
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid field"))).toBe(true);
    });
  });
});
