/**
 * Tests for GitHub Plugin and Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Import after mocking
import githubPlugin, { GitHubProvider, GITHUB_URL_PATTERNS } from "../src/index.js";
import type { GitHubIssue, GitHubComment } from "../src/gh-client.js";

const execMock = exec as unknown as ReturnType<typeof vi.fn>;

/**
 * Helper to create mock exec callback
 */
function mockExecSuccess(stdout: string) {
  return (
    _command: string,
    _options: unknown,
    callback: (error: unknown, result: { stdout: string }) => void
  ) => {
    callback(null, { stdout });
  };
}

function mockExecError(stderr: string) {
  return (
    _command: string,
    _options: unknown,
    callback: (error: unknown, result?: { stdout: string }) => void
  ) => {
    callback({ stderr, message: stderr });
  };
}

describe("GitHub Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", () => {
      expect(githubPlugin.name).toBe("github");
    });

    it("should have display name", () => {
      expect(githubPlugin.displayName).toBe("GitHub");
    });

    it("should have version", () => {
      expect(githubPlugin.version).toBe("0.1.0");
    });

    it("should have description", () => {
      expect(githubPlugin.description).toContain("GitHub");
    });

    it("should have config schema (empty)", () => {
      expect(githubPlugin.configSchema).toBeDefined();
      expect(githubPlugin.configSchema?.properties).toEqual({});
    });
  });

  describe("validateConfig", () => {
    it("should accept empty config (no token needed)", () => {
      const result = githubPlugin.validateConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should accept any config (ignored)", () => {
      const result = githubPlugin.validateConfig({ anything: "value" });
      expect(result.valid).toBe(true);
    });
  });

  describe("testConnection", () => {
    it("should fail when gh CLI is not installed", async () => {
      execMock.mockImplementation(mockExecError("command not found: gh"));

      const result = await githubPlugin.testConnection({}, "/tmp");

      expect(result.success).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.error).toContain("not installed");
    });

    it("should fail when not authenticated", async () => {
      // First call for --version succeeds
      // Second call for auth status fails
      let callCount = 0;
      execMock.mockImplementation((command: string, _options: unknown, callback: (err: unknown, result?: { stdout: string }) => void) => {
        callCount++;
        if (command.includes("--version")) {
          callback(null, { stdout: "gh version 2.40.0" });
        } else {
          callback({ stderr: "not logged in", message: "not logged in" });
        }
      });

      const result = await githubPlugin.testConnection({}, "/tmp");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not authenticated");
    });

    it("should succeed when gh CLI is authenticated", async () => {
      execMock.mockImplementation(mockExecSuccess("Logged in to github.com account user"));

      const result = await githubPlugin.testConnection({}, "/tmp");

      expect(result.success).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.details?.authMethod).toBe("gh-cli");
    });
  });

  describe("createProvider", () => {
    it("should create provider instance", () => {
      const provider = githubPlugin.createProvider({}, "/tmp");

      expect(provider).toBeDefined();
      expect(provider.name).toBe("github");
    });
  });
});

