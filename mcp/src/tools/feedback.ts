/**
 * MCP tools for feedback management
 */

import { SudocodeClient } from "../client.js";
import { Feedback, FeedbackType } from "../types.js";

// Tool parameter types
export interface AddFeedbackParams {
  issue_id: string;
  to_id: string;
  content: string;
  type?: FeedbackType;
  line?: number;
  text?: string;
  agent?: string;
}

/**
 * Add anchored feedback to a spec or issue
 * Entity type is inferred from the ID prefix (s- for specs, i- for issues)
 */
export async function addFeedback(
  client: SudocodeClient,
  params: AddFeedbackParams
): Promise<Feedback> {
  const args = ["feedback", "add", params.issue_id, params.to_id];

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
