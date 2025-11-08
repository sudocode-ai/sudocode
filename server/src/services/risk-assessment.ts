/**
 * Risk Assessment Service
 * Phase 6: Calculates confidence scores and risk levels for project agent actions
 */

import type {
  ProjectAgentActionType,
  ProjectAgentAction,
} from "@sudocode-ai/types";

export interface RiskAssessment {
  confidenceScore: number; // 0-100
  riskLevel: "low" | "medium" | "high";
  factors: string[]; // Explanation of confidence/risk factors
}

/**
 * Risk Assessment Service
 * Analyzes actions and calculates confidence scores and risk levels
 */
export class RiskAssessmentService {
  /**
   * Assess an action and calculate confidence and risk
   */
  assessAction(
    actionType: ProjectAgentActionType,
    payload: any,
    context?: {
      previousActions?: ProjectAgentAction[];
      projectState?: any;
    }
  ): RiskAssessment {
    switch (actionType) {
      case "add_feedback":
        return this.assessAddFeedback(payload, context);

      case "create_issues_from_spec":
        return this.assessCreateIssues(payload, context);

      case "start_execution":
        return this.assessStartExecution(payload, context);

      case "pause_execution":
        return this.assessPauseExecution(payload, context);

      case "resume_execution":
        return this.assessResumeExecution(payload, context);

      case "modify_spec":
        return this.assessModifySpec(payload, context);

      case "create_relationship":
        return this.assessCreateRelationship(payload, context);

      case "update_issue_status":
        return this.assessUpdateIssueStatus(payload, context);

      default:
        // Default conservative assessment for unknown actions
        return {
          confidenceScore: 50,
          riskLevel: "high",
          factors: ["Unknown action type - conservative assessment"],
        };
    }
  }

  /**
   * Assess add_feedback action
   * Low risk: Only adds feedback, doesn't modify existing entities
   */
  private assessAddFeedback(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 95; // Start high - low risk action

    if (!payload.content || payload.content.length < 10) {
      score -= 20;
      factors.push("Feedback content is very short");
    }

    if (payload.type && ["blocker", "question"].includes(payload.type)) {
      score -= 5;
      factors.push("Feedback type requires user attention");
    } else {
      factors.push("Feedback is informational");
    }

    return {
      confidenceScore: score,
      riskLevel: "low",
      factors,
    };
  }

