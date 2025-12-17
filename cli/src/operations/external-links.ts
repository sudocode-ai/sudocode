/**
 * External link operations for Specs and Issues
 * External links are stored in JSONL (not SQLite), so these operations
 * work directly with JSONL files.
 */

import type {
  ExternalLink,
  SpecJSONL,
  IssueJSONL,
  IntegrationProviderName,
  IssueStatus,
  SyncDirection,
  RelationshipJSONL,
  EntityType,
  RelationshipType,
} from "../types.js";
import { readJSONLSync, writeJSONLSync } from "../jsonl.js";
import {
  hashUUIDToBase36,
  getAdaptiveHashLength,
  generateUUID,
} from "../id-generator.js";
import * as path from "path";

/**
 * Get the path to the specs JSONL file
 */
function getSpecsJsonlPath(sudocodeDir: string): string {
  return path.join(sudocodeDir, "specs.jsonl");
}

/**
 * Get the path to the issues JSONL file
 */
function getIssuesJsonlPath(sudocodeDir: string): string {
  return path.join(sudocodeDir, "issues.jsonl");
}

// =============================================================================
// Spec External Link Operations
// =============================================================================

/**
 * Get a spec from JSONL by ID
 */
export function getSpecFromJsonl(
  sudocodeDir: string,
  specId: string
): SpecJSONL | null {
  const specsPath = getSpecsJsonlPath(sudocodeDir);
  const specs = readJSONLSync<SpecJSONL>(specsPath, { skipErrors: true });
  return specs.find((s) => s.id === specId) ?? null;
}

/**
 * Update a spec in JSONL
 */
function updateSpecInJsonl(
  sudocodeDir: string,
  specId: string,
  updater: (spec: SpecJSONL) => SpecJSONL
): SpecJSONL {
  const specsPath = getSpecsJsonlPath(sudocodeDir);
  const specs = readJSONLSync<SpecJSONL>(specsPath, { skipErrors: true });

  const index = specs.findIndex((s) => s.id === specId);
  if (index === -1) {
    throw new Error(`Spec not found: ${specId}`);
  }

  const updatedSpec = updater(specs[index]);
  updatedSpec.updated_at = new Date().toISOString();
  specs[index] = updatedSpec;

  writeJSONLSync(specsPath, specs);
  return updatedSpec;
}

/**
 * Add an external link to a spec
 */
export function addExternalLinkToSpec(
  sudocodeDir: string,
  specId: string,
  link: ExternalLink
): SpecJSONL {
  return updateSpecInJsonl(sudocodeDir, specId, (spec) => {
    const links = spec.external_links || [];

    // Check for duplicate
    if (
      links.some(
        (l) =>
          l.provider === link.provider && l.external_id === link.external_id
      )
    ) {
      throw new Error(
        `Link already exists: ${link.provider}:${link.external_id}`
      );
    }

    links.push(link);
    return { ...spec, external_links: links };
  });
}

/**
 * Remove an external link from a spec
 */
export function removeExternalLinkFromSpec(
  sudocodeDir: string,
  specId: string,
  externalId: string
): SpecJSONL {
  return updateSpecInJsonl(sudocodeDir, specId, (spec) => {
    const links = (spec.external_links || []).filter(
      (l) => l.external_id !== externalId
    );
    return { ...spec, external_links: links.length > 0 ? links : undefined };
  });
}

/**
 * Update sync metadata for an external link on a spec
 */
export function updateSpecExternalLinkSync(
  sudocodeDir: string,
  specId: string,
  externalId: string,
  updates: Partial<
    Pick<
      ExternalLink,
      "last_synced_at" | "external_updated_at" | "sync_enabled"
    >
  >
): SpecJSONL {
  return updateSpecInJsonl(sudocodeDir, specId, (spec) => {
    const links = (spec.external_links || []).map((l) => {
      if (l.external_id === externalId) {
        return { ...l, ...updates };
      }
      return l;
    });
    return { ...spec, external_links: links };
  });
}

/**
 * Find specs by external link
 */
export function findSpecsByExternalLink(
  sudocodeDir: string,
  provider: IntegrationProviderName,
  externalId: string
): SpecJSONL[] {
  const specsPath = getSpecsJsonlPath(sudocodeDir);
  const specs = readJSONLSync<SpecJSONL>(specsPath, { skipErrors: true });
  return specs.filter((s) =>
    s.external_links?.some(
      (l) => l.provider === provider && l.external_id === externalId
    )
  );
}

