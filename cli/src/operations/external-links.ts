/**
 * External link operations for Specs and Issues
 * External links are stored in JSONL (not SQLite), so these operations
 * work directly with JSONL files.
 */

import type { ExternalLink, SpecJSONL, IssueJSONL, IntegrationProviderName } from "../types.js";
import { readJSONLSync, writeJSONLSync } from "../jsonl.js";
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
    if (links.some(l => l.provider === link.provider && l.external_id === link.external_id)) {
      throw new Error(`Link already exists: ${link.provider}:${link.external_id}`);
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
    const links = (spec.external_links || []).filter(l => l.external_id !== externalId);
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
  updates: Partial<Pick<ExternalLink, 'last_synced_at' | 'external_updated_at' | 'sync_enabled'>>
): SpecJSONL {
  return updateSpecInJsonl(sudocodeDir, specId, (spec) => {
    const links = (spec.external_links || []).map(l => {
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
  return specs.filter(s =>
    s.external_links?.some(l => l.provider === provider && l.external_id === externalId)
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
    if (links.some(l => l.provider === link.provider && l.external_id === link.external_id)) {
      throw new Error(`Link already exists: ${link.provider}:${link.external_id}`);
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
    const links = (issue.external_links || []).filter(l => l.external_id !== externalId);
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
  updates: Partial<Pick<ExternalLink, 'last_synced_at' | 'external_updated_at' | 'sync_enabled'>>
): IssueJSONL {
  return updateIssueInJsonl(sudocodeDir, issueId, (issue) => {
    const links = (issue.external_links || []).map(l => {
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
  return issues.filter(i =>
    i.external_links?.some(l => l.provider === provider && l.external_id === externalId)
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
