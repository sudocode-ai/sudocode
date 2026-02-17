/**
 * Tests for Repository Info API endpoint
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import * as path from "path";
import {
  getRepositoryInfo,
  getRepositoryBranches,
} from "../../src/services/repo-info.js";
import { createRepoInfoRouter } from "../../src/routes/repo-info.js";

// Mock modules at the top level
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("../../src/execution/worktree/git-sync-cli.js", () => ({
  GitSyncCli: vi.fn(),
}));

vi.mock("../../src/execution/worktree/conflict-detector.js", () => ({
  ConflictDetector: vi.fn(),
}));

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

    // Add the repository branches endpoint using the service
    app.get("/api/repo-info/branches", async (_req, res): Promise<void> => {
      try {
        const branchInfo = await getRepositoryBranches(REPO_ROOT);
        res.status(200).json(branchInfo);
      } catch (error) {
        const err = error as Error;
        if (err.message === "Not a git repository") {
          res.status(404).json({ error: err.message });
        } else {
          console.error("Failed to get repository branches:", error);
          res.status(500).json({ error: "Failed to get repository branches" });
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

  describe("GET /api/repo-info/branches", () => {
    it("should return branch information for a valid git repository", async () => {
      const response = await request(app)
        .get("/api/repo-info/branches")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body).toHaveProperty("current");
      expect(response.body).toHaveProperty("branches");
      expect(typeof response.body.current).toBe("string");
      expect(Array.isArray(response.body.branches)).toBe(true);
      expect(response.body.current.length).toBeGreaterThan(0);
      expect(response.body.branches.length).toBeGreaterThan(0);
    });

    // CI runs in detached HEAD state, so current branch isn't in branches list
    it.skipIf(!!process.env.CI)("should include current branch in the branches list", async () => {
      const response = await request(app)
        .get("/api/repo-info/branches")
        .expect(200);

      expect(response.body.branches).toContain(response.body.current);
    });

    it("should return all local branches as strings", async () => {
      const response = await request(app)
        .get("/api/repo-info/branches")
        .expect(200);

      expect(response.body.branches.length).toBeGreaterThan(0);
      response.body.branches.forEach((branch: any) => {
        expect(typeof branch).toBe("string");
        expect(branch.length).toBeGreaterThan(0);
      });
    });

    it("should return current branch matching repo-info endpoint", async () => {
      const [infoResponse, branchesResponse] = await Promise.all([
        request(app).get("/api/repo-info").expect(200),
        request(app).get("/api/repo-info/branches").expect(200),
      ]);

      expect(branchesResponse.body.current).toBe(infoResponse.body.branch);
    });
  });

  describe("getRepositoryBranches service", () => {
    it("should return BranchInfo with current and branches", async () => {
      const REPO_ROOT = path.join(process.cwd());
      const branchInfo = await getRepositoryBranches(REPO_ROOT);

      expect(branchInfo).toHaveProperty("current");
      expect(branchInfo).toHaveProperty("branches");
      expect(typeof branchInfo.current).toBe("string");
      expect(Array.isArray(branchInfo.branches)).toBe(true);
      expect(branchInfo.current.length).toBeGreaterThan(0);
      expect(branchInfo.branches.length).toBeGreaterThan(0);
    });

    // CI runs in detached HEAD state, so current branch isn't in branches array
    it.skipIf(!!process.env.CI)("should include current branch in branches array", async () => {
      const REPO_ROOT = path.join(process.cwd());
      const branchInfo = await getRepositoryBranches(REPO_ROOT);

      expect(branchInfo.branches).toContain(branchInfo.current);
    });

    it("should throw error for non-git directory", async () => {
      const nonGitPath = "/tmp/not-a-git-repo";

      await expect(getRepositoryBranches(nonGitPath)).rejects.toThrow(
        "Not a git repository"
      );
    });

    it("should match getRepositoryInfo current branch", async () => {
      const REPO_ROOT = path.join(process.cwd());
      const [repoInfo, branchInfo] = await Promise.all([
        getRepositoryInfo(REPO_ROOT),
        getRepositoryBranches(REPO_ROOT),
      ]);

      expect(branchInfo.current).toBe(repoInfo.branch);
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

describe("Worktree Endpoints", () => {
  let app: express.Application;
  let mockDb: any;
  let mockProject: any;
  let fs: any;
  let GitSyncCli: any;
  let ConflictDetector: any;

  beforeEach(async () => {
    // Import the mocked modules
    fs = await import("fs");
    const gitSyncModule = await import("../../src/execution/worktree/git-sync-cli.js");
    const conflictDetectorModule = await import("../../src/execution/worktree/conflict-detector.js");
    GitSyncCli = gitSyncModule.GitSyncCli;
    ConflictDetector = conflictDetectorModule.ConflictDetector;

    // Set up Express app with worktree endpoints
    app = express();
    app.use(express.json());

    // Mock database
    mockDb = {
      prepare: vi.fn(),
    };

    // Mock project
    mockProject = {
      db: mockDb,
      path: path.join(process.cwd()),
    };

    // Add middleware to inject mock project
    app.use((req: any, _res, next) => {
      req.project = mockProject;
      next();
    });

    // Mount the router
    app.use("/api/repo-info", createRepoInfoRouter());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/repo-info/worktrees", () => {
    it("should return empty array when worktrees directory does not exist", async () => {
      // Mock fs.existsSync to return false
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const response = await request(app)
        .get("/api/repo-info/worktrees")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body).toEqual({
        success: true,
        data: [],
      });
    });

    it("should return worktrees with execution info when worktrees exist", async () => {
      const worktreePath = path.join(
        process.cwd(),
        ".sudocode",
        "worktrees",
        "test-branch"
      );

      // Mock fs operations
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "test-branch", isDirectory: () => true },
      ] as any);

      // Mock database query
      const mockExecution = {
        id: "exec-123",
        worktree_path: worktreePath,
        branch_name: "test-branch",
        status: "active",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockExecution),
      });

      const response = await request(app)
        .get("/api/repo-info/worktrees")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual(mockExecution);
    });

    it("should return orphaned worktree info when no execution found", async () => {
      const worktreePath = path.join(
        process.cwd(),
        ".sudocode",
        "worktrees",
        "orphan-branch"
      );

      // Mock fs operations
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "orphan-branch", isDirectory: () => true },
      ] as any);

      // Mock database query to return null
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      const response = await request(app)
        .get("/api/repo-info/worktrees")
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: null,
        worktree_path: worktreePath,
        branch_name: "orphan-branch",
        status: "orphaned",
        created_at: null,
        updated_at: null,
      });
    });

    it("should handle errors gracefully", async () => {
      // Mock fs.existsSync to throw an error
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error("File system error");
      });

      const response = await request(app)
        .get("/api/repo-info/worktrees")
        .expect(500)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Failed to list worktrees");
      expect(response.body.error_data).toBe("File system error");
    });
  });

  describe("POST /api/repo-info/worktrees/preview", () => {
    it("should return 400 when required parameters are missing", async () => {
      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({})
        .expect(400)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Missing required parameters");
    });

    it("should return 404 when worktree does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({
          worktreePath: "/nonexistent/path",
          branchName: "test-branch",
          targetBranch: "main",
        })
        .expect(404)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Worktree not found");
    });

    it("should return preview with commits and diff when worktree exists", async () => {
      // Mock fs
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock GitSyncCli and ConflictDetector
      const mockGitSyncCli = {
        getMergeBase: vi.fn().mockReturnValue("abc123"),
        getCommitList: vi.fn().mockReturnValue([
          {
            hash: "def456",
            message: "Test commit",
            author: "Test Author",
            date: "2024-01-01",
          },
        ]),
        getDiff: vi.fn().mockReturnValue({
          filesChanged: 2,
          insertions: 10,
          deletions: 5,
        }),
        getUncommittedFiles: vi.fn().mockReturnValue([]),
        getUncommittedStats: vi.fn().mockReturnValue({
          files: [],
          additions: 0,
          deletions: 0,
        }),
      };

      const mockConflictDetector = {
        detectConflicts: vi.fn().mockReturnValue({
          codeConflicts: [],
          jsonlConflicts: [],
        }),
      };

      vi.mocked(GitSyncCli).mockImplementation(() => mockGitSyncCli as any);
      vi.mocked(ConflictDetector).mockImplementation(() => mockConflictDetector as any);

      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({
          worktreePath: "/test/worktree",
          branchName: "feature-branch",
          targetBranch: "main",
        })
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("canSync");
      expect(response.body.data).toHaveProperty("conflicts");
      expect(response.body.data).toHaveProperty("diff");
      expect(response.body.data).toHaveProperty("commits");
      expect(response.body.data).toHaveProperty("mergeBase");
      expect(response.body.data).toHaveProperty("uncommittedChanges");
      expect(response.body.data).toHaveProperty("warnings");
    });

    it("should set canSync to false when code conflicts exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockGitSyncCli = {
        getMergeBase: vi.fn().mockReturnValue("abc123"),
        getCommitList: vi.fn().mockReturnValue([]),
        getDiff: vi.fn().mockReturnValue({
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        }),
        getUncommittedFiles: vi.fn().mockReturnValue([]),
        getUncommittedStats: vi.fn().mockReturnValue({
          files: [],
          additions: 0,
          deletions: 0,
        }),
      };

      const mockConflictDetector = {
        detectConflicts: vi.fn().mockReturnValue({
          codeConflicts: [
            {
              file: "test.ts",
              type: "content",
            },
          ],
          jsonlConflicts: [],
        }),
      };

      vi.mocked(GitSyncCli).mockImplementation(() => mockGitSyncCli as any);
      vi.mocked(ConflictDetector).mockImplementation(() => mockConflictDetector as any);

      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({
          worktreePath: "/test/worktree",
          branchName: "feature-branch",
          targetBranch: "main",
        })
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.canSync).toBe(false);
      expect(response.body.data.warnings).toContain(
        "1 code conflict(s) detected. Manual resolution required."
      );
    });

    it("should include warning for uncommitted JSONL files", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockGitSyncCli = {
        getMergeBase: vi.fn().mockReturnValue("abc123"),
        getCommitList: vi.fn().mockReturnValue([]),
        getDiff: vi.fn().mockReturnValue({
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        }),
        getUncommittedFiles: vi
          .fn()
          .mockReturnValue([".sudocode/execution-1234.jsonl"]),
        getUncommittedStats: vi.fn().mockReturnValue({
          files: [".sudocode/execution-1234.jsonl"],
          additions: 10,
          deletions: 0,
        }),
      };

      const mockConflictDetector = {
        detectConflicts: vi.fn().mockReturnValue({
          codeConflicts: [],
          jsonlConflicts: [],
        }),
      };

      vi.mocked(GitSyncCli).mockImplementation(() => mockGitSyncCli as any);
      vi.mocked(ConflictDetector).mockImplementation(() => mockConflictDetector as any);

      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({
          worktreePath: "/test/worktree",
          branchName: "feature-branch",
          targetBranch: "main",
        })
        .expect(200)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.warnings).toContain(
        "1 uncommitted JSONL file(s) will be included in sync."
      );
    });

    it("should handle git operation errors gracefully", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock GitSyncCli to throw an error
      vi.mocked(GitSyncCli).mockImplementation(() => {
        throw new Error("Git operation failed");
      });

      const response = await request(app)
        .post("/api/repo-info/worktrees/preview")
        .send({
          worktreePath: "/test/worktree",
          branchName: "feature-branch",
          targetBranch: "main",
        })
        .expect(500)
        .expect("Content-Type", /json/);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Failed to preview worktree sync");
    });
  });
});