/**
 * Get all external links for a spec
 */
export function getSpecExternalLinks(
  sudocodeDir: string,
  specId: string
): ExternalLink[] {
  const spec = getSpecFromJsonl(sudocodeDir, specId);
  if (!spec) {
    throw new Error(`Spec not found: ${specId}`);
  }
  return spec.external_links || [];
}

// =============================================================================
// Issue External Link Operations
// =============================================================================

/**
 * Get an issue from JSONL by ID
 */
export function getIssueFromJsonl(
  sudocodeDir: string,
  issueId: string
): IssueJSONL | null {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });
  return issues.find((i) => i.id === issueId) ?? null;
}

/**
 * Update an issue in JSONL
 */
function updateIssueInJsonl(
  sudocodeDir: string,
  issueId: string,
  updater: (issue: IssueJSONL) => IssueJSONL
): IssueJSONL {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });

  const index = issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const updatedIssue = updater(issues[index]);
  updatedIssue.updated_at = new Date().toISOString();
  issues[index] = updatedIssue;

  writeJSONLSync(issuesPath, issues);
  return updatedIssue;
}

/**
 * Add an external link to an issue
 */
export function addExternalLinkToIssue(
  sudocodeDir: string,
  issueId: string,
  link: ExternalLink
): IssueJSONL {
  return updateIssueInJsonl(sudocodeDir, issueId, (issue) => {
    const links = issue.external_links || [];

    // Check for duplicate
    if (
      links.some(
        (l) =>
          l.provider === link.provider && l.external_id === link.external_id
      )
    ) {
      throw new Error(
        `Link already exists: ${link.provider}:${link.external_id}`
      );
    }

    links.push(link);
    return { ...issue, external_links: links };
  });
}

/**
 * Remove an external link from an issue
 */
export function removeExternalLinkFromIssue(
  sudocodeDir: string,
  issueId: string,
  externalId: string
): IssueJSONL {
  return updateIssueInJsonl(sudocodeDir, issueId, (issue) => {
    const links = (issue.external_links || []).filter(
      (l) => l.external_id !== externalId
    );
    return { ...issue, external_links: links.length > 0 ? links : undefined };
  });
}

/**
 * Update sync metadata for an external link on an issue
 */
export function updateIssueExternalLinkSync(
  sudocodeDir: string,
  issueId: string,
  externalId: string,
  updates: Partial<
    Pick<
      ExternalLink,
      "last_synced_at" | "external_updated_at" | "sync_enabled"
    >
  >
): IssueJSONL {
  return updateIssueInJsonl(sudocodeDir, issueId, (issue) => {
    const links = (issue.external_links || []).map((l) => {
      if (l.external_id === externalId) {
        return { ...l, ...updates };
      }
      return l;
    });
    return { ...issue, external_links: links };
  });
}

/**
 * Find issues by external link
 */
export function findIssuesByExternalLink(
  sudocodeDir: string,
  provider: IntegrationProviderName,
  externalId: string
): IssueJSONL[] {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });
  return issues.filter((i) =>
    i.external_links?.some(
      (l) => l.provider === provider && l.external_id === externalId
    )
  );
}

/**
 * Get all external links for an issue
 */
export function getIssueExternalLinks(
  sudocodeDir: string,
  issueId: string
): ExternalLink[] {
  const issue = getIssueFromJsonl(sudocodeDir, issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }
  return issue.external_links || [];
}

// =============================================================================
// Generic Operations
// =============================================================================

/**
 * Find all entities (specs and issues) by external link
 */
export function findEntitiesByExternalLink(
  sudocodeDir: string,
  provider: IntegrationProviderName,
  externalId: string
): { specs: SpecJSONL[]; issues: IssueJSONL[] } {
  return {
    specs: findSpecsByExternalLink(sudocodeDir, provider, externalId),
    issues: findIssuesByExternalLink(sudocodeDir, provider, externalId),
  };
}

// =============================================================================
// Auto-Import Operations
// =============================================================================

/**
 * Generate a unique issue ID without database
 * Uses JSONL to check for collisions
 */
