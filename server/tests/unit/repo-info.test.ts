/**
 * Tests for Repository Info API endpoint
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import * as path from "path";
import { getRepositoryInfo } from "../../src/services/repo-info.js";

describe("Repository Info API", () => {
  let app: express.Application;

  beforeAll(() => {
    // Set up Express app with the repo-info endpoint
    app = express();
    app.use(express.json());

    // Mock the REPO_ROOT to use the actual repository root
    const REPO_ROOT = path.join(process.cwd());

    // Add the repository info endpoint using the service
    app.get("/api/repo-info", async (_req, res): Promise<void> => {
      try {
        const repoInfo = await getRepositoryInfo(REPO_ROOT);
        res.status(200).json(repoInfo);
      } catch (error) {
        const err = error as Error;
        if (err.message === "Not a git repository") {
          res.status(404).json({ error: err.message });
        } else {
          console.error("Failed to get repository info:", error);
          res.status(500).json({ error: "Failed to get repository info" });
        }
      }
    });
  });

  describe("GET /api/repo-info", () => {
    it("should return repository information for a valid git repository", async () => {
      const response = await request(app)
        .get("/api/repo-info")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body).toHaveProperty("name");
      expect(response.body).toHaveProperty("branch");
      expect(response.body).toHaveProperty("path");
      expect(typeof response.body.name).toBe("string");
      expect(typeof response.body.branch).toBe("string");
      expect(typeof response.body.path).toBe("string");
      expect(response.body.name.length).toBeGreaterThan(0);
      expect(response.body.branch.length).toBeGreaterThan(0);
    });

    it("should extract repository name from git remote URL", async () => {
      const response = await request(app).get("/api/repo-info").expect(200);

      // For this test repository, it should extract 'sudocode-3' from the remote URL
      // or use the directory name if no remote is configured
      expect(response.body.name).toBeTruthy();
      expect(typeof response.body.name).toBe("string");
    });

    it("should return current branch name", async () => {
      const response = await request(app).get("/api/repo-info").expect(200);

      // Branch should be a non-empty string
      expect(response.body.branch).toBeTruthy();
      expect(typeof response.body.branch).toBe("string");
      expect(response.body.branch).not.toBe("(detached)"); // Assuming tests run on a checked out branch
    });

    it("should return the repository path", async () => {
      const response = await request(app).get("/api/repo-info").expect(200);

      expect(response.body.path).toBeTruthy();
      expect(typeof response.body.path).toBe("string");
      expect(path.isAbsolute(response.body.path)).toBe(true);
    });
  });

  describe("Repository name extraction", () => {
    it("should handle HTTPS URLs with .git extension", () => {
      const url = "https://github.com/user/my-repo.git";
      const match = url.match(/\/([^\/]+?)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("my-repo");
    });

    it("should handle HTTPS URLs without .git extension", () => {
      const url = "https://github.com/user/my-repo";
      const match = url.match(/\/([^\/]+?)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("my-repo");
    });

    it("should handle SSH URLs with .git extension", () => {
      const url = "git@github.com:user/my-repo.git";
      const match = url.match(/\/([^\/]+?)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("my-repo");
    });

    it("should handle SSH URLs without .git extension", () => {
      const url = "git@github.com:user/my-repo";
      const match = url.match(/\/([^\/]+?)(\.git)?$/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("my-repo");
    });
  });
});
