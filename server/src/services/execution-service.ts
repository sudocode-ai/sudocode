/**
 * Execution Service
 *
 * High-level service for managing issue-to-execution transformations.
 * Coordinates between template rendering, worktree management, and workflow execution.
 *
 * @module services/execution-service
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";
import * as TOML from "@iarna/toml";
import type Database from "better-sqlite3";
import type { Execution, ExecutionStatus } from "@sudocode-ai/types";
import { ExecutionLifecycleService } from "./execution-lifecycle.js";
import {
  createExecution,
  getExecution,
  updateExecution,
} from "./executions.js";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import type { ExecutionTask } from "agent-execution-engine/engine";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import { ExecutionLogsStore } from "./execution-logs-store.js";
import { ExecutionWorkerPool } from "./execution-worker-pool.js";
import { broadcastExecutionUpdate } from "./websocket.js";
import { createExecutorForAgent } from "../execution/executors/executor-factory.js";
import type { AgentType } from "@sudocode-ai/types/agents";
import { PromptResolver } from "./prompt-resolver.js";
import { execFileNoThrow } from "../utils/execFileNoThrow.js";
import type { NarrationConfig } from "./narration-service.js";
import { getNarrationConfig } from "./narration-service.js";
import { readVoiceConfig, isVoiceBroadcastEnabled } from "../utils/voice-config.js";

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  type?: string;
  command: string;
  tools?: string[];
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Configuration for creating an execution
 */
export interface ExecutionConfig {
  mode?: "worktree" | "local";
  model?: string;
  timeout?: number;
  baseBranch?: string;
  createBaseBranch?: boolean;
  branchName?: string;
  reuseWorktreePath?: string; // If set, reuse existing worktree at this path
  checkpointInterval?: number;
  continueOnStepFailure?: boolean;
  captureFileChanges?: boolean;
  captureToolCalls?: boolean;
  /** MCP servers to connect to the agent */
  mcpServers?: Record<string, McpServerConfig>;
  /** System prompt to append to agent's default prompt */
  appendSystemPrompt?: string;
  /** Skip permission prompts (for automated/orchestrator executions) */
  dangerouslySkipPermissions?: boolean;
  /** Resume a previous Claude Code session by session ID */
  resume?: string;
  /** Parent execution ID to link resumed/follow-up executions */
  parentExecutionId?: string;
  /**
   * Voice narration configuration for this execution.
   * Controls what gets narrated (e.g., only assistant_message and speak tool).
   * Set narrateToolUse: false to disable narrating Read, Write, Bash, etc.
   */
  narrationConfig?: Partial<NarrationConfig>;
}

/**
 * Workflow context for executions spawned by workflows
 */
export interface WorkflowContext {
  /** The workflow ID that spawned this execution */
  workflowId: string;
  /** The workflow step ID this execution implements */
  stepId: string;
}

/**
 * Build worktree context string to append to system prompt.
 *
 * This helps agents understand they're working in an isolated worktree
 * and should only edit files within that worktree.
 *
 * @param worktreePath - Path to the worktree directory
 * @param branchName - Name of the branch in the worktree
 * @param repoPath - Path to the main repository
 * @returns System prompt context string, or empty string if not in worktree mode
 */
function buildWorktreeSystemPromptContext(
  worktreePath: string | undefined,
  branchName: string | undefined,
  repoPath: string
): string {
  if (!worktreePath) {
    return "";
  }

  return `
## Worktree Context

You are working in an **isolated git worktree**, not the main repository.

- **Worktree path**: ${worktreePath}
- **Branch**: ${branchName || "unknown"}
- **Main repository**: ${repoPath}

**IMPORTANT**: You MUST only read and edit files within the worktree directory (${worktreePath}).
Do NOT attempt to read or edit files in the main repository (${repoPath}) or any other directory outside the worktree.
All file paths you use should be relative to or within: ${worktreePath}

This isolation ensures your changes don't affect other work in progress.
`;
}

/**
 * ExecutionService
 *
 * Manages the full lifecycle of issue-based executions:
 * - Creating and starting executions with worktree isolation
 * - Creating follow-up executions that reuse worktrees
 * - Canceling and cleaning up executions
 */
export class ExecutionService {
  private db: Database.Database;
  private projectId: string;
  private lifecycleService: ExecutionLifecycleService;
  private repoPath: string;
  private transportManager?: TransportManager;
  private logsStore: ExecutionLogsStore;
  private workerPool?: ExecutionWorkerPool;

  /**
   * Create a new ExecutionService
   *
   * @param db - Database instance
   * @param projectId - Project ID for WebSocket broadcasts
   * @param repoPath - Path to the git repository
   * @param lifecycleService - Optional execution lifecycle service (creates one if not provided)
   * @param transportManager - Optional transport manager for SSE streaming
   * @param logsStore - Optional execution logs store (creates one if not provided)
   * @param workerPool - Optional worker pool for isolated execution processes
   */
  constructor(
    db: Database.Database,
    projectId: string,
    repoPath: string,
    lifecycleService?: ExecutionLifecycleService,
    transportManager?: TransportManager,
    logsStore?: ExecutionLogsStore,
    workerPool?: ExecutionWorkerPool
  ) {
    this.db = db;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this.lifecycleService =
      lifecycleService || new ExecutionLifecycleService(db, repoPath);
    this.transportManager = transportManager;
    this.logsStore = logsStore || new ExecutionLogsStore(db);
    this.workerPool = workerPool;
  }