function generateIssueIdFromJsonl(sudocodeDir: string): {
  id: string;
  uuid: string;
} {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });
  const existingIds = new Set(issues.map((i) => i.id));

  const uuid = generateUUID();
  const baseLength = getAdaptiveHashLength(issues.length);

  // Try progressively longer hashes on collision
  for (let length = baseLength; length <= 8; length++) {
    const hash = hashUUIDToBase36(uuid, length);
    const candidate = `i-${hash}`;

    if (!existingIds.has(candidate)) {
      return { id: candidate, uuid };
    }
  }

  throw new Error(
    `Failed to generate unique issue ID after trying lengths ${baseLength}-8`
  );
}

/**
 * Resolve an external ID to a sudocode ID
 * Searches both specs and issues for the linked entity
 */
function resolveExternalIdToSudocodeId(
  sudocodeDir: string,
  provider: IntegrationProviderName,
  externalId: string,
  expectedType: "spec" | "issue"
): { id: string; type: EntityType } | null {
  if (expectedType === "spec") {
    const specs = findSpecsByExternalLink(sudocodeDir, provider, externalId);
    if (specs.length > 0) {
      return { id: specs[0].id, type: "spec" };
    }
  } else {
    const issues = findIssuesByExternalLink(sudocodeDir, provider, externalId);
    if (issues.length > 0) {
      return { id: issues[0].id, type: "issue" };
    }
  }
  return null;
}

/**
 * Resolve external relationships to sudocode relationships
 * Only includes relationships where the target entity has already been imported
 */
function resolveExternalRelationships(
  sudocodeDir: string,
  fromId: string,
  fromType: EntityType,
  provider: IntegrationProviderName,
  externalRelationships: ExternalRelationshipInput[] | undefined
): RelationshipJSONL[] {
  if (!externalRelationships || externalRelationships.length === 0) {
    return [];
  }

  const relationships: RelationshipJSONL[] = [];

  for (const extRel of externalRelationships) {
    const resolved = resolveExternalIdToSudocodeId(
      sudocodeDir,
      provider,
      extRel.targetExternalId,
      extRel.targetType
    );

    if (resolved) {
      relationships.push({
        from: fromId,
        from_type: fromType,
        to: resolved.id,
        to_type: resolved.type,
        type: extRel.relationshipType as RelationshipType,
      });
    } else {
      // Log that we couldn't resolve the relationship
      console.log(
        `[external-links] Could not resolve relationship target: ${extRel.targetExternalId} (${extRel.targetType}) - entity not yet imported`
      );
    }
  }

  return relationships;
}

/**
 * Relationship input for creating entities from external sources
 */
export interface ExternalRelationshipInput {
  /** Target entity ID in the external system */
  targetExternalId: string;
  /** Target entity type */
  targetType: "spec" | "issue";
  /** Relationship type */
  relationshipType:
    | "implements"
    | "blocks"
    | "depends-on"
    | "references"
    | "related"
    | "discovered-from";
}

/**
 * Input for creating an issue from an external entity
 */
export interface CreateIssueFromExternalInput {
  /** Issue title */
  title: string;
  /** Issue content/description */
  content?: string;
  /** Issue status */
  status?: IssueStatus;
  /** Priority (0-4) */
  priority?: number;
  /** External system info for auto-linking */
  external: {
    provider: IntegrationProviderName;
    external_id: string;
    sync_direction?: SyncDirection;
  };
  /** Relationships to other external entities (will be resolved to sudocode IDs) */
  relationships?: ExternalRelationshipInput[];
}

/**
 * Create a new sudocode issue from an external entity
 * Automatically establishes the external_link and resolves relationships
 *
 * @param sudocodeDir - Path to .sudocode directory
 * @param input - Issue data and external link info
 * @returns The created issue
 */
export function createIssueFromExternal(
  sudocodeDir: string,
  input: CreateIssueFromExternalInput
): IssueJSONL {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });

  const { id, uuid } = generateIssueIdFromJsonl(sudocodeDir);
  const now = new Date().toISOString();

  // Resolve external relationships to sudocode relationships
  const relationships = resolveExternalRelationships(
    sudocodeDir,
    id,
    "issue",
    input.external.provider,
    input.relationships
  );

  const newIssue: IssueJSONL = {
    id,
    uuid,
    title: input.title,
    content: input.content || "",
    status: input.status || "open",
    priority: input.priority ?? 2,
    created_at: now,
    updated_at: now,
    relationships,
    tags: [],
    external_links: [
      {
        provider: input.external.provider,
        external_id: input.external.external_id,
        sync_enabled: true,
        sync_direction: input.external.sync_direction || "bidirectional",
        last_synced_at: now,
      },
    ],
  };

  issues.push(newIssue);
  writeJSONLSync(issuesPath, issues);

  return newIssue;
}

