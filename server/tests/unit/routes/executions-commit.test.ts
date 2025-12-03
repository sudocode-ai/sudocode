import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createExecutionsRouter } from "../../../src/routes/executions.js";
import type { ExecutionService } from "../../../src/services/execution-service.js";
import type { ExecutionLogsStore } from "../../../src/services/execution-logs-store.js";
import type { Execution } from "@sudocode-ai/types";
import type { Database } from "better-sqlite3";
import * as child_process from "child_process";

// Mock child_process - need to mock both execSync and spawnSync
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof child_process>();
  return {
    ...actual,
    execSync: vi.fn(),
    spawnSync: vi.fn(),
  };
});

// Mock agent registry service
vi.mock("../../../src/services/agent-registry.js", () => {
  const implementedAgents = new Set(["claude-code"]);
  const registeredAgents = new Set([
    "claude-code",
    "codex",
    "copilot",
    "cursor",
  ]);

  return {
    agentRegistryService: {
      hasAgent: (agentType: string) => {
        return registeredAgents.has(agentType);
      },
      isAgentImplemented: (agentType: string) => {
        return implementedAgents.has(agentType);
      },
      getAvailableAgents: () => [
        { name: "claude-code", displayName: "Claude", implemented: true },
        { name: "codex", displayName: "Codex", implemented: false },
        { name: "copilot", displayName: "GitHub Copilot", implemented: false },
        { name: "cursor", displayName: "Cursor", implemented: false },
      ],
    },
  };
});

