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
import { SudocodeClient } from "@sudocode-ai/cli/dist/client.js";
import { getEventBus } from "./event-bus.js";

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
  private cliClient: SudocodeClient;
  private repoPath: string;
  private executionService?: any; // ExecutionService instance (optional for non-execution actions)

  constructor(
    db: Database.Database,
    config: ProjectAgentConfig,
    repoPath: string,
    executionService?: any
  ) {
    this.db = db;
    this.config = config;
    this.repoPath = repoPath;
    this.executionService = executionService;

    // Initialize CLI client for executing actions
    this.cliClient = new SudocodeClient({
      workingDir: repoPath,
    });
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
    console.log("[action-manager] Executing create_issues_from_spec", payload);

    const issues = payload.issues || [];
    const relationships = payload.relationships || [];
    const createdIssues: string[] = [];

    // Create each issue
    for (const issue of issues) {
      try {
        const args = ["issue", "create", issue.title];

        if (issue.description) {
          args.push("--description", issue.description);
        }
        if (issue.priority !== undefined) {
          args.push("--priority", issue.priority.toString());
        }
        if (issue.parent) {
          args.push("--parent", issue.parent);
        }
        if (issue.tags && issue.tags.length > 0) {
          args.push("--tags", issue.tags.join(","));
        }

        const result = await this.cliClient.exec(args);
        createdIssues.push(result.id);

        // Emit event
        try {
          const eventBus = getEventBus();
          eventBus.emitEvent("filesystem:issue_created", {
            entityType: "issue",
            entityId: result.id,
          });
        } catch (err) {
          console.error("[action-manager] Failed to emit event:", err);
        }
      } catch (error) {
        console.error("[action-manager] Failed to create issue:", error);
      }
    }

    // Create relationships
    for (const rel of relationships) {
      try {
        const args = ["link", rel.from, rel.to];
        if (rel.type) {
          args.push("--type", rel.type);
        }
        await this.cliClient.exec(args);

        // Emit event
        try {
          const eventBus = getEventBus();
          eventBus.emitRelationshipCreated(
            rel.from,
            "issue",
            rel.to,
            "issue",
            rel.type || "related"
          );
        } catch (err) {
          console.error("[action-manager] Failed to emit event:", err);
        }
      } catch (error) {
        console.error("[action-manager] Failed to create relationship:", error);
      }
    }

    return { issuesCreated: createdIssues, relationships: relationships.length };
  }

  private async executeStartExecution(payload: any): Promise<any> {
    console.log("[action-manager] Executing start_execution", payload);

    if (!this.executionService) {
      throw new Error("ExecutionService not available");
    }

    // Prepare execution (renders prompt with template)
    const prepareResult = await this.executionService.prepareExecution(
      payload.issue_id,
      {
        config: payload.config || {},
      }
    );

    // Create and start execution
    const execution = await this.executionService.createExecution(
      payload.issue_id,
      prepareResult.defaultConfig,
      prepareResult.renderedPrompt
    );

    // Emit event
    try {
      const eventBus = getEventBus();
      eventBus.emitExecutionEvent(
        "started",
        execution.id,
        "running",
        payload.issue_id
      );
    } catch (err) {
      console.error("[action-manager] Failed to emit event:", err);
    }

    return {
      executionId: execution.id,
      issueId: payload.issue_id,
      status: execution.status,
      worktreePath: execution.worktree_path,
    };
  }

  private async executePauseExecution(payload: any): Promise<any> {
    console.log("[action-manager] Executing pause_execution", payload);

    if (!this.executionService) {
      throw new Error("ExecutionService not available");
    }

    // Pause the execution
    await this.executionService.pauseExecution(payload.execution_id);

    // Emit event
    try {
      const eventBus = getEventBus();
      eventBus.emitExecutionEvent(
        "paused",
        payload.execution_id,
        "paused"
      );
    } catch (err) {
      console.error("[action-manager] Failed to emit event:", err);
    }

    return {
      executionId: payload.execution_id,
      status: "paused",
    };
  }

  private async executeResumeExecution(payload: any): Promise<any> {
    console.log("[action-manager] Executing resume_execution", payload);

    if (!this.executionService) {
      throw new Error("ExecutionService not available");
    }

    // Resume the execution
    await this.executionService.resumeExecution(payload.execution_id);

    // Emit event
    try {
      const eventBus = getEventBus();
      eventBus.emitExecutionEvent(
        "resumed",
        payload.execution_id,
        "running"
      );
    } catch (err) {
      console.error("[action-manager] Failed to emit event:", err);
    }

    return {
      executionId: payload.execution_id,
      status: "running",
    };
  }

  private async executeAddFeedback(payload: any): Promise<any> {
    console.log("[action-manager] Executing add_feedback", payload);

    try {
      const args = [
        "feedback",
        "add",
        "--issue", payload.issue_id,
        "--spec", payload.spec_id,
        "--content", payload.content,
        "--type", payload.type || "comment",
      ];

      if (payload.line !== undefined) {
        args.push("--line", payload.line.toString());
      } else if (payload.text) {
        args.push("--text", payload.text);
      }

      const result = await this.cliClient.exec(args);

      // Emit event
      try {
        const eventBus = getEventBus();
        eventBus.emitFeedbackCreated(result.id, payload.issue_id, payload.spec_id);
      } catch (err) {
        console.error("[action-manager] Failed to emit event:", err);
      }

      return { feedbackId: result.id };
    } catch (error: any) {
      console.error("[action-manager] Failed to add feedback:", error);
      throw new Error(`Failed to add feedback: ${error.message}`);
    }
  }

  private async executeModifySpec(payload: any): Promise<any> {
    console.log("[action-manager] Executing modify_spec", payload);

    try {
      const args = ["spec", "update", payload.spec_id];

      if (payload.title) {
        args.push("--title", payload.title);
      }
      if (payload.description) {
        args.push("--description", payload.description);
      }
      if (payload.priority !== undefined) {
        args.push("--priority", payload.priority.toString());
      }

      const result = await this.cliClient.exec(args);

      // Emit event
      try {
        const eventBus = getEventBus();
        eventBus.emitEvent("filesystem:spec_updated", {
          entityType: "spec",
          entityId: payload.spec_id,
        });
      } catch (err) {
        console.error("[action-manager] Failed to emit event:", err);
      }

      return { specId: result.id, modified: true };
    } catch (error: any) {
      console.error("[action-manager] Failed to modify spec:", error);
      throw new Error(`Failed to modify spec: ${error.message}`);
    }
  }

  private async executeCreateRelationship(payload: any): Promise<any> {
    console.log("[action-manager] Executing create_relationship", payload);

    try {
      const args = ["link", payload.from_id, payload.to_id];
      if (payload.type) {
        args.push("--type", payload.type);
      }

      await this.cliClient.exec(args);

      // Emit event
      try {
        const eventBus = getEventBus();
        eventBus.emitRelationshipCreated(
          payload.from_id,
          payload.from_type || "issue",
          payload.to_id,
          payload.to_type || "issue",
          payload.type || "related"
        );
      } catch (err) {
        console.error("[action-manager] Failed to emit event:", err);
      }

      return { relationshipCreated: true };
    } catch (error: any) {
      console.error("[action-manager] Failed to create relationship:", error);
      throw new Error(`Failed to create relationship: ${error.message}`);
    }
  }

  private async executeUpdateIssueStatus(payload: any): Promise<any> {
    console.log("[action-manager] Executing update_issue_status", payload);

    try {
      const args = ["issue", "update", payload.issue_id, "--status", payload.status];

      const result = await this.cliClient.exec(args);

      // Emit event
      try {
        const eventBus = getEventBus();
        eventBus.emitIssueStatusChanged(
          payload.issue_id,
          payload.old_status || "unknown",
          payload.status
        );
      } catch (err) {
        console.error("[action-manager] Failed to emit event:", err);
      }

      return { issueId: result.id, newStatus: result.status };
    } catch (error: any) {
      console.error("[action-manager] Failed to update issue status:", error);
      throw new Error(`Failed to update issue status: ${error.message}`);
    }
  }
}
