/**
 * Unit tests for WorkflowPromptBuilder
 *
 * Tests prompt generation for the orchestrator agent:
 * - Initial prompt generation for different source types
 * - Wakeup message building with events
 * - Execution summary formatting
 */

import { describe, it, expect } from "vitest";
import type {
  Workflow,
  WorkflowEvent,
  Issue,
  Execution,
} from "@sudocode-ai/types";
import { WorkflowPromptBuilder } from "../../../../src/workflow/services/prompt-builder.js";
import type { ResolvedAwait } from "../../../../src/workflow/services/wakeup-service.js";

// =============================================================================
// Test Data Factories
// =============================================================================

function createTestWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-test123",
    title: "Test Workflow",
    source: { type: "issues", issueIds: ["i-1", "i-2"] },
    status: "pending",
    steps: [],
    baseBranch: "main",
    currentStepIndex: 0,
    config: {
      parallelism: "sequential",
      onFailure: "pause",
      autoCommitAfterStep: true,
      defaultAgentType: "claude-code",
      autonomyLevel: "human_in_the_loop",
    },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTestIssue(overrides?: Partial<Issue>): Issue {
  return {
    id: "i-test",
    uuid: "test-uuid",
    title: "Test Issue",
    status: "open",
    content: "Test issue content",
    priority: 1,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTestExecution(overrides?: Partial<Execution>): Execution {
  return {
    id: "exec-test",
    issue_id: "i-test",
    issue_uuid: "test-uuid",
    mode: "worktree",
    prompt: "Test prompt",
    config: null,
    agent_type: "claude-code",
    session_id: null,
    workflow_execution_id: null,
    target_branch: "main",
    branch_name: "sudocode/exec-test",
    before_commit: "abc123",
    after_commit: "def456",
    worktree_path: "/tmp/worktree",
    status: "completed",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:01:00.000Z",
    started_at: "2025-01-01T00:00:00.000Z",
    completed_at: "2025-01-01T00:01:00.000Z",
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: "claude-sonnet-4",
    summary: "Successfully implemented the feature",
    files_changed: JSON.stringify([
      { path: "src/file.ts", additions: 50, deletions: 10 },
      { path: "src/test.ts", additions: 30, deletions: 5 },
    ]),
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
    ...overrides,
  };
}

function createTestEvent(overrides?: Partial<WorkflowEvent>): WorkflowEvent {
  return {
    id: "event-test",
    workflowId: "wf-test123",
    type: "step_completed",
    stepId: "step-1",
    executionId: "exec-test",
    payload: {},
    createdAt: "2025-01-01T00:01:00.000Z",
    ...overrides,
  };
}

function createTestResolvedAwait(overrides?: Partial<ResolvedAwait>): ResolvedAwait {
  return {
    id: "await-test",
    workflowId: "wf-test123",
    eventTypes: ["step_completed", "step_failed"],
    createdAt: "2025-01-01T00:00:00.000Z",
    resolvedBy: "step_completed",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("WorkflowPromptBuilder", () => {
  const builder = new WorkflowPromptBuilder();

  describe("buildInitialPrompt", () => {
    it("should include workflow ID and title", () => {
      const workflow = createTestWorkflow({
        id: "wf-abc123",
        title: "My Workflow",
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("wf-abc123");
      expect(prompt).toContain("My Workflow");
    });

    it("should format spec source correctly", () => {
      const workflow = createTestWorkflow({
        source: { type: "spec", specId: "s-auth" },
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("Implementing spec `s-auth`");
    });

    it("should format issues source correctly", () => {
      const workflow = createTestWorkflow({
        source: { type: "issues", issueIds: ["i-1", "i-2", "i-3"] },
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("Executing 3 issues");
      expect(prompt).toContain("i-1, i-2, i-3");
    });

    it("should format root_issue source correctly", () => {
      const workflow = createTestWorkflow({
        source: { type: "root_issue", issueId: "i-main" },
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("Completing issue `i-main`");
      expect(prompt).toContain("blockers");
    });

    it("should format goal source correctly", () => {
      const workflow = createTestWorkflow({
        source: { type: "goal", goal: "Implement user authentication with OAuth" },
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("Goal: Implement user authentication with OAuth");
      expect(prompt).toContain("goal-based workflow");
      expect(prompt).toContain("upsert_issue");
    });

    it("should include configuration details", () => {
      const workflow = createTestWorkflow({
        config: {
          parallelism: "sequential",
          onFailure: "stop",
          autoCommitAfterStep: true,
          defaultAgentType: "claude-code",
          autonomyLevel: "full_auto",
          orchestratorModel: "claude-opus-4",
          executionTimeoutMs: 300000,
        },
      });
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("Full Auto");
      expect(prompt).toContain("stop");
      expect(prompt).toContain("claude-opus-4");
      expect(prompt).toContain("5m");
    });

    it("should list available MCP tools", () => {
      const workflow = createTestWorkflow();
      const issues: Issue[] = [];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("workflow_status");
      expect(prompt).toContain("execute_issue");
      expect(prompt).toContain("execution_status");
      expect(prompt).toContain("execution_cancel");
      expect(prompt).toContain("execution_trajectory");
      expect(prompt).toContain("execution_changes");
      expect(prompt).toContain("escalate_to_user");
      expect(prompt).toContain("workflow_complete");
    });

    it("should include issue details when issues provided", () => {
      const workflow = createTestWorkflow();
      const issues: Issue[] = [
        createTestIssue({ id: "i-auth", title: "Add authentication", priority: 0 }),
        createTestIssue({ id: "i-tests", title: "Add unit tests", priority: 2 }),
      ];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).toContain("i-auth: Add authentication");
      expect(prompt).toContain("(P0)");
      expect(prompt).toContain("i-tests: Add unit tests");
      expect(prompt).toContain("(P2)");
    });

    it("should truncate long issue content", () => {
      const workflow = createTestWorkflow();
      const longContent = "A".repeat(600);
      const issues: Issue[] = [
        createTestIssue({ content: longContent }),
      ];

      const prompt = builder.buildInitialPrompt(workflow, issues);

      expect(prompt).not.toContain(longContent);
      expect(prompt).toContain("...");
    });
  });

  describe("buildWakeupMessage", () => {
    it("should handle empty events", () => {
      const events: WorkflowEvent[] = [];
      const executions = new Map<string, Execution>();

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("No new events");
      expect(message).toContain("What would you like to do next?");
    });

    it("should summarize completed execution", () => {
      const execution = createTestExecution({
        id: "exec-1",
        issue_id: "i-auth",
        status: "completed",
        summary: "Implemented OAuth flow",
      });

      const events: WorkflowEvent[] = [
        createTestEvent({
          type: "step_completed",
          executionId: "exec-1",
        }),
      ];

      const executions = new Map<string, Execution>();
      executions.set("exec-1", execution);

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("Executions changed");
      expect(message).toContain("i-auth");
      expect(message).toContain("COMPLETED");
      expect(message).toContain("Implemented OAuth flow");
    });

    it("should summarize failed execution with error", () => {
      const execution = createTestExecution({
        id: "exec-1",
        issue_id: "i-tests",
        status: "failed",
        exit_code: 1,
        error_message: "Test suite failed: 3 tests failing in auth.test.ts",
        summary: null,
      });

      const events: WorkflowEvent[] = [
        createTestEvent({
          type: "step_failed",
          executionId: "exec-1",
        }),
      ];

      const executions = new Map<string, Execution>();
      executions.set("exec-1", execution);

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("i-tests");
      expect(message).toContain("FAILED");
      expect(message).toContain("Exit code: 1");
      expect(message).toContain("Test suite failed");
    });

    it("should include duration and file changes", () => {
      const execution = createTestExecution({
        id: "exec-1",
        started_at: "2025-01-01T00:00:00.000Z",
        completed_at: "2025-01-01T00:03:42.000Z", // 3m 42s
        files_changed: JSON.stringify([
          { path: "a.ts", additions: 100, deletions: 20 },
          { path: "b.ts", additions: 56, deletions: 3 },
        ]),
      });

      const events: WorkflowEvent[] = [
        createTestEvent({ executionId: "exec-1" }),
      ];

      const executions = new Map<string, Execution>();
      executions.set("exec-1", execution);

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("3m 42s");
      expect(message).toContain("Files changed: 2");
      expect(message).toContain("+156");
      expect(message).toContain("-23");
    });

    it("should include user response events", () => {
      const events: WorkflowEvent[] = [
        createTestEvent({
          type: "user_response",
          payload: { action: "approve", message: "Looks good, proceed" },
        }),
      ];

      const executions = new Map<string, Execution>();

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("User responses");
      expect(message).toContain("approve");
      expect(message).toContain("Looks good, proceed");
    });

    it("should handle workflow pause event", () => {
      const events: WorkflowEvent[] = [
        createTestEvent({ type: "workflow_paused" }),
      ];

      const executions = new Map<string, Execution>();

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("paused by user");
    });

    it("should handle multiple events", () => {
      const exec1 = createTestExecution({
        id: "exec-1",
        issue_id: "i-1",
        status: "completed",
      });
      const exec2 = createTestExecution({
        id: "exec-2",
        issue_id: "i-2",
        status: "failed",
        error_message: "Build failed",
      });

      const events: WorkflowEvent[] = [
        createTestEvent({ type: "step_completed", executionId: "exec-1" }),
        createTestEvent({ type: "step_failed", executionId: "exec-2" }),
      ];

      const executions = new Map<string, Execution>();
      executions.set("exec-1", exec1);
      executions.set("exec-2", exec2);

      const message = builder.buildWakeupMessage(events, executions);

      expect(message).toContain("i-1");
      expect(message).toContain("COMPLETED");
      expect(message).toContain("i-2");
      expect(message).toContain("FAILED");
    });

    // Await context tests
    describe("with await context", () => {
      it("should include await resolved header when resolvedAwait provided", () => {
        const events: WorkflowEvent[] = [
          createTestEvent({ type: "step_completed" }),
        ];
        const executions = new Map<string, Execution>();
        executions.set("exec-test", createTestExecution());

        const resolvedAwait = createTestResolvedAwait();

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("AWAIT RESOLVED");
      });

      it("should show what event types were being waited for", () => {
        const events: WorkflowEvent[] = [
          createTestEvent({ type: "step_completed" }),
        ];
        const executions = new Map<string, Execution>();
        executions.set("exec-test", createTestExecution());

        const resolvedAwait = createTestResolvedAwait({
          eventTypes: ["step_completed", "step_failed", "user_response"],
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("You were waiting for:");
        expect(message).toContain("step_completed");
        expect(message).toContain("step_failed");
        expect(message).toContain("user_response");
      });

      it("should show what triggered the await resolution", () => {
        const events: WorkflowEvent[] = [
          createTestEvent({ type: "step_failed" }),
        ];
        const executions = new Map<string, Execution>();
        executions.set("exec-test", createTestExecution({ status: "failed" }));

        const resolvedAwait = createTestResolvedAwait({
          resolvedBy: "step_failed",
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("Triggered by: step_failed");
      });

      it("should include await message context when provided", () => {
        const events: WorkflowEvent[] = [];
        const executions = new Map<string, Execution>();

        const resolvedAwait = createTestResolvedAwait({
          message: "Waiting for issue i-auth to complete",
          resolvedBy: "timeout",
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("Context: Waiting for issue i-auth to complete");
      });

      it("should include filtered execution IDs when provided", () => {
        const events: WorkflowEvent[] = [];
        const executions = new Map<string, Execution>();

        const resolvedAwait = createTestResolvedAwait({
          executionIds: ["exec-1", "exec-2"],
          resolvedBy: "timeout",
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("Filtered executions: exec-1, exec-2");
      });

      it("should handle timeout wakeup with no events", () => {
        const events: WorkflowEvent[] = [];
        const executions = new Map<string, Execution>();

        const resolvedAwait = createTestResolvedAwait({
          resolvedBy: "timeout",
          eventTypes: ["step_completed"],
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).toContain("AWAIT RESOLVED");
        expect(message).toContain("Triggered by: timeout");
        expect(message).toContain("timeout wakeup");
        expect(message).toContain("What would you like to do next?");
      });

      it("should not include filtered executions when empty", () => {
        const events: WorkflowEvent[] = [
          createTestEvent({ type: "step_completed" }),
        ];
        const executions = new Map<string, Execution>();
        executions.set("exec-test", createTestExecution());

        const resolvedAwait = createTestResolvedAwait({
          executionIds: [],
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        expect(message).not.toContain("Filtered executions");
      });

      it("should include both await context and event details", () => {
        const execution = createTestExecution({
          id: "exec-1",
          issue_id: "i-auth",
          status: "completed",
          summary: "Implemented OAuth",
        });

        const events: WorkflowEvent[] = [
          createTestEvent({
            type: "step_completed",
            executionId: "exec-1",
          }),
        ];

        const executions = new Map<string, Execution>();
        executions.set("exec-1", execution);

        const resolvedAwait = createTestResolvedAwait({
          eventTypes: ["step_completed"],
          resolvedBy: "step_completed",
          message: "Waiting for auth implementation",
        });

        const message = builder.buildWakeupMessage(events, executions, resolvedAwait);

        // Should have await context
        expect(message).toContain("AWAIT RESOLVED");
        expect(message).toContain("Triggered by: step_completed");
        expect(message).toContain("Context: Waiting for auth implementation");

        // Should also have execution details
        expect(message).toContain("i-auth");
        expect(message).toContain("COMPLETED");
        expect(message).toContain("Implemented OAuth");
      });
    });
  });

  describe("summarizeExecution", () => {
    it("should include issue ID and status", () => {
      const execution = createTestExecution({
        issue_id: "i-auth",
        status: "completed",
      });

      const summary = builder.summarizeExecution(execution);

      expect(summary).toContain("i-auth");
      expect(summary).toContain("COMPLETED");
      expect(summary).toContain("✓");
    });

    it("should show running status correctly", () => {
      const execution = createTestExecution({
        status: "running",
        completed_at: null,
      });

      const summary = builder.summarizeExecution(execution);

      expect(summary).toContain("RUNNING");
      expect(summary).toContain("⏳");
    });

    it("should show failed status with exit code", () => {
      const execution = createTestExecution({
        status: "failed",
        exit_code: 127,
        error_message: "Command not found",
      });

      const summary = builder.summarizeExecution(execution);

      expect(summary).toContain("FAILED");
      expect(summary).toContain("✗");
      expect(summary).toContain("Exit code: 127");
      expect(summary).toContain("Command not found");
    });

    it("should truncate long summaries", () => {
      const longSummary = "A".repeat(300);
      const execution = createTestExecution({
        summary: longSummary,
      });

      const summary = builder.summarizeExecution(execution);

      expect(summary).not.toContain(longSummary);
      expect(summary).toContain("...");
    });

    it("should handle null files_changed gracefully", () => {
      const execution = createTestExecution({
        files_changed: null,
      });

      const summary = builder.summarizeExecution(execution);

      // Should not throw, and should not include files changed line
      expect(summary).not.toContain("Files changed:");
    });

    it("should handle malformed files_changed JSON", () => {
      const execution = createTestExecution({
        files_changed: "not valid json",
      });

      const summary = builder.summarizeExecution(execution);

      // Should not throw
      expect(summary).toContain("i-test");
    });
  });
});
