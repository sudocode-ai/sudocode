/**
 * MCP tools for analytics and statistics
 */

import { SudocodeClient } from "../client.js";

// Tool parameter types
export interface StatusParams {
  verbose?: boolean;
}

// Result types
export interface StatsResult {
  specs: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    ready: number;
  };
  issues: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    ready: number;
    blocked: number;
  };
  relationships: {
    total: number;
    by_type: Record<string, number>;
  };
  recent_activity: {
    specs_updated: number;
    issues_updated: number;
    issues_created: number;
    issues_closed: number;
  };
}

// Tool implementations

/**
 * Get comprehensive project statistics
 */
export async function stats(client: SudocodeClient): Promise<StatsResult> {
  return client.exec(["stats"]);
}

/**
 * Get quick project status
 */
export async function status(
  client: SudocodeClient,
  params: StatusParams = {}
): Promise<any> {
  const args = ["status"];

  if (params.verbose) {
    args.push("--verbose");
  }

  return client.exec(args);
}
