/**
 * Action Manager Service
 * Manages project agent actions: proposal, approval, and execution
 */

import type Database from "better-sqlite3";
import type {
  ProjectAgentAction,
  ProjectAgentActionType,
  ProjectAgentActionStatus,
  ProjectAgentConfig,
} from "@sudocode-ai/types";
import {
  createProjectAgentAction,
  getProjectAgentAction,
  listProjectAgentActions,
  updateProjectAgentActionStatus,
  updateProjectAgentActionResult,
  incrementProjectAgentMetric,
} from "./project-agent-db.js";

/**
 * Proposed action parameters
 */
export interface ProposeActionParams {
  projectAgentExecutionId: string;
  actionType: ProjectAgentActionType;
  targetId?: string;
  targetType?: "spec" | "issue" | "execution";
  payload: any;
  justification: string;
  priority?: "high" | "medium" | "low";
}

/**
 * Action execution result
 */
export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Action Manager Service
 */
export class ActionManager {
  private db: Database.Database;
  private config: ProjectAgentConfig;

  constructor(db: Database.Database, config: ProjectAgentConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Propose a new action
   */
  async proposeAction(params: ProposeActionParams): Promise<ProjectAgentAction> {
    // Create the action in database
    const action = createProjectAgentAction(this.db, {
      projectAgentExecutionId: params.projectAgentExecutionId,
      actionType: params.actionType,
      priority: params.priority,
      targetId: params.targetId,
      targetType: params.targetType,
      payload: params.payload,
      justification: params.justification,
    });

    // Increment metrics
    incrementProjectAgentMetric(this.db, params.projectAgentExecutionId, "actions_proposed");

    // Check if action should be auto-approved
    if (this.shouldAutoApprove(action)) {
      console.log(`[action-manager] Auto-approving action ${action.id}: ${action.action_type}`);
      await this.approveAction(action.id);
    } else {
      console.log(`[action-manager] Action ${action.id} proposed, awaiting approval`);
      // Broadcast notification (will be implemented with WebSocket integration)
      this.broadcastActionUpdate(action);
    }

    return action;
  }

  /**
   * Approve an action
   */
  async approveAction(actionId: string, userId?: string): Promise<void> {
    const action = getProjectAgentAction(this.db, actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== "proposed") {
      throw new Error(`Action ${actionId} is not in proposed state`);
    }

    // Update status to approved
    updateProjectAgentActionStatus(this.db, actionId, "approved");

    // Increment metrics
    incrementProjectAgentMetric(this.db, action.project_agent_execution_id, "actions_approved");

    console.log(`[action-manager] Action ${actionId} approved${userId ? ` by ${userId}` : ""}`);

    // Execute the action
    await this.executeAction(actionId);

    // Broadcast update
    const updatedAction = getProjectAgentAction(this.db, actionId);
    if (updatedAction) {
      this.broadcastActionUpdate(updatedAction);
    }
  }

  /**
   * Reject an action
   */
  async rejectAction(actionId: string, reason?: string): Promise<void> {
    const action = getProjectAgentAction(this.db, actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== "proposed") {
      throw new Error(`Action ${actionId} is not in proposed state`);
    }

    // Update status to rejected
    updateProjectAgentActionStatus(this.db, actionId, "rejected", reason);

    // Increment metrics
    incrementProjectAgentMetric(this.db, action.project_agent_execution_id, "actions_rejected");

    console.log(`[action-manager] Action ${actionId} rejected${reason ? `: ${reason}` : ""}`);

    // Broadcast update
    const updatedAction = getProjectAgentAction(this.db, actionId);
    if (updatedAction) {
      this.broadcastActionUpdate(updatedAction);
    }
  }

  /**
   * Execute an approved action
   */
  async executeAction(actionId: string): Promise<ActionResult> {
    const action = getProjectAgentAction(this.db, actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== "approved") {
      throw new Error(`Action ${actionId} is not approved`);
    }

    console.log(`[action-manager] Executing action ${actionId}: ${action.action_type}`);

    // Update status to executing
    updateProjectAgentActionStatus(this.db, actionId, "executing");

    try {
      const result = await this.executeActionByType(action);

      // Update status to completed
      updateProjectAgentActionStatus(this.db, actionId, "completed");
      updateProjectAgentActionResult(this.db, actionId, result);

      console.log(`[action-manager] Action ${actionId} completed successfully`);

      return { success: true, data: result };
    } catch (error: any) {
      // Update status to failed
      updateProjectAgentActionStatus(this.db, actionId, "failed", error.message);

      console.error(`[action-manager] Action ${actionId} failed:`, error);

      return { success: false, error: error.message };
    }
  }

  /**
   * Execute action based on type
   */
  private async executeActionByType(action: ProjectAgentAction): Promise<any> {
    const payload = JSON.parse(action.payload_json);

    switch (action.action_type) {
      case "create_issues_from_spec":
        return this.executeCreateIssuesFromSpec(payload);

      case "start_execution":
        return this.executeStartExecution(payload);

      case "pause_execution":
        return this.executePauseExecution(payload);

      case "resume_execution":
        return this.executeResumeExecution(payload);

      case "add_feedback":
        return this.executeAddFeedback(payload);

      case "modify_spec":
        return this.executeModifySpec(payload);

      case "create_relationship":
        return this.executeCreateRelationship(payload);

      case "update_issue_status":
        return this.executeUpdateIssueStatus(payload);

      default:
        throw new Error(`Unknown action type: ${action.action_type}`);
    }
  }

  /**
   * Check if action should be auto-approved
   */
  private shouldAutoApprove(action: ProjectAgentAction): boolean {
    const { autoApprove } = this.config;

    if (!autoApprove.enabled) {
      return false;
    }

    return autoApprove.allowedActions.includes(action.action_type);
  }

  /**
   * Broadcast action update via WebSocket
   */
  private broadcastActionUpdate(action: ProjectAgentAction): void {
    // TODO: Integrate with WebSocket broadcaster
    // For now, just log
    console.log(`[action-manager] Broadcasting action update: ${action.id} (${action.status})`);
  }

  /**
   * List actions with optional filters
   */
  listActions(params?: {
    status?: ProjectAgentActionStatus;
    limit?: number;
  }): ProjectAgentAction[] {
    return listProjectAgentActions(this.db, params);
  }

  /**
   * Get action by ID
   */
  getAction(actionId: string): ProjectAgentAction | null {
    return getProjectAgentAction(this.db, actionId);
  }

  // ============================================================================
  // Action Executors
  // These methods execute specific action types
  // ============================================================================

  private async executeCreateIssuesFromSpec(payload: any): Promise<any> {
    // TODO: Implement issue creation logic
    // This will use the CLI operations to create issues with relationships
    console.log("[action-manager] Executing create_issues_from_spec", payload);
    return { issuesCreated: payload.issues?.length || 0 };
  }

  private async executeStartExecution(payload: any): Promise<any> {
    // TODO: Implement execution start logic
    // This will use the ExecutionService to create and start an execution
    console.log("[action-manager] Executing start_execution", payload);
    return { executionId: payload.issue_id };
  }

  private async executePauseExecution(payload: any): Promise<any> {
    // TODO: Implement execution pause logic
    console.log("[action-manager] Executing pause_execution", payload);
    return { executionId: payload.execution_id, paused: true };
  }

  private async executeResumeExecution(payload: any): Promise<any> {
    // TODO: Implement execution resume logic
    console.log("[action-manager] Executing resume_execution", payload);
    return { executionId: payload.execution_id, resumed: true };
  }

  private async executeAddFeedback(payload: any): Promise<any> {
    // TODO: Implement feedback addition logic
    console.log("[action-manager] Executing add_feedback", payload);
    return { feedbackId: `feedback_${Date.now()}` };
  }

  private async executeModifySpec(payload: any): Promise<any> {
    // TODO: Implement spec modification logic
    console.log("[action-manager] Executing modify_spec", payload);
    return { specId: payload.spec_id, modified: true };
  }

  private async executeCreateRelationship(payload: any): Promise<any> {
    // TODO: Implement relationship creation logic
    console.log("[action-manager] Executing create_relationship", payload);
    return { relationshipCreated: true };
  }

  private async executeUpdateIssueStatus(payload: any): Promise<any> {
    // TODO: Implement issue status update logic
    console.log("[action-manager] Executing update_issue_status", payload);
    return { issueId: payload.issue_id, newStatus: payload.status };
  }
}
