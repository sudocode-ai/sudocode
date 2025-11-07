/**
 * Tests for preset marketplace and sharing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  createPresetPackage,
  packagePresetsForDistribution,
  installPackage,
  exportPackageToTarball,
  importPackageFromTarball,
  searchPackages,
  addToLocalRegistry,
  sharePackageToTeam,
  installFromTeamRepo,
  listTeamPackages,
} from "../../src/operations/marketplace.js";
import {
  initializeAgentsDirectory,
  createAgentPreset,
} from "../../src/operations/agents.js";

describe("Preset Marketplace", () => {
  let testDir: string;
  let sudocodeDir: string;
  let teamRepoDir: string;

  beforeEach(() => {
    const timestamp = Date.now();
    testDir = path.join("/tmp", `marketplace-test-${timestamp}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    teamRepoDir = path.join(testDir, "team-repo");

    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(teamRepoDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);

    // Create test presets
    createAgentPreset(sudocodeDir, {
      id: "test-preset-1",
      name: "Test Preset 1",
      description: "First test preset",
      agent_type: "claude-code",
      system_prompt: "Test 1",
    });

    createAgentPreset(sudocodeDir, {
      id: "test-preset-2",
      name: "Test Preset 2",
      description: "Second test preset",
      agent_type: "claude-code",
      system_prompt: "Test 2",
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createPresetPackage", () => {
    it("should create preset package", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "test-package",
        name: "Test Package",
        version: "1.0.0",
        description: "A test package",
        author: {
          name: "Test Author",
          email: "test@example.com",
        },
        preset_ids: ["test-preset-1", "test-preset-2"],
        tags: ["test", "example"],
      });

      expect(pkg.id).toBe("test-package");
      expect(pkg.name).toBe("Test Package");
      expect(pkg.presets.length).toBe(2);
      expect(pkg.published_at).toBeDefined();
    });

    it("should fail for nonexistent presets", () => {
      expect(() =>
        createPresetPackage(sudocodeDir, {
          id: "invalid-package",
          name: "Invalid",
          version: "1.0.0",
          description: "Invalid",
          author: { name: "Test" },
          preset_ids: ["nonexistent"],
        })
      ).toThrow();
    });
  });

  describe("packagePresetsForDistribution", () => {
    it("should package presets with files", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "dist-package",
        name: "Distribution Package",
        version: "1.0.0",
        description: "Test distribution",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      const entry = packagePresetsForDistribution(sudocodeDir, pkg);

      expect(entry.package).toBeDefined();
      expect(entry.files.length).toBeGreaterThan(0);

      const presetFile = entry.files.find((f) =>
        f.path.includes("test-preset-1")
      );
      expect(presetFile).toBeDefined();
      expect(presetFile?.content).toContain("Test 1");
    });
  });

  describe("installPackage", () => {
    it("should install package", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "install-test",
        name: "Install Test",
        version: "1.0.0",
        description: "Test install",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      const entry = packagePresetsForDistribution(sudocodeDir, pkg);

      // Install to a fresh directory
      const installDir = path.join(testDir, "install-target", ".sudocode");
      initializeAgentsDirectory(installDir);

      const result = installPackage(installDir, entry);

      expect(result.success).toBe(true);
      expect(result.installed_presets).toContain("test-preset-1");
    });

    it("should not overwrite without flag", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "overwrite-test",
        name: "Overwrite Test",
        version: "1.0.0",
        description: "Test overwrite",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      const entry = packagePresetsForDistribution(sudocodeDir, pkg);

      // Create new install directory
      const installDir = path.join(testDir, "overwrite-target", ".sudocode");
      initializeAgentsDirectory(installDir);

      // First install
      const result1 = installPackage(installDir, entry);
      expect(result1.success).toBe(true);

      // Second install without overwrite
      const result2 = installPackage(installDir, entry);
      expect(result2.success).toBe(false);
      expect(result2.errors).toBeDefined();
    });

    it("should overwrite with flag", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "overwrite-test-2",
        name: "Overwrite Test 2",
        version: "1.0.0",
        description: "Test overwrite",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      const entry = packagePresetsForDistribution(sudocodeDir, pkg);

      // Create new install directory
      const installDir = path.join(testDir, "overwrite-flag-target", ".sudocode");
      initializeAgentsDirectory(installDir);

      // First install
      installPackage(installDir, entry);

      // Second install with overwrite
      const result = installPackage(installDir, entry, { overwrite: true });
      expect(result.success).toBe(true);
    });
  });

  describe("exportPackageToTarball and importPackageFromTarball", () => {
    it("should export and import package", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "tarball-test",
        name: "Tarball Test",
        version: "1.0.0",
        description: "Test tarball",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      const entry = packagePresetsForDistribution(sudocodeDir, pkg);

      const tarballPath = path.join(testDir, "package.tar.json");
      exportPackageToTarball(entry, tarballPath);

      expect(fs.existsSync(tarballPath)).toBe(true);

      const imported = importPackageFromTarball(tarballPath);
      expect(imported.package.id).toBe("tarball-test");
      expect(imported.files.length).toBe(entry.files.length);
    });
  });

  describe("searchPackages", () => {
    beforeEach(() => {
      const pkg1 = createPresetPackage(sudocodeDir, {
        id: "search-test-1",
        name: "TypeScript Package",
        version: "1.0.0",
        description: "TypeScript presets",
        author: { name: "Author 1" },
        preset_ids: ["test-preset-1"],
        tags: ["typescript", "coding"],
        category: "development",
      });

      const pkg2 = createPresetPackage(sudocodeDir, {
        id: "search-test-2",
        name: "Python Package",
        version: "1.0.0",
        description: "Python presets",
        author: { name: "Author 2" },
        preset_ids: ["test-preset-2"],
        tags: ["python", "coding"],
        category: "development",
      });

      addToLocalRegistry(sudocodeDir, pkg1);
      addToLocalRegistry(sudocodeDir, pkg2);
    });

    it("should search by text", () => {
      const results = searchPackages(sudocodeDir, {
        text: "typescript",
      });

      expect(results.length).toBe(1);
      expect(results[0].name).toContain("TypeScript");
    });

    it("should search by tags", () => {
      const results = searchPackages(sudocodeDir, {
        tags: ["coding"],
      });

      expect(results.length).toBe(2);
    });

    it("should search by category", () => {
      const results = searchPackages(sudocodeDir, {
        category: "development",
      });

      expect(results.length).toBe(2);
    });
  });

  describe("sharePackageToTeam and installFromTeamRepo", () => {
    it("should share and install from team repo", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "team-share-test",
        name: "Team Share Test",
        version: "1.0.0",
        description: "Test team sharing",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      addToLocalRegistry(sudocodeDir, pkg);

      // Share to team repo
      const shareResult = sharePackageToTeam(
        sudocodeDir,
        "team-share-test",
        teamRepoDir
      );

      expect(shareResult.success).toBe(true);
      expect(shareResult.package_path).toBeDefined();

      // Install from team repo to new location
      const installDir = path.join(testDir, "team-install", ".sudocode");
      initializeAgentsDirectory(installDir);

      const installResult = installFromTeamRepo(
        installDir,
        teamRepoDir,
        "team-share-test"
      );

      expect(installResult.success).toBe(true);
      expect(installResult.installed_presets).toContain("test-preset-1");
    });
  });

  describe("listTeamPackages", () => {
    it("should list available team packages", () => {
      const pkg = createPresetPackage(sudocodeDir, {
        id: "team-list-test",
        name: "Team List Test",
        version: "1.0.0",
        description: "Test team listing",
        author: { name: "Test" },
        preset_ids: ["test-preset-1"],
      });

      addToLocalRegistry(sudocodeDir, pkg);
      sharePackageToTeam(sudocodeDir, "team-list-test", teamRepoDir);

      const packages = listTeamPackages(teamRepoDir);
      expect(packages.length).toBe(1);
      expect(packages[0].id).toBe("team-list-test");
    });

    it("should return empty array for empty repo", () => {
      const packages = listTeamPackages(path.join(testDir, "empty-repo"));
      expect(packages).toEqual([]);
    });
  });
});
