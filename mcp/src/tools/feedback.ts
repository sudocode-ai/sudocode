/**
 * MCP tools for feedback management
 */

import { SudocodeClient } from "../client.js";
import { Feedback, FeedbackType } from "../types.js";

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
  // if (params.agent) {
  //   args.push("--agent", params.agent);
  // }

  return client.exec(args);
}
