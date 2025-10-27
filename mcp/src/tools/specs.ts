/**
 * MCP tools for spec management
 */

import { SudocodeClient } from "../client.js";
import { Spec } from "../types.js";

// Tool parameter types
export interface ListSpecsParams {
  limit?: number;
  search?: string;
}

export interface ShowSpecParams {
  spec_id: string;
}

export interface UpsertSpecParams {
  spec_id?: string; // If provided, update; otherwise create
  title?: string; // Required for create, optional for update
  priority?: number;
  description?: string;
  parent?: string;
  tags?: string[];
}

// Tool implementations

/**
 * List all specs with optional filters
 */
export async function listSpecs(
  client: SudocodeClient,
  params: ListSpecsParams = {}
): Promise<Spec[]> {
  const args = ["spec", "list"];

  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }
  if (params.search) {
    args.push("--grep", params.search);
  }

  const specs = await client.exec(args);

  // Redact content field from specs to keep response shorter
  if (Array.isArray(specs)) {
    return specs.map((spec: any) => {
      const { content, ...rest } = spec;
      return rest;
    });
  }

  return specs;
}

/**
 * Show detailed spec information including feedback
 */
export async function showSpec(
  client: SudocodeClient,
  params: ShowSpecParams
): Promise<any> {
  const args = ["spec", "show", params.spec_id];
  return client.exec(args);
}

/**
 * Upsert a spec (create if no spec_id, update if spec_id provided)
 */
export async function upsertSpec(
  client: SudocodeClient,
  params: UpsertSpecParams
): Promise<Spec> {
  const isUpdate = !!params.spec_id;

  if (isUpdate) {
    // Update mode
    const args = ["spec", "update", params.spec_id!];

    if (params.title) {
      args.push("--title", params.title);
    }
    if (params.priority !== undefined) {
      args.push("--priority", params.priority.toString());
    }
    if (params.description) {
      args.push("--description", params.description);
    }
    if (params.parent !== undefined) {
      args.push("--parent", params.parent || "");
    }
    if (params.tags !== undefined) {
      args.push("--tags", params.tags.join(","));
    }

    return client.exec(args);
  } else {
    // Create mode
    if (!params.title) {
      throw new Error("title is required when creating a new spec");
    }

    const args = ["spec", "create", params.title];

    if (params.priority !== undefined) {
      args.push("--priority", params.priority.toString());
    }
    if (params.description) {
      args.push("--description", params.description);
    }
    if (params.parent) {
      args.push("--parent", params.parent);
    }
    if (params.tags && params.tags.length > 0) {
      args.push("--tags", params.tags.join(","));
    }

    return client.exec(args);
  }
}
