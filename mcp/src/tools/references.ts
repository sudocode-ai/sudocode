/**
 * MCP tools for reference management
 */

import { SudocodeClient } from "../client.js";

// Tool parameter types
export interface AddReferenceParams {
  entity_id: string;
  reference_id: string;
  display_text?: string;
  relationship_type?: string;
  line?: number;
  text?: string;
  format?: "inline" | "newline";
  position?: "before" | "after";
}

/**
 * Add a cross-reference to a spec or issue
 *
 * Tries spec first, then issue. The CLI command handles entity validation.
 */
export async function addReference(
  client: SudocodeClient,
  params: AddReferenceParams
): Promise<any> {
  // Build command args
  const buildArgs = (command: "spec" | "issue") => {
    const args = [command, "add-ref", params.entity_id, params.reference_id];

    if (params.line !== undefined) {
      args.push("--line", params.line.toString());
    }
    if (params.text) {
      args.push("--text", params.text);
    }
    if (params.display_text) {
      args.push("--display", params.display_text);
    }
    if (params.relationship_type) {
      args.push("--type", params.relationship_type);
    }
    if (params.format) {
      args.push("--format", params.format);
    }
    if (params.position) {
      args.push("--position", params.position);
    }

    return args;
  };

  // TODO: Infer entity type from ID pattern if possible.
  // Try spec first
  try {
    return await client.exec(buildArgs("spec"));
  } catch (specError) {
    // If spec command fails, try issue
    try {
      return await client.exec(buildArgs("issue"));
    } catch (issueError) {
      // If both fail, throw the issue error (it will have the proper error message)
      throw issueError;
    }
  }
}
