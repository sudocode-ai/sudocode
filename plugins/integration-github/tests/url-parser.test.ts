/**
 * Tests for GitHub URL parsing utilities
 */

import { describe, it, expect } from "vitest";
import {
  canHandleUrl,
  parseUrl,
  parseGitHubUrl,
  parseExternalId,
  buildGitHubUrl,
  formatExternalId,
  GITHUB_URL_PATTERNS,
} from "../src/url-parser.js";

describe("URL Parser", () => {
  describe("GITHUB_URL_PATTERNS", () => {
    it("should have patterns for issues, discussions, and PRs", () => {
      expect(GITHUB_URL_PATTERNS.issue).toBeDefined();
      expect(GITHUB_URL_PATTERNS.discussion).toBeDefined();
      expect(GITHUB_URL_PATTERNS.pullRequest).toBeDefined();
    });
  });

  describe("canHandleUrl", () => {
    describe("issue URLs", () => {
      it("should handle standard issue URLs", () => {
        expect(canHandleUrl("https://github.com/owner/repo/issues/123")).toBe(true);
      });

      it("should handle issue URLs with dashes in names", () => {
        expect(canHandleUrl("https://github.com/my-org/my-repo/issues/1")).toBe(true);
      });

      it("should handle issue URLs with dots in names", () => {
        expect(canHandleUrl("https://github.com/owner/repo.js/issues/42")).toBe(true);
      });

      it("should handle issue URLs with query parameters", () => {
        expect(canHandleUrl("https://github.com/owner/repo/issues/123?ref=main")).toBe(true);
      });

      it("should handle issue URLs with hash fragments", () => {
        expect(canHandleUrl("https://github.com/owner/repo/issues/123#issuecomment-1")).toBe(true);
      });

      it("should handle issue URLs with trailing paths", () => {
        expect(canHandleUrl("https://github.com/owner/repo/issues/123/timeline")).toBe(true);
      });
    });

    describe("discussion URLs", () => {
      it("should handle standard discussion URLs", () => {
        expect(canHandleUrl("https://github.com/owner/repo/discussions/456")).toBe(true);
      });

      it("should handle discussion URLs with dashes", () => {
        expect(canHandleUrl("https://github.com/my-org/my-repo/discussions/1")).toBe(true);
      });
    });

    describe("pull request URLs", () => {
      it("should handle standard PR URLs", () => {
        expect(canHandleUrl("https://github.com/owner/repo/pull/789")).toBe(true);
      });

      it("should handle PR URLs with subpaths", () => {
        expect(canHandleUrl("https://github.com/owner/repo/pull/789/files")).toBe(true);
      });
    });

    describe("invalid URLs", () => {
      it("should reject non-GitHub URLs", () => {
        expect(canHandleUrl("https://gitlab.com/owner/repo/issues/123")).toBe(false);
      });

      it("should reject GitHub URLs without issues/discussions/pull", () => {
        expect(canHandleUrl("https://github.com/owner/repo")).toBe(false);
      });

      it("should reject GitHub profile URLs", () => {
        expect(canHandleUrl("https://github.com/owner")).toBe(false);
      });

      it("should reject non-numeric issue numbers", () => {
        expect(canHandleUrl("https://github.com/owner/repo/issues/abc")).toBe(false);
      });

      it("should reject HTTP URLs (non-HTTPS)", () => {
        expect(canHandleUrl("http://github.com/owner/repo/issues/123")).toBe(false);
      });

      it("should reject empty strings", () => {
        expect(canHandleUrl("")).toBe(false);
      });

      it("should reject malformed URLs", () => {
        expect(canHandleUrl("not-a-url")).toBe(false);
      });
    });
  });

  describe("parseUrl", () => {
    it("should parse issue URLs", () => {
      const result = parseUrl("https://github.com/sudocode-ai/sudocode/issues/42");

      expect(result).not.toBeNull();
      expect(result?.externalId).toBe("sudocode-ai/sudocode#42");
      expect(result?.metadata?.owner).toBe("sudocode-ai");
      expect(result?.metadata?.repo).toBe("sudocode");
      expect(result?.metadata?.number).toBe(42);
      expect(result?.metadata?.type).toBe("issue");
    });

    it("should parse discussion URLs", () => {
      const result = parseUrl("https://github.com/vercel/next.js/discussions/100");

      expect(result).not.toBeNull();
      expect(result?.externalId).toBe("vercel/next.js#100");
      expect(result?.metadata?.type).toBe("discussion");
    });

    it("should parse PR URLs", () => {
      const result = parseUrl("https://github.com/facebook/react/pull/999");

      expect(result).not.toBeNull();
      expect(result?.externalId).toBe("facebook/react#999");
      expect(result?.metadata?.type).toBe("pull_request");
    });

    it("should return null for invalid URLs", () => {
      expect(parseUrl("https://gitlab.com/owner/repo/issues/1")).toBeNull();
      expect(parseUrl("not-a-url")).toBeNull();
      expect(parseUrl("")).toBeNull();
    });

    it("should preserve original URL in metadata", () => {
      const url = "https://github.com/owner/repo/issues/123";
      const result = parseUrl(url);

      expect(result?.metadata?.url).toBe(url);
    });
  });

  describe("parseGitHubUrl", () => {
    it("should return full parsed details", () => {
      const result = parseGitHubUrl("https://github.com/org/project/issues/50");

      expect(result).not.toBeNull();
      expect(result?.owner).toBe("org");
      expect(result?.repo).toBe("project");
      expect(result?.number).toBe(50);
      expect(result?.type).toBe("issue");
      expect(result?.externalId).toBe("org/project#50");
      expect(result?.url).toBe("https://github.com/org/project/issues/50");
    });

    it("should handle discussion URLs", () => {
      const result = parseGitHubUrl("https://github.com/org/project/discussions/75");

      expect(result?.type).toBe("discussion");
      expect(result?.number).toBe(75);
    });

    it("should return null for invalid URLs", () => {
      expect(parseGitHubUrl("invalid")).toBeNull();
    });
  });

  describe("parseExternalId", () => {
    it("should parse valid external IDs", () => {
      const result = parseExternalId("owner/repo#123");

      expect(result).not.toBeNull();
      expect(result?.owner).toBe("owner");
      expect(result?.repo).toBe("repo");
      expect(result?.number).toBe(123);
    });

    it("should handle dashes and dots", () => {
      const result = parseExternalId("my-org/my-repo.js#1");

      expect(result?.owner).toBe("my-org");
      expect(result?.repo).toBe("my-repo.js");
      expect(result?.number).toBe(1);
    });

    it("should return null for invalid formats", () => {
      expect(parseExternalId("invalid")).toBeNull();
      expect(parseExternalId("owner/repo")).toBeNull();
      expect(parseExternalId("owner/repo#abc")).toBeNull();
      expect(parseExternalId("")).toBeNull();
    });
  });

  describe("buildGitHubUrl", () => {
    it("should build issue URLs", () => {
      const url = buildGitHubUrl("owner", "repo", 123, "issue");
      expect(url).toBe("https://github.com/owner/repo/issues/123");
    });

    it("should build discussion URLs", () => {
      const url = buildGitHubUrl("owner", "repo", 456, "discussion");
      expect(url).toBe("https://github.com/owner/repo/discussions/456");
    });

    it("should build PR URLs", () => {
      const url = buildGitHubUrl("owner", "repo", 789, "pull_request");
      expect(url).toBe("https://github.com/owner/repo/pull/789");
    });

    it("should default to issue type", () => {
      const url = buildGitHubUrl("owner", "repo", 100);
      expect(url).toBe("https://github.com/owner/repo/issues/100");
    });
  });

  describe("formatExternalId", () => {
    it("should format external IDs correctly", () => {
      expect(formatExternalId("owner", "repo", 123)).toBe("owner/repo#123");
    });

    it("should handle special characters", () => {
      expect(formatExternalId("my-org", "my-repo.js", 1)).toBe("my-org/my-repo.js#1");
    });
  });

  describe("round-trip conversions", () => {
    it("should convert URL → externalId → URL", () => {
      const originalUrl = "https://github.com/owner/repo/issues/42";
      const parsed = parseGitHubUrl(originalUrl);
      expect(parsed).not.toBeNull();

      const rebuiltUrl = buildGitHubUrl(
        parsed!.owner,
        parsed!.repo,
        parsed!.number,
        parsed!.type
      );
      expect(rebuiltUrl).toBe(originalUrl);
    });

    it("should convert externalId → URL → externalId", () => {
      const originalId = "owner/repo#123";
      const parsed = parseExternalId(originalId);
      expect(parsed).not.toBeNull();

      const url = buildGitHubUrl(parsed!.owner, parsed!.repo, parsed!.number, "issue");
      const reparsed = parseGitHubUrl(url);
      expect(reparsed).not.toBeNull();
      expect(reparsed!.externalId).toBe(originalId);
    });
  });
});
