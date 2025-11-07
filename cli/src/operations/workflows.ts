/**
 * Agent composition and multi-agent workflows
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPreset } from "@sudocode-ai/types";
import { getAgentPreset } from "./agents.js";

export type WorkflowStepType = "sequential" | "parallel" | "conditional";
export type WorkflowConditionType = "success" | "failure" | "always" | "custom";

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  id: string;
  agent_id: string;
  type: WorkflowStepType;
  description?: string;

  // Conditional execution
  condition?: {
    type: WorkflowConditionType;
    expression?: string; // JavaScript expression for custom conditions
  };

  // Input/output mapping
  input_mapping?: Record<string, string>; // Map previous outputs to inputs
  output_key?: string; // Key to store this step's output

  // Parallel execution
  parallel_steps?: WorkflowStep[];

  // Sequential execution
  next_step?: string; // ID of next step
  on_success?: string; // ID of step to run on success
  on_failure?: string; // ID of step to run on failure

  // Retry configuration
  max_retries?: number;
  retry_delay_ms?: number;
}

/**
 * Agent workflow definition
 */
export interface AgentWorkflow {
  id: string;
  name: string;
  description: string;
  version: string;

  // Workflow steps
  steps: WorkflowStep[];
  initial_step: string; // ID of first step to execute

  // Workflow configuration
  timeout_ms?: number;
  max_concurrent_steps?: number;

  // Metadata
  tags?: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Workflow execution context
 */
export interface WorkflowExecutionContext {
  workflow_id: string;
  execution_id: string;
  issue_id?: string;

  // Execution state
  current_step?: string;
  completed_steps: string[];
  failed_steps: string[];

  // Data flow
  step_outputs: Record<string, any>;
  global_context: Record<string, any>;

  // Timing
  started_at: string;
  completed_at?: string;

