/**
 * URL parsing utilities for GitHub URLs
 *
 * Supports parsing GitHub issue and discussion URLs to extract
 * owner, repo, and entity number.
 */

/**
 * Supported GitHub URL patterns
 */
export const GITHUB_URL_PATTERNS = {
  issue: /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?:\/.*)?(?:\?.*)?(?:#.*)?$/,
  discussion: /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/discussions\/(\d+)(?:\/.*)?(?:\?.*)?(?:#.*)?$/,
  pullRequest: /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/.*)?(?:\?.*)?(?:#.*)?$/,
} as const;

/**
 * Entity types that can be parsed from GitHub URLs
 */
export type GitHubEntityType = "issue" | "discussion" | "pull_request";

/**
 * Result of parsing a GitHub URL
 */
export interface ParsedGitHubUrl {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Entity number (issue/discussion/PR number) */
  number: number;
  /** Type of entity */
  type: GitHubEntityType;
  /** External ID in format "owner/repo#number" */
  externalId: string;
  /** Original URL */
  url: string;
}

/**
 * Check if a URL is a GitHub URL that this provider can handle
 *
 * @param url - URL to check
 * @returns true if URL matches a supported GitHub pattern
 */
export function canHandleUrl(url: string): boolean {
  return Object.values(GITHUB_URL_PATTERNS).some((pattern) => pattern.test(url));
}

/**
 * Parse a GitHub URL to extract entity information
 *
 * @param url - GitHub URL to parse
 * @returns Parsed URL info or null if URL cannot be parsed
 */
export function parseUrl(
  url: string
): { externalId: string; metadata?: Record<string, unknown> } | null {
  // Try issue pattern
  const issueMatch = url.match(GITHUB_URL_PATTERNS.issue);
  if (issueMatch) {
    const [, owner, repo, number] = issueMatch;
    return {
      externalId: `${owner}/${repo}#${number}`,
      metadata: {
        owner,
        repo,
        number: parseInt(number, 10),
        type: "issue" as GitHubEntityType,
        url,
      },
    };
  }

  // Try discussion pattern
  const discussionMatch = url.match(GITHUB_URL_PATTERNS.discussion);
  if (discussionMatch) {
    const [, owner, repo, number] = discussionMatch;
    return {
      externalId: `${owner}/${repo}#${number}`,
      metadata: {
        owner,
        repo,
        number: parseInt(number, 10),
        type: "discussion" as GitHubEntityType,
        url,
      },
    };
  }

  // Try PR pattern
  const prMatch = url.match(GITHUB_URL_PATTERNS.pullRequest);
  if (prMatch) {
    const [, owner, repo, number] = prMatch;
    return {
      externalId: `${owner}/${repo}#${number}`,
      metadata: {
        owner,
        repo,
        number: parseInt(number, 10),
        type: "pull_request" as GitHubEntityType,
        url,
      },
    };
  }

  return null;
}

/**
 * Parse a GitHub URL to extract full details
 *
 * @param url - GitHub URL to parse
 * @returns Full parsed URL details or null if URL cannot be parsed
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const result = parseUrl(url);
  if (!result || !result.metadata) {
    return null;
  }

  const { owner, repo, number, type } = result.metadata as {
    owner: string;
    repo: string;
    number: number;
    type: GitHubEntityType;
  };

  return {
    owner,
    repo,
    number,
    type,
    externalId: result.externalId,
    url,
  };
}

/**
 * Parse an external ID in format "owner/repo#number"
 *
 * @param externalId - External ID to parse
 * @returns Parsed components or null if invalid format
 */
export function parseExternalId(
  externalId: string
): { owner: string; repo: string; number: number } | null {
  const match = externalId.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (!match) {
    return null;
  }

  const [, owner, repo, number] = match;
  return {
    owner,
    repo,
    number: parseInt(number, 10),
  };
}

/**
 * Build a GitHub URL from parsed components
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param number - Entity number
 * @param type - Entity type (defaults to issue)
 * @returns GitHub URL
 */
export function buildGitHubUrl(
  owner: string,
  repo: string,
  number: number,
  type: GitHubEntityType = "issue"
): string {
  const typeMap: Record<GitHubEntityType, string> = {
    issue: "issues",
    discussion: "discussions",
    pull_request: "pull",
  };

  return `https://github.com/${owner}/${repo}/${typeMap[type]}/${number}`;
}

/**
 * Format an external ID from components
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param number - Entity number
 * @returns External ID in format "owner/repo#number"
 */
export function formatExternalId(
  owner: string,
  repo: string,
  number: number
): string {
  return `${owner}/${repo}#${number}`;
}