describe("POST /api/executions/:executionId/commit", () => {
  let app: Express;
  let mockExecutionService: Partial<ExecutionService>;
  let mockLogsStore: Partial<ExecutionLogsStore>;
  let mockDb: Partial<Database>;
  let mockDbPrepare: ReturnType<typeof vi.fn>;
  let mockDbRun: ReturnType<typeof vi.fn>;
  let mockDbGet: ReturnType<typeof vi.fn>;

  const mockExecution: Execution = {
    id: "exec-123",
    issue_id: "i-abc",
    issue_uuid: "uuid-123",
    agent_type: "claude-code",
    status: "completed",
    mode: "worktree",
    prompt: "Test prompt",
    config: JSON.stringify({ mode: "worktree" }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    branch_name: "feature/test-branch",
    target_branch: "main",
    before_commit: "abc123",
    after_commit: null,
    worktree_path: "/test/worktree",
    files_changed: JSON.stringify(["file1.ts", "file2.ts"]),
    session_id: null,
    workflow_execution_id: null,
    cancelled_at: null,
    exit_code: 0,
    error_message: null,
    error: null,
    model: "claude-sonnet-4",
    summary: "Test execution",
    parent_execution_id: null,
    step_type: null,
    step_index: null,
    step_config: null,
  };

  beforeEach(() => {
    // Setup mock execution service
    mockExecutionService = {
      getExecution: vi.fn().mockResolvedValue(mockExecution),
      listExecutions: vi.fn().mockReturnValue([]),
      getExecutionChain: vi.fn().mockReturnValue([]),
    };

    mockLogsStore = {
      getNormalizedEntries: vi.fn().mockReturnValue([]),
      getLogMetadata: vi.fn().mockReturnValue(null),
    };

    // Setup mock database
    mockDbRun = vi.fn();
    mockDbGet = vi.fn().mockReturnValue(mockExecution);
    mockDbPrepare = vi.fn().mockReturnValue({
      run: mockDbRun,
      get: mockDbGet,
      all: vi.fn().mockReturnValue([]),
    });
    mockDb = {
      prepare: mockDbPrepare,
    } as unknown as Database;

    // Setup Express app with executions router
    app = express();
    app.use(express.json());

    // Mock the project middleware
    app.use((req, _res, next) => {
      (req as any).project = {
        executionService: mockExecutionService,
        logsStore: mockLogsStore,
        db: mockDb,
        path: "/test/project",
      };
      next();
    });

    app.use("/api", createExecutionsRouter());

    // Mock child_process.execSync to simulate git commands
    // Return strings directly instead of Buffers
    // Track whether git add has been called to simulate staged files
    let gitAddCalled = false;
    vi.mocked(child_process.execSync).mockImplementation((command: any) => {
      const cmd = command.toString();

      if (cmd.includes("git rev-parse HEAD")) {
        return "def456\n" as any;
      }
      // Mock git status commands for detecting uncommitted files
      if (cmd.includes("git diff --name-only") && !cmd.includes("--cached")) {
        return "file1.ts\n" as any;
      }
      if (cmd.includes("git diff --cached --name-only")) {
        // After git add, return the staged files
        return gitAddCalled ? "file1.ts\nfile2.ts\n" as any : "" as any;
      }
      if (cmd.includes("git ls-files --others --exclude-standard")) {
        return "file2.ts\n" as any;
      }
      if (cmd.includes("git add")) {
        gitAddCalled = true;
        return "" as any;
      }
      if (cmd.includes("git commit")) {
        return "" as any;
      }
      return "" as any;
    });

    // Mock spawnSync for git commit (route uses spawnSync for safer message handling)
    vi.mocked(child_process.spawnSync).mockImplementation(() => {
      return {
        status: 0,
        stdout: "commit successful",
        stderr: "",
        pid: 12345,
        output: ["", "commit successful", ""],
        signal: null,
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should commit changes in worktree mode", async () => {
    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "feat: implement new feature",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.commitSha).toBe("def456");
    expect(response.body.data.filesCommitted).toBe(2);
    expect(response.body.data.branch).toBe("feature/test-branch");

    // Verify git commands were called
    expect(child_process.execSync).toHaveBeenCalledWith(
      expect.stringContaining("git add"),
      expect.any(Object)
    );
    // git commit is now called via spawnSync for safer message handling
    expect(child_process.spawnSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "feat: implement new feature"],
      expect.any(Object)
    );
    expect(child_process.execSync).toHaveBeenCalledWith(
      expect.stringContaining("git rev-parse HEAD"),
      expect.any(Object)
    );

    // Note: The implementation does NOT update execution.after_commit
    // Manual commits are tracked separately from execution completion state
  });

  it("should commit changes in local mode", async () => {
    const localExecution: Execution = {
      ...mockExecution,
      mode: "local",
      worktree_path: null,
      branch_name: null,
      config: JSON.stringify({ mode: "local" }),
    };

    // Update database mock to return local execution for this test
    mockDbGet.mockReturnValueOnce(localExecution);

    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "fix: bug fix",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.commitSha).toBe("def456");
    expect(response.body.data.branch).toBe("main");
  });

  it("should return 404 if execution not found", async () => {
    // Update database mock to return null for this test
    mockDbGet.mockReturnValueOnce(null);

    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "feat: test",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Execution not found");
  });

  it("should return 400 if commit message is missing", async () => {
    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Commit message is required and must be non-empty"
    );
  });

  it("should return 400 if no uncommitted files in working directory", async () => {
    // Mock git commands to return no uncommitted files
    vi.mocked(child_process.execSync).mockImplementation((command: any) => {
      const cmd = command.toString();

      // Return empty for all status commands
      if (cmd.includes("git diff --name-only")) {
        return "" as any;
      }
      if (cmd.includes("git diff --cached --name-only")) {
        return "" as any;
      }
      if (cmd.includes("git ls-files --others --exclude-standard")) {
        return "" as any;
      }
      return "" as any;
    });

    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "feat: test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("No files to commit");
  });

  it("should allow commits even when execution already has after_commit", async () => {
    // The implementation allows manual commits after execution completion
    // after_commit represents the state at execution time, manual commits are separate
    const committedExecution: Execution = {
      ...mockExecution,
      after_commit: "previous-commit-sha",
    };

    // Update database mock for this test
    mockDbGet.mockReturnValueOnce(committedExecution);

    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "feat: test",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.commitSha).toBe("def456");
  });

  it("should handle git command failures gracefully", async () => {
    // Mock git status commands to succeed, but git add/commit to fail
    vi.mocked(child_process.execSync).mockImplementation((command: any) => {
      const cmd = command.toString();

      // Allow status commands to succeed
      if (cmd.includes("git diff --name-only") && !cmd.includes("--cached")) {
        return "file1.ts\n" as any;
      }
      if (cmd.includes("git diff --cached --name-only")) {
        return "" as any;
      }
      if (cmd.includes("git ls-files --others --exclude-standard")) {
        return "" as any;
      }
      // Fail on git add/commit
      throw new Error("Git command failed");
    });

    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: "feat: test",
      });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Git commit failed");
  });

  it("should properly escape special characters in commit message", async () => {
    const response = await request(app)
      .post("/api/executions/exec-123/commit")
      .send({
        message: 'fix: handle "quotes" and special chars',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.commitSha).toBe("def456");

    // Verify git commands were called
    expect(child_process.execSync).toHaveBeenCalled();
  });
});