  // Status
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
}

/**
 * Create a new workflow
 */
export function createWorkflow(
  sudocodeDir: string,
  input: {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    initial_step: string;
    timeout_ms?: number;
    tags?: string[];
  }
): AgentWorkflow {
  const workflowsDir = path.join(sudocodeDir, "agents", "workflows");
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const workflow: AgentWorkflow = {
    ...input,
    version: "1.0.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Validate workflow
  const errors = validateWorkflow(sudocodeDir, workflow);
  if (errors.length > 0) {
    throw new Error(`Invalid workflow: ${errors.join(", ")}`);
  }

  // Save workflow
  const workflowPath = path.join(workflowsDir, `${input.id}.workflow.json`);
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  return workflow;
}

/**
 * Validate workflow definition
 */
export function validateWorkflow(
  sudocodeDir: string,
  workflow: AgentWorkflow
): string[] {
  const errors: string[] = [];

  // Check initial step exists
  const initialStep = workflow.steps.find((s) => s.id === workflow.initial_step);
  if (!initialStep) {
    errors.push(`Initial step not found: ${workflow.initial_step}`);
  }

  // Validate each step
  for (const step of workflow.steps) {
    // Check agent exists
    const agent = getAgentPreset(sudocodeDir, step.agent_id);
    if (!agent) {
      errors.push(`Agent not found for step ${step.id}: ${step.agent_id}`);
    }

    // Check next step references are valid
    if (step.next_step) {
      const nextStep = workflow.steps.find((s) => s.id === step.next_step);
      if (!nextStep) {
        errors.push(`Next step not found for ${step.id}: ${step.next_step}`);
      }
    }

    // Check parallel steps
    if (step.parallel_steps && step.parallel_steps.length > 0) {
      for (const parallelStep of step.parallel_steps) {
        const agent = getAgentPreset(sudocodeDir, parallelStep.agent_id);
        if (!agent) {
          errors.push(
            `Agent not found for parallel step in ${step.id}: ${parallelStep.agent_id}`
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Get workflow
 */
export function getWorkflow(
  sudocodeDir: string,
  workflowId: string
): AgentWorkflow | null {
  const workflowPath = path.join(
    sudocodeDir,
    "agents",
    "workflows",
    `${workflowId}.workflow.json`
  );

  if (!fs.existsSync(workflowPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
}

/**
 * List all workflows
 */
export function listWorkflows(sudocodeDir: string): AgentWorkflow[] {
  const workflowsDir = path.join(sudocodeDir, "agents", "workflows");

  if (!fs.existsSync(workflowsDir)) {
    return [];
  }

  const files = fs.readdirSync(workflowsDir);
  const workflows: AgentWorkflow[] = [];

  for (const file of files) {
    if (file.endsWith(".workflow.json")) {
      const workflowPath = path.join(workflowsDir, file);
      const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
      workflows.push(workflow);
    }
  }

  return workflows;
}

/**
 * Create simple sequential workflow
 */
export function createSequentialWorkflow(
  sudocodeDir: string,
  input: {
    id: string;
    name: string;
    description: string;
    agent_sequence: string[]; // Array of agent IDs in order
  }
): AgentWorkflow {
  const steps: WorkflowStep[] = input.agent_sequence.map((agentId, index) => ({
    id: `step-${index + 1}`,
    agent_id: agentId,
    type: "sequential" as WorkflowStepType,
    description: `Execute ${agentId}`,
    next_step: index < input.agent_sequence.length - 1 ? `step-${index + 2}` : undefined,
  }));

  return createWorkflow(sudocodeDir, {
    id: input.id,
    name: input.name,
    description: input.description,
    steps,
    initial_step: "step-1",
  });
}

/**
 * Create parallel workflow
 */
export function createParallelWorkflow(
  sudocodeDir: string,
  input: {
    id: string;
    name: string;
    description: string;
    parallel_agents: string[]; // Array of agent IDs to run in parallel
    aggregator_agent?: string; // Optional agent to aggregate results
  }
): AgentWorkflow {
  const steps: WorkflowStep[] = [
    {
      id: "parallel-execution",
      agent_id: input.parallel_agents[0], // First agent is the coordinator
      type: "parallel" as WorkflowStepType,
      description: "Execute agents in parallel",
      parallel_steps: input.parallel_agents.slice(1).map((agentId, index) => ({
        id: `parallel-${index + 1}`,
        agent_id: agentId,
        type: "parallel" as WorkflowStepType,
        output_key: `parallel_result_${index + 1}`,
      })),
      next_step: input.aggregator_agent ? "aggregation" : undefined,
    },
  ];

  // Add aggregator if specified
  if (input.aggregator_agent) {
    steps.push({
      id: "aggregation",
      agent_id: input.aggregator_agent,
      type: "sequential" as WorkflowStepType,
      description: "Aggregate parallel results",
      input_mapping: {
        results: "step_outputs",
      },
    });
  }

  return createWorkflow(sudocodeDir, {
    id: input.id,
    name: input.name,
    description: input.description,
    steps,
    initial_step: "parallel-execution",
  });
}

/**
 * Create review workflow (plan -> implement -> review)
 */
export function createReviewWorkflow(
  sudocodeDir: string,
  input: {
    id: string;
    name: string;
    planner_agent: string;
    implementer_agent: string;
    reviewer_agent: string;
  }
): AgentWorkflow {
  const steps: WorkflowStep[] = [
    {
      id: "planning",
      agent_id: input.planner_agent,
      type: "sequential" as WorkflowStepType,
      description: "Plan implementation approach",
      output_key: "plan",
      next_step: "implementation",
    },
    {
      id: "implementation",
      agent_id: input.implementer_agent,
      type: "sequential" as WorkflowStepType,
      description: "Implement based on plan",
      input_mapping: {
        plan: "plan",
      },
      output_key: "implementation",
      on_success: "review",
      on_failure: "planning", // Retry planning on failure
    },
    {
      id: "review",
      agent_id: input.reviewer_agent,
      type: "sequential" as WorkflowStepType,
      description: "Review implementation",
      input_mapping: {
        implementation: "implementation",
        plan: "plan",
      },
      output_key: "review_result",
      condition: {
        type: "custom",
        expression: "step_outputs.implementation?.status === 'success'",
      },
    },
  ];

  return createWorkflow(sudocodeDir, {
    id: input.id,
    name: input.name,
    description: "Plan, implement, and review workflow",
    steps,
    initial_step: "planning",
  });
}

/**
 * Delete workflow
 */
export function deleteWorkflow(sudocodeDir: string, workflowId: string): boolean {
  const workflowPath = path.join(
    sudocodeDir,
    "agents",
    "workflows",
    `${workflowId}.workflow.json`
  );

  if (!fs.existsSync(workflowPath)) {
    return false;
  }

  fs.unlinkSync(workflowPath);
  return true;
}

/**
 * Initialize workflow execution context
 */
export function initializeWorkflowExecution(
  workflow: AgentWorkflow,
  issueId?: string
): WorkflowExecutionContext {
  return {
    workflow_id: workflow.id,
    execution_id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    issue_id: issueId,
    current_step: workflow.initial_step,
    completed_steps: [],
    failed_steps: [],
    step_outputs: {},
    global_context: {},
    started_at: new Date().toISOString(),
    status: "running",
  };
}
