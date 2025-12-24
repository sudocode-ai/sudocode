/**
 * GitHub CLI (gh) wrapper for API calls
 *
 * Uses the `gh` CLI for authentication and API requests.
 * This avoids managing tokens directly - users authenticate via `gh auth login`.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Error thrown when gh CLI is not authenticated
 */
export class GhAuthError extends Error {
  constructor(message: string = "GitHub CLI not authenticated. Run: gh auth login") {
    super(message);
    this.name = "GhAuthError";
  }
}

/**
 * Error thrown when a GitHub resource is not found
 */
export class GhNotFoundError extends Error {
  constructor(resource: string) {
    super(`GitHub resource not found: ${resource}`);
    this.name = "GhNotFoundError";
  }
}

/**
 * Error thrown when rate limited by GitHub API
 */
export class GhRateLimitError extends Error {
  constructor(retryAfter?: number) {
    super(
      retryAfter
        ? `GitHub API rate limit exceeded. Retry after ${retryAfter} seconds.`
        : "GitHub API rate limit exceeded."
    );
    this.name = "GhRateLimitError";
    this.retryAfter = retryAfter;
  }
  retryAfter?: number;
}

/**
 * Error thrown when gh CLI is not installed
 */
export class GhNotInstalledError extends Error {
  constructor() {
    super("GitHub CLI (gh) is not installed. Install from: https://cli.github.com/");
    this.name = "GhNotInstalledError";
  }
}

/**
 * Options for gh API calls
 */
export interface GhApiOptions {
  /** HTTP method (default: GET) */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request body for POST/PUT/PATCH */
  body?: Record<string, unknown>;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Execute a gh CLI command and return the output
 *
 * @param args - Arguments to pass to gh
 * @returns Command output
 * @throws GhNotInstalledError if gh is not installed
 * @throws GhAuthError if not authenticated
 */
async function execGh(args: string[]): Promise<string> {
  const command = `gh ${args.join(" ")}`;

  try {
    const { stdout } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
    });
    return stdout;
  } catch (error) {
    const execError = error as { stderr?: string; code?: number; message?: string };
    const stderr = execError.stderr || execError.message || "";

    // Check for common error conditions
    if (stderr.includes("command not found") || stderr.includes("not recognized")) {
      throw new GhNotInstalledError();
    }

    if (
      stderr.includes("not logged in") ||
      stderr.includes("authentication") ||
      stderr.includes("gh auth login")
    ) {
      throw new GhAuthError();
    }

    if (stderr.includes("404") || stderr.includes("Not Found")) {
      throw new GhNotFoundError(args.join(" "));
    }

    if (stderr.includes("rate limit") || stderr.includes("403")) {
      // Try to extract retry-after from error
      const retryMatch = stderr.match(/retry after (\d+)/i);
      const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : undefined;
      throw new GhRateLimitError(retryAfter);
    }

    // Re-throw with better context
    throw new Error(`gh command failed: ${stderr}`);
  }
}

/**
 * Execute a gh api command and parse JSON response
 *
 * @param endpoint - API endpoint (e.g., "/repos/owner/repo/issues/123")
 * @param options - Optional API options
 * @returns Parsed JSON response
 */
export async function ghApi<T>(endpoint: string, options?: GhApiOptions): Promise<T> {
  const args = ["api"];

  // Add method if not GET
  if (options?.method && options.method !== "GET") {
    args.push("-X", options.method);
  }

  // Add headers
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  // Add body for POST/PUT/PATCH
  if (options?.body) {
    args.push("-f", JSON.stringify(options.body));
  }

  // Add endpoint (escape special characters)
  args.push(`"${endpoint}"`);

  const output = await execGh(args);
  return JSON.parse(output) as T;
}

/**
 * Check if gh CLI is authenticated
 *
 * @returns true if authenticated, false otherwise
 */
export async function ghAuthStatus(): Promise<boolean> {
  try {
    await execGh(["auth", "status"]);
    return true;
  } catch (error) {
    if (error instanceof GhNotInstalledError) {
      throw error; // Re-throw if not installed
    }
    return false;
  }
}

/**
 * Check if gh CLI is installed and available
 *
 * @returns true if gh CLI is available
 */
export async function isGhInstalled(): Promise<boolean> {
  try {
    await execGh(["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the authenticated user's login
 *
 * @returns GitHub username or null if not authenticated
 */
export async function getAuthenticatedUser(): Promise<string | null> {
  try {
    const output = await execGh(["auth", "status", "-t"]);
    const match = output.match(/Logged in to github\.com account (\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ============================================================================
// GitHub API Types (subset used by this plugin)
// ============================================================================

/**
 * GitHub user/author from API
 */
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
}

/**
 * GitHub label from API
 */
export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

/**
 * GitHub issue from API
 */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened" | null;
  html_url: string;
  user: GitHubUser | null;
  labels: GitHubLabel[];
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  /** Present only on pull requests - used to filter them out */
  pull_request?: {
    url: string;
  };
}

/**
 * GitHub issue comment from API
 */
export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

/**
 * GitHub discussion from API (GraphQL structure)
 */
export interface GitHubDiscussion {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: {
    login: string;
  } | null;
  category: {
    name: string;
  };
  comments: {
    totalCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * GitHub discussion comment from GraphQL
 */
export interface GitHubDiscussionComment {
  id: string;
  body: string;
  author: {
    login: string;
  } | null;
  url: string;
  createdAt: string;
}
