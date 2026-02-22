import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ProjectManager } from "../../../src/services/project-manager.js";
import { ProjectRegistry } from "../../../src/services/project-registry.js";

describe("ProjectManager", () => {
  let tempDir: string;
  let configPath: string;
  let registry: ProjectRegistry;
  let manager: ProjectManager;
  let testProjectPath: string;

  beforeEach(async () => {
    // Create temp directory for test config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-pm-test-"));
    configPath = path.join(tempDir, "projects.json");
    registry = new ProjectRegistry(configPath);
    await registry.load();

    // Create manager with file watching disabled for tests
    manager = new ProjectManager(registry, { watchEnabled: false });

    // Create a test project directory with .sudocode and cache.db
    testProjectPath = path.join(tempDir, "test-project");
    const sudocodeDir = path.join(testProjectPath, ".sudocode");
    fs.mkdirSync(testProjectPath, { recursive: true });
    fs.mkdirSync(sudocodeDir, { recursive: true });

    // Create a minimal cache.db file
    const dbPath = path.join(sudocodeDir, "cache.db");
    fs.writeFileSync(dbPath, "");
  });

  afterEach(async () => {
    // Shutdown manager and clean up
    await manager.shutdown();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    it("should create ProjectManager with registry", () => {
      expect(manager).toBeDefined();
      expect(manager.getAllOpenProjects()).toEqual([]);
    });

    it("should support disabling file watching", () => {
      const managerNoWatch = new ProjectManager(registry, {
        watchEnabled: false,
      });
      expect(managerNoWatch).toBeDefined();
    });
  });

  describe("openProject", () => {
    it("should reject non-existent path", async () => {
      const result = await manager.openProject("/non/existent/path");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("PATH_NOT_FOUND");
      }
    });

    it("should reject path that is not a directory", async () => {
      const filePath = path.join(tempDir, "not-a-dir.txt");
      fs.writeFileSync(filePath, "test");

      const result = await manager.openProject(filePath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("INVALID_PROJECT");
      }
    });

    it("should reject project without .sudocode directory", async () => {
      const projectPath = path.join(tempDir, "no-sudocode");
      fs.mkdirSync(projectPath, { recursive: true });

      const result = await manager.openProject(projectPath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("INVALID_PROJECT");
        expect(result.error.message).toContain(".sudocode");
      }
    });

    it("should reject project without cache.db", async () => {
      const projectPath = path.join(tempDir, "no-cache-db");
      const sudocodeDir = path.join(projectPath, ".sudocode");
      fs.mkdirSync(sudocodeDir, { recursive: true });

      const result = await manager.openProject(projectPath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("INVALID_PROJECT");
        expect(result.error.message).toContain("cache.db");
      }
    });

    it("should successfully open valid project", async () => {
      const result = await manager.openProject(testProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(result.value.path).toBe(testProjectPath);
        expect(result.value.db).toBeDefined();
        expect(result.value.executionService).toBeDefined();
      }
    });

    it("should add opened project to registry", async () => {
      const result = await manager.openProject(testProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const projectInfo = registry.getProject(result.value.id);
        expect(projectInfo).not.toBeNull();
        expect(projectInfo?.path).toBe(testProjectPath);
      }
    });

    it("should track opened project", async () => {
      const result = await manager.openProject(testProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(manager.isProjectOpen(result.value.id)).toBe(true);
        expect(manager.getAllOpenProjects()).toHaveLength(1);
      }
    });

    it("should return existing project if already open", async () => {
      const result1 = await manager.openProject(testProjectPath);
      expect(result1.ok).toBe(true);

      const result2 = await manager.openProject(testProjectPath);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.id).toBe(result2.value.id);
        expect(manager.getAllOpenProjects()).toHaveLength(1);
      }
    });

    it("should update lastOpened timestamp when reopening", async () => {
      const result1 = await manager.openProject(testProjectPath);
      expect(result1.ok).toBe(true);

      if (result1.ok) {
        const projectInfo1 = registry.getProject(result1.value.id);
        const timestamp1 = projectInfo1?.lastOpenedAt;

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 10));

        const result2 = await manager.openProject(testProjectPath);
        expect(result2.ok).toBe(true);

        if (result2.ok) {
          const projectInfo2 = registry.getProject(result2.value.id);
          expect(projectInfo2?.lastOpenedAt).not.toBe(timestamp1);
        }
      }
    });
  });

  describe("closeProject", () => {
    it("should close an open project", async () => {
      const openResult = await manager.openProject(testProjectPath);
      expect(openResult.ok).toBe(true);

      if (openResult.ok) {
        const projectId = openResult.value.id;

        await manager.closeProject(projectId);

        expect(manager.isProjectOpen(projectId)).toBe(false);
        expect(manager.getAllOpenProjects()).toHaveLength(0);
      }
    });

    it("should keep database in cache by default", async () => {
      const openResult = await manager.openProject(testProjectPath);
      expect(openResult.ok).toBe(true);

      if (openResult.ok) {
        const projectId = openResult.value.id;

        await manager.closeProject(projectId, true);

        const summary = manager.getSummary();
        expect(summary.cachedDatabases).toContain(projectId);
      }
    });

    it("should not cache database if keepDbInCache is false", async () => {
      const openResult = await manager.openProject(testProjectPath);
      expect(openResult.ok).toBe(true);

      if (openResult.ok) {
        const projectId = openResult.value.id;

        await manager.closeProject(projectId, false);

        const summary = manager.getSummary();
        expect(summary.cachedDatabases).not.toContain(projectId);
      }
    });

    it("should handle closing non-existent project gracefully", async () => {
      await expect(
        manager.closeProject("non-existent-id")
      ).resolves.toBeUndefined();
    });
  });

  describe("getProject", () => {
    it("should return null for non-existent project", () => {
      const project = manager.getProject("non-existent-id");
      expect(project).toBeNull();
    });

    it("should return project context for open project", async () => {
      const openResult = await manager.openProject(testProjectPath);
      expect(openResult.ok).toBe(true);

      if (openResult.ok) {
        const projectId = openResult.value.id;
        const project = manager.getProject(projectId);

        expect(project).not.toBeNull();
        expect(project?.id).toBe(projectId);
        expect(project?.path).toBe(testProjectPath);
      }
    });
  });

  describe("getAllOpenProjects", () => {
    it("should return empty array when no projects open", () => {
      const projects = manager.getAllOpenProjects();
      expect(projects).toEqual([]);
    });

    it("should return all open projects", async () => {
      // Create a second test project
      const testProject2Path = path.join(tempDir, "test-project-2");
      const sudocodeDir2 = path.join(testProject2Path, ".sudocode");
      fs.mkdirSync(sudocodeDir2, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir2, "cache.db"), "");

      const result1 = await manager.openProject(testProjectPath);
      const result2 = await manager.openProject(testProject2Path);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      const openProjects = manager.getAllOpenProjects();
      expect(openProjects).toHaveLength(2);
    });
  });

  describe("isProjectOpen", () => {
    it("should return false for non-open project", () => {
      expect(manager.isProjectOpen("non-existent-id")).toBe(false);
    });

    it("should return true for open project", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(manager.isProjectOpen(result.value.id)).toBe(true);
      }
    });

    it("should return false after closing project", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const projectId = result.value.id;
        await manager.closeProject(projectId);

        expect(manager.isProjectOpen(projectId)).toBe(false);
      }
    });
  });

  describe("database caching", () => {
    it("should reuse cached database on reopen", async () => {
      const result1 = await manager.openProject(testProjectPath);
      expect(result1.ok).toBe(true);

      if (result1.ok) {
        const projectId = result1.value.id;

        // Close with cache
        await manager.closeProject(projectId, true);

        const summary1 = manager.getSummary();
        expect(summary1.cachedDatabases).toContain(projectId);

        // Reopen
        const result2 = await manager.openProject(testProjectPath);
        expect(result2.ok).toBe(true);

        // Cache should be cleared after reopen
        const summary2 = manager.getSummary();
        expect(summary2.cachedDatabases).not.toContain(projectId);
      }
    });
  });

  describe("getSummary", () => {
    it("should return summary of manager state", () => {
      const summary = manager.getSummary();

      expect(summary).toEqual({
        openProjects: [],
        cachedDatabases: [],
        totalOpen: 0,
        totalCached: 0,
      });
    });

    it("should include open projects in summary", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      const summary = manager.getSummary();

      expect(summary.totalOpen).toBe(1);
      expect(summary.openProjects).toHaveLength(1);
      if (result.ok) {
        expect(summary.openProjects[0].id).toBe(result.value.id);
      }
    });

    it("should include cached databases in summary", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const projectId = result.value.id;
        await manager.closeProject(projectId, true);

        const summary = manager.getSummary();

        expect(summary.totalCached).toBe(1);
        expect(summary.cachedDatabases).toContain(projectId);
      }
    });
  });

  describe("shutdown", () => {
    it("should close all open projects on shutdown", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      await manager.shutdown();

      expect(manager.getAllOpenProjects()).toHaveLength(0);
    });

    it("should clear database cache on shutdown", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        await manager.closeProject(result.value.id, true);
      }

      await manager.shutdown();

      const summary = manager.getSummary();
      expect(summary.totalCached).toBe(0);
    });

    it("should not cache databases when shutting down", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      await manager.shutdown();

      const summary = manager.getSummary();
      expect(summary.totalCached).toBe(0);
    });
  });

  describe("initializeProject", () => {
    it("should reject non-existent path", async () => {
      const result = await manager.initializeProject("/non/existent/path");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("PATH_NOT_FOUND");
      }
    });

    it("should reject path that is not a directory", async () => {
      const filePath = path.join(tempDir, "not-a-dir.txt");
      fs.writeFileSync(filePath, "test");

      const result = await manager.initializeProject(filePath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("INVALID_PROJECT");
      }
    });

    it("should successfully initialize new project", async () => {
      const newProjectPath = path.join(tempDir, "init-project");
      fs.mkdirSync(newProjectPath, { recursive: true });

      const result = await manager.initializeProject(newProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(result.value.path).toBe(newProjectPath);
        expect(result.value.db).toBeDefined();

        // Verify .sudocode structure was created
        const sudocodeDir = path.join(newProjectPath, ".sudocode");
        expect(fs.existsSync(sudocodeDir)).toBe(true);
        expect(fs.existsSync(path.join(sudocodeDir, "cache.db"))).toBe(true);
        expect(fs.existsSync(path.join(sudocodeDir, "config.json"))).toBe(true);
        expect(fs.existsSync(path.join(sudocodeDir, "specs"))).toBe(true);
        expect(fs.existsSync(path.join(sudocodeDir, "issues"))).toBe(true);
        expect(fs.existsSync(path.join(sudocodeDir, ".gitignore"))).toBe(true);
      }
    });

    it("should set project name when provided", async () => {
      const newProjectPath = path.join(tempDir, "named-init-project");
      fs.mkdirSync(newProjectPath, { recursive: true });

      const result = await manager.initializeProject(
        newProjectPath,
        "My Project"
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const projectInfo = registry.getProject(result.value.id);
        expect(projectInfo?.name).toBe("My Project");
      }
    });

    it("should open already initialized project without reinitializing", async () => {
      // testProjectPath is already initialized in beforeEach
      const result = await manager.initializeProject(testProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.path).toBe(testProjectPath);
        expect(manager.isProjectOpen(result.value.id)).toBe(true);
      }
    });

    it("should add initialized project to registry", async () => {
      const newProjectPath = path.join(tempDir, "registered-init-project");
      fs.mkdirSync(newProjectPath, { recursive: true });

      const result = await manager.initializeProject(newProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const projectInfo = registry.getProject(result.value.id);
        expect(projectInfo).not.toBeNull();
        expect(projectInfo?.path).toBe(newProjectPath);
      }
    });

    it("should track initialized project as open", async () => {
      const newProjectPath = path.join(tempDir, "tracked-init-project");
      fs.mkdirSync(newProjectPath, { recursive: true });

      const result = await manager.initializeProject(newProjectPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(manager.isProjectOpen(result.value.id)).toBe(true);
        expect(manager.getAllOpenProjects()).toHaveLength(1);
      }
    });

    it("should create proper config.json and config.local.json", async () => {
      const newProjectPath = path.join(tempDir, "config-init-project");
      fs.mkdirSync(newProjectPath, { recursive: true });

      const result = await manager.initializeProject(newProjectPath);

      expect(result.ok).toBe(true);

      // Project config (git-tracked) — should NOT contain worktree or version
      const configPath = path.join(newProjectPath, ".sudocode", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config).not.toHaveProperty("version");
      expect(config).not.toHaveProperty("worktree");

      // Local config (gitignored) — should contain worktree and editor settings
      const localConfigPath = path.join(newProjectPath, ".sudocode", "config.local.json");
      expect(fs.existsSync(localConfigPath)).toBe(true);

      const localConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
      expect(localConfig).toHaveProperty("worktree");
      expect(localConfig.worktree).toHaveProperty("worktreeStoragePath");
      expect(localConfig.worktree).toHaveProperty("branchPrefix", "sudocode");
    });
  });

  describe("file watcher integration", () => {
    it("should initialize watcher when watchEnabled is true", async () => {
      const managerWithWatch = new ProjectManager(registry, {
        watchEnabled: true,
      });

      const result = await managerWithWatch.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const project = managerWithWatch.getProject(result.value.id);
        expect(project).not.toBeNull();
        expect(project?.watcher).toBeDefined();
      }

      await managerWithWatch.shutdown();
    });

    it("should not initialize watcher when watchEnabled is false", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const project = manager.getProject(result.value.id);
        expect(project).not.toBeNull();
        expect(project?.watcher).toBeNull();
      }
    });

    it("should stop watcher on project close", async () => {
      const managerWithWatch = new ProjectManager(registry, {
        watchEnabled: true,
      });

      const result = await managerWithWatch.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const projectId = result.value.id;
        const project = managerWithWatch.getProject(projectId);

        // Watcher should be defined
        expect(project?.watcher).toBeDefined();

        // Close project
        await managerWithWatch.closeProject(projectId);

        // Project should no longer be open
        expect(managerWithWatch.isProjectOpen(projectId)).toBe(false);
      }

      await managerWithWatch.shutdown();
    });
  });

  describe("updateServerUrl", () => {
    it("should update server URL for all open projects", async () => {
      // Create a second test project
      const testProject2Path = path.join(tempDir, "test-project-2");
      const sudocodeDir2 = path.join(testProject2Path, ".sudocode");
      fs.mkdirSync(sudocodeDir2, { recursive: true });
      fs.writeFileSync(path.join(sudocodeDir2, "cache.db"), "");

      // Open both projects
      const result1 = await manager.openProject(testProjectPath);
      const result2 = await manager.openProject(testProject2Path);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      // Verify both projects are open
      expect(manager.getAllOpenProjects()).toHaveLength(2);

      // Update server URL - should not throw
      expect(() =>
        manager.updateServerUrl("http://localhost:3005")
      ).not.toThrow();
    });

    it("should handle empty projects list gracefully", () => {
      // No projects open
      expect(manager.getAllOpenProjects()).toHaveLength(0);

      // Should not throw
      expect(() =>
        manager.updateServerUrl("http://localhost:3005")
      ).not.toThrow();
    });

    it("should propagate URL to project contexts", async () => {
      const result = await manager.openProject(testProjectPath);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const project = manager.getProject(result.value.id);
        expect(project).not.toBeNull();

        // Mock the orchestratorWorkflowEngine with setServerUrl
        const mockSetServerUrl = vi.fn();
        project!.orchestratorWorkflowEngine = {
          setServerUrl: mockSetServerUrl,
        } as any;

        // Update server URL
        manager.updateServerUrl("http://localhost:3005");

        // Verify setServerUrl was called on the engine
        expect(mockSetServerUrl).toHaveBeenCalledWith("http://localhost:3005");
      }
    });
  });
});
