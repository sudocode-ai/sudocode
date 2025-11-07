/**
 * Tests for agent workflows and composition
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  createWorkflow,
  validateWorkflow,
  getWorkflow,
  listWorkflows,
  createSequentialWorkflow,
  createParallelWorkflow,
  createReviewWorkflow,
  deleteWorkflow,
  initializeWorkflowExecution,
  type AgentWorkflow,
  type WorkflowStep,
} from "../../src/operations/workflows.js";
import {
  initializeAgentsDirectory,
  createAgentPreset,
} from "../../src/operations/agents.js";

describe("Agent Workflows", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    // Create temporary test directory
    const timestamp = Date.now();
    testDir = path.join("/tmp", `workflow-test-${timestamp}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);

    // Create test agents
    createAgentPreset(sudocodeDir, {
      id: "planner",
      name: "Planner",
      description: "Plans implementations",
      agent_type: "claude-code",
      system_prompt: "Plan",
    });

    createAgentPreset(sudocodeDir, {
      id: "implementer",
      name: "Implementer",
      description: "Implements features",
      agent_type: "claude-code",
      system_prompt: "Implement",
    });

    createAgentPreset(sudocodeDir, {
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      agent_type: "claude-code",
      system_prompt: "Review",
    });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createWorkflow", () => {
    it("should create a basic workflow", () => {
      const steps: WorkflowStep[] = [
        {
          id: "step1",
          agent_id: "planner",
          type: "sequential",
          next_step: "step2",
        },
        {
          id: "step2",
          agent_id: "implementer",
          type: "sequential",
        },
      ];

      const workflow = createWorkflow(sudocodeDir, {
        id: "test-workflow",
        name: "Test Workflow",
        description: "A test workflow",
        steps,
        initial_step: "step1",
      });

      expect(workflow.id).toBe("test-workflow");
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.steps.length).toBe(2);
      expect(workflow.initial_step).toBe("step1");
      expect(workflow.version).toBe("1.0.0");
    });

    it("should save workflow to file", () => {
      const steps: WorkflowStep[] = [
        {
          id: "step1",
          agent_id: "planner",
          type: "sequential",
        },
      ];

      createWorkflow(sudocodeDir, {
        id: "save-test",
        name: "Save Test",
        description: "Test saving",
        steps,
        initial_step: "step1",
      });

      const workflowPath = path.join(
        sudocodeDir,
        "agents",
        "workflows",
        "save-test.workflow.json"
      );
      expect(fs.existsSync(workflowPath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
      expect(saved.id).toBe("save-test");
    });
  });

  describe("validateWorkflow", () => {
    it("should validate valid workflow", () => {
      const steps: WorkflowStep[] = [
        {
          id: "step1",
          agent_id: "planner",
          type: "sequential",
        },
      ];

      const workflow: AgentWorkflow = {
        id: "valid",
        name: "Valid",
        description: "Valid workflow",
        version: "1.0.0",
        steps,
        initial_step: "step1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateWorkflow(sudocodeDir, workflow);
      expect(errors.length).toBe(0);
    });

    it("should detect missing initial step", () => {
      const workflow: AgentWorkflow = {
        id: "invalid",
        name: "Invalid",
        description: "Invalid workflow",
        version: "1.0.0",
        steps: [],
        initial_step: "nonexistent",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateWorkflow(sudocodeDir, workflow);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Initial step not found");
    });

    it("should detect missing agent", () => {
      const steps: WorkflowStep[] = [
        {
          id: "step1",
          agent_id: "nonexistent-agent",
          type: "sequential",
        },
      ];

      const workflow: AgentWorkflow = {
        id: "invalid",
        name: "Invalid",
        description: "Invalid workflow",
        version: "1.0.0",
        steps,
        initial_step: "step1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateWorkflow(sudocodeDir, workflow);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Agent not found");
    });
  });

  describe("createSequentialWorkflow", () => {
    it("should create sequential workflow", () => {
      const workflow = createSequentialWorkflow(sudocodeDir, {
        id: "sequential",
        name: "Sequential Workflow",
        description: "Runs agents in sequence",
        agent_sequence: ["planner", "implementer", "reviewer"],
      });

      expect(workflow.steps.length).toBe(3);
      expect(workflow.steps[0].agent_id).toBe("planner");
      expect(workflow.steps[0].next_step).toBe("step-2");
      expect(workflow.steps[1].agent_id).toBe("implementer");
      expect(workflow.steps[1].next_step).toBe("step-3");
      expect(workflow.steps[2].agent_id).toBe("reviewer");
      expect(workflow.steps[2].next_step).toBeUndefined();
    });
  });

  describe("createParallelWorkflow", () => {
    it("should create parallel workflow", () => {
      const workflow = createParallelWorkflow(sudocodeDir, {
        id: "parallel",
        name: "Parallel Workflow",
        description: "Runs agents in parallel",
        parallel_agents: ["planner", "implementer", "reviewer"],
      });

      expect(workflow.steps.length).toBe(1);
      expect(workflow.steps[0].type).toBe("parallel");
      expect(workflow.steps[0].parallel_steps?.length).toBe(2);
    });

    it("should support aggregator agent", () => {
      const workflow = createParallelWorkflow(sudocodeDir, {
        id: "parallel-with-aggregator",
        name: "Parallel With Aggregator",
        description: "Runs agents in parallel with aggregator",
        parallel_agents: ["planner", "implementer"],
        aggregator_agent: "reviewer",
      });

      expect(workflow.steps.length).toBe(2);
      expect(workflow.steps[1].agent_id).toBe("reviewer");
      expect(workflow.steps[1].id).toBe("aggregation");
    });
  });

  describe("createReviewWorkflow", () => {
    it("should create review workflow", () => {
      const workflow = createReviewWorkflow(sudocodeDir, {
        id: "review",
        name: "Review Workflow",
        planner_agent: "planner",
        implementer_agent: "implementer",
        reviewer_agent: "reviewer",
      });

      expect(workflow.steps.length).toBe(3);

      const planningStep = workflow.steps.find((s) => s.id === "planning");
      expect(planningStep?.agent_id).toBe("planner");
      expect(planningStep?.output_key).toBe("plan");

      const implementationStep = workflow.steps.find(
        (s) => s.id === "implementation"
      );
      expect(implementationStep?.agent_id).toBe("implementer");
      expect(implementationStep?.on_success).toBe("review");

      const reviewStep = workflow.steps.find((s) => s.id === "review");
      expect(reviewStep?.agent_id).toBe("reviewer");
    });
  });

  describe("getWorkflow and listWorkflows", () => {
    beforeEach(() => {
      createSequentialWorkflow(sudocodeDir, {
        id: "workflow1",
        name: "Workflow 1",
        description: "First workflow",
        agent_sequence: ["planner"],
      });

      createSequentialWorkflow(sudocodeDir, {
        id: "workflow2",
        name: "Workflow 2",
        description: "Second workflow",
        agent_sequence: ["implementer"],
      });
    });

    it("should get specific workflow", () => {
      const workflow = getWorkflow(sudocodeDir, "workflow1");
      expect(workflow).toBeDefined();
      expect(workflow?.id).toBe("workflow1");
      expect(workflow?.name).toBe("Workflow 1");
    });

    it("should return null for nonexistent workflow", () => {
      const workflow = getWorkflow(sudocodeDir, "nonexistent");
      expect(workflow).toBeNull();
    });

    it("should list all workflows", () => {
      const workflows = listWorkflows(sudocodeDir);
      expect(workflows.length).toBe(2);

      const ids = workflows.map((w) => w.id);
      expect(ids).toContain("workflow1");
      expect(ids).toContain("workflow2");
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete workflow", () => {
      createSequentialWorkflow(sudocodeDir, {
        id: "to-delete",
        name: "To Delete",
        description: "Will be deleted",
        agent_sequence: ["planner"],
      });

      const result = deleteWorkflow(sudocodeDir, "to-delete");
      expect(result).toBe(true);

      const workflow = getWorkflow(sudocodeDir, "to-delete");
      expect(workflow).toBeNull();
    });

    it("should return false for nonexistent workflow", () => {
      const result = deleteWorkflow(sudocodeDir, "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("initializeWorkflowExecution", () => {
    it("should initialize execution context", () => {
      const workflow = createSequentialWorkflow(sudocodeDir, {
        id: "exec-test",
        name: "Execution Test",
        description: "Test execution",
        agent_sequence: ["planner", "implementer"],
      });

      const context = initializeWorkflowExecution(workflow, "ISSUE-001");

      expect(context.workflow_id).toBe("exec-test");
      expect(context.issue_id).toBe("ISSUE-001");
      expect(context.current_step).toBe("step-1");
      expect(context.completed_steps).toEqual([]);
      expect(context.status).toBe("running");
      expect(context.execution_id).toBeDefined();
    });
  });
});