  /**
   * Create and start execution
   *
   * Creates an execution record, sets up worktree (if needed), and starts
   * workflow execution. Returns the execution record immediately while
   * workflow runs in the background.
   *
   * @param issueId - ID of issue to execute, or null for orchestrator executions
   * @param config - Execution configuration
   * @param prompt - Rendered prompt to execute
   * @param agentType - Type of agent to use (defaults to 'claude-code')
   * @param workflowContext - Optional workflow context for workflow-spawned executions
   * @returns Created execution record
   */
  async createExecution(
    issueId: string | null,
    config: ExecutionConfig,
    prompt: string,
    agentType: AgentType = "claude-code",
    workflowContext?: WorkflowContext
  ): Promise<Execution> {
    // 1. Validate
    if (!prompt.trim()) {
      throw new Error("Prompt cannot be empty");
    }

    // 2. Build execution config with auto-injected MCP servers
    const mergedConfig = await this.buildExecutionConfig(agentType, config);

    // Get issue if issueId is provided (orchestrator executions don't have an issue)
    let issue: { id: string; title: string } | undefined;
    if (issueId) {
      issue = this.db
        .prepare("SELECT * FROM issues WHERE id = ?")
        .get(issueId) as { id: string; title: string } | undefined;

      if (!issue) {
        throw new Error(`Issue ${issueId} not found`);
      }
    }

    // Get the current branch as default (instead of hardcoding "main")
    let defaultBranch = "main";
    try {
      defaultBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.repoPath,
        encoding: "utf-8",
      }).trim();
    } catch {
      // Fall back to "main" if we can't determine current branch
    }

    // 3. Determine execution mode and create execution with worktree
    // Store the original (unexpanded) prompt in the database
    const mode = mergedConfig.mode || "worktree";
    let execution: Execution;
    let workDir: string;

    // Worktree mode requires either an issue or a reuseWorktreePath
    if (mode === "worktree" && !issueId && !mergedConfig.reuseWorktreePath) {
      throw new Error(
        "Worktree mode requires either an issueId or reuseWorktreePath"
      );
    }

    if (mode === "worktree" && (issueId || mergedConfig.reuseWorktreePath)) {
      // Check if we're reusing an existing worktree
      if (mergedConfig.reuseWorktreePath) {
        // Validate worktree exists
        if (!fs.existsSync(mergedConfig.reuseWorktreePath)) {
          throw new Error(
            `Cannot reuse worktree: path does not exist: ${mergedConfig.reuseWorktreePath}`
          );
        }

        // Validate it's a git worktree by checking for .git
        const gitPath = path.join(mergedConfig.reuseWorktreePath, ".git");
        if (!fs.existsSync(gitPath)) {
          throw new Error(
            `Cannot reuse worktree: not a valid git worktree: ${mergedConfig.reuseWorktreePath}`
          );
        }

        // Get branch name from the worktree
        let branchName: string;
        try {
          branchName = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: mergedConfig.reuseWorktreePath,
            encoding: "utf-8",
          }).trim();
        } catch {
          throw new Error(
            `Cannot reuse worktree: failed to get branch name from: ${mergedConfig.reuseWorktreePath}`
          );
        }

        // Capture before_commit from the reused worktree
        let beforeCommit: string | undefined;
        try {
          beforeCommit = execSync("git rev-parse HEAD", {
            cwd: mergedConfig.reuseWorktreePath,
            encoding: "utf-8",
          }).trim();
          console.log(
            `[ExecutionService] Captured before_commit for reused worktree: ${beforeCommit}`
          );
        } catch (error) {
          console.warn(
            "[ExecutionService] Failed to capture before_commit for reused worktree:",
            error instanceof Error ? error.message : String(error)
          );
          // Continue - this is supplementary data
        }

        // Create execution record with the reused worktree path
        const executionId = randomUUID();
        execution = createExecution(this.db, {
          id: executionId,
          issue_id: issueId,
          agent_type: agentType,
          mode: mode,
          prompt: prompt,
          config: JSON.stringify(mergedConfig),
          target_branch: mergedConfig.baseBranch || branchName,
          branch_name: branchName,
          worktree_path: mergedConfig.reuseWorktreePath,
          parent_execution_id: mergedConfig.parentExecutionId,
          before_commit: beforeCommit,
        });

        workDir = mergedConfig.reuseWorktreePath;
      } else {
        // Create execution with isolated worktree
        // This path requires issueId and issue (reuseWorktreePath not provided)
        if (!issueId || !issue) {
          throw new Error(
            "Creating new worktree requires an issueId (use reuseWorktreePath for issue-less executions)"
          );
        }
        const result = await this.lifecycleService.createExecutionWithWorktree({
          issueId,
          issueTitle: issue.title,
          agentType: agentType,
          targetBranch: mergedConfig.baseBranch || defaultBranch,
          repoPath: this.repoPath,
          mode: mode,
          prompt: prompt, // Store original (unexpanded) prompt
          config: JSON.stringify(mergedConfig),
          createTargetBranch: mergedConfig.createBaseBranch || false,
          parentExecutionId: mergedConfig.parentExecutionId,
        });

        execution = result.execution;
        workDir = result.worktreePath;
      }
    } else {
      // Local mode - create execution without worktree
      const executionId = randomUUID();
      execution = createExecution(this.db, {
        id: executionId,
        issue_id: issueId,
        agent_type: agentType,
        mode: mode,
        prompt: prompt, // Store original (unexpanded) prompt
        config: JSON.stringify(mergedConfig),
        target_branch: mergedConfig.baseBranch || defaultBranch,
        branch_name: mergedConfig.baseBranch || defaultBranch,
        parent_execution_id: mergedConfig.parentExecutionId,
      });
      workDir = this.repoPath;

      // Capture current commit as before_commit for local mode
      try {
        const beforeCommit = execSync("git rev-parse HEAD", {
          cwd: this.repoPath,
          encoding: "utf-8",
        }).trim();
        updateExecution(this.db, executionId, {
          before_commit: beforeCommit,
        });
        // Reload execution to get updated before_commit
        const updatedExecution = getExecution(this.db, executionId);
        if (updatedExecution) {
          execution = updatedExecution;
        }
      } catch (error) {
        console.warn(
          "[ExecutionService] Failed to capture before_commit for local mode:",
          error instanceof Error ? error.message : String(error)
        );
        // Continue - this is supplementary data
      }
    }

    // 3. Update workflow context if provided
    if (workflowContext) {
      updateExecution(this.db, execution.id, {
        workflow_execution_id: workflowContext.workflowId,
      });
      // Reload execution to get updated workflow_execution_id
      const updatedExecution = getExecution(this.db, execution.id);
      if (updatedExecution) {
        execution = updatedExecution;
      }
    }

    // 4. Resolve prompt references for execution (done after storing original)
    // Pass the issue ID so the issue content is automatically included even if not explicitly mentioned
    const resolver = new PromptResolver(this.db);
    const { resolvedPrompt, errors } = await resolver.resolve(
      prompt,
      new Set(),
      issueId ?? undefined
    );
    if (errors.length > 0) {
      console.warn(`[ExecutionService] Prompt resolution warnings:`, errors);
    }

    // Initialize empty logs for this execution
    try {
      this.logsStore.initializeLogs(execution.id);
    } catch (error) {
      console.error(
        "[ExecutionService] Failed to initialize logs (non-critical):",
        {
          executionId: execution.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't fail execution creation - logs are nice-to-have
    }

    // 3. Start execution (use worker pool if available, otherwise fall back to in-process)
    if (this.workerPool) {
      // Worker pool handles all execution logic in isolated process
      const dbPath = this.db.name as string;
      await this.workerPool.startExecution(execution, this.repoPath, dbPath);

      // Broadcast execution creation
      broadcastExecutionUpdate(
        this.projectId,
        execution.id,
        "created",
        execution,
        execution.issue_id || undefined
      );

      return execution;
    }

    // 4. In-process execution with executor wrapper (fallback when no worker pool)
    // Extract agent-relevant config fields (exclude sudocode-specific fields like mode,
    // baseBranch, createBaseBranch, branchName, reuseWorktreePath, etc.)
    const {
      mode: _mode,
      baseBranch: _baseBranch,
      createBaseBranch: _createBaseBranch,
      branchName: _branchName,
      reuseWorktreePath: _reuseWorktreePath,
      checkpointInterval: _checkpointInterval,
      continueOnStepFailure: _continueOnStepFailure,
      captureFileChanges: _captureFileChanges,
      captureToolCalls: _captureToolCalls,
      narrationConfig,
      ...agentConfig
    } = mergedConfig;

    // Read voice config to determine if voice narration broadcasts are enabled
    // Also get narration settings (narrateToolUse, narrateAssistantMessages, etc.)
    const voiceConfig = readVoiceConfig(this.repoPath);
    const voiceEnabled = isVoiceBroadcastEnabled(voiceConfig);
    const voiceNarrationSettings = getNarrationConfig(voiceConfig);

    const wrapper = createExecutorForAgent(
      agentType,
      {
        workDir: this.repoPath,
        ...agentConfig,
      },
      {
        workDir: this.repoPath,
        lifecycleService: this.lifecycleService,
        logsStore: this.logsStore,
        projectId: this.projectId,
        db: this.db,
        transportManager: this.transportManager,
        // Merge narration config: voiceSettings from config.json, then execution overrides, then enabled flag
        narrationConfig: { ...voiceNarrationSettings, ...narrationConfig, enabled: voiceEnabled },
      }
    );

    // Log incoming config for debugging
    console.log("[ExecutionService] createExecution mergedConfig:", {
      hasMcpServers: !!mergedConfig.mcpServers,
      mcpServerNames: mergedConfig.mcpServers
        ? Object.keys(mergedConfig.mcpServers)
        : "none",
      hasAppendSystemPrompt: !!mergedConfig.appendSystemPrompt,
      dangerouslySkipPermissions: mergedConfig.dangerouslySkipPermissions,
    });

    // Log agentConfig being passed to executor
    console.log("[ExecutionService] agentConfig passed to executor:", {
      hasMcpServers: !!(agentConfig as any).mcpServers,
      mcpServerNames: (agentConfig as any).mcpServers
        ? Object.keys((agentConfig as any).mcpServers)
        : "none",
      hasAppendSystemPrompt: !!(agentConfig as any).appendSystemPrompt,
      dangerouslySkipPermissions: (agentConfig as any)
        .dangerouslySkipPermissions,
      allKeys: Object.keys(agentConfig),
    });

    // Build worktree context for system prompt (if in worktree mode)
    const worktreeContext = buildWorktreeSystemPromptContext(
      execution.worktree_path ?? undefined,
      execution.branch_name ?? undefined,
      this.repoPath
    );

    // Merge worktree context with any existing appendSystemPrompt
    const combinedAppendSystemPrompt = [
      worktreeContext,
      mergedConfig.appendSystemPrompt || "",
    ]
      .filter(Boolean)
      .join("\n");

    // Build execution task (prompt already resolved above)
    const task: ExecutionTask = {
      id: execution.id,
      type: "issue",
      entityId: issueId ?? undefined,
      prompt: resolvedPrompt,
      workDir: workDir,
      config: {
        timeout: mergedConfig.timeout,
      },
      metadata: {
        model: mergedConfig.model || "claude-sonnet-4",
        captureFileChanges: mergedConfig.captureFileChanges ?? true,
        captureToolCalls: mergedConfig.captureToolCalls ?? true,
        issueId: issueId ?? undefined,
        executionId: execution.id,
        mcpServers: mergedConfig.mcpServers,
        appendSystemPrompt: combinedAppendSystemPrompt || undefined,
        dangerouslySkipPermissions: mergedConfig.dangerouslySkipPermissions,
        resume: mergedConfig.resume,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    console.log("[ExecutionService] Task metadata mcpServers:", {
      hasMcpServers: !!task.metadata?.mcpServers,
      mcpServerNames: task.metadata?.mcpServers
        ? Object.keys(task.metadata.mcpServers as Record<string, unknown>)
        : "none",
    });

    // Execute with full lifecycle management (non-blocking)
    wrapper.executeWithLifecycle(execution.id, task, workDir).catch((error) => {
      console.error(
        `[ExecutionService] Execution ${execution.id} failed:`,
        error
      );
      // Error is already handled by wrapper (status updated, broadcasts sent)
    });

    // Broadcast execution creation
    broadcastExecutionUpdate(
      this.projectId,
      execution.id,
      "created",
      execution,
      execution.issue_id || undefined
    );

    return execution;
  }

  /**
   * Create follow-up execution
   *
   * For worktree-based executions: reuses the worktree and resumes the session.
   * For local/non-worktree executions: creates a new execution with feedback context.
   *
   * @param executionId - ID of previous execution to follow up on
   * @param feedback - Additional feedback/context to append to prompt
   * @param options - Optional configuration
   * @param options.includeOriginalPrompt - Whether to prepend the original issue content (default: false, assumes session resumption with full history)
   * @returns Created follow-up execution record
   */
  async createFollowUp(
    executionId: string,
    feedback: string,
    options?: {
      includeOriginalPrompt?: boolean;
    }
  ): Promise<Execution> {
    // 1. Get previous execution
    const prevExecution = getExecution(this.db, executionId);
    if (!prevExecution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const hasWorktree = !!prevExecution.worktree_path;

    // For worktree executions, check if worktree still exists on filesystem, recreate if needed
    if (hasWorktree && this.lifecycleService) {
      const fs = await import("fs");
      const worktreeExists = fs.existsSync(prevExecution.worktree_path!);

      if (!worktreeExists) {
        console.log(
          `Recreating worktree for follow-up execution: ${prevExecution.worktree_path}`
        );

        // Recreate the worktree using the same path and branch
        const worktreeManager = (this.lifecycleService as any).worktreeManager;
        await worktreeManager.createWorktree({
          repoPath: this.repoPath,
          branchName: prevExecution.branch_name,
          worktreePath: prevExecution.worktree_path,
          baseBranch: prevExecution.target_branch,
          createBranch: false, // Branch already exists, just recreate worktree
        });
      }
    }

    // TODO: Make it so follow-ups don't require an issue id.
    // 2. Build follow-up prompt (default: just feedback, assumes session resumption)
    let followUpPrompt = feedback;

    if (options?.includeOriginalPrompt) {
      // Optional: include original issue content if explicitly requested
      if (!prevExecution.issue_id) {
        throw new Error(
          "Previous execution must have an issue_id to include original prompt"
        );
      }

      // Get issue content directly from database
      const issue = this.db
        .prepare("SELECT content FROM issues WHERE id = ?")
        .get(prevExecution.issue_id) as { content: string } | undefined;

      if (!issue) {
        throw new Error(`Issue ${prevExecution.issue_id} not found`);
      }

      followUpPrompt = `${issue.content}

${feedback}`;
    }

    // 3. Create new execution record that references previous execution
    // Default to 'claude-code' if agent_type is null (for backwards compatibility)
    const agentType = (prevExecution.agent_type || "claude-code") as AgentType;

    // Determine working directory: worktree path if available, otherwise repo path (local mode)
    const workDir = hasWorktree ? prevExecution.worktree_path! : this.repoPath;

    const newExecutionId = randomUUID();
    const newExecution = createExecution(this.db, {
      id: newExecutionId,
      issue_id: prevExecution.issue_id,
      agent_type: agentType, // Use same agent as previous execution
      mode: prevExecution.mode || (hasWorktree ? "worktree" : "local"), // Inherit mode from parent
      target_branch: prevExecution.target_branch,
      branch_name: prevExecution.branch_name,
      worktree_path: prevExecution.worktree_path || undefined, // Reuse same worktree (undefined for local)
      config: prevExecution.config || undefined, // Preserve config (including cleanupMode) from previous execution
      parent_execution_id: executionId, // Link to parent execution for follow-up chain
      prompt: followUpPrompt, // Store original (unexpanded) follow-up prompt
    });

    // Initialize empty logs for this execution
    try {
      this.logsStore.initializeLogs(newExecution.id);
    } catch (error) {
      console.error(
        "[ExecutionService] Failed to initialize logs (non-critical):",
        {
          executionId: newExecution.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't fail execution creation - logs are nice-to-have
    }

    // Collect already-expanded entities from parent execution chain
    const alreadyExpandedIds =
      await this.collectExpandedEntitiesFromChain(executionId);

    // Resolve prompt references for execution (done after storing original)
    // Skip entities that were already expanded in parent executions
    const resolver = new PromptResolver(this.db);
    const { resolvedPrompt, errors } = await resolver.resolve(
      followUpPrompt,
      alreadyExpandedIds
    );
    if (errors.length > 0) {
      console.warn(
        `[ExecutionService] Follow-up prompt resolution warnings:`,
        errors
      );
    }

    // Parse config to get model and other settings
    // This is done early so we can pass it to the executor
    const parsedConfig = prevExecution.config
      ? JSON.parse(prevExecution.config)
      : {};

    // 4. Use executor wrapper with session resumption
    // IMPORTANT: Pass the full config from parent execution to preserve mcpServers,
    // dangerouslySkipPermissions, appendSystemPrompt, and other settings
    // Extract agent-relevant config fields (exclude sudocode-specific fields)
    const {
      mode: _mode,
      baseBranch: _baseBranch,
      createBaseBranch: _createBaseBranch,
      branchName: _branchName,
      reuseWorktreePath: _reuseWorktreePath,
      checkpointInterval: _checkpointInterval,
      continueOnStepFailure: _continueOnStepFailure,
      captureFileChanges: _captureFileChanges,
      captureToolCalls: _captureToolCalls,
      narrationConfig: parentNarrationConfig,
      ...parentAgentConfig
    } = parsedConfig;

    // Read voice config to determine if voice narration broadcasts are enabled
    // Also get narration settings (narrateToolUse, narrateAssistantMessages, etc.)
    const voiceConfig = readVoiceConfig(this.repoPath);
    const voiceEnabled = isVoiceBroadcastEnabled(voiceConfig);
    const voiceNarrationSettings = getNarrationConfig(voiceConfig);

    const wrapper = createExecutorForAgent(
      agentType,
      {
        workDir: this.repoPath,
        ...parentAgentConfig,
      },
      {
        workDir: this.repoPath,
        lifecycleService: this.lifecycleService,
        logsStore: this.logsStore,
        projectId: this.projectId,
        db: this.db,
        transportManager: this.transportManager,
        // Merge narration config: voiceSettings from config.json, then execution overrides, then enabled flag
        narrationConfig: { ...voiceNarrationSettings, ...parentNarrationConfig, enabled: voiceEnabled },
      }
    );

    // Use previous execution's session_id (the actual Claude UUID) if available
    // This enables proper session resumption with Claude Code's --resume-session flag
    // If no session_id was captured, we can't resume - this would start a new session
    const sessionId = prevExecution.session_id;
    if (!sessionId) {
      console.warn(
        `[ExecutionService] No session_id found for execution ${executionId}, follow-up will start a new session`
      );
    }

    // Build worktree context for system prompt (if in worktree mode)
    const followUpWorktreeContext = buildWorktreeSystemPromptContext(
      newExecution.worktree_path ?? undefined,
      newExecution.branch_name ?? undefined,
      this.repoPath
    );

    // Merge worktree context with any existing appendSystemPrompt from parent config
    const followUpCombinedAppendSystemPrompt = [
      followUpWorktreeContext,
      parsedConfig.appendSystemPrompt || "",
    ]
      .filter(Boolean)
      .join("\n");

    // Build execution task for follow-up (use resolved prompt for agent)
    // IMPORTANT: Inherit ALL config from parent execution
    // This ensures orchestrator follow-ups retain dangerouslySkipPermissions, mcpServers,
    // appendSystemPrompt, and any other config fields
    const task: ExecutionTask = {
      id: newExecution.id,
      type: "issue",
      entityId: prevExecution.issue_id ?? undefined,
      prompt: resolvedPrompt,
      workDir: workDir,
      config: {
        timeout: parsedConfig.timeout,
      },
      metadata: {
        // Spread all config fields from parent execution first
        ...parsedConfig,
        // Then override specific fields for this follow-up
        model: parsedConfig.model || "claude-sonnet-4",
        captureFileChanges: parsedConfig.captureFileChanges ?? true,
        captureToolCalls: parsedConfig.captureToolCalls ?? true,
        issueId: prevExecution.issue_id ?? undefined,
        executionId: newExecution.id,
        followUpOf: executionId,
        // Override appendSystemPrompt with combined worktree context
        appendSystemPrompt: followUpCombinedAppendSystemPrompt || undefined,
      },
      priority: 0,
      dependencies: [],
      createdAt: new Date(),
    };

    console.log("[ExecutionService] Follow-up task metadata:", {
      executionId: newExecution.id,
      parentExecutionId: executionId,
      inheritedConfigKeys: Object.keys(parsedConfig),
      hasMcpServers: !!parsedConfig.mcpServers,
      mcpServerNames: parsedConfig.mcpServers
        ? Object.keys(parsedConfig.mcpServers)
        : "none",
      dangerouslySkipPermissions: parsedConfig.dangerouslySkipPermissions,
      hasAppendSystemPrompt: !!parsedConfig.appendSystemPrompt,
      model: parsedConfig.model,
    });

    // Execute follow-up (non-blocking)
    // If we have a session ID, resume the session; otherwise start a new one
    if (sessionId) {
      wrapper
        .resumeWithLifecycle(newExecution.id, sessionId, task, workDir)
        .catch((error) => {
          console.error(
            `[ExecutionService] Follow-up execution ${newExecution.id} failed:`,
            error
          );
          // Error is already handled by wrapper (status updated, broadcasts sent)
        });
    } else {
      // No session to resume, start a new execution with the follow-up prompt
      wrapper
        .executeWithLifecycle(newExecution.id, task, workDir)
        .catch((error) => {
          console.error(
            `[ExecutionService] Follow-up execution ${newExecution.id} failed:`,
            error
          );
        });
    }

    // Broadcast execution creation
    broadcastExecutionUpdate(
      this.projectId,
      newExecution.id,
      "created",
      newExecution,
      newExecution.issue_id || undefined
    );

    // Also broadcast to parent execution channel
    if (newExecution.parent_execution_id) {
      broadcastExecutionUpdate(
        this.projectId,
        newExecution.parent_execution_id,
        "updated",
        newExecution,
        newExecution.issue_id || undefined
      );
    }

    return newExecution;
  }

  /**
   * Cancel a running execution
   *
   * Stops the workflow execution and marks the execution as cancelled.
   * Optionally cleans up the worktree based on config.
   *
   * @param executionId - ID of execution to cancel
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== "running") {
      throw new Error(`Cannot cancel execution in ${execution.status} state`);
    }

    // Use worker pool cancellation if available
    if (this.workerPool && this.workerPool.hasWorker(executionId)) {
      await this.workerPool.cancelExecution(executionId);
      return; // Worker pool handles DB updates and broadcasts
    }

    // For in-process executions using AgentExecutorWrapper:
    // The wrapper manages its own lifecycle and cancellation.
    // We update the database status, which the wrapper may check,
    // or we rely on process termination to stop execution.
    // TODO: Add cancellation registry in AgentExecutorWrapper for direct process control

    // Update status in database
    updateExecution(this.db, executionId, {
      status: "stopped",
      completed_at: new Date().toISOString(),
    });

    // Broadcast status change
    const updated = getExecution(this.db, executionId);
    if (updated) {
      broadcastExecutionUpdate(
        this.projectId,
        executionId,
        "status_changed",
        updated,
        updated.issue_id || undefined
      );
    }
  }

  /**
   * Clean up execution resources
   *
   * Removes the worktree and associated files. This is called automatically
   * on workflow completion, or can be called manually.
   *
   * @param executionId - ID of execution to clean up
   */
  async cleanupExecution(executionId: string): Promise<void> {
    await this.lifecycleService.cleanupExecution(executionId);
  }

  /**
   * Check if worktree exists in filesystem for an execution
   *
   * @param executionId - ID of execution to check
   * @returns true if worktree exists, false otherwise
   */
  async worktreeExists(executionId: string): Promise<boolean> {
    const execution = getExecution(this.db, executionId);
    if (!execution || !execution.worktree_path) {
      return false;
    }

    const fs = await import("fs");
    return fs.existsSync(execution.worktree_path);
  }

  /**
   * Delete worktree for an execution
   *
   * Manually deletes the worktree for a specific execution, regardless of
   * cleanupMode configuration. This allows users to manually cleanup worktrees
   * when they're configured for manual cleanup.
   *
   * @param executionId - ID of execution whose worktree to delete
   * @param deleteBranch - Whether to also delete the execution's branch (default: false)
   * @throws Error if execution not found, has no worktree, or worktree doesn't exist
   */
  async deleteWorktree(
    executionId: string,
    deleteBranch: boolean = false
  ): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (!execution.worktree_path) {
      throw new Error(`Execution ${executionId} has no worktree to delete`);
    }

    // Check if worktree exists in the filesystem
    const fs = await import("fs");
    const worktreeExists = fs.existsSync(execution.worktree_path);

    if (!worktreeExists) {
      throw new Error(
        `Worktree does not exist in filesystem: ${execution.worktree_path}`
      );
    }

    // TODO: Cancel any running execution.

    // Get worktree manager from lifecycle service
    const worktreeManager = (this.lifecycleService as any).worktreeManager;

    // Clean up the worktree
    await worktreeManager.cleanupWorktree(
      execution.worktree_path,
      this.repoPath
    );

    // Delete branch if requested and it was created by this execution
    if (deleteBranch && execution.branch_name) {
      try {
        // A branch was created for this execution if:
        // - branch_name is DIFFERENT from target_branch (autoCreateBranches was true)
        // - This means a new worktree-specific branch was created
        const wasCreatedByExecution =
          execution.branch_name !== execution.target_branch &&
          execution.branch_name !== "(detached)";

        if (wasCreatedByExecution) {
          await worktreeManager.git.deleteBranch(
            this.repoPath,
            execution.branch_name,
            true // Force deletion
          );
          console.log(
            `[ExecutionService] Deleted execution-created branch: ${execution.branch_name}`
          );
        } else {
          console.log(
            `[ExecutionService] Skipping branch deletion - branch ${execution.branch_name} is the target branch (not created by execution)`
          );
        }
      } catch (err) {
        console.warn(
          `Failed to delete branch ${execution.branch_name} during worktree deletion:`,
          err
        );
        // Continue even if branch deletion fails
      }
    }
  }

  /**
   * Delete an execution and its entire chain
   *
   * Deletes the execution and all its follow-ups (descendants).
   * Optionally deletes the worktree and/or branch.
   *
   * @param executionId - ID of execution to delete (can be root or any execution in chain)
   * @param deleteBranch - Whether to also delete the execution's branch (default: false)
   * @param deleteWorktree - Whether to also delete the execution's worktree (default: false)
   * @throws Error if execution not found
   */
  async deleteExecution(
    executionId: string,
    deleteBranch: boolean = false,
    deleteWorktree: boolean = false
  ): Promise<void> {
    const execution = getExecution(this.db, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Find the root execution by traversing up parent_execution_id
    let rootId = executionId;
    let current = execution;
    while (current.parent_execution_id) {
      rootId = current.parent_execution_id;
      const parent = getExecution(this.db, rootId);
      if (!parent) break;
      current = parent;
    }

    // Get all executions in the chain (root + all descendants)
    const chain = this.db
      .prepare(
        `
      WITH RECURSIVE execution_chain AS (
        -- Base case: the root execution
        SELECT * FROM executions WHERE id = ?
        UNION ALL
        -- Recursive case: children of executions in the chain
        SELECT e.* FROM executions e
        INNER JOIN execution_chain ec ON e.parent_execution_id = ec.id
      )
      SELECT * FROM execution_chain
    `
      )
      .all(rootId) as Execution[];

    // Cancel any running executions in the chain
    for (const exec of chain) {
      if (exec.status === "running" || exec.status === "pending") {
        try {
          await this.cancelExecution(exec.id);
        } catch (err) {
          console.warn(
            `Failed to cancel execution ${exec.id} during deletion:`,
            err
          );
          // Continue with deletion even if cancel fails
        }
      }
    }

    // Delete worktree if requested and it exists (only for root execution)
    const rootExecution = chain.find((e) => e.id === rootId);
    if (deleteWorktree && rootExecution?.worktree_path) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(rootExecution.worktree_path)) {
          await this.deleteWorktree(rootId);
        }
      } catch (err) {
        console.warn(
          `Failed to delete worktree during execution deletion:`,
          err
        );
        // Continue with deletion even if worktree cleanup fails
      }
    }

    // Delete branch if requested and it exists
    // IMPORTANT: Only delete branches that were created specifically for this execution
    if (deleteBranch && rootExecution?.branch_name) {
      try {
        // A branch was created for this execution if:
        // - branch_name is DIFFERENT from target_branch (autoCreateBranches was true)
        // - This means a new worktree-specific branch was created
        //
        // A branch was NOT created (reusing existing) if:
        // - branch_name === target_branch (autoCreateBranches was false)
        // - This means the worktree reused the target branch directly
        const wasCreatedByExecution =
          rootExecution.branch_name !== rootExecution.target_branch &&
          rootExecution.branch_name !== "(detached)";

        if (wasCreatedByExecution) {
          // Get worktree manager from lifecycle service to access git operations
          const worktreeManager = (this.lifecycleService as any)
            .worktreeManager;

          await worktreeManager.git.deleteBranch(
            this.repoPath,
            rootExecution.branch_name,
            true // Force deletion
          );
          console.log(
            `[ExecutionService] Deleted execution-created branch: ${rootExecution.branch_name}`
          );
        } else {
          console.log(
            `[ExecutionService] Skipping branch deletion - branch ${rootExecution.branch_name} is the target branch (not created by execution)`
          );
        }
      } catch (err) {
        console.warn(
          `Failed to delete branch ${rootExecution.branch_name} during execution deletion:`,
          err
        );
        // Continue with deletion even if branch deletion fails
      }
    }

    // Delete execution logs for all executions in the chain
    for (const exec of chain) {
      try {
        this.logsStore.deleteLogs(exec.id);
      } catch (err) {
        console.warn(`Failed to delete logs for execution ${exec.id}:`, err);
        // Continue with deletion even if log cleanup fails
      }
    }

    // Delete all executions in the chain from database
    // Delete in reverse order (children first) to avoid foreign key issues
    const chainIds = chain.map((e) => e.id);
    const placeholders = chainIds.map(() => "?").join(",");
    this.db
      .prepare(`DELETE FROM executions WHERE id IN (${placeholders})`)
      .run(...chainIds);

    // Broadcast deletion event for each execution
    for (const exec of chain) {
      broadcastExecutionUpdate(
        this.projectId,
        exec.id,
        "deleted",
        { executionId: exec.id },
        exec.issue_id || undefined
      );
    }
  }

  /**
   * Shutdown execution service - cancel all active executions
   *
   * This is called during server shutdown to gracefully terminate
   * all running executions before the server exits.
   */
  async shutdown(): Promise<void> {
    // Shutdown worker pool if available
    if (this.workerPool) {
      await this.workerPool.shutdown();
    }

    // For in-process executions using AgentExecutorWrapper:
    // The wrapper manages its own lifecycle. Processes will be terminated
    // when the Node.js process exits.
    // TODO: Add active execution tracking to AgentExecutorWrapper for graceful shutdown
  }

  /**
   * List all executions for an issue
   *
   * Returns all executions associated with a specific issue,
   * ordered by creation time (most recent first).
   *
   * @param issueId - ID of issue to list executions for
   * @returns Array of executions for the issue
   */
  listExecutions(issueId: string): Execution[] {
    const executions = this.db
      .prepare(
        `
      SELECT * FROM executions
      WHERE issue_id = ?
      ORDER BY created_at DESC
    `
      )
      .all(issueId) as Execution[];

    return executions;
  }

  /**
   * Get a single execution by ID
   *
   * @param executionId - ID of execution to retrieve
   * @returns Execution or null if not found
   */
  getExecution(executionId: string): Execution | null {
    return getExecution(this.db, executionId);
  }

  /**
   * List all executions with filtering and pagination
   *
   * Returns executions across all issues with support for filtering
   * by status, issueId, and pagination.
   *
   * @param options - Filtering and pagination options
   * @param options.limit - Maximum number of executions to return (default: 50)
   * @param options.offset - Number of executions to skip (default: 0)
   * @param options.status - Filter by execution status (single or array)
   * @param options.issueId - Filter by issue ID
   * @param options.sortBy - Field to sort by (default: 'created_at')
   * @param options.order - Sort order (default: 'desc')
   * @param options.since - Only return executions created after this ISO date
   * @param options.includeRunning - When used with 'since', also include running executions regardless of age
   * @returns Object containing executions array, total count, and hasMore flag
   */
  listAll(
    options: {
      limit?: number;
      offset?: number;
      status?: ExecutionStatus | ExecutionStatus[];
      issueId?: string;
      sortBy?: "created_at" | "updated_at";
      order?: "asc" | "desc";
      since?: string;
      includeRunning?: boolean;
      tags?: string[];
    } = {}
  ): {
    executions: Execution[];
    total: number;
    hasMore: boolean;
  } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const sortBy = options.sortBy ?? "created_at";
    const order = options.order ?? "desc";

    // Validate inputs
    if (limit < 0 || offset < 0) {
      throw new Error("Limit and offset must be non-negative");
    }

    // Build WHERE clause dynamically
    const whereClauses: string[] = [];
    const params: any[] = [];

    // Filter by status (single or array)
    if (options.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      const placeholders = statuses.map(() => "?").join(",");
      whereClauses.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }

    // Filter by issueId
    if (options.issueId) {
      whereClauses.push("issue_id = ?");
      params.push(options.issueId);
    }

    // Filter by since date (with optional includeRunning)
    if (options.since) {
      if (options.includeRunning) {
        // Include executions created after 'since' OR that are currently running
        whereClauses.push("(created_at >= ? OR status = 'running')");
        params.push(options.since);
      } else {
        // Only include executions created after 'since'
        whereClauses.push("created_at >= ?");
        params.push(options.since);
      }
    }

    // Filter by tags (stored in config JSON field)
    // Uses json_each to check if any of the specified tags exist in config.tags array
    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags
        .map(() => "EXISTS (SELECT 1 FROM json_each(json_extract(config, '$.tags')) WHERE value = ?)")
        .join(" OR ");
      whereClauses.push(`(${tagConditions})`);
      params.push(...options.tags);
    }

    // Build WHERE clause
    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM executions ${whereClause}`;
    const countResult = this.db.prepare(countQuery).get(...params) as {
      count: number;
    };
    const total = countResult.count;

    // Get executions with pagination
    const query = `
      SELECT * FROM executions
      ${whereClause}
      ORDER BY ${sortBy} ${order.toUpperCase()}
      LIMIT ? OFFSET ?
    `;
    const executions = this.db
      .prepare(query)
      .all(...params, limit, offset) as Execution[];

    // Calculate hasMore
    const hasMore = offset + executions.length < total;

    return {
      executions,
      total,
      hasMore,
    };
  }

  /**
   * Check if there are any active executions
   *
   * @returns true if there are active worker pool executions
   */
  hasActiveExecutions(): boolean {
    // Check worker pool for active executions
    if (this.workerPool) {
      return this.workerPool.getActiveWorkerCount() > 0;
    }

    // For in-process executions, we don't track them anymore
    // Query the database for running executions as a fallback
    const runningExecutions = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM executions WHERE status = 'running'"
      )
      .get() as { count: number };

    return runningExecutions.count > 0;
  }

  /**
   * Collect entity IDs that were already expanded in parent executions
   *
   * Walks the execution chain backwards and resolves each prompt to extract
   * which entities were referenced (and thus expanded) in previous executions.
   * This prevents redundant expansion of the same entities in follow-ups.
   *
   * @param executionId - ID of the current execution
   * @returns Set of entity IDs that were already expanded
   */
  private async collectExpandedEntitiesFromChain(
    executionId: string
  ): Promise<Set<string>> {
    const expandedIds = new Set<string>();
    const resolver = new PromptResolver(this.db);

    // Walk backwards through the execution chain
    let currentExecId: string | null = executionId;
    while (currentExecId) {
      const execution = getExecution(this.db, currentExecId);
      if (!execution || !execution.prompt) break;

      // Resolve the prompt to extract what entities were referenced
      // Pass empty set so we expand everything in this pass (just to collect IDs)
      // Pass the execution's issue_id as implicit to track if it was auto-included
      const { expandedEntityIds } = await resolver.resolve(
        execution.prompt,
        new Set(),
        execution.issue_id || undefined
      );

      // Add all expanded entity IDs from this execution
      expandedEntityIds.forEach((id) => expandedIds.add(id));

      // Move to parent execution
      currentExecId = execution.parent_execution_id || null;
    }

    return expandedIds;
  }

  /**
   * Build execution config with auto-injected MCP servers
   *
   * This method handles the auto-injection of sudocode-mcp into the execution config
   * when it's not already configured. It:
   * 1. Checks if sudocode-mcp package is installed (throws error if not)
   * 2. Checks if the agent already has sudocode-mcp configured
   * 3. Auto-injects sudocode-mcp to mcpServers if needed
   * 4. Preserves all user-provided MCP servers
   *
   * @param agentType - The type of agent to execute
   * @param userConfig - User-provided execution configuration
   * @returns Merged execution configuration with auto-injected MCP servers
   * @throws Error if sudocode-mcp package is not installed
   */
  private async buildExecutionConfig(
    agentType: AgentType,
    userConfig: ExecutionConfig
  ): Promise<ExecutionConfig> {
    // Start with user config
    const mergedConfig = { ...userConfig };

    // 1. Detect if sudocode-mcp package is installed
    const isInstalled = await this.detectSudocodeMcp();
    if (!isInstalled) {
      throw new Error(
        "sudocode-mcp package not found. Please install sudocode to enable MCP tools.\nVisit: https://github.com/sudocode-ai/sudocode"
      );
    }

    // 2. Check if agent already has sudocode-mcp configured
    const mcpPresent = await this.detectAgentMcp(agentType);

    // 3. For Cursor, MCP MUST be configured (no CLI injection available)
    if (agentType === "cursor" && !mcpPresent) {
      throw new Error(
        "Cursor agent requires sudocode-mcp to be configured in .cursor/mcp.json.\n" +
        "Please create .cursor/mcp.json in your project root with:\n\n" +
        JSON.stringify(
          {
            mcpServers: {
              "sudocode-mcp": {
                command: "sudocode-mcp",
              },
            },
          },
          null,
          2
        ) +
        "\n\nVisit: https://github.com/sudocode-ai/sudocode"
      );
    }

    // For Cursor with sudocode-mcp, auto-approve MCP servers in headless mode
    if (agentType === "cursor" && mcpPresent) {
      console.info(
        "[ExecutionService] Enabling approveMcps for Cursor (sudocode-mcp detected)"
      );
      (mergedConfig as any).approveMcps = true;
    }

    // 4. Auto-inject sudocode-mcp if not configured and not already in userConfig
    if (!mcpPresent && !userConfig.mcpServers?.["sudocode-mcp"]) {
      console.info(
        "[ExecutionService] Adding sudocode-mcp to mcpServers (auto-injection)"
      );
      mergedConfig.mcpServers = {
        ...(userConfig.mcpServers || {}),
        "sudocode-mcp": {
          command: "sudocode-mcp",
        },
      };
    } else if (mcpPresent) {
      console.info(
        "[ExecutionService] Removing sudocode-mcp from CLI config (using plugin instead)"
      );
      // Remove sudocode-mcp from mcpServers to avoid duplication with plugin
      if (userConfig.mcpServers) {
        const { "sudocode-mcp": _removed, ...rest } = userConfig.mcpServers;
        mergedConfig.mcpServers = Object.keys(rest).length > 0 ? rest : undefined;
      }
    } else if (userConfig.mcpServers?.["sudocode-mcp"]) {
      console.info(
        "[ExecutionService] Skipping sudocode-mcp injection (user provided in config)"
      );
    }

    return mergedConfig;
  }

  /**
   * Detect if sudocode-mcp command is available in PATH
   *
   * This checks if the sudocode-mcp package is installed on the system by
   * attempting to locate the command using `which` (Unix) or `where` (Windows).
   *
   * @returns true if sudocode-mcp is available, false otherwise
   * @internal Used by buildExecutionConfig
   */
  private async detectSudocodeMcp(): Promise<boolean> {
    try {
      // Use 'which' on Unix systems, 'where' on Windows
      const command = process.platform === "win32" ? "where" : "which";

      const result = await execFileNoThrow(command, ["sudocode-mcp"]);

      if (result.status === 0) {
        return true;
      } else {
        // Command failed - sudocode-mcp not found in PATH
        console.warn(
          "[ExecutionService] sudocode-mcp command not found in PATH"
        );
        return false;
      }
    } catch (error) {
      // Unexpected error during detection
      console.warn(
        "[ExecutionService] Failed to detect sudocode-mcp:",
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * Detect if sudocode-mcp is configured for the given agent
   *
   * For claude-code: Checks if the sudocode plugin is enabled in ~/.claude/settings.json
   * For cursor: Checks .cursor/mcp.json in project root for sudocode-mcp command
   * For codex: Checks ~/.codex/config.toml for sudocode-mcp in mcp_servers
   * For copilot: Checks ~/.copilot/mcp-config.json for sudocode-mcp command
   *
   * @param agentType - The type of agent to check
   * @returns true if configured, false otherwise
   * @internal Used by buildExecutionConfig
   */
  private async detectAgentMcp(agentType: AgentType): Promise<boolean> {
    // For claude-code, check ~/.claude/settings.json
    // This is not foolproof, but covers the default case
    if (agentType === "claude-code") {
      try {
        const claudeSettingsPath = path.join(
          os.homedir(),
          ".claude",
          "settings.json"
        );

        const settingsContent = await fsPromises.readFile(
          claudeSettingsPath,
          "utf-8"
        );

        const settings = JSON.parse(settingsContent);

        // Check if sudocode@sudocode-marketplace is enabled
        const isEnabled =
          settings.enabledPlugins?.["sudocode@sudocode-marketplace"] === true;

        if (isEnabled) {
          console.info(
            "[ExecutionService] sudocode-mcp detected for claude-code (plugin enabled)"
          );
        } else {
          console.info(
            "[ExecutionService] sudocode-mcp not detected for claude-code (plugin not enabled)"
          );
        }

        return isEnabled;
      } catch (error) {
        // Handle file read errors gracefully
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          // File not found - plugin definitely not configured
          console.warn(
            "[ExecutionService] ~/.claude/settings.json not found - plugin not configured"
          );
          return false;
        } else if (error instanceof SyntaxError) {
          // Malformed JSON - can't determine, assume configured (conservative)
          console.error(
            "[ExecutionService] Failed to parse ~/.claude/settings.json - malformed JSON:",
            error.message
          );
          return true;
        } else {
          // Other errors (permission denied, etc.) - can't determine, assume configured (conservative)
          console.warn(
            "[ExecutionService] Failed to read ~/.claude/settings.json:",
            error instanceof Error ? error.message : String(error)
          );
          return true;
        }
      }
    }

    // For cursor, check .cursor/mcp.json in project root
    if (agentType === "cursor") {
      try {
        // NOTE: .cursor/mcp.json is in project root, not home directory
        const cursorConfigPath = path.join(this.repoPath, ".cursor", "mcp.json");

        const configContent = await fsPromises.readFile(cursorConfigPath, "utf-8");
        const config = JSON.parse(configContent);

        // Check if any mcpServer has command "sudocode-mcp"
        const hasSudocodeMcp = Object.values(config.mcpServers || {}).some(
          (server: any) => server.command === "sudocode-mcp"
        );

        if (hasSudocodeMcp) {
          console.info("[ExecutionService] sudocode-mcp detected for cursor");
        } else {
          console.info("[ExecutionService] sudocode-mcp not detected for cursor");
        }

        return hasSudocodeMcp;
      } catch (error) {
        // Handle ENOENT, JSON parse errors, etc.
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          // File not found - MCP definitely not configured
          console.warn(
            "[ExecutionService] .cursor/mcp.json not found in project root - MCP not configured"
          );
          return false;
        } else if (error instanceof SyntaxError) {
          // Malformed JSON - can't determine configuration
          console.error(
            "[ExecutionService] Failed to parse .cursor/mcp.json - malformed JSON:",
            error.message
          );
          return false;
        } else {
          // Other errors (permission denied, etc.)
          console.warn(
            "[ExecutionService] Failed to read .cursor/mcp.json:",
            error instanceof Error ? error.message : String(error)
          );
          return false;
        }
      }
    }

    // For codex, check ~/.codex/config.toml
    if (agentType === "codex") {
      try {
        const codexConfigPath = path.join(
          os.homedir(),
          ".codex",
          "config.toml"
        );

        const configContent = await fsPromises.readFile(
          codexConfigPath,
          "utf-8"
        );

        const config = TOML.parse(configContent);

        // Check if any mcp_servers section has command "sudocode-mcp"
        const mcpServers = config.mcp_servers as Record<string, any> | undefined;
        const hasSudocodeMcp =
          mcpServers &&
          Object.values(mcpServers).some(
            (server: any) => server.command === "sudocode-mcp"
          );

        if (hasSudocodeMcp) {
          console.info("[ExecutionService] sudocode-mcp detected for codex");
        } else {
          console.info(
            "[ExecutionService] sudocode-mcp not detected for codex"
          );
        }

        return !!hasSudocodeMcp;
      } catch (error) {
        // Handle ENOENT, TOML parse errors, etc.
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          // File not found - MCP definitely not configured
          console.warn(
            "[ExecutionService] ~/.codex/config.toml not found - MCP not configured"
          );
          return false;
        } else if (error instanceof Error && error.message.includes("parse")) {
          // Malformed TOML - can't determine configuration
          console.error(
            "[ExecutionService] Failed to parse ~/.codex/config.toml - malformed TOML:",
            error.message
          );
          return false;
        } else {
          // Other errors (permission denied, etc.)
          console.warn(
            "[ExecutionService] Failed to detect codex MCP config:",
            error instanceof Error ? error.message : String(error)
          );
          return false;
        }
      }
    }

    // For copilot, check ~/.copilot/mcp-config.json
    if (agentType === "copilot") {
      try {
        const copilotConfigPath = path.join(
          os.homedir(),
          ".copilot",
          "mcp-config.json"
        );

        const configContent = await fsPromises.readFile(
          copilotConfigPath,
          "utf-8"
        );

        const config = JSON.parse(configContent);

        // Check if any mcpServer has command "sudocode-mcp"
        const hasSudocodeMcp = Object.values(config.mcpServers || {}).some(
          (server: any) => server.command === "sudocode-mcp"
        );

        if (hasSudocodeMcp) {
          console.info("[ExecutionService] sudocode-mcp detected for copilot");
        } else {
          console.info(
            "[ExecutionService] sudocode-mcp not detected for copilot"
          );
        }

        return hasSudocodeMcp;
      } catch (error) {
        // Handle ENOENT, JSON parse errors, etc.
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          // File not found - MCP definitely not configured
          console.warn(
            "[ExecutionService] ~/.copilot/mcp-config.json not found - MCP not configured"
          );
          return false;
        } else if (error instanceof SyntaxError) {
          // Malformed JSON - can't determine configuration
          console.error(
            "[ExecutionService] Failed to parse ~/.copilot/mcp-config.json - malformed JSON:",
            error.message
          );
          return false;
        } else {
          // Other errors (permission denied, etc.)
          console.warn(
            "[ExecutionService] Failed to detect copilot MCP config:",
            error instanceof Error ? error.message : String(error)
          );
          return false;
        }
      }
    }

    // For other agents, return true (safe default)
    return true;
  }
}
