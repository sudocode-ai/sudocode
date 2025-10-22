/**
 * MCP tools for spec management
 */

import { SudocodeClient } from "../client.js";
import { Spec, SpecStatus, SpecType } from "../types.js";

// Tool parameter types
export interface ListSpecsParams {
  status?: SpecStatus;
  type?: SpecType;
  priority?: number;
  limit?: number;
}

export interface ShowSpecParams {
  spec_id: string;
}

export interface CreateSpecParams {
  title: string;
  type?: SpecType;
  priority?: number;
  description?: string;
  design?: string;
  file_path?: string;
  parent?: string;
  tags?: string[];
}

export interface UpsertSpecParams {
  spec_id?: string; // If provided, update; otherwise create
  title?: string; // Required for create, optional for update
  type?: SpecType;
  priority?: number;
  description?: string;
  design?: string;
  file_path?: string;
  parent?: string;
  tags?: string[];
  status?: SpecStatus;
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

  if (params.status) {
    args.push("--status", params.status);
  }
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.limit !== undefined) {
    args.push("--limit", params.limit.toString());
  }

  return client.exec(args);
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
 * Create a new spec
 */
export async function createSpec(
  client: SudocodeClient,
  params: CreateSpecParams
): Promise<Spec> {
  const args = ["spec", "create", params.title];

  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.priority !== undefined) {
    args.push("--priority", params.priority.toString());
  }
  if (params.description) {
    args.push("--description", params.description);
  }
  if (params.design) {
    args.push("--design", params.design);
  }
  if (params.file_path) {
    args.push("--file-path", params.file_path);
  }
  if (params.parent) {
    args.push("--parent", params.parent);
  }
  if (params.tags && params.tags.length > 0) {
    args.push("--tags", params.tags.join(","));
  }

  return client.exec(args);
}

/**
 * Upsert a spec (create if no spec_id, update if spec_id provided)
 * Note: Update mode is not yet implemented in the CLI, so this currently only supports create
 */
export async function upsertSpec(
  client: SudocodeClient,
  params: UpsertSpecParams
): Promise<Spec> {
  const isUpdate = !!params.spec_id;

  if (isUpdate) {
    // TODO: Implement spec update in CLI first
    throw new Error(
      "Spec update is not yet supported. Please use spec_id=undefined to create a new spec."
    );
  } else {
    // Create mode
    if (!params.title) {
      throw new Error("title is required when creating a new spec");
    }

    const args = ["spec", "create", params.title];

    if (params.type) {
      args.push("--type", params.type);
    }
    if (params.priority !== undefined) {
      args.push("--priority", params.priority.toString());
    }
    if (params.description) {
      args.push("--description", params.description);
    }
    if (params.design) {
      args.push("--design", params.design);
    }
    if (params.file_path) {
      args.push("--file-path", params.file_path);
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
