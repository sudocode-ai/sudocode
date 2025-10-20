/**
 * MCP tools for relationship management
 */

import { SudocodeClient } from "../client.js";

// Tool parameter types
export type RelationshipType =
  | "blocks"
  | "implements"
  | "references"
  | "depends-on"
  | "parent-child"
  | "discovered-from"
  | "related";

export interface LinkParams {
  from_id: string;
  to_id: string;
  type?: RelationshipType;
}

// Tool implementation

/**
 * Create a relationship between two entities (specs or issues)
 */
export async function link(
  client: SudocodeClient,
  params: LinkParams
): Promise<any> {
  const args = ["link", params.from_id, params.to_id];

  if (params.type) {
    args.push("--type", params.type);
  }

  return client.exec(args);
}
