/**
 * Workflow Test Setup Utilities
 *
 * Helper functions for creating test databases, fixtures, and wait utilities
 * for workflow integration and E2E testing.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  DB_CONFIG,
  ISSUES_TABLE,
  SPECS_TABLE,
  EXECUTIONS_TABLE,
  EXECUTION_LOGS_TABLE,
  WORKFLOWS_TABLE,
  WORKFLOW_EVENTS_TABLE,
  RELATIONSHIPS_TABLE,
} from "@sudocode-ai/types/schema";
import { runMigrations } from "@sudocode-ai/types/migrations";
import type {
  Workflow,
  WorkflowSource,
  WorkflowStatus,
  WorkflowStepStatus,
  WorkflowConfig,
  WorkflowStep,
} from "@sudocode-ai/types";

// =============================================================================
// Database Helpers
// =============================================================================

/**
 * Create an in-memory SQLite database with full workflow schema
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(":memory:");

  // Apply configuration
  db.exec(DB_CONFIG);

  // Create tables in order (respecting foreign keys)
  db.exec(SPECS_TABLE);
  db.exec(ISSUES_TABLE);
  db.exec(RELATIONSHIPS_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);
  db.exec(WORKFLOWS_TABLE);
  db.exec(WORKFLOW_EVENTS_TABLE);

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Create a file-based SQLite database (for MCP subprocess tests)
 */
export function createFileDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Apply configuration
  db.exec(DB_CONFIG);

  // Create tables
  db.exec(SPECS_TABLE);
  db.exec(ISSUES_TABLE);
  db.exec(RELATIONSHIPS_TABLE);
  db.exec(EXECUTIONS_TABLE);
  db.exec(EXECUTION_LOGS_TABLE);
  db.exec(WORKFLOWS_TABLE);
  db.exec(WORKFLOW_EVENTS_TABLE);

  // Run migrations
  runMigrations(db);

  return db;
}

// =============================================================================
// Fixture Helpers
// =============================================================================

export interface TestIssueData {
  id: string;
  title: string;
  status?: string;
  content?: string;
  priority?: number;
}

export interface TestSpecData {
  id: string;
  title: string;
  content?: string;
  priority?: number;
}

export interface TestDependency {
  from: string;
  to: string;
  type: "blocks" | "depends-on";
}

/**
 * Create test issues in the database
 */
