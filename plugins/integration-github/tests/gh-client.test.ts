/**
 * Tests for GitHub CLI wrapper
 *
 * These tests mock the gh CLI to test error handling and response parsing.
 * Set RUN_CLI_TESTS=true to run integration tests with real gh CLI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Import after mocking
import {
  ghApi,
  ghAuthStatus,
  isGhInstalled,
  GhAuthError,
  GhNotFoundError,
  GhNotInstalledError,
  GhRateLimitError,
} from "../src/gh-client.js";

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

function mockExecError(stderr: string, code = 1) {
  return (
    _command: string,
    _options: unknown,
    callback: (error: unknown, result?: { stdout: string }) => void
  ) => {
    callback({ stderr, code, message: stderr });
  };
}

describe("gh-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GhAuthError", () => {
    it("should have correct name and message", () => {
      const error = new GhAuthError();
      expect(error.name).toBe("GhAuthError");
      expect(error.message).toContain("gh auth login");
    });

    it("should accept custom message", () => {
      const error = new GhAuthError("Custom auth error");
      expect(error.message).toBe("Custom auth error");
    });
  });

  describe("GhNotFoundError", () => {
    it("should include resource in message", () => {
      const error = new GhNotFoundError("repos/owner/repo/issues/999");
      expect(error.name).toBe("GhNotFoundError");
      expect(error.message).toContain("repos/owner/repo/issues/999");
    });
  });

  describe("GhRateLimitError", () => {
    it("should have correct name", () => {
      const error = new GhRateLimitError();
      expect(error.name).toBe("GhRateLimitError");
      expect(error.message).toContain("rate limit");
    });

    it("should include retry-after when provided", () => {
      const error = new GhRateLimitError(60);
      expect(error.message).toContain("60 seconds");
      expect(error.retryAfter).toBe(60);
    });
  });

  describe("GhNotInstalledError", () => {
    it("should have correct message", () => {
      const error = new GhNotInstalledError();
      expect(error.name).toBe("GhNotInstalledError");
      expect(error.message).toContain("not installed");
      expect(error.message).toContain("cli.github.com");
    });
  });

  describe("isGhInstalled", () => {
    it("should return true when gh CLI is available", async () => {
      execMock.mockImplementation(mockExecSuccess("gh version 2.40.0"));

      const result = await isGhInstalled();
      expect(result).toBe(true);
    });

    it("should return false when gh CLI is not found", async () => {
      execMock.mockImplementation(mockExecError("command not found: gh"));

      const result = await isGhInstalled();
      expect(result).toBe(false);
    });
  });

  describe("ghAuthStatus", () => {
    it("should return true when authenticated", async () => {
      execMock.mockImplementation(
        mockExecSuccess("Logged in to github.com account user (keyring)")
      );

      const result = await ghAuthStatus();
      expect(result).toBe(true);
    });

    it("should return false when not authenticated", async () => {
      execMock.mockImplementation(mockExecError("You are not logged in"));

      const result = await ghAuthStatus();
      expect(result).toBe(false);
    });

    it("should throw when gh CLI is not installed", async () => {
      execMock.mockImplementation(mockExecError("command not found: gh"));

      await expect(ghAuthStatus()).rejects.toThrow(GhNotInstalledError);
    });
  });

  describe("ghApi", () => {
    it("should parse JSON response", async () => {
      const mockIssue = {
        id: 123,
        number: 42,
        title: "Test Issue",
        body: "Test body",
      };
      execMock.mockImplementation(mockExecSuccess(JSON.stringify(mockIssue)));

      const result = await ghApi<typeof mockIssue>("/repos/owner/repo/issues/42");

      expect(result).toEqual(mockIssue);
    });

    it("should throw GhAuthError when not authenticated", async () => {
      execMock.mockImplementation(mockExecError("not logged in to any GitHub hosts"));

      await expect(ghApi("/repos/owner/repo/issues/1")).rejects.toThrow(GhAuthError);
    });

    it("should throw GhNotFoundError for 404 responses", async () => {
      execMock.mockImplementation(mockExecError("404 Not Found"));

      await expect(ghApi("/repos/owner/repo/issues/999")).rejects.toThrow(GhNotFoundError);
    });

    it("should throw GhRateLimitError for rate limit errors", async () => {
      execMock.mockImplementation(mockExecError("403 rate limit exceeded"));

      await expect(ghApi("/repos/owner/repo")).rejects.toThrow(GhRateLimitError);
    });

    it("should extract retry-after from error message", async () => {
      execMock.mockImplementation(
        mockExecError("API rate limit exceeded. Please retry after 120 seconds")
      );

      try {
        await ghApi("/repos/owner/repo");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GhRateLimitError);
        expect((error as GhRateLimitError).retryAfter).toBe(120);
      }
    });

    it("should throw GhNotInstalledError when gh not found", async () => {
      execMock.mockImplementation(mockExecError("command not found: gh"));

      await expect(ghApi("/repos/owner/repo")).rejects.toThrow(GhNotInstalledError);
    });

    it("should throw generic error for other failures", async () => {
      execMock.mockImplementation(mockExecError("Some unexpected error"));

      await expect(ghApi("/repos/owner/repo")).rejects.toThrow("gh command failed");
    });
  });

  // Integration tests (require real gh CLI and authentication)
  describe.skipIf(!process.env.RUN_CLI_TESTS)("integration tests", () => {
    // Restore real exec for integration tests
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should check real gh installation", async () => {
      const result = await isGhInstalled();
      // This test passes if gh is installed, regardless of auth status
      expect(typeof result).toBe("boolean");
    });

    it("should check real auth status", async () => {
      const installed = await isGhInstalled();
      if (!installed) {
        console.log("Skipping auth test - gh not installed");
        return;
      }

      const result = await ghAuthStatus();
      expect(typeof result).toBe("boolean");
    });

    it("should fetch a real public issue", async () => {
      const installed = await isGhInstalled();
      const authenticated = installed && (await ghAuthStatus());

      if (!authenticated) {
        console.log("Skipping API test - not authenticated");
        return;
      }

      // Fetch a well-known public issue
      const issue = await ghApi<{ title: string; number: number }>(
        "/repos/cli/cli/issues/1"
      );

      expect(issue.number).toBe(1);
      expect(typeof issue.title).toBe("string");
    });
  });
});
