/**
 * Integration tests using the REAL GitHub CLI (gh)
 *
 * These tests use the `gh` CLI to interact with the real GitHub API.
 * They require:
 * 1. gh CLI to be installed (https://cli.github.com/)
 * 2. Authentication via `gh auth login`
 *
 * Tests are opt-in to avoid CI failures and API rate limits.
 *
 * To run: RUN_CLI_TESTS=true npm test -- tests/integration/real-cli.test.ts
 *
 * @see https://cli.github.com/
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import githubPlugin, {
  isGhInstalled,
  ghAuthStatus,
  ghApi,
  GitHubProvider,
} from "../../src/index.js";
import type { GitHubIssue } from "../../src/gh-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Check if gh CLI is installed and authenticated
async function checkGhStatus(): Promise<{
  installed: boolean;
  authenticated: boolean;
  version?: string;
  user?: string;
}> {
  try {
    // Check installation
    const versionResult = spawnSync("gh", ["--version"], { encoding: "utf-8" });
    if (versionResult.status !== 0) {
      return { installed: false, authenticated: false };
    }
    const version = versionResult.stdout.split("\n")[0]?.trim();

    // Check authentication
    const authResult = spawnSync("gh", ["auth", "status"], {
      encoding: "utf-8",
    });
    if (authResult.status !== 0) {
      return { installed: true, authenticated: false, version };
    }

    // Extract user from auth status output
    const userMatch = (authResult.stdout + authResult.stderr).match(
      /Logged in to github\.com.*account\s+(\S+)/i
    );
    const user = userMatch?.[1];

    return { installed: true, authenticated: true, version, user };
  } catch {
    return { installed: false, authenticated: false };
  }
}

// Check if real CLI tests should run (opt-in via RUN_CLI_TESTS env var)
const shouldRunCliTests = process.env.RUN_CLI_TESTS === "true";
let cliStatus: Awaited<ReturnType<typeof checkGhStatus>>;

// Helper to run gh commands with timeout
function runGh(
  args: string[],
  timeoutMs = 30000
): SpawnSyncReturns<string> {
  return spawnSync("gh", args, {
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

// Well-known public repositories and issues for testing
const TEST_REPOS = {
  // cli/cli is the GitHub CLI repository - always available
  ghCli: { owner: "cli", repo: "cli", issue: 1 },
  // facebook/react - popular open source project
  react: { owner: "facebook", repo: "react", issue: 1 },
};

// Conditionally run tests
const describeCLI = shouldRunCliTests ? describe : describe.skip;

if (!shouldRunCliTests) {
  console.log(
    "\n⏭️  Skipping real GitHub CLI tests.\n" +
      "   Run with: RUN_CLI_TESTS=true npm test -- tests/integration/real-cli.test.ts\n"
  );
}

describeCLI("Real GitHub CLI Integration", () => {
  beforeAll(async () => {
    cliStatus = await checkGhStatus();

    if (!cliStatus.installed) {
      console.log(
        "\n⚠️  Skipping tests: GitHub CLI (gh) not installed.\n" +
          "   Install from: https://cli.github.com/\n"
      );
      return;
    }

    if (!cliStatus.authenticated) {
      console.log(
        "\n⚠️  Skipping tests: GitHub CLI not authenticated.\n" +
          "   Run: gh auth login\n"
      );
      return;
    }

    console.log(
      `\n✓ GitHub CLI: ${cliStatus.version}\n` +
        `✓ Authenticated as: ${cliStatus.user}\n`
    );
  });

  describe("gh CLI basic commands", () => {
    it("should report version", () => {
      const result = runGh(["--version"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/gh version/i);
    });

    it("should report auth status", () => {
      const result = runGh(["auth", "status"]);
      expect(result.status).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Logged in to github\.com/i);
    });
  });

  describe("gh api commands", { timeout: 60000 }, () => {
    it("should fetch a public issue", () => {
      const { owner, repo, issue } = TEST_REPOS.ghCli;
      const result = runGh([
        "api",
        `/repos/${owner}/${repo}/issues/${issue}`,
      ]);

      expect(result.status).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.number).toBe(issue);
      expect(typeof data.title).toBe("string");
      expect(typeof data.body).toBe("string");
    });

    it("should fetch issue comments", () => {
      const { owner, repo, issue } = TEST_REPOS.ghCli;
      const result = runGh([
        "api",
        `/repos/${owner}/${repo}/issues/${issue}/comments`,
      ]);

      expect(result.status).toBe(0);
      const comments = JSON.parse(result.stdout);
      expect(Array.isArray(comments)).toBe(true);
    });

    it("should search issues", () => {
      const result = runGh([
        "api",
        "/search/issues?q=repo:cli/cli+type:issue&per_page=5",
      ]);

      expect(result.status).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it("should handle 404 for non-existent issue", () => {
      const result = runGh([
        "api",
        "/repos/cli/cli/issues/999999999",
      ]);

      expect(result.status).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/404|Not Found/i);
    });
  });

  describe("ghApi wrapper function", { timeout: 60000 }, () => {
    it("should fetch issue via wrapper", async () => {
      const { owner, repo, issue } = TEST_REPOS.ghCli;
      const data = await ghApi<GitHubIssue>(
        `/repos/${owner}/${repo}/issues/${issue}`
      );

      expect(data.number).toBe(issue);
      expect(typeof data.title).toBe("string");
    });

    it("should handle authentication check", async () => {
      const installed = await isGhInstalled();
      expect(installed).toBe(true);

      const authenticated = await ghAuthStatus();
      expect(authenticated).toBe(true);
    });
  });

  describe("GitHubProvider integration", { timeout: 120000 }, () => {
    let provider: GitHubProvider;

    beforeEach(async () => {
      provider = new GitHubProvider({});
      await provider.initialize();
    });

    afterEach(async () => {
      await provider.dispose();
    });

    describe("URL handling", () => {
      it("should recognize GitHub issue URLs", () => {
        expect(
          provider.canHandleUrl("https://github.com/cli/cli/issues/1")
        ).toBe(true);
        expect(
          provider.canHandleUrl("https://github.com/facebook/react/issues/123")
        ).toBe(true);
        expect(
          provider.canHandleUrl("https://gitlab.com/owner/repo/issues/1")
        ).toBe(false);
      });

      it("should parse GitHub issue URLs", () => {
        const result = provider.parseUrl(
          "https://github.com/cli/cli/issues/42"
        );

        expect(result).not.toBeNull();
        // External ID format is "owner/repo#number"
        expect(result?.externalId).toBe("cli/cli#42");
        expect(result?.metadata?.owner).toBe("cli");
        expect(result?.metadata?.repo).toBe("cli");
        expect(result?.metadata?.number).toBe(42);
      });
    });

    describe("fetchEntity", () => {
      it("should fetch a real GitHub issue by external ID", async () => {
        const { owner, repo, issue } = TEST_REPOS.ghCli;
        // External ID format is "owner/repo#number"
        const externalId = `${owner}/${repo}#${issue}`;
        const entity = await provider.fetchEntity(externalId);

        expect(entity).not.toBeNull();
        expect(entity?.id).toBe(externalId);
        expect(entity?.title).toBeDefined();
        expect(typeof entity?.title).toBe("string");
        // GitHub issues map to "spec" type in sudocode
        expect(entity?.type).toBe("spec");
      });

      it("should return null for non-existent issue", async () => {
        const entity = await provider.fetchEntity("cli/cli#999999999");

        expect(entity).toBeNull();
      });
    });

    describe("fetchByUrl", () => {
      it("should fetch a real GitHub issue by URL", async () => {
        const { owner, repo, issue } = TEST_REPOS.ghCli;
        const entity = await provider.fetchByUrl(
          `https://github.com/${owner}/${repo}/issues/${issue}`
        );

        expect(entity).not.toBeNull();
        // External ID format is "owner/repo#number"
        expect(entity?.id).toBe(`${owner}/${repo}#${issue}`);
        expect(entity?.title).toBeDefined();
      });

      it("should return null for invalid URL", async () => {
        const entity = await provider.fetchByUrl(
          "https://example.com/not-github"
        );

        expect(entity).toBeNull();
      });
    });

    describe("fetchComments", () => {
      it("should fetch comments for a GitHub issue", async () => {
        const { owner, repo, issue } = TEST_REPOS.ghCli;
        // External ID format is "owner/repo#number"
        const comments = await provider.fetchComments(
          `${owner}/${repo}#${issue}`
        );

        expect(Array.isArray(comments)).toBe(true);
        // Issue #1 on cli/cli should have comments
        if (comments.length > 0) {
          expect(comments[0].author).toBeDefined();
          expect(comments[0].body).toBeDefined();
          expect(comments[0].created_at).toBeDefined();
        }
      });

      it("should return empty array for invalid external ID", async () => {
        const comments = await provider.fetchComments("invalid-id");

        expect(Array.isArray(comments)).toBe(true);
        expect(comments.length).toBe(0);
      });
    });

    describe("searchEntities", () => {
      it("should search for issues in a repository", async () => {
        const results = await provider.searchEntities("repo:cli/cli is:issue");

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        const firstResult = results[0];
        // GitHub issues map to "spec" type in sudocode
        expect(firstResult.type).toBe("spec");
        expect(firstResult.title).toBeDefined();
        expect(firstResult.id).toBeDefined();
      });

      it("should return empty array for no query", async () => {
        const results = await provider.searchEntities();

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(0);
      });
    });

    describe("refreshEntities", () => {
      it("should refresh multiple entities", async () => {
        const { owner, repo, issue } = TEST_REPOS.ghCli;
        // External ID format is "owner/repo#number"
        const externalIds = [
          `${owner}/${repo}#${issue}`,
          `${owner}/${repo}#999999999`, // Non-existent
        ];

        const results = await provider.refreshEntities(externalIds);

        expect(results.length).toBe(2);
        expect(results[0]).not.toBeNull(); // First should succeed
        expect(results[1]).toBeNull(); // Second should fail (not found)
      });
    });

    describe("mapToSudocode", () => {
      it("should map GitHub issue to sudocode spec", async () => {
        const { owner, repo, issue } = TEST_REPOS.ghCli;
        // External ID format is "owner/repo#number"
        const entity = await provider.fetchEntity(
          `${owner}/${repo}#${issue}`
        );

        expect(entity).not.toBeNull();

        const mapped = provider.mapToSudocode(entity!);

        expect(mapped.spec).toBeDefined();
        expect(mapped.spec?.title).toBeDefined();
        // mapToSudocodeSpec returns content, not description
        expect(mapped.spec?.content).toBeDefined();
      });
    });
  });

  describe("Plugin testConnection", { timeout: 30000 }, () => {
    it("should report successful connection", async () => {
      const result = await githubPlugin.testConnection({}, process.cwd());

      expect(result.success).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.enabled).toBe(true);
      expect(result.details?.authMethod).toBe("gh-cli");
    });
  });

  describe("Plugin createProvider", () => {
    it("should create a functional provider", async () => {
      const provider = githubPlugin.createProvider({}, process.cwd());

      expect(provider).toBeDefined();
      expect(provider.name).toBe("github");
      expect(provider.supportsOnDemandImport).toBe(true);
      expect(provider.supportsPush).toBe(false);
    });
  });
});

// Version check test (always runs if shouldRunCliTests is true)
describeCLI("CLI Version Check", () => {
  it("should report gh version", () => {
    const result = runGh(["--version"]);
    expect(result.status).toBe(0);
    console.log(`   GitHub CLI version: ${result.stdout.split("\n")[0]?.trim()}`);
  });
});
