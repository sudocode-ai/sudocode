import { describe, it, expect } from "vitest";
import { validateIntegrationsConfig } from "../../../src/integrations/config-validator.js";

describe("validateIntegrationsConfig", () => {
  describe("jira", () => {
    it("should require instance_url", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          auth_type: "basic",
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("jira.instance_url is required");
    });

    it("should require auth_type", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "jira.auth_type is required (basic or oauth2)"
      );
    });

    it("should validate auth_type enum", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
          auth_type: "invalid" as any,
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "jira.auth_type must be 'basic' or 'oauth2'"
      );
    });

    it("should warn about HTTP URLs", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "http://example.atlassian.net",
          auth_type: "basic",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("jira.instance_url should use HTTPS");
    });

    it("should warn about missing credentials_env for basic auth", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "jira.credentials_env recommended for basic auth"
      );
    });

    it("should not warn about credentials_env for oauth2", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
          auth_type: "oauth2",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).not.toContain(
        "jira.credentials_env recommended for basic auth"
      );
    });

    it("should accept valid config", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
          credentials_env: "JIRA_TOKEN",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("beads", () => {
    it("should require path", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("beads.path is required");
    });

    it("should accept valid config", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          path: ".beads",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("spec-kit", () => {
    it("should require path", () => {
      const result = validateIntegrationsConfig({
        "spec-kit": {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "newest-wins",
          import_specs: true,
          import_plans: true,
          import_tasks: true,
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("spec-kit.path is required");
    });

    it("should warn when no import options enabled", () => {
      const result = validateIntegrationsConfig({
        "spec-kit": {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "newest-wins",
          path: "specs",
          import_specs: false,
          import_plans: false,
          import_tasks: false,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("spec-kit: no import options enabled");
    });

    it("should not warn when at least one import option is enabled", () => {
      const result = validateIntegrationsConfig({
        "spec-kit": {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "newest-wins",
          path: "specs",
          import_specs: true,
          import_plans: false,
          import_tasks: false,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).not.toContain(
        "spec-kit: no import options enabled"
      );
    });
  });

  describe("openspec", () => {
    it("should require path", () => {
      const result = validateIntegrationsConfig({
        openspec: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "newest-wins",
          import_specs: true,
          import_changes: true,
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("openspec.path is required");
    });

    it("should warn when no import options enabled", () => {
      const result = validateIntegrationsConfig({
        openspec: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "newest-wins",
          path: "openspec",
          import_specs: false,
          import_changes: false,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("openspec: no import options enabled");
    });
  });

  describe("base config validation", () => {
    it("should validate sync_direction enum", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "invalid" as any,
          conflict_resolution: "newest-wins",
          path: ".beads",
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "beads.default_sync_direction must be one of: inbound, outbound, bidirectional"
      );
    });

    it("should validate conflict_resolution enum", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "invalid" as any,
          path: ".beads",
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "beads.conflict_resolution must be one of: newest-wins, sudocode-wins, external-wins, manual"
      );
    });

    it("should accept all valid sync directions", () => {
      for (const direction of ["inbound", "outbound", "bidirectional"]) {
        const result = validateIntegrationsConfig({
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: direction as any,
            conflict_resolution: "newest-wins",
            path: ".beads",
          },
        });
        expect(result.valid).toBe(true);
      }
    });

    it("should accept all valid conflict resolutions", () => {
      for (const resolution of [
        "newest-wins",
        "sudocode-wins",
        "external-wins",
        "manual",
      ]) {
        const result = validateIntegrationsConfig({
          beads: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: resolution as any,
            path: ".beads",
          },
        });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("empty config", () => {
    it("should accept empty integrations config", () => {
      const result = validateIntegrationsConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("multiple integrations", () => {
    it("should validate all integrations", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          // Missing instance_url and auth_type
        } as any,
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          // Missing path
        } as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toContain("jira.instance_url is required");
      expect(result.errors).toContain(
        "jira.auth_type is required (basic or oauth2)"
      );
      expect(result.errors).toContain("beads.path is required");
    });

    it("should validate all integrations with valid configs", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
          credentials_env: "JIRA_TOKEN",
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
          conflict_resolution: "external-wins",
          path: "specs",
          import_specs: true,
          import_plans: true,
          import_tasks: true,
        },
        openspec: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "inbound",
          conflict_resolution: "external-wins",
          path: "openspec",
          import_specs: true,
          import_changes: true,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
