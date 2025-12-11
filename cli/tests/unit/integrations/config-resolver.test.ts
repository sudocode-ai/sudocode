import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveIntegrationPaths,
  getEnabledProviders,
} from "../../../src/integrations/config-resolver.js";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("resolveIntegrationPaths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sudocode-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("beads", () => {
    it("should resolve relative beads path", () => {
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);

      const result = resolveIntegrationPaths(
        {
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            path: ".beads",
          },
        },
        tempDir
      );

      expect(result.beads?.resolvedPath).toBe(beadsDir);
    });

    it("should throw for non-existent path", () => {
      expect(() =>
        resolveIntegrationPaths(
          {
            beads: {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "bidirectional",
              conflict_resolution: "newest-wins",
              path: "nonexistent",
            },
          },
          tempDir
        )
      ).toThrow("Beads path not found");
    });

    it("should skip disabled integrations", () => {
      const result = resolveIntegrationPaths(
        {
          beads: {
            enabled: false,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            path: "nonexistent", // Would fail if enabled
          },
        },
        tempDir
      );

      expect(result.beads).toBeUndefined();
    });
  });

  describe("spec-kit", () => {
    it("should resolve relative spec-kit path", () => {
      const specKitDir = join(tempDir, "specs");
      mkdirSync(specKitDir);

      const result = resolveIntegrationPaths(
        {
          "spec-kit": {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            path: "specs",
            import_specs: true,
            import_plans: true,
            import_tasks: true,
          },
        },
        tempDir
      );

      expect(result["spec-kit"]?.resolvedPath).toBe(specKitDir);
    });

    it("should throw for non-existent spec-kit path", () => {
      expect(() =>
        resolveIntegrationPaths(
          {
            "spec-kit": {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "inbound",
              conflict_resolution: "newest-wins",
              path: "nonexistent-specs",
              import_specs: true,
              import_plans: true,
              import_tasks: true,
            },
          },
          tempDir
        )
      ).toThrow("Spec-kit path not found");
    });
  });

  describe("openspec", () => {
    it("should resolve relative openspec path", () => {
      const openspecDir = join(tempDir, "openspec");
      mkdirSync(openspecDir);

      const result = resolveIntegrationPaths(
        {
          openspec: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            path: "openspec",
            import_specs: true,
            import_changes: true,
          },
        },
        tempDir
      );

      expect(result.openspec?.resolvedPath).toBe(openspecDir);
    });

    it("should throw for non-existent openspec path", () => {
      expect(() =>
        resolveIntegrationPaths(
          {
            openspec: {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "inbound",
              conflict_resolution: "newest-wins",
              path: "nonexistent-openspec",
              import_specs: true,
              import_changes: true,
            },
          },
          tempDir
        )
      ).toThrow("OpenSpec path not found");
    });
  });

  describe("jira", () => {
    it("should mark jira config as resolved", () => {
      const result = resolveIntegrationPaths(
        {
          jira: {
            enabled: true,
            auto_sync: true,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://example.atlassian.net",
            auth_type: "basic",
          },
        },
        tempDir
      );

      expect(result.jira).toBeDefined();
      expect(result.jira?.resolved).toBe(true);
      expect(result.jira?.instance_url).toBe("https://example.atlassian.net");
    });

    it("should skip disabled jira", () => {
      const result = resolveIntegrationPaths(
        {
          jira: {
            enabled: false,
            auto_sync: true,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://example.atlassian.net",
            auth_type: "basic",
          },
        },
        tempDir
      );

      expect(result.jira).toBeUndefined();
    });
  });

  describe("multiple integrations", () => {
    it("should resolve multiple integrations", () => {
      const beadsDir = join(tempDir, ".beads");
      const specsDir = join(tempDir, "specs");
      mkdirSync(beadsDir);
      mkdirSync(specsDir);

      const result = resolveIntegrationPaths(
        {
          jira: {
            enabled: true,
            auto_sync: true,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://example.atlassian.net",
            auth_type: "basic",
          },
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            path: ".beads",
          },
          "spec-kit": {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            path: "specs",
            import_specs: true,
            import_plans: true,
            import_tasks: true,
          },
        },
        tempDir
      );

      expect(result.jira?.resolved).toBe(true);
      expect(result.beads?.resolvedPath).toBe(beadsDir);
      expect(result["spec-kit"]?.resolvedPath).toBe(specsDir);
    });
  });

  describe("empty config", () => {
    it("should handle empty integrations config", () => {
      const result = resolveIntegrationPaths({}, tempDir);

      expect(result.jira).toBeUndefined();
      expect(result.beads).toBeUndefined();
      expect(result["spec-kit"]).toBeUndefined();
      expect(result.openspec).toBeUndefined();
    });
  });
});

describe("getEnabledProviders", () => {
  it("should return empty array for no enabled integrations", () => {
    const result = getEnabledProviders({});
    expect(result).toEqual([]);
  });

  it("should return enabled providers", () => {
    const result = getEnabledProviders({
      jira: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        instance_url: "https://example.atlassian.net",
        auth_type: "basic",
      },
      beads: {
        enabled: false,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        path: ".beads",
      },
      "spec-kit": {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        path: "specs",
        import_specs: true,
        import_plans: true,
        import_tasks: true,
      },
    });

    expect(result).toEqual(["jira", "spec-kit"]);
  });

  it("should return all providers when all enabled", () => {
    const result = getEnabledProviders({
      jira: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        instance_url: "https://example.atlassian.net",
        auth_type: "basic",
      },
      beads: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        path: ".beads",
      },
      "spec-kit": {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        path: "specs",
        import_specs: true,
        import_plans: true,
        import_tasks: true,
      },
      openspec: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        path: "openspec",
        import_specs: true,
        import_changes: true,
      },
    });

    expect(result).toEqual(["jira", "beads", "spec-kit", "openspec"]);
  });
});
