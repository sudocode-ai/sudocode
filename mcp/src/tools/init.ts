/**
 * MCP tool for initialization
 */

import { SudocodeClient } from "../client.js";

// Tool parameter types
export interface InitParams {
  prefix?: string;
}

// Result type
export interface InitResult {
  success: boolean;
  path: string;
  prefix: string;
}

// Tool implementation

/**
 * Initialize Sudograph in the current directory
 */
export async function init(
  client: SudocodeClient,
  params: InitParams = {}
): Promise<InitResult> {
  const args = ["init"];

  if (params.prefix) {
    args.push("--prefix", params.prefix);
  }

  return client.exec(args);
}
