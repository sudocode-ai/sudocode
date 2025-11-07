/**
 * MCP tools for project analysis and planning
 */

import { SudocodeClient } from "../client.js";
import type { Spec, Issue } from "../types.js";

// Tool parameter types

export interface AnalyzeProjectParams {}

export interface PlanSpecParams {
  spec_id: string;
  include_existing?: boolean;
}

// Result types

export interface ProjectAnalysis {
  specs: {
    total: number;
    needs_clarification: Array<{
      spec_id: string;
      title: string;
      issues: string[];
    }>;
    ready_to_implement: Spec[];
    blocked: Spec[];
  };
  issues: {
    ready: Issue[];
    blocked: Array<{
      issue: Issue;
      blocked_by: Issue[];
    }>;
    in_progress: Issue[];
    stale: Array<{
      issue: Issue;
      days_inactive: number;
    }>;
  };
  executions: {
    running: any[];
    completed_today: number;
    failed_today: number;
    stalled: Array<{
      execution: any;
      stall_duration_minutes: number;
      last_activity: string;
    }>;
  };
  recommendations: Array<{
    type: "start_execution" | "review_spec" | "resolve_blocker";
    priority: "high" | "medium" | "low";
    description: string;
    target_id: string;
  }>;
}

export interface SpecPlan {
  spec: Spec;
  proposed_issues: Array<{
    title: string;
    description: string;
    priority: number;
    dependencies: string[];
    estimated_complexity: "small" | "medium" | "large";
  }>;
  existing_issues: Issue[];
  timeline_estimate: string;
  risks: string[];
}

// Tool implementations

/**
 * Analyze overall project state and health
 */
export async function analyzeProject(
  client: SudocodeClient,
  params: AnalyzeProjectParams = {}
): Promise<ProjectAnalysis> {
  // Get project status and ready issues
  const statusResult = await client.exec(["status"]);
  const readyResult = await client.exec(["ready"]);

  // Get all specs and issues
  const specs = await client.exec(["spec", "list", "--limit", "1000"]);
  const issues = await client.exec(["issue", "list", "--limit", "1000"]);

  // Analyze specs
  const needsClarification: Array<{
    spec_id: string;
    title: string;
    issues: string[];
  }> = [];

  const readyToImplement: Spec[] = [];
  const blockedSpecs: Spec[] = [];

  // TODO: Implement spec analysis logic
  // For now, use basic heuristics

  if (Array.isArray(specs)) {
    for (const spec of specs) {
      // Check if spec has implementing issues
      const hasIssues = Array.isArray(issues) && issues.some((issue: any) =>
        issue.content?.includes(spec.id)
      );

      if (!hasIssues && spec.content && spec.content.length > 200) {
        readyToImplement.push(spec);
      }
    }
  }

  // Analyze issues
  const readyIssues = readyResult.issues || [];
  const blockedIssues: Array<{ issue: Issue; blocked_by: Issue[] }> = [];
  const inProgressIssues: Issue[] = [];
  const staleIssues: Array<{ issue: Issue; days_inactive: number }> = [];

  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (issue.status === "in_progress") {
        inProgressIssues.push(issue);

        // Check if stale (updated more than 7 days ago)
        const updatedAt = new Date(issue.updated_at);
        const daysSinceUpdate = Math.floor(
          (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceUpdate > 7) {
          staleIssues.push({
            issue,
            days_inactive: daysSinceUpdate,
          });
        }
      }
    }
  }

  // Generate recommendations
  const recommendations: ProjectAnalysis["recommendations"] = [];

  // Recommend starting executions for ready issues
  if (readyIssues.length > 0) {
    for (const issue of readyIssues.slice(0, 3)) {
      recommendations.push({
        type: "start_execution",
        priority: issue.priority === 0 ? "high" : "medium",
        description: `Start execution for ready issue: ${issue.title}`,
        target_id: issue.id,
      });
    }
  }

  // Recommend reviewing specs
  if (readyToImplement.length > 0) {
    for (const spec of readyToImplement.slice(0, 2)) {
      recommendations.push({
        type: "review_spec",
        priority: "medium",
        description: `Spec ready for implementation: ${spec.title}`,
        target_id: spec.id,
      });
    }
  }

  // Recommend addressing stale issues
  if (staleIssues.length > 0) {
    for (const stale of staleIssues.slice(0, 2)) {
      recommendations.push({
        type: "resolve_blocker",
        priority: "low",
        description: `Issue inactive for ${stale.days_inactive} days: ${stale.issue.title}`,
        target_id: stale.issue.id,
      });
    }
  }

  return {
    specs: {
      total: Array.isArray(specs) ? specs.length : 0,
      needs_clarification: needsClarification,
      ready_to_implement: readyToImplement,
      blocked: blockedSpecs,
    },
    issues: {
      ready: readyIssues,
      blocked: blockedIssues,
      in_progress: inProgressIssues,
      stale: staleIssues,
    },
    executions: {
      running: [],
      completed_today: 0,
      failed_today: 0,
      stalled: [],
    },
    recommendations: recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }),
  };
}

/**
 * Plan implementation for a spec
 */
export async function planSpec(
  client: SudocodeClient,
  params: PlanSpecParams
): Promise<SpecPlan> {
  // Get the spec
  const spec = await client.exec(["spec", "show", params.spec_id]);

  // Get existing issues related to this spec
  const allIssues = await client.exec(["issue", "list", "--limit", "1000"]);
  const existingIssues: Issue[] = [];

  if (Array.isArray(allIssues)) {
    for (const issue of allIssues) {
      // Check if issue references this spec
      if (issue.content?.includes(params.spec_id)) {
        existingIssues.push(issue);
      }
    }
  }

  // TODO: Use AI to analyze spec and propose issues
  // For now, return basic structure

  const proposedIssues = [
    {
      title: `Implement ${spec.title}`,
      description: `Implementation task for ${params.spec_id}`,
      priority: spec.priority || 2,
      dependencies: [],
      estimated_complexity: "medium" as const,
    },
  ];

  return {
    spec,
    proposed_issues: proposedIssues,
    existing_issues: existingIssues,
    timeline_estimate: "Unknown (analysis pending)",
    risks: [],
  };
}