/**
 * Delete an issue by ID
 *
 * @param sudocodeDir - Path to .sudocode directory
 * @param issueId - ID of issue to delete
 * @returns true if deleted, false if not found
 */
export function deleteIssueFromJsonl(
  sudocodeDir: string,
  issueId: string
): boolean {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });

  const index = issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    return false;
  }

  issues.splice(index, 1);
  writeJSONLSync(issuesPath, issues);
  return true;
}

/**
 * Close an issue (set status to 'closed')
 *
 * @param sudocodeDir - Path to .sudocode directory
 * @param issueId - ID of issue to close
 * @returns The closed issue, or null if not found
 */
export function closeIssueInJsonl(
  sudocodeDir: string,
  issueId: string
): IssueJSONL | null {
  const issuesPath = getIssuesJsonlPath(sudocodeDir);
  const issues = readJSONLSync<IssueJSONL>(issuesPath, { skipErrors: true });

  const index = issues.findIndex((i) => i.id === issueId);
  if (index === -1) {
    return null;
  }

  const now = new Date().toISOString();
  issues[index] = {
    ...issues[index],
    status: "closed",
    closed_at: now,
    updated_at: now,
  };

  writeJSONLSync(issuesPath, issues);
  return issues[index];
}

/**
 * Generate a unique spec ID without database
 * Uses JSONL to check for collisions
 */
function generateSpecIdFromJsonl(sudocodeDir: string): {
  id: string;
  uuid: string;
} {
  const specsPath = getSpecsJsonlPath(sudocodeDir);
  const specs = readJSONLSync<SpecJSONL>(specsPath, { skipErrors: true });
  const existingIds = new Set(specs.map((s) => s.id));

  const uuid = generateUUID();
  const baseLength = getAdaptiveHashLength(specs.length);

  // Try progressively longer hashes on collision
  for (let length = baseLength; length <= 8; length++) {
    const hash = hashUUIDToBase36(uuid, length);
    const candidate = `s-${hash}`;

    if (!existingIds.has(candidate)) {
      return { id: candidate, uuid };
    }
  }

  throw new Error(
    `Failed to generate unique spec ID after trying lengths ${baseLength}-8`
  );
}

/**
 * Input for creating a spec from an external entity
 */
export interface CreateSpecFromExternalInput {
  /** Spec title */
  title: string;
  /** Spec content/description */
  content?: string;
  /** Priority (0-4) */
  priority?: number;
  /** External system info for auto-linking */
  external: {
    provider: IntegrationProviderName;
    external_id: string;
    sync_direction?: SyncDirection;
  };
  /** Relationships to other external entities (will be resolved to sudocode IDs) */
  relationships?: ExternalRelationshipInput[];
}

/**
 * Create a new sudocode spec from an external entity
 * Automatically establishes the external_link and resolves relationships
 *
 * @param sudocodeDir - Path to .sudocode directory
 * @param input - Spec data and external link info
 * @returns The created spec
 */
export function createSpecFromExternal(
  sudocodeDir: string,
  input: CreateSpecFromExternalInput
): SpecJSONL {
  const specsPath = getSpecsJsonlPath(sudocodeDir);
  const specs = readJSONLSync<SpecJSONL>(specsPath, { skipErrors: true });

  const { id, uuid } = generateSpecIdFromJsonl(sudocodeDir);
  const now = new Date().toISOString();

  // Generate file_path from id (required for SpecJSONL)
  // File path is just a reference for imported specs - actual files are in the external system
  const file_path = `specs/${id}.md`;

  // Resolve external relationships to sudocode relationships
  const relationships = resolveExternalRelationships(
    sudocodeDir,
    id,
    "spec",
    input.external.provider,
    input.relationships
  );

  const newSpec: SpecJSONL = {
    id,
    uuid,
    title: input.title,
    file_path,
    content: input.content || "",
    priority: input.priority ?? 2,
    created_at: now,
    updated_at: now,
    relationships,
    tags: [],
    external_links: [
      {
        provider: input.external.provider,
        external_id: input.external.external_id,
        sync_enabled: true,
        sync_direction: input.external.sync_direction || "bidirectional",
        last_synced_at: now,
      },
    ],
  };

  specs.push(newSpec);
  writeJSONLSync(specsPath, specs);

  return newSpec;
}
