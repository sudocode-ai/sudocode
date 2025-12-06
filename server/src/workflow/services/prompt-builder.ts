/**
 * WorkflowPromptBuilder
 *
 * Constructs prompts for the orchestrator agent.
 * Builds initial prompts when workflows start and wakeup messages when events occur.
 */

import type {
  Workflow,
  WorkflowSource,
  WorkflowConfig,
  WorkflowEvent,
  Issue,
  Execution,
} from "@sudocode-ai/types";

import type { ResolvedAwait } from "./wakeup-service.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Parse files_changed JSON string to get count and stats
 */
function parseFilesChanged(filesChanged: string | null): {
  count: number;
  additions: number;
  deletions: number;
} {
  if (!filesChanged) {
    return { count: 0, additions: 0, deletions: 0 };
  }

  try {
    const files = JSON.parse(filesChanged) as Array<{
      additions?: number;
      deletions?: number;
    }>;
    const additions = files.reduce((sum, f) => sum + (f.additions || 0), 0);
    const deletions = files.reduce((sum, f) => sum + (f.deletions || 0), 0);
    return { count: files.length, additions, deletions };
  } catch {
    return { count: 0, additions: 0, deletions: 0 };
  }
}

/**
 * Format workflow source for display
 */
function formatSource(source: WorkflowSource): string {
  switch (source.type) {
    case "spec":
      return `Implementing spec \`${source.specId}\``;
    case "issues":
      return `Executing ${source.issueIds.length} issues: ${source.issueIds.join(", ")}`;
    case "root_issue":
      return `Completing issue \`${source.issueId}\` and its blockers`;
    case "goal":
      return `Goal: ${source.goal}`;
    default:
      return "Unknown source";
  }
}

/**
 * Format config for display
 */
function formatConfig(config: WorkflowConfig): string {
  const lines: string[] = [];

  lines.push(`- **Autonomy Level**: ${config.autonomyLevel === "full_auto" ? "Full Auto (no user intervention)" : "Human-in-the-Loop"}`);
  lines.push(`- **On Failure**: ${config.onFailure}`);
  lines.push(`- **Default Agent**: ${config.defaultAgentType}`);

  if (config.orchestratorModel) {
    lines.push(`- **Model**: ${config.orchestratorModel}`);
  }

  if (config.executionTimeoutMs) {
    lines.push(`- **Execution Timeout**: ${formatDuration(config.executionTimeoutMs)}`);
  }

  return lines.join("\n");
}

// =============================================================================
// WorkflowPromptBuilder
// =============================================================================

/**
 * Builds prompts and messages for the orchestrator agent.
 */
export class WorkflowPromptBuilder {
  /**
   * Build the initial prompt for the orchestrator when workflow starts.
   * Includes: workflow source, config, available issues, relationships.
   */
  buildInitialPrompt(workflow: Workflow, issues: Issue[]): string {
    const sections: string[] = [];

    // Header
    sections.push("# Workflow Orchestration");
    sections.push("");
    sections.push(`You are orchestrating workflow \`${workflow.id}\`: **${workflow.title}**`);
    sections.push("");

    // Source
    sections.push("## Objective");
    sections.push("");
    sections.push(formatSource(workflow.source));
    sections.push("");

    // Configuration
    sections.push("## Configuration");
    sections.push("");
    sections.push(formatConfig(workflow.config));
    sections.push("");

    // Available Tools
    sections.push("## Available Tools");
    sections.push("");
    sections.push("You have access to workflow orchestration tools:");
    sections.push("");
    sections.push("| Tool | Purpose |");
    sections.push("|------|---------|");
    sections.push("| `workflow_status` | Get current workflow state, active executions, ready issues |");
    sections.push("| `execute_issue` | Start an agent execution for an issue |");
    sections.push("| `execution_status` | Check status of a running/completed execution |");
    sections.push("| `execution_cancel` | Cancel a running execution |");
    sections.push("| `execution_trajectory` | Get summarized trajectory (tool calls, decisions) |");
    sections.push("| `execution_changes` | Get file changes from an execution |");
    sections.push("| `escalate_to_user` | Request user input (async - response via wakeup) |");
    sections.push("| `notify_user` | Send notification without blocking |");
    sections.push("| `workflow_complete` | Mark workflow as complete |");
    sections.push("");
    sections.push("You also have access to sudocode tools (`ready`, `show_issue`, `upsert_issue`, `link`, etc.) for managing issues and specs.");
    sections.push("");

    // Issues
    if (issues.length > 0) {
      sections.push("## Issues to Execute");
      sections.push("");
      for (const issue of issues) {
        const priority = issue.priority !== undefined ? ` (P${issue.priority})` : "";
        sections.push(`### ${issue.id}: ${issue.title}${priority}`);
        sections.push("");
        sections.push(`Status: ${issue.status}`);
        if (issue.content) {
          // Truncate long content
          const content = issue.content.length > 500
            ? issue.content.slice(0, 500) + "..."
            : issue.content;
          sections.push("");
          sections.push(content);
        }
        sections.push("");
      }
    } else if (workflow.source.type === "goal") {
      sections.push("## Getting Started");
      sections.push("");
      sections.push("This is a goal-based workflow. No issues have been created yet.");
      sections.push("Use `upsert_issue` to create issues and `link` to establish dependencies.");
      sections.push("Then use `execute_issue` to run agents on the issues.");
      sections.push("");
    }

    // Instructions
    sections.push("## Instructions");
    sections.push("");
    sections.push("1. Review the issues and their dependencies");
    sections.push("2. Use `execute_issue` to start agents on ready issues");
    sections.push("3. You will receive wakeup messages when executions complete or fail");
    sections.push("4. Inspect results with `execution_trajectory` and `execution_changes`");
    sections.push("5. Handle failures by retrying, creating fix issues, or escalating");
    sections.push("6. When all work is done, call `workflow_complete` with a summary");
    sections.push("");
    sections.push("Begin by reviewing the current state and starting the first execution.");

    return sections.join("\n");
  }

