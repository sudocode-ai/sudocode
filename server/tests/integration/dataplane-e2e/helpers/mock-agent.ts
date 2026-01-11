/**
 * Mock Agent Helper
 *
 * Provides utilities to mock agent execution for integration testing.
 * Instead of spawning real Claude Code, we intercept at the executor level
 * and simulate realistic file changes, commits, and ACP events.
 */

import { vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

/**
 * File change to simulate during execution
 */
export interface MockFileChange {
  path: string;
  content: string;
  operation: "create" | "modify" | "delete";
}

/**
 * Configuration for mock execution behavior
 */
export interface MockExecutionConfig {
  /** File changes to make during execution */
  fileChanges?: MockFileChange[];
  /** Commit message for the changes */
  commitMessage?: string;
  /** Whether execution should succeed */
  shouldSucceed?: boolean;
  /** Error message if execution fails */
  errorMessage?: string;
  /** Delay before completion (ms) */
  delay?: number;
  /** Exit code (0 for success) */
  exitCode?: number;
}

/**
 * Apply mock file changes to a worktree
 */
export function applyMockChanges(
  worktreePath: string,
  changes: MockFileChange[]
): void {
  for (const change of changes) {
    const fullPath = path.join(worktreePath, change.path);

    switch (change.operation) {
      case "create":
      case "modify":
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, change.content);
        break;
      case "delete":
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
        break;
    }
  }
}

/**
 * Commit mock changes in a worktree
 */
export function commitMockChanges(
  worktreePath: string,
  message: string
): string {
  execSync("git add .", { cwd: worktreePath, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: worktreePath, stdio: "pipe" });

  return execSync("git rev-parse HEAD", {
    cwd: worktreePath,
    encoding: "utf-8",
  }).trim();
}

/**
 * Default mock file changes for testing
 */
export const DEFAULT_MOCK_CHANGES: MockFileChange[] = [
  {
    path: "src/feature.ts",
    content: `/**
 * New feature implementation
 */
export function newFeature(): string {
  return "This is a new feature";
}
`,
    operation: "create",
  },
  {
    path: "src/index.ts",
    content: `export const greeting = "Hello, World!";
export { newFeature } from "./feature";
`,
    operation: "modify",
  },
];

/**
 * Create mock for acp-factory to prevent spawning real agents
 */
export function createAcpFactoryMock(config: MockExecutionConfig = {}) {
  const {
    fileChanges = DEFAULT_MOCK_CHANGES,
    commitMessage = "feat: implement requested changes",
    shouldSucceed = true,
    errorMessage = "Execution failed",
    delay = 100,
    exitCode = 0,
  } = config;

  let worktreePath: string | null = null;

  const createMockSession = (overrides: any = {}) => ({
    id: `test-session-${Date.now()}`,
    cwd: worktreePath || "/test/workdir",
    modes: ["code"],
    models: ["claude-sonnet-4"],
    prompt: vi.fn().mockImplementation(async function* () {
      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Apply file changes if we have a worktree path
      if (worktreePath && shouldSucceed) {
        applyMockChanges(worktreePath, fileChanges);

        // Yield agent messages to simulate real execution
        yield {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "I'll implement the requested changes.\n\n" },
        };

        // Simulate tool calls for each file change
        for (const change of fileChanges) {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "tool_call",
              tool_call: {
                id: `tool-${Date.now()}`,
                name: change.operation === "delete" ? "Bash" : "Write",
                input: { path: change.path },
              },
            },
          };

          yield {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "tool_result",
              tool_result: {
                id: `tool-${Date.now()}`,
                result: `${change.operation} ${change.path} successfully`,
              },
            },
          };
        }

        // Commit the changes
        commitMockChanges(worktreePath, commitMessage);

        yield {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "\n\nChanges committed successfully." },
        };
      }

      // Yield completion
      yield {
        sessionUpdate: "turn_complete",
        result: shouldSucceed ? "success" : "error",
        exitCode: shouldSucceed ? 0 : exitCode,
        error: shouldSucceed ? undefined : errorMessage,
      };
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const createMockAgent = (sessionOverrides: any = {}) => ({
    capabilities: { loadSession: true },
    createSession: vi.fn().mockImplementation(async (options: any) => {
      // Capture the working directory for file changes
      worktreePath = options?.cwd || null;
      return createMockSession(sessionOverrides);
    }),
    loadSession: vi.fn().mockImplementation(async (options: any) => {
      worktreePath = options?.cwd || null;
      return createMockSession(sessionOverrides);
    }),
    close: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
  });

  return {
    AgentFactory: {
      spawn: vi.fn().mockImplementation(() => Promise.resolve(createMockAgent())),
      listAgents: vi
        .fn()
        .mockReturnValue(["claude-code", "codex", "gemini", "opencode"]),
      getConfig: vi.fn(),
    },
    __createMockSession: createMockSession,
    __createMockAgent: createMockAgent,
    __setWorktreePath: (path: string) => {
      worktreePath = path;
    },
  };
}

/**
 * Simulate execution completing with changes applied
 *
 * This is used when we can't fully mock the executor but want to
 * simulate the end state of a successful execution.
 */
export async function simulateExecutionComplete(
  db: any,
  executionId: string,
  worktreePath: string,
  config: MockExecutionConfig = {}
): Promise<void> {
  const {
    fileChanges = DEFAULT_MOCK_CHANGES,
    commitMessage = "feat: implement requested changes",
    shouldSucceed = true,
    exitCode = 0,
  } = config;

  if (shouldSucceed) {
    // Apply changes and commit
    applyMockChanges(worktreePath, fileChanges);
    const afterCommit = commitMockChanges(worktreePath, commitMessage);

    // Update execution record
    db.prepare(
      `
      UPDATE executions
      SET status = 'completed',
          after_commit = ?,
          exit_code = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(afterCommit, exitCode, executionId);
  } else {
    // Mark as failed
    db.prepare(
      `
      UPDATE executions
      SET status = 'failed',
          exit_code = ?,
          error_message = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(config.exitCode || 1, config.errorMessage || "Execution failed", executionId);
  }
}

/**
 * Create conflicting changes on the target branch
 *
 * Used to test conflict detection and resolution.
 */
export function createConflictingChanges(
  repoPath: string,
  targetBranch: string,
  conflictFile: string,
  conflictContent: string
): string {
  // Get current branch
  const currentBranch = execSync("git branch --show-current", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  // Switch to target branch
  execSync(`git checkout ${targetBranch}`, { cwd: repoPath, stdio: "pipe" });

  // Make conflicting change
  const fullPath = path.join(repoPath, conflictFile);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, conflictContent);

  execSync("git add .", { cwd: repoPath, stdio: "pipe" });
  execSync('git commit -m "Create conflicting change"', {
    cwd: repoPath,
    stdio: "pipe",
  });

  const commitHash = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  // Switch back
  if (currentBranch) {
    execSync(`git checkout ${currentBranch}`, { cwd: repoPath, stdio: "pipe" });
  }

  return commitHash;
}
