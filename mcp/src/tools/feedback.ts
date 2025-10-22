/**
 * MCP tools for feedback management
 */

import { SudocodeClient } from "../client.js";
import { Feedback, FeedbackType, FeedbackStatus } from "../types.js";

// Tool parameter types
export interface AddFeedbackParams {
  issue_id: string;
  spec_id: string;
  content: string;
  type?: FeedbackType;
  line?: number;
  text?: string;
  agent?: string;
}

export interface ListFeedbackParams {
  issue?: string;
  spec?: string;
  type?: FeedbackType;
  status?: FeedbackStatus;
  limit?: number;
}

export interface ShowFeedbackParams {
  feedback_id: string;
}

export interface AcknowledgeFeedbackParams {
  feedback_id: string;
}

export interface ResolveFeedbackParams {
  feedback_id: string;
}

export interface WontfixFeedbackParams {
  feedback_id: string;
}

export interface StaleFeedbackParams {
  limit?: number;
}

export interface RelocateFeedbackParams {
  feedback_id: string;
}

export interface UpsertFeedbackParams {
  feedback_id?: string; // If provided, update status; otherwise create
  issue_id?: string; // Required for create
  spec_id?: string; // Required for create
  content?: string; // Required for create
  type?: FeedbackType;
  line?: number;
  text?: string;
  agent?: string;
  status?: FeedbackStatus; // For updating feedback status
  relocate?: boolean; // If true and feedback_id provided, relocate the anchor
}

// Tool implementations - Part 1

/**
 * Add anchored feedback to a spec
 */
export async function addFeedback(
  client: SudocodeClient,
  params: AddFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "add", params.issue_id, params.spec_id];

  args.push("--content", params.content);

  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.line !== undefined) {
    args.push("--line", params.line.toString());
  }
  if (params.text) {
    args.push("--text", params.text);
  }
  if (params.agent) {
    args.push("--agent", params.agent);
  }

  return client.exec(args);
}

/**
 * List feedback with optional filters
 */
export async function listFeedback(
  client: SudocodeClient,
  params: ListFeedbackParams = {}
): Promise<Feedback[]> {
  const args = ["feedback", "list"];

  if (params.issue) {
    args.push("--issue", params.issue);
  }
  if (params.spec) {
    args.push("--spec", params.spec);
  }
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.status) {
    args.push("--status", params.status);
  }
  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }

  return client.exec(args);
}

/**
 * Show detailed feedback information
 */
export async function showFeedback(
  client: SudocodeClient,
  params: ShowFeedbackParams
): Promise<any> {
  const args = ["feedback", "show", params.feedback_id];
  return client.exec(args);
}

/**
 * Acknowledge feedback
 */
export async function acknowledgeFeedback(
  client: SudocodeClient,
  params: AcknowledgeFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "acknowledge", params.feedback_id];
  return client.exec(args);
}

/**
 * Resolve feedback
 */
export async function resolveFeedback(
  client: SudocodeClient,
  params: ResolveFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "resolve", params.feedback_id];
  return client.exec(args);
}

/**
 * Mark feedback as won't fix
 */
export async function wontfixFeedback(
  client: SudocodeClient,
  params: WontfixFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "wontfix", params.feedback_id];
  return client.exec(args);
}

/**
 * Get stale feedback
 */
export async function staleFeedback(
  client: SudocodeClient,
  params: StaleFeedbackParams = {}
): Promise<Feedback[]> {
  const args = ["feedback", "stale"];

  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }

  return client.exec(args);
}

/**
 * Relocate feedback anchors after spec changes
 */
export async function relocateFeedback(
  client: SudocodeClient,
  params: RelocateFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "relocate", params.feedback_id];
  return client.exec(args);
}

/**
 * Upsert feedback (create if no feedback_id, update/relocate if feedback_id provided)
 */
export async function upsertFeedback(
  client: SudocodeClient,
  params: UpsertFeedbackParams
): Promise<Feedback> {
  const isUpdate = !!params.feedback_id;

  if (isUpdate) {
    // Update mode - handle status changes or relocation
    if (params.relocate) {
      // Relocate the feedback anchor
      const args = ["feedback", "relocate", params.feedback_id!];
      return client.exec(args);
    } else if (params.status) {
      // Update feedback status
      const args: string[] = [];

      switch (params.status) {
        case "acknowledged":
          args.push("feedback", "acknowledge", params.feedback_id!);
          break;
        case "resolved":
          args.push("feedback", "resolve", params.feedback_id!);
          break;
        case "wont_fix":
          args.push("feedback", "wont-fix", params.feedback_id!);
          break;
        default:
          throw new Error(`Cannot update feedback to status: ${params.status}`);
      }

      return client.exec(args);
    } else {
      throw new Error(
        "When updating feedback, you must provide either status or relocate=true"
      );
    }
  } else {
    // Create mode
    if (!params.issue_id || !params.spec_id || !params.content) {
      throw new Error(
        "issue_id, spec_id, and content are required when creating feedback"
      );
    }

    const args = ["feedback", "add", params.issue_id, params.spec_id];
    args.push("--content", params.content);

    if (params.type) {
      args.push("--type", params.type);
    }
    if (params.line !== undefined) {
      args.push("--line", params.line.toString());
    }
    if (params.text) {
      args.push("--text", params.text);
    }
    if (params.agent) {
      args.push("--agent", params.agent);
    }

    return client.exec(args);
  }
}