  /**
   * Build a wakeup message from workflow events.
   * Summarizes what happened since last orchestrator interaction.
   *
   * @param events - Unprocessed workflow events
   * @param executions - Map of execution ID to execution data
   * @param resolvedAwait - Optional resolved await context (if woken from await_events)
   */
  buildWakeupMessage(
    events: WorkflowEvent[],
    executions: Map<string, Execution>,
    resolvedAwait?: ResolvedAwait
  ): string {
    const sections: string[] = [];

    sections.push("[Workflow Event]");
    sections.push("");

    // If woken from await, explain what triggered it
    if (resolvedAwait) {
      sections.push("=== AWAIT RESOLVED ===");
      sections.push(`You were waiting for: ${resolvedAwait.eventTypes.join(", ")}`);
      sections.push(`Triggered by: ${resolvedAwait.resolvedBy}`);
      if (resolvedAwait.message) {
        sections.push(`Context: ${resolvedAwait.message}`);
      }
      if (resolvedAwait.executionIds && resolvedAwait.executionIds.length > 0) {
        sections.push(`Filtered executions: ${resolvedAwait.executionIds.join(", ")}`);
      }
      sections.push("");
    }

    if (events.length === 0) {
      if (resolvedAwait) {
        // If we have a resolved await but no events, it was likely a timeout
        sections.push("No new events - this is likely a timeout wakeup.");
      } else {
        sections.push("No new events since last update.");
      }
      sections.push("");
      sections.push("What would you like to do next?");
      return sections.join("\n");
    }

    // Group events by type
    const executionEvents = events.filter(
      (e) =>
        e.type === "step_completed" ||
        e.type === "step_failed" ||
        e.type === "step_started"
    );

    const escalationEvents = events.filter(
      (e) => e.type === "escalation_resolved" || e.type === "user_response"
    );

    const lifecycleEvents = events.filter(
      (e) =>
        e.type === "workflow_paused" ||
        e.type === "workflow_resumed"
    );

    // Execution updates
    if (executionEvents.length > 0) {
      sections.push("Executions changed since last update:");
      sections.push("");

      for (const event of executionEvents) {
        const execution = event.executionId
          ? executions.get(event.executionId)
          : undefined;

        if (execution) {
          sections.push(this.summarizeExecution(execution));
          sections.push("");
        } else {
          // Fallback if execution not found
          const issueId = (event.payload as { issueId?: string }).issueId || "unknown";
          sections.push(`## ${issueId}`);
          sections.push(`- Event: ${event.type}`);
          if (event.payload) {
            sections.push(`- Details: ${JSON.stringify(event.payload)}`);
          }
          sections.push("");
        }
      }
    }

    // Escalation responses
    if (escalationEvents.length > 0) {
      sections.push("User responses:");
      sections.push("");

      for (const event of escalationEvents) {
        const payload = event.payload as {
          action?: string;
          message?: string;
        };
        sections.push(`- **Action**: ${payload.action || "unknown"}`);
        if (payload.message) {
          sections.push(`  Message: "${payload.message}"`);
        }
        sections.push("");
      }
    }

    // Lifecycle events
    if (lifecycleEvents.length > 0) {
      for (const event of lifecycleEvents) {
        if (event.type === "workflow_paused") {
          sections.push("⚠️ Workflow was paused by user.");
          sections.push("");
        } else if (event.type === "workflow_resumed") {
          sections.push("✓ Workflow resumed.");
          sections.push("");
        }
      }
    }

    sections.push("---");
    sections.push("");
    sections.push("Use `execution_trajectory` or `execution_changes` for details.");
    sections.push("What would you like to do next?");

    return sections.join("\n");
  }

  /**
   * Create a compact summary of an execution result.
   */
  summarizeExecution(execution: Execution): string {
    const lines: string[] = [];

    // Header with issue ID and title (from issue_id if available)
    const issueId = execution.issue_id || "unknown";
    lines.push(`## ${issueId}`);

    // Status
    const statusEmoji = this.getStatusEmoji(execution.status);
    lines.push(`- Status: ${statusEmoji} ${execution.status.toUpperCase()}`);

    // Duration
    if (execution.started_at && execution.completed_at) {
      const startTime = new Date(execution.started_at).getTime();
      const endTime = new Date(execution.completed_at).getTime();
      const duration = endTime - startTime;
      lines.push(`- Duration: ${formatDuration(duration)}`);
    }

    // Files changed
    const { count, additions, deletions } = parseFilesChanged(
      execution.files_changed
    );
    if (count > 0) {
      lines.push(`- Files changed: ${count} (+${additions}, -${deletions})`);
    }

    // For completed executions, show summary
    if (execution.status === "completed" && execution.summary) {
      const summary =
        execution.summary.length > 200
          ? execution.summary.slice(0, 200) + "..."
          : execution.summary;
      lines.push(`- Summary: "${summary}"`);
    }

    // For failed executions, show error
    if (execution.status === "failed") {
      if (execution.exit_code !== null) {
        lines.push(`- Exit code: ${execution.exit_code}`);
      }
      if (execution.error_message) {
        const error =
          execution.error_message.length > 200
            ? execution.error_message.slice(0, 200) + "..."
            : execution.error_message;
        lines.push(`- Error: "${error}"`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get emoji for execution status
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "✗";
      case "running":
        return "⏳";
      case "stopped":
        return "⏹";
      case "pending":
        return "○";
      default:
        return "•";
    }
  }
}