  /**
   * Assess create_issues_from_spec action
   * Medium risk: Creates new entities but doesn't modify existing ones
   */
  private assessCreateIssues(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 80; // Medium-high confidence

    const issues = payload.issues || [];
    const relationships = payload.relationships || [];

    if (issues.length === 0) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No issues to create"],
      };
    }

    if (issues.length > 10) {
      score -= 15;
      factors.push(`Creating many issues (${issues.length}) - review recommended`);
    } else {
      factors.push(`Creating ${issues.length} issues`);
    }

    // Check if issues have descriptions
    const issuesWithDescription = issues.filter(
      (i: any) => i.description && i.description.length > 20
    );
    if (issuesWithDescription.length < issues.length * 0.7) {
      score -= 15;
      factors.push("Some issues lack detailed descriptions");
    } else {
      factors.push("All issues have detailed descriptions");
    }

    // Check relationships
    if (relationships.length > 0) {
      score -= 5;
      factors.push(`Creating ${relationships.length} relationships`);
    }

    const riskLevel = score >= 75 ? "low" : "medium";

    return {
      confidenceScore: Math.max(0, score),
      riskLevel,
      factors,
    };
  }

  /**
   * Assess start_execution action
   * Medium risk: Starts resource-intensive operation
   */
  private assessStartExecution(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 75;

    if (!payload.issue_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No issue ID specified"],
      };
    }

    if (!payload.reason) {
      score -= 10;
      factors.push("No justification provided");
    } else {
      factors.push("Justification provided");
    }

    // Check if there's a previous successful action context
    if (context?.previousActions) {
      const recentSuccesses = context.previousActions.filter(
        (a: ProjectAgentAction) =>
          a.action_type === "start_execution" && a.status === "completed"
      );
      if (recentSuccesses.length > 0) {
        score += 5;
        factors.push("Previous executions started successfully");
      }
    }

    return {
      confidenceScore: Math.min(100, score),
      riskLevel: "medium",
      factors,
    };
  }

  /**
   * Assess pause_execution action
   * Medium risk: Interrupts running operation
   */
  private assessPauseExecution(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 70;

    if (!payload.execution_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No execution ID specified"],
      };
    }

    if (!payload.reason) {
      score -= 15;
      factors.push("No reason for pausing provided");
    } else {
      factors.push(`Reason: ${payload.reason}`);
    }

    // Check if reason indicates stall detection
    if (payload.reason && /stall|hung|stuck|unresponsive/i.test(payload.reason)) {
      score += 10;
      factors.push("Stall detected - pause likely appropriate");
    }

    return {
      confidenceScore: score,
      riskLevel: "medium",
      factors,
    };
  }

  /**
   * Assess resume_execution action
   * Medium risk: Restarts paused operation
   */
  private assessResumeExecution(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 75;

    if (!payload.execution_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No execution ID specified"],
      };
    }

    if (payload.additional_context) {
      score += 5;
      factors.push("Additional context provided for resume");
    } else {
      score -= 10;
      factors.push("No additional context for resume");
    }

    return {
      confidenceScore: score,
      riskLevel: "medium",
      factors,
    };
  }

  /**
   * Assess modify_spec action
   * High risk: Modifies existing critical entity
   */
  private assessModifySpec(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 60; // Start lower for risky operation

    if (!payload.spec_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No spec ID specified"],
      };
    }

    const changedFields = [];
    if (payload.title) changedFields.push("title");
    if (payload.description) changedFields.push("description");
    if (payload.priority !== undefined) changedFields.push("priority");

    if (changedFields.length === 0) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No changes specified"],
      };
    }

    if (changedFields.length === 1 && changedFields[0] === "priority") {
      score += 15;
      factors.push("Only priority change - lower risk");
    } else if (changedFields.includes("description")) {
      score -= 10;
      factors.push("Description change - review recommended");
    }

    factors.push(`Modifying: ${changedFields.join(", ")}`);

    // Check if diff was generated
    if (payload._diff) {
      score += 5;
      factors.push("Diff available for review");
    }

    return {
      confidenceScore: score,
      riskLevel: "high",
      factors,
    };
  }

  /**
   * Assess create_relationship action
   * Low-Medium risk: Creates relationship between entities
   */
  private assessCreateRelationship(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 80;

    if (!payload.from_id || !payload.to_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["Missing relationship endpoints"],
      };
    }

    if (!payload.type || !["blocks", "depends_on", "related_to"].includes(payload.type)) {
      score -= 20;
      factors.push("Unknown or missing relationship type");
    } else {
      factors.push(`Creating ${payload.type} relationship`);
    }

    if (payload.type === "blocks") {
      score -= 5;
      factors.push("Blocks relationship affects execution order");
    }

    return {
      confidenceScore: score,
      riskLevel: score >= 75 ? "low" : "medium",
      factors,
    };
  }

  /**
   * Assess update_issue_status action
   * Medium risk: Changes issue state
   */
  private assessUpdateIssueStatus(payload: any, context?: any): RiskAssessment {
    const factors: string[] = [];
    let score = 75;

    if (!payload.issue_id) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No issue ID specified"],
      };
    }

    if (!payload.status) {
      return {
        confidenceScore: 0,
        riskLevel: "high",
        factors: ["No status specified"],
      };
    }

    const validStatuses = ["ready", "in_progress", "blocked", "completed", "cancelled"];
    if (!validStatuses.includes(payload.status)) {
      score -= 20;
      factors.push("Invalid status value");
    }

    // Marking as completed is higher risk
    if (payload.status === "completed") {
      score -= 15;
      factors.push("Marking as completed - verify work is done");
    } else if (payload.status === "cancelled") {
      score -= 15;
      factors.push("Cancelling issue - verify intent");
    } else {
      factors.push(`Updating status to ${payload.status}`);
    }

    if (!payload.reason) {
      score -= 10;
      factors.push("No reason provided for status change");
    }

    return {
      confidenceScore: score,
      riskLevel: "medium",
      factors,
    };
  }
}

/**
 * Get global risk assessment service instance
 */
let riskAssessmentService: RiskAssessmentService | null = null;

export function getRiskAssessmentService(): RiskAssessmentService {
  if (!riskAssessmentService) {
    riskAssessmentService = new RiskAssessmentService();
  }
  return riskAssessmentService;
}