export function createTestIssues(
  db: Database.Database,
  issues: TestIssueData[]
): void {
  const stmt = db.prepare(`
    INSERT INTO issues (id, uuid, title, status, content, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const issue of issues) {
    stmt.run(
      issue.id,
      uuidv4(),
      issue.title,
      issue.status || "open",
      issue.content || `Content for ${issue.title}`,
      issue.priority ?? 2
    );
  }
}

/**
 * Create test specs in the database
 */
export function createTestSpecs(
  db: Database.Database,
  specs: TestSpecData[]
): void {
  const stmt = db.prepare(`
    INSERT INTO specs (id, uuid, title, content, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const spec of specs) {
    stmt.run(
      spec.id,
      uuidv4(),
      spec.title,
      spec.content || `Specification: ${spec.title}`,
      spec.priority ?? 2
    );
  }
}

/**
 * Create issue dependencies (blocks/depends-on relationships)
 */
export function createIssueDependencies(
  db: Database.Database,
  deps: TestDependency[]
): void {
  const stmt = db.prepare(`
    INSERT INTO relationships (from_id, from_uuid, from_type, to_id, to_uuid, to_type, relationship_type, created_at)
    VALUES (?, ?, 'issue', ?, ?, 'issue', ?, CURRENT_TIMESTAMP)
  `);

  for (const dep of deps) {
    // Get UUIDs for the issues
    const fromIssue = db
      .prepare("SELECT uuid FROM issues WHERE id = ?")
      .get(dep.from) as { uuid: string } | undefined;
    const toIssue = db
      .prepare("SELECT uuid FROM issues WHERE id = ?")
      .get(dep.to) as { uuid: string } | undefined;

    if (fromIssue && toIssue) {
      stmt.run(dep.from, fromIssue.uuid, dep.to, toIssue.uuid, dep.type);
    }
  }
}

export interface CreateWorkflowData {
  id?: string;
  title?: string;
  source: WorkflowSource;
  status?: WorkflowStatus;
  config?: Partial<WorkflowConfig>;
  steps?: WorkflowStep[];
}

/**
 * Create a test workflow in the database
 */
export function createTestWorkflow(
  db: Database.Database,
  data: CreateWorkflowData
): Workflow {
  const id = data.id || `wf-${uuidv4().substring(0, 8)}`;
  const title = data.title || "Test Workflow";
  const status = data.status || "pending";

  // Build steps from source if not provided
  let steps = data.steps || [];
  if (steps.length === 0 && data.source.type === "issues") {
    steps = data.source.issueIds.map((issueId, index) => ({
      id: `step-${index + 1}`,
      issueId,
      index,
      dependencies: [],
      status: "pending" as WorkflowStepStatus,
    }));
  }

  const config: WorkflowConfig = {
    parallelism: "sequential",
    onFailure: "pause",
    autoCommitAfterStep: true,
    defaultAgentType: "claude-code",
    autonomyLevel: "human_in_the_loop",
    ...data.config,
  };

  const stmt = db.prepare(`
    INSERT INTO workflows (
      id, title, source, status, steps, base_branch,
      current_step_index, config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    id,
    title,
    JSON.stringify(data.source),
    status,
    JSON.stringify(steps),
    "main",
    0,
    JSON.stringify(config)
  );

  return getWorkflow(db, id)!;
}

/**
 * Get a workflow from the database
 */
export function getWorkflow(
  db: Database.Database,
  id: string
): Workflow | null {
  try {
    const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as
      | any
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      source: JSON.parse(row.source),
      status: row.status,
      steps: JSON.parse(row.steps || "[]"),
      worktreePath: row.worktree_path,
      branchName: row.branch_name,
      baseBranch: row.base_branch,
      currentStepIndex: row.current_step_index,
      orchestratorExecutionId: row.orchestrator_execution_id,
      orchestratorSessionId: row.orchestrator_session_id,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  } catch {
    // Database may be closed during test cleanup
    return null;
  }
}

/**
 * Update a workflow in the database
 */
export function updateWorkflow(
  db: Database.Database,
  id: string,
  updates: Partial<{
    status: WorkflowStatus;
    steps: WorkflowStep[];
    currentStepIndex: number;
    orchestratorExecutionId: string;
  }>
): Workflow | null {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.steps !== undefined) {
    fields.push("steps = ?");
    values.push(JSON.stringify(updates.steps));
  }
  if (updates.currentStepIndex !== undefined) {
    fields.push("current_step_index = ?");
    values.push(updates.currentStepIndex);
  }
  if (updates.orchestratorExecutionId !== undefined) {
    fields.push("orchestrator_execution_id = ?");
    values.push(updates.orchestratorExecutionId);
  }

  if (fields.length > 0) {
    fields.push("updated_at = CURRENT_TIMESTAMP");
    const sql = `UPDATE workflows SET ${fields.join(", ")} WHERE id = ?`;
    db.prepare(sql).run(...values, id);
  }

  return getWorkflow(db, id);
}

/**
 * Create an execution record in the database
 */
export function createExecution(
  db: Database.Database,
  data: {
    id: string;
    issueId?: string | null;
    agentType?: string;
    mode?: string;
    prompt?: string;
    status?: string;
    workflowExecutionId?: string;
    branchName?: string;
  }
): any {
  const branchName = data.branchName || `sudocode/exec-${data.id}`;

  const stmt = db.prepare(`
    INSERT INTO executions (
      id, issue_id, agent_type, mode, prompt, status,
      workflow_execution_id, target_branch, branch_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  stmt.run(
    data.id,
    data.issueId ?? null,
    data.agentType || "claude-code",
    data.mode || "worktree",
    data.prompt || "Test prompt",
    data.status || "pending",
    data.workflowExecutionId || null,
    "main",
    branchName
  );

  return db.prepare("SELECT * FROM executions WHERE id = ?").get(data.id);
}

/**
 * Update an execution status
 */
export function updateExecution(
  db: Database.Database,
  id: string,
  updates: Record<string, any>
): any {
  try {
    const fields = Object.keys(updates);
    const values = Object.values(updates);

    if (fields.length > 0) {
      const setClause = fields.map((f) => `${f} = ?`).join(", ");
      db.prepare(`UPDATE executions SET ${setClause} WHERE id = ?`).run(
        ...values,
        id
      );
    }

    return db.prepare("SELECT * FROM executions WHERE id = ?").get(id);
  } catch {
    // Database may be closed during test cleanup
    return null;
  }
}

// =============================================================================
// Wait Helpers
// =============================================================================

/**
 * Wait for a condition to be true with polling
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const result = await condition();
    if (result) return;

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Wait for workflow to reach a specific status
 */
export async function waitForWorkflowStatus(
  db: Database.Database,
  workflowId: string,
  targetStatus: WorkflowStatus,
  timeoutMs = 10000
): Promise<Workflow> {
  await waitFor(() => {
    const workflow = getWorkflow(db, workflowId);
    return workflow?.status === targetStatus;
  }, timeoutMs);

  return getWorkflow(db, workflowId)!;
}

/**
 * Wait for a step to reach a specific status
 */
export async function waitForStepStatus(
  db: Database.Database,
  workflowId: string,
  stepId: string,
  targetStatus: WorkflowStepStatus,
  timeoutMs = 10000
): Promise<WorkflowStep> {
  let foundStep: WorkflowStep | undefined;

  await waitFor(() => {
    const workflow = getWorkflow(db, workflowId);
    if (!workflow) return false;

    foundStep = workflow.steps.find((s) => s.id === stepId);
    return foundStep?.status === targetStatus;
  }, timeoutMs);

  return foundStep!;
}

// =============================================================================
// WebSocket Helpers
// =============================================================================

export interface WebSocketMessage {
  type: string;
  projectId?: string;
  data?: any;
}

/**
 * Wait for a specific WebSocket event
 */
export function waitForWebSocketEvent(
  messages: WebSocketMessage[],
  eventType: string,
  timeoutMs = 5000
): Promise<WebSocketMessage> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const found = messages.find((m) => m.type === eventType);
      if (found) {
        resolve(found);
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        reject(
          new Error(
            `Timeout waiting for WebSocket event: ${eventType} after ${timeoutMs}ms`
          )
        );
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}

// =============================================================================
// Cleanup Helpers
// =============================================================================

/**
 * Clean up test database
 */
export function cleanup(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Reset database between tests (delete all data but keep schema)
 */
export function resetDatabase(db: Database.Database): void {
  db.exec("DELETE FROM workflow_events");
  db.exec("DELETE FROM workflows");
  db.exec("DELETE FROM execution_logs");
  db.exec("DELETE FROM executions");
  db.exec("DELETE FROM relationships");
  db.exec("DELETE FROM issues");
  db.exec("DELETE FROM specs");
}
