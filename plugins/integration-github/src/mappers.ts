/**
 * Entity mapping utilities for GitHub API → sudocode
 *
 * Converts GitHub API responses to ExternalEntity format
 * and maps to sudocode Spec format.
 */

import type { ExternalEntity, ExternalComment, Spec } from "@sudocode-ai/types";

/**
 * Type guard for raw data with author field
 */
interface GitHubRawData {
  author?: string;
  labels?: string[];
  [key: string]: unknown;
}
import type { GitHubIssue, GitHubComment, GitHubDiscussion, GitHubDiscussionComment } from "./gh-client.js";
import { formatExternalId, buildGitHubUrl, type GitHubEntityType } from "./url-parser.js";

/**
 * Map a GitHub issue to ExternalEntity
 *
 * @param issue - GitHub issue from API
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns ExternalEntity
 */
export function mapGitHubIssueToExternal(
  issue: GitHubIssue,
  owner: string,
  repo: string
): ExternalEntity {
  return {
    id: formatExternalId(owner, repo, issue.number),
    type: "spec", // GitHub issues map to specs in sudocode
    title: issue.title,
    description: issue.body || "",
    status: issue.state,
    url: issue.html_url,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    raw: {
      labels: issue.labels.map((l) => l.name),
      author: issue.user?.login,
      comments_count: issue.comments,
      state_reason: issue.state_reason,
      github_id: issue.id,
      entity_type: "issue" as GitHubEntityType,
    },
  };
}

/**
 * Map a GitHub discussion to ExternalEntity
 *
 * @param discussion - GitHub discussion from GraphQL API
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns ExternalEntity
 */
export function mapGitHubDiscussionToExternal(
  discussion: GitHubDiscussion,
  owner: string,
  repo: string
): ExternalEntity {
  return {
    id: formatExternalId(owner, repo, discussion.number),
    type: "spec",
    title: discussion.title,
    description: discussion.body || "",
    status: "open", // Discussions don't have a closed state like issues
    url: discussion.url,
    created_at: discussion.createdAt,
    updated_at: discussion.updatedAt,
    raw: {
      category: discussion.category.name,
      author: discussion.author?.login,
      comments_count: discussion.comments.totalCount,
      github_id: discussion.id,
      entity_type: "discussion" as GitHubEntityType,
    },
  };
}

/**
 * Map a GitHub comment to ExternalComment
 *
 * @param comment - GitHub comment from API
 * @returns ExternalComment
 */
export function mapGitHubCommentToExternal(comment: GitHubComment): ExternalComment {
  return {
    id: String(comment.id),
    author: comment.user?.login || "unknown",
    body: comment.body,
    created_at: comment.created_at,
    url: comment.html_url,
  };
}

/**
 * Map a GitHub discussion comment to ExternalComment
 *
 * @param comment - GitHub discussion comment from GraphQL API
 * @returns ExternalComment
 */
export function mapGitHubDiscussionCommentToExternal(
  comment: GitHubDiscussionComment
): ExternalComment {
  return {
    id: comment.id,
    author: comment.author?.login || "unknown",
    body: comment.body,
    created_at: comment.createdAt,
    url: comment.url,
  };
}

/**
 * Format content for imported spec with attribution header
 *
 * @param external - External entity to format
 * @returns Formatted content string
 */
export function formatSpecContent(external: ExternalEntity): string {
  const lines: string[] = [];

  // Add source attribution
  lines.push(`> Imported from [${external.id}](${external.url})`);

  // Add author if available
  const raw = external.raw as GitHubRawData | undefined;
  if (raw?.author) {
    lines.push(`> Author: @${raw.author}`);
  }

  // Add empty line separator
  lines.push("");

  // Add original content
  if (external.description) {
    lines.push(external.description);
  }

  return lines.join("\n");
}

/**
 * Extended spec data including labels for import
 * Note: tags are stored in SpecJSONL, not the base Spec type
 */
export interface ImportedSpecData extends Partial<Spec> {
  /** GitHub labels to be stored as tags */
  labels?: string[];
}

/**
 * Map ExternalEntity to sudocode Spec format
 *
 * @param external - External entity from GitHub
 * @returns Partial Spec for creation/update, with labels stored separately
 */
export function mapToSudocodeSpec(external: ExternalEntity): ImportedSpecData {
  const raw = external.raw as GitHubRawData | undefined;
  const labels = raw?.labels || [];

  return {
    title: external.title,
    content: formatSpecContent(external),
    priority: 2, // Default priority
    labels, // Stored as labels, caller converts to tags
  };
}

/**
 * Map priority from sudocode format (0-4) to GitHub labels
 *
 * This is used when pushing back to GitHub (not implemented in this version)
 *
 * @param priority - sudocode priority (0=highest, 4=lowest)
 * @returns GitHub priority label or undefined
 */
export function mapPriorityToLabel(priority: number): string | undefined {
  const labels: Record<number, string> = {
    0: "priority: critical",
    1: "priority: high",
    2: "priority: medium",
    3: "priority: low",
    4: "priority: lowest",
  };
  return labels[priority];
}

/**
 * Extract priority from GitHub labels
 *
 * @param labels - Array of label names
 * @returns Mapped priority (0-4) or undefined
 */
export function extractPriorityFromLabels(labels: string[]): number | undefined {
  const priorityMap: Record<string, number> = {
    "priority: critical": 0,
    "priority: high": 1,
    "priority: medium": 2,
    "priority: low": 3,
    "priority: lowest": 4,
    "p0": 0,
    "p1": 1,
    "p2": 2,
    "p3": 3,
    "p4": 4,
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
  };

  for (const label of labels) {
    const normalized = label.toLowerCase();
    if (normalized in priorityMap) {
      return priorityMap[normalized];
    }
  }

  return undefined;
}

/**
 * Build external link metadata for storage
 *
 * @param external - External entity
 * @param entityType - Type of GitHub entity (issue/discussion)
 * @returns External link metadata
 */
export function buildExternalLinkMetadata(
  external: ExternalEntity,
  entityType: GitHubEntityType
): Record<string, unknown> {
  const parsed = external.id.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (!parsed) {
    return { type: entityType };
  }

  const [, owner, repo] = parsed;
  return {
    owner,
    repo,
    type: entityType,
    comments_imported: false,
  };
}