describe("GitHub Provider", () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubProvider({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("capabilities", () => {
    it("should report correct capability flags", () => {
      expect(provider.supportsWatch).toBe(false);
      expect(provider.supportsPolling).toBe(false);
      expect(provider.supportsOnDemandImport).toBe(true);
      expect(provider.supportsSearch).toBe(true);
      expect(provider.supportsPush).toBe(false);
    });
  });

  describe("canHandleUrl", () => {
    it("should handle GitHub issue URLs", () => {
      expect(provider.canHandleUrl("https://github.com/owner/repo/issues/123")).toBe(true);
    });

    it("should handle GitHub discussion URLs", () => {
      expect(provider.canHandleUrl("https://github.com/owner/repo/discussions/456")).toBe(true);
    });

    it("should reject non-GitHub URLs", () => {
      expect(provider.canHandleUrl("https://gitlab.com/owner/repo/issues/1")).toBe(false);
    });
  });

  describe("parseUrl", () => {
    it("should parse issue URLs", () => {
      const result = provider.parseUrl("https://github.com/owner/repo/issues/42");

      expect(result).not.toBeNull();
      expect(result?.externalId).toBe("owner/repo#42");
    });

    it("should return null for invalid URLs", () => {
      expect(provider.parseUrl("invalid")).toBeNull();
    });
  });

  describe("initialize", () => {
    it("should initialize successfully when authenticated", async () => {
      execMock.mockImplementation(mockExecSuccess("Logged in to github.com account user"));

      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it("should fail when gh CLI not installed", async () => {
      execMock.mockImplementation(mockExecError("command not found: gh"));

      await expect(provider.initialize()).rejects.toThrow("not installed");
    });

    it("should fail when not authenticated", async () => {
      let callCount = 0;
      execMock.mockImplementation((command: string, _options: unknown, callback: (err: unknown, result?: { stdout: string }) => void) => {
        callCount++;
        if (command.includes("--version")) {
          callback(null, { stdout: "gh version 2.40.0" });
        } else {
          callback({ stderr: "not logged in", message: "not logged in" });
        }
      });

      await expect(provider.initialize()).rejects.toThrow("not authenticated");
    });
  });

  describe("validate", () => {
    it("should return valid when authenticated", async () => {
      execMock.mockImplementation(mockExecSuccess("Logged in to github.com account user"));

      const result = await provider.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return invalid when not authenticated", async () => {
      let callCount = 0;
      execMock.mockImplementation((command: string, _options: unknown, callback: (err: unknown, result?: { stdout: string }) => void) => {
        callCount++;
        if (command.includes("--version")) {
          callback(null, { stdout: "gh version 2.40.0" });
        } else {
          callback({ stderr: "not logged in", message: "not logged in" });
        }
      });

      const result = await provider.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("fetchEntity", () => {
    const mockIssue: GitHubIssue = {
      id: 12345,
      number: 42,
      title: "Test Issue",
      body: "This is the issue body.",
      state: "open",
      html_url: "https://github.com/owner/repo/issues/42",
      user: {
        login: "testuser",
        id: 1,
        avatar_url: "https://avatars.githubusercontent.com/u/1",
        html_url: "https://github.com/testuser",
      },
      labels: [
        { id: 1, name: "bug", color: "red", description: "Bug label" },
        { id: 2, name: "high-priority", color: "yellow" },
      ],
      comments: 5,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      closed_at: null,
    };

    it("should fetch and map GitHub issue", async () => {
      execMock.mockImplementation(mockExecSuccess(JSON.stringify(mockIssue)));

      const entity = await provider.fetchEntity("owner/repo#42");

      expect(entity).not.toBeNull();
      expect(entity?.id).toBe("owner/repo#42");
      expect(entity?.type).toBe("spec");
      expect(entity?.title).toBe("Test Issue");
      expect(entity?.description).toBe("This is the issue body.");
      expect(entity?.status).toBe("open");
      expect(entity?.url).toBe("https://github.com/owner/repo/issues/42");
      expect(entity?.raw?.author).toBe("testuser");
      expect(entity?.raw?.labels).toEqual(["bug", "high-priority"]);
    });

    it("should return null for invalid external ID", async () => {
      const entity = await provider.fetchEntity("invalid");
      expect(entity).toBeNull();
    });

    it("should return null when issue not found", async () => {
      execMock.mockImplementation(mockExecError("404 Not Found"));

      const entity = await provider.fetchEntity("owner/repo#999");
      expect(entity).toBeNull();
    });
  });

  describe("fetchComments", () => {
    const mockComments: GitHubComment[] = [
      {
        id: 100,
        body: "First comment",
        user: {
          login: "commenter1",
          id: 10,
          avatar_url: "https://avatars.githubusercontent.com/u/10",
          html_url: "https://github.com/commenter1",
        },
        html_url: "https://github.com/owner/repo/issues/42#issuecomment-100",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: 101,
        body: "Second comment",
        user: null,
        html_url: "https://github.com/owner/repo/issues/42#issuecomment-101",
        created_at: "2024-01-03T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
      },
    ];

    it("should fetch and map comments", async () => {
      execMock.mockImplementation(mockExecSuccess(JSON.stringify(mockComments)));

      const comments = await provider.fetchComments("owner/repo#42");

      expect(comments).toHaveLength(2);
      expect(comments[0].id).toBe("100");
      expect(comments[0].author).toBe("commenter1");
      expect(comments[0].body).toBe("First comment");
      expect(comments[1].author).toBe("unknown"); // null user
    });

    it("should return empty array for invalid external ID", async () => {
      const comments = await provider.fetchComments("invalid");
      expect(comments).toEqual([]);
    });

    it("should return empty array when issue not found", async () => {
      execMock.mockImplementation(mockExecError("404 Not Found"));

      const comments = await provider.fetchComments("owner/repo#999");
      expect(comments).toEqual([]);
    });
  });

  describe("fetchByUrl", () => {
    it("should fetch entity by URL", async () => {
      const mockIssue: GitHubIssue = {
        id: 123,
        number: 42,
        title: "Test",
        body: "Body",
        state: "open",
        html_url: "https://github.com/owner/repo/issues/42",
        user: null,
        labels: [],
        comments: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        closed_at: null,
      };
      execMock.mockImplementation(mockExecSuccess(JSON.stringify(mockIssue)));

      const entity = await provider.fetchByUrl("https://github.com/owner/repo/issues/42");

      expect(entity).not.toBeNull();
      expect(entity?.id).toBe("owner/repo#42");
    });

    it("should return null for invalid URL", async () => {
      const entity = await provider.fetchByUrl("invalid");
      expect(entity).toBeNull();
    });
  });

  describe("refreshEntities", () => {
    it("should refresh multiple entities", async () => {
      const mockIssue1: GitHubIssue = {
        id: 1,
        number: 1,
        title: "Issue 1",
        body: null,
        state: "open",
        html_url: "https://github.com/owner/repo/issues/1",
        user: null,
        labels: [],
        comments: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        closed_at: null,
      };

      const mockIssue2: GitHubIssue = {
        id: 2,
        number: 2,
        title: "Issue 2",
        body: null,
        state: "closed",
        html_url: "https://github.com/owner/repo/issues/2",
        user: null,
        labels: [],
        comments: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        closed_at: "2024-01-02T00:00:00Z",
      };

      let callCount = 0;
      execMock.mockImplementation((command: string, _options: unknown, callback: (err: unknown, result?: { stdout: string }) => void) => {
        callCount++;
        if (command.includes("issues/1")) {
          callback(null, { stdout: JSON.stringify(mockIssue1) });
        } else if (command.includes("issues/2")) {
          callback(null, { stdout: JSON.stringify(mockIssue2) });
        } else if (command.includes("issues/3")) {
          callback({ stderr: "404 Not Found", message: "404 Not Found" });
        }
      });

      const results = await provider.refreshEntities([
        "owner/repo#1",
        "owner/repo#2",
        "owner/repo#3",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]?.title).toBe("Issue 1");
      expect(results[1]?.title).toBe("Issue 2");
      expect(results[2]).toBeNull(); // Not found
    });
  });

  describe("mapToSudocode", () => {
    it("should map external entity to spec", () => {
      const external = {
        id: "owner/repo#42",
        type: "spec" as const,
        title: "Test Issue",
        description: "Issue body content",
        status: "open",
        url: "https://github.com/owner/repo/issues/42",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T00:00:00Z",
        raw: {
          author: "testuser",
          labels: ["bug", "enhancement"],
        },
      };

      const mapped = provider.mapToSudocode(external);

      expect(mapped.spec).toBeDefined();
      expect(mapped.spec?.title).toBe("Test Issue");
      expect(mapped.spec?.content).toContain("owner/repo#42");
      expect(mapped.spec?.content).toContain("@testuser");
      expect(mapped.spec?.content).toContain("Issue body content");
      expect(mapped.spec?.priority).toBe(2);
      // Note: labels are extracted separately and stored as tags at a higher layer
      // The mapToSudocode return doesn't include labels directly
    });
  });

  describe("read-only operations", () => {
    it("should throw on createEntity", async () => {
      await expect(provider.createEntity({ title: "Test" })).rejects.toThrow("read-only");
    });

    it("should throw on updateEntity", async () => {
      await expect(provider.updateEntity("id", { title: "Test" })).rejects.toThrow("read-only");
    });

    it("should throw on deleteEntity", async () => {
      await expect(provider.deleteEntity("id")).rejects.toThrow("read-only");
    });

    it("should throw on mapFromSudocode", () => {
      expect(() => provider.mapFromSudocode({ title: "Test" } as any)).toThrow("read-only");
    });

    it("should return empty array for getChangesSince", async () => {
      const changes = await provider.getChangesSince(new Date());
      expect(changes).toEqual([]);
    });
  });

  describe("searchEntities", () => {
    it("should search for issues", async () => {
      const mockSearchResult = {
        items: [
          {
            id: 1,
            number: 1,
            title: "Search Result 1",
            body: "Body 1",
            state: "open" as const,
            html_url: "https://github.com/owner/repo/issues/1",
            user: null,
            labels: [],
            comments: 0,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            closed_at: null,
          },
        ],
      };
      execMock.mockImplementation(mockExecSuccess(JSON.stringify(mockSearchResult)));

      const results = await provider.searchEntities("test query");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Search Result 1");
    });

    it("should return empty array when no query provided", async () => {
      const results = await provider.searchEntities();
      expect(results).toEqual([]);
    });

    it("should handle search errors gracefully", async () => {
      execMock.mockImplementation(mockExecError("API error"));

      const results = await provider.searchEntities("query");
      expect(results).toEqual([]);
    });
  });
});

describe("GITHUB_URL_PATTERNS export", () => {
  it("should export URL patterns", () => {
    expect(GITHUB_URL_PATTERNS).toBeDefined();
    expect(GITHUB_URL_PATTERNS.issue).toBeDefined();
    expect(GITHUB_URL_PATTERNS.discussion).toBeDefined();
  });
});
