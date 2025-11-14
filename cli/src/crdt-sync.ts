/**
 * CRDT Synchronization Support for CLI
 *
 * Provides CRDT sync capabilities when CLI is run in an execution context.
 * Detects execution context via environment variables and initializes CRDT Agent.
 */

import type { Issue, Spec, IssueFeedback } from "@sudocode-ai/types";
import * as fs from "fs";
import * as path from "path";

// Lazy import to avoid dependency issues when not in execution context
let CRDTAgent: any = null;
let crdtAgentInstance: any = null;
let crdtEnabled = false;
let fileWatchersActive = false;
let issuesWatcher: fs.FSWatcher | null = null;
let specsWatcher: fs.FSWatcher | null = null;

/**
 * Initialize CRDT Agent if running in execution context
 */
export async function initializeCRDT(): Promise<void> {
  // Check if we're in an execution context
  const executionId = process.env.CRDT_EXECUTION_ID;

  if (!executionId) {
    // Not in execution context - CRDT not needed
    return;
  }

  try {
    // Lazy load CRDT Agent only when needed
    const { CRDTAgent: LoadedCRDTAgent } = await import(
      "@sudocode-ai/local-server/dist/execution/crdt-agent.js"
    );
    CRDTAgent = LoadedCRDTAgent;

    // Read CRDT configuration from environment
    const serverHost = process.env.CRDT_SERVER_HOST || "localhost";
    const serverPort = parseInt(process.env.CRDT_SERVER_PORT || "3001", 10);

    console.error(`[CRDT Sync] Initializing CRDT Agent for execution ${executionId}`);
    console.error(`[CRDT Sync]   Coordinator: ${serverHost}:${serverPort}`);

    // Create CRDT Agent
    crdtAgentInstance = new CRDTAgent({
      agentId: executionId,
      coordinatorHost: serverHost,
      coordinatorPort: serverPort,
      heartbeatInterval: parseInt(process.env.CRDT_HEARTBEAT_INTERVAL || "30000", 10),
      maxReconnectAttempts: parseInt(process.env.CRDT_RECONNECT_MAX_ATTEMPTS || "10", 10),
    });

    // Connect to coordinator (non-blocking, falls back to local-only mode)
    await crdtAgentInstance.connect().catch((error: Error) => {
      console.error(
        "[CRDT Sync] Connection failed (continuing in local-only mode):",
        error.message
      );
    });

    crdtEnabled = true;
    console.error("[CRDT Sync] CRDT Agent initialized");

    // Setup file system watchers as backup for direct file edits
    await setupFileWatchers();
  } catch (error) {
    console.error("[CRDT Sync] Failed to initialize CRDT Agent (continuing without sync):");
    console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
    crdtAgentInstance = null;
    crdtEnabled = false;
  }
}

/**
 * Setup file system watchers for .sudocode/issues.jsonl and specs.jsonl
 * This catches direct file edits that don't go through the CLI
 */
