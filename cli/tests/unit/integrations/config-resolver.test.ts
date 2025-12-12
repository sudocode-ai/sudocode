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

  describe("providers with path option", () => {
    it("should resolve relative path in options", () => {
      const beadsDir = join(tempDir, ".beads");
      mkdirSync(beadsDir);

      const result = resolveIntegrationPaths(
        {
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: ".beads" },
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
              options: { path: "nonexistent" },
            },
          },
          tempDir
        )
      ).toThrow(/beads path not found/i);
    });

    it("should skip disabled integrations", () => {
      const result = resolveIntegrationPaths(
        {
          beads: {
            enabled: false,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: "nonexistent" }, // Would fail if enabled
          },
        },
        tempDir
      );

      expect(result.beads).toBeUndefined();
    });

    it("should resolve spec-kit path in options", () => {
      const specKitDir = join(tempDir, "specs");
      mkdirSync(specKitDir);

      const result = resolveIntegrationPaths(
        {
          "spec-kit": {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            options: {
              path: "specs",
              import_specs: true,
              import_plans: true,
              import_tasks: true,
            },
          },
        },
        tempDir
      );

      expect(result["spec-kit"]?.resolvedPath).toBe(specKitDir);
    });

    it("should resolve openspec path in options", () => {
      const openspecDir = join(tempDir, "openspec");
      mkdirSync(openspecDir);

      const result = resolveIntegrationPaths(
        {
          openspec: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            options: {
              path: "openspec",
              import_specs: true,
              import_changes: true,
            },
          },
        },
        tempDir
      );

      expect(result.openspec?.resolvedPath).toBe(openspecDir);
    });
  });

  describe("providers without path option", () => {
    it("should not set resolvedPath when no path option", () => {
      const result = resolveIntegrationPaths(
        {
          jira: {
            enabled: true,
            auto_sync: true,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: {
              instance_url: "https://example.atlassian.net",
              auth_type: "basic",
            },
          },
        },
        tempDir
      );

      expect(result.jira).toBeDefined();
      expect(result.jira?.resolvedPath).toBeUndefined();
      expect(result.jira?.options?.instance_url).toBe("https://example.atlassian.net");
    });

    it("should skip disabled providers without path", () => {
      const result = resolveIntegrationPaths(
        {
          jira: {
            enabled: false,
            auto_sync: true,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: {
              instance_url: "https://example.atlassian.net",
              auth_type: "basic",
            },
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
            options: {
              instance_url: "https://example.atlassian.net",
              auth_type: "basic",
            },
          },
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            options: { path: ".beads" },
          },
          "spec-kit": {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            options: {
              path: "specs",
              import_specs: true,
              import_plans: true,
              import_tasks: true,
            },
          },
        },
        tempDir
      );

      expect(result.jira?.resolvedPath).toBeUndefined();
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

  describe("custom plugins", () => {
    it("should resolve path for custom plugin with path option", () => {
      const customDir = join(tempDir, "custom-data");
      mkdirSync(customDir);

      const result = resolveIntegrationPaths(
        {
          "custom-provider": {
            plugin: "@company/sudocode-integration-custom",
            enabled: true,
            auto_sync: false,
            default_sync_direction: "outbound",
            conflict_resolution: "manual",
            options: {
              path: "custom-data",
              otherOption: "value",
            },
          },
        },
        tempDir
      );

      expect(result["custom-provider"]?.resolvedPath).toBe(customDir);
      expect(result["custom-provider"]?.options?.otherOption).toBe("value");
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
        options: {
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
        },
      },
      beads: {
        enabled: false,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        options: { path: ".beads" },
      },
      "spec-kit": {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        options: {
          path: "specs",
          import_specs: true,
          import_plans: true,
          import_tasks: true,
        },
      },
    });

    expect(result).toContain("jira");
    expect(result).toContain("spec-kit");
    expect(result).not.toContain("beads");
  });

  it("should return all providers when all enabled", () => {
    const result = getEnabledProviders({
      jira: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        options: {
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
        },
      },
      beads: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        options: { path: ".beads" },
      },
      "spec-kit": {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        options: {
          path: "specs",
          import_specs: true,
          import_plans: true,
          import_tasks: true,
        },
      },
      openspec: {
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        options: {
          path: "openspec",
          import_specs: true,
          import_changes: true,
        },
      },
    });

    expect(result).toContain("jira");
    expect(result).toContain("beads");
    expect(result).toContain("spec-kit");
    expect(result).toContain("openspec");
  });

  it("should handle custom plugin providers", () => {
    const result = getEnabledProviders({
      "custom-provider": {
        plugin: "@company/sudocode-integration-custom",
        enabled: true,
        auto_sync: false,
        default_sync_direction: "outbound",
        conflict_resolution: "manual",
        options: { someOption: "value" },
      },
      "disabled-provider": {
        enabled: false,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
      },
    });

    expect(result).toContain("custom-provider");
    expect(result).not.toContain("disabled-provider");
  });
});
