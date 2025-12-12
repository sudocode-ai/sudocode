import { describe, it, expect } from "vitest";
import { validateIntegrationsConfig } from "../../../src/integrations/config-validator.js";

describe("validateIntegrationsConfig", () => {
  describe("base config validation", () => {
    it("should validate sync_direction enum", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "invalid" as any,
          conflict_resolution: "newest-wins",
          options: { path: ".beads" },
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
          options: { path: ".beads" },
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
            options: { path: ".beads" },
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
            options: { path: ".beads" },
          },
        });
        expect(result.valid).toBe(true);
      }
    });

    it("should warn when enabled but no options configured", () => {
      const result = validateIntegrationsConfig({
        "custom-provider": {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "custom-provider: enabled but no options configured"
      );
    });

    it("should not warn when options are configured", () => {
      const result = validateIntegrationsConfig({
        "custom-provider": {
          enabled: true,
          auto_sync: false,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          options: { someOption: "value" },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).not.toContain(
        "custom-provider: enabled but no options configured"
      );
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
          default_sync_direction: "invalid-direction" as any,
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
          conflict_resolution: "invalid-resolution" as any,
          options: { path: ".beads" },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain(
        "jira.default_sync_direction must be one of: inbound, outbound, bidirectional"
      );
      expect(result.errors).toContain(
        "beads.conflict_resolution must be one of: newest-wins, sudocode-wins, external-wins, manual"
      );
    });

    it("should validate all integrations with valid configs", () => {
      const result = validateIntegrationsConfig({
        jira: {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: "newest-wins",
          options: {
            instance_url: "https://example.atlassian.net",
            auth_type: "basic",
            credentials_env: "JIRA_TOKEN",
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
          conflict_resolution: "external-wins",
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
          conflict_resolution: "external-wins",
          options: {
            path: "openspec",
            import_specs: true,
            import_changes: true,
          },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("custom plugins", () => {
    it("should accept config with custom plugin field", () => {
      const result = validateIntegrationsConfig({
        "my-provider": {
          plugin: "@company/sudocode-integration-custom",
          enabled: true,
          auto_sync: false,
          default_sync_direction: "outbound",
          conflict_resolution: "manual",
          options: {
            apiEndpoint: "https://api.example.com",
            apiKey: "secret",
          },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate base fields even for custom plugins", () => {
      const result = validateIntegrationsConfig({
        "my-provider": {
          plugin: "@company/sudocode-integration-custom",
          enabled: true,
          auto_sync: false,
          default_sync_direction: "not-valid" as any,
          conflict_resolution: "manual",
          options: {
            apiEndpoint: "https://api.example.com",
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "my-provider.default_sync_direction must be one of: inbound, outbound, bidirectional"
      );
    });
  });

  describe("disabled integrations", () => {
    it("should still validate base fields for disabled integrations", () => {
      const result = validateIntegrationsConfig({
        beads: {
          enabled: false,
          auto_sync: false,
          default_sync_direction: "invalid" as any,
          conflict_resolution: "newest-wins",
          options: { path: ".beads" },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "beads.default_sync_direction must be one of: inbound, outbound, bidirectional"
      );
    });
  });
});