async function setupFileWatchers(): Promise<void> {
  const worktreePath = process.env.CRDT_WORKTREE_PATH;
  if (!worktreePath) {
    return;
  }

  try {
    const sudocodeDir = path.join(worktreePath, ".sudocode");

    // Watch issues.jsonl
    const issuesPath = path.join(sudocodeDir, "issues.jsonl");
    if (fs.existsSync(issuesPath)) {
      issuesWatcher = fs.watch(issuesPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          handleIssuesFileChange(issuesPath);
        }
      });
      console.error("[CRDT Sync] Watching issues.jsonl for changes");
    }

    // Watch specs.jsonl
    const specsPath = path.join(sudocodeDir, "specs.jsonl");
    if (fs.existsSync(specsPath)) {
      specsWatcher = fs.watch(specsPath, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          handleSpecsFileChange(specsPath);
        }
      });
      console.error("[CRDT Sync] Watching specs.jsonl for changes");
    }

    fileWatchersActive = true;
  } catch (error) {
    console.error("[CRDT Sync] Failed to setup file watchers (non-critical):");
    console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Handle changes to issues.jsonl file
 */
function handleIssuesFileChange(filePath: string): void {
  if (!isCRDTEnabled()) {
    return;
  }

  try {
    console.error("[CRDT Sync] Detected change in issues.jsonl, syncing...");
    // Read and parse the file
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const issue = JSON.parse(line);
        syncIssue(issue);
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.error("[CRDT Sync] Error handling issues file change:");
    console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Handle changes to specs.jsonl file
 */
function handleSpecsFileChange(filePath: string): void {
  if (!isCRDTEnabled()) {
    return;
  }

  try {
    console.error("[CRDT Sync] Detected change in specs.jsonl, syncing...");
    // Read and parse the file
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const spec = JSON.parse(line);
        syncSpec(spec);
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.error("[CRDT Sync] Error handling specs file change:");
    console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Shutdown CRDT Agent and export state
 */
export async function shutdownCRDT(): Promise<void> {
  // Close file watchers first
  if (fileWatchersActive) {
    try {
      if (issuesWatcher) {
        issuesWatcher.close();
        issuesWatcher = null;
      }
      if (specsWatcher) {
        specsWatcher.close();
        specsWatcher = null;
      }
      fileWatchersActive = false;
      console.error("[CRDT Sync] File watchers closed");
    } catch (error) {
      console.error("[CRDT Sync] Error closing file watchers:");
      console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!crdtAgentInstance) {
    return;
  }

  try {
    console.error("[CRDT Sync] Shutting down CRDT Agent...");

    // Export CRDT state to JSONL
    const worktreePath = process.env.CRDT_WORKTREE_PATH;
    if (worktreePath) {
      await crdtAgentInstance.exportToLocalJSONL(worktreePath);
      console.error("[CRDT Sync] Exported CRDT state to JSONL");
    }

    // Disconnect agent
    await crdtAgentInstance.disconnect();
    console.error("[CRDT Sync] CRDT Agent disconnected");
  } catch (error) {
    console.error("[CRDT Sync] Error during CRDT shutdown:");
    console.error(`[CRDT Sync]   ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if CRDT sync is enabled
 */
export function isCRDTEnabled(): boolean {
  return crdtEnabled && crdtAgentInstance !== null;
}

/**
 * Sync issue to CRDT (called after DB write)
 */
export function syncIssue(issue: Issue): void {
  if (!isCRDTEnabled()) {
    return;
  }

  try {
    crdtAgentInstance.updateIssue(issue.id, {
      title: issue.title,
      content: issue.content || "",
      status: issue.status,
      priority: issue.priority,
      parent: issue.parent_id || undefined,
      archived: issue.archived || false,
    });
  } catch (error) {
    // Log but don't fail the operation
    console.error(
      `[CRDT Sync] Failed to sync issue ${issue.id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Sync spec to CRDT (called after DB write)
 */
export function syncSpec(spec: Spec): void {
  if (!isCRDTEnabled()) {
    return;
  }

  try {
    crdtAgentInstance.updateSpec(spec.id, {
      title: spec.title,
      content: spec.content || "",
      priority: spec.priority,
      parent: spec.parent_id || undefined,
    });
  } catch (error) {
    // Log but don't fail the operation
    console.error(
      `[CRDT Sync] Failed to sync spec ${spec.id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Sync feedback to CRDT (called after DB write)
 */
export function syncFeedback(feedback: IssueFeedback): void {
  if (!isCRDTEnabled()) {
    return;
  }

  try {
    // Parse anchor JSON if present
    let anchorLine: number | undefined;
    let anchorText: string | undefined;
    if (feedback.anchor) {
      try {
        const anchor = JSON.parse(feedback.anchor);
        anchorLine = anchor.line_number;
        anchorText = anchor.text_snippet;
      } catch (e) {
        // Ignore anchor parse errors
      }
    }

    crdtAgentInstance.addFeedback(feedback.id, {
      specId: feedback.spec_id,
      issueId: feedback.issue_id,
      type: feedback.feedback_type,
      content: feedback.content,
      anchorLine,
      anchorText,
    });
  } catch (error) {
    // Log but don't fail the operation
    console.error(
      `[CRDT Sync] Failed to sync feedback ${feedback.id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
