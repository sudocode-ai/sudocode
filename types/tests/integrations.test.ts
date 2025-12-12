/**
 * Unit Tests for Integration Types
 *
 * Tests type definitions for the integration framework.
 * These tests verify that types are properly defined and usable.
 */

import { describe, it, expect } from "vitest";
import type {
  SyncDirection,
  ConflictResolution,
  IntegrationProviderName,
  ExternalLink,
  Spec,
  Issue,
} from "../src/index.js";
import type {
  IntegrationProviderConfig,
  IntegrationsConfig,
  IntegrationPlugin,
  IntegrationProvider,
  PluginValidationResult,
  PluginTestResult,
  PluginConfigSchema,
  ExternalEntity,
  ExternalChange,
  SyncResult,
  SyncConflict,
} from "../src/integrations.js";

describe("Integration Types", () => {
  describe("ExternalLink", () => {
    it("should allow valid provider names", () => {
      const link: ExternalLink = {
        provider: "jira",
        external_id: "PROJ-123",
        sync_enabled: true,
        sync_direction: "bidirectional",
      };
      expect(link.provider).toBe("jira");
      expect(link.external_id).toBe("PROJ-123");
      expect(link.sync_enabled).toBe(true);
      expect(link.sync_direction).toBe("bidirectional");
    });

    it("should support any provider name (plugin architecture)", () => {
      const providers: IntegrationProviderName[] = [
        "jira",
        "beads",
        "spec-kit",
        "openspec",
        "custom-provider", // Third-party plugins can use any name
        "my-company-integration",
      ];

      providers.forEach((provider) => {
        const link: ExternalLink = {
          provider,
          external_id: `${provider}-123`,
          sync_enabled: true,
          sync_direction: "bidirectional",
        };
        expect(link.provider).toBe(provider);
      });
    });

    it("should support all sync directions", () => {
      const directions: SyncDirection[] = [
        "inbound",
        "outbound",
        "bidirectional",
      ];

      directions.forEach((direction) => {
        const link: ExternalLink = {
          provider: "jira",
          external_id: "PROJ-123",
          sync_enabled: true,
          sync_direction: direction,
        };
        expect(link.sync_direction).toBe(direction);
      });
    });

    it("should support optional fields", () => {
      const link: ExternalLink = {
        provider: "beads",
        external_id: "bd-abc",
        sync_enabled: false,
        sync_direction: "inbound",
        external_url: "https://example.com",
        last_synced_at: "2025-01-01T00:00:00Z",
        external_updated_at: "2025-01-01T00:00:00Z",
        metadata: { custom: "data", nested: { value: 123 } },
      };

      expect(link.external_url).toBe("https://example.com");
      expect(link.last_synced_at).toBe("2025-01-01T00:00:00Z");
      expect(link.external_updated_at).toBe("2025-01-01T00:00:00Z");
      expect(link.metadata?.custom).toBe("data");
      expect((link.metadata?.nested as { value: number })?.value).toBe(123);
    });
  });

  describe("Spec with ExternalLinks", () => {
    it("should allow spec with external_links field", () => {
      const spec: Spec = {
        id: "s-test",
        title: "Test Spec",
        uuid: "uuid-123",
        file_path: ".sudocode/specs/test.md",
        content: "# Test",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "jira",
            external_id: "PROJ-123",
            sync_enabled: true,
            sync_direction: "bidirectional",
          },
        ],
      };

      expect(spec.external_links).toHaveLength(1);
      expect(spec.external_links?.[0].provider).toBe("jira");
    });

    it("should allow spec without external_links field", () => {
      const spec: Spec = {
        id: "s-test",
        title: "Test Spec",
        uuid: "uuid-123",
        file_path: ".sudocode/specs/test.md",
        content: "# Test",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      expect(spec.external_links).toBeUndefined();
    });
  });

  describe("Issue with ExternalLinks", () => {
    it("should allow issue with external_links field", () => {
      const issue: Issue = {
        id: "i-test",
        title: "Test Issue",
        status: "open",
        uuid: "uuid-456",
        content: "Test content",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "jira",
            external_id: "PROJ-456",
            external_url: "https://jira.example.com/browse/PROJ-456",
            sync_enabled: true,
            sync_direction: "outbound",
          },
        ],
      };

      expect(issue.external_links).toHaveLength(1);
      expect(issue.external_links?.[0].external_url).toContain("PROJ-456");
    });
  });

  describe("IntegrationProviderConfig", () => {
    it("should support all conflict resolution strategies", () => {
      const strategies: ConflictResolution[] = [
        "newest-wins",
        "sudocode-wins",
        "external-wins",
        "manual",
      ];

      strategies.forEach((strategy) => {
        const config: IntegrationProviderConfig = {
          enabled: true,
          auto_sync: true,
          default_sync_direction: "bidirectional",
          conflict_resolution: strategy,
        };
        expect(config.conflict_resolution).toBe(strategy);
      });
    });

    it("should support plugin field for custom plugins", () => {
      const config: IntegrationProviderConfig = {
        plugin: "@company/my-integration",
        enabled: true,
        auto_sync: false,
        default_sync_direction: "inbound",
        conflict_resolution: "newest-wins",
        options: {
          apiKey: "secret",
          endpoint: "https://api.example.com",
        },
      };

      expect(config.plugin).toBe("@company/my-integration");
      expect(config.options?.apiKey).toBe("secret");
    });

    it("should support provider-specific options", () => {
      // Beads-like config
      const beadsConfig: IntegrationProviderConfig = {
        enabled: true,
        auto_sync: true,
        default_sync_direction: "inbound",
        conflict_resolution: "sudocode-wins",
        options: {
          path: ".beads",
          issue_prefix: "bd",
        },
      };

      expect(beadsConfig.options?.path).toBe(".beads");
      expect(beadsConfig.options?.issue_prefix).toBe("bd");

      // Jira-like config
      const jiraConfig: IntegrationProviderConfig = {
        enabled: true,
        auto_sync: true,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        options: {
          instance_url: "https://example.atlassian.net",
          auth_type: "basic",
          credentials_env: "JIRA_TOKEN",
          jql_filter: 'project = "PROJ"',
        },
      };

      expect(jiraConfig.options?.instance_url).toBe("https://example.atlassian.net");
      expect(jiraConfig.options?.auth_type).toBe("basic");
    });
  });

  describe("IntegrationsConfig", () => {
    it("should support multiple provider configurations", () => {
      const config: IntegrationsConfig = {
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
          auto_sync: true,
          default_sync_direction: "inbound",
          conflict_resolution: "sudocode-wins",
          options: {
            path: ".beads",
          },
        },
      };

      expect(config.jira?.enabled).toBe(true);
      expect(config.beads?.enabled).toBe(true);
      expect(config["spec-kit"]).toBeUndefined();
      expect(config.openspec).toBeUndefined();
    });

    it("should allow empty config", () => {
      const config: IntegrationsConfig = {};
      expect(config.jira).toBeUndefined();
    });

    it("should allow custom provider names for plugins", () => {
      const config: IntegrationsConfig = {
        "my-custom-provider": {
          plugin: "@company/sudocode-integration-custom",
          enabled: true,
          auto_sync: false,
          default_sync_direction: "outbound",
          conflict_resolution: "manual",
          options: {
            customOption: "value",
          },
        },
      };

      expect(config["my-custom-provider"]?.plugin).toBe("@company/sudocode-integration-custom");
    });
  });

  describe("Plugin Types", () => {
    it("should define PluginValidationResult", () => {
      const result: PluginValidationResult = {
        valid: true,
        errors: [],
        warnings: ["Consider enabling auto_sync for better experience"],
      };

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    it("should define PluginTestResult", () => {
      const result: PluginTestResult = {
        success: true,
        configured: true,
        enabled: true,
        details: {
          version: "1.0.0",
          apiStatus: "healthy",
        },
      };

      expect(result.success).toBe(true);
      expect(result.details?.version).toBe("1.0.0");
    });

    it("should define PluginTestResult with error", () => {
      const result: PluginTestResult = {
        success: false,
        configured: true,
        enabled: true,
        error: "Connection failed: timeout",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });

    it("should define PluginConfigSchema", () => {
      const schema: PluginConfigSchema = {
        type: "object",
        properties: {
          path: {
            type: "string",
            title: "Beads Path",
            description: "Path to the .beads directory",
            required: true,
          },
          issue_prefix: {
            type: "string",
            title: "Issue Prefix",
            default: "bd",
          },
        },
        required: ["path"],
      };

      expect(schema.type).toBe("object");
      expect(schema.properties.path.required).toBe(true);
      expect(schema.required).toContain("path");
    });
  });

  describe("ExternalEntity", () => {
    it("should support spec type entities", () => {
      const entity: ExternalEntity = {
        id: "PROJ-123",
        type: "spec",
        title: "API Design Specification",
        description: "Detailed API specification",
        status: "approved",
        priority: 1,
        url: "https://jira.example.com/browse/PROJ-123",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
        raw: { customField: "value" },
      };

      expect(entity.type).toBe("spec");
      expect(entity.priority).toBe(1);
    });

    it("should support issue type entities", () => {
      const entity: ExternalEntity = {
        id: "PROJ-456",
        type: "issue",
        title: "Implement login flow",
      };

      expect(entity.type).toBe("issue");
      expect(entity.description).toBeUndefined();
    });
  });

  describe("ExternalChange", () => {
    it("should represent created entities", () => {
      const change: ExternalChange = {
        entity_id: "PROJ-123",
        entity_type: "spec",
        change_type: "created",
        timestamp: "2025-01-01T00:00:00Z",
        data: {
          id: "PROJ-123",
          type: "spec",
          title: "New Spec",
        },
      };

      expect(change.change_type).toBe("created");
      expect(change.data).toBeDefined();
    });

    it("should represent deleted entities without data", () => {
      const change: ExternalChange = {
        entity_id: "PROJ-123",
        entity_type: "issue",
        change_type: "deleted",
        timestamp: "2025-01-01T00:00:00Z",
      };

      expect(change.change_type).toBe("deleted");
      expect(change.data).toBeUndefined();
    });
  });

  describe("SyncResult", () => {
    it("should represent successful sync", () => {
      const result: SyncResult = {
        success: true,
        entity_id: "s-test",
        external_id: "PROJ-123",
        action: "created",
      };

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
      expect(result.error).toBeUndefined();
    });

    it("should represent failed sync with error", () => {
      const result: SyncResult = {
        success: false,
        entity_id: "s-test",
        external_id: "PROJ-123",
        action: "conflict",
        error: "Both entities modified since last sync",
      };

      expect(result.success).toBe(false);
      expect(result.action).toBe("conflict");
      expect(result.error).toBeDefined();
    });

    it("should support all action types", () => {
      const actions: SyncResult["action"][] = [
        "created",
        "updated",
        "skipped",
        "conflict",
      ];

      actions.forEach((action) => {
        const result: SyncResult = {
          success: action !== "conflict",
          entity_id: "s-test",
          external_id: "PROJ-123",
          action,
        };
        expect(result.action).toBe(action);
      });
    });
  });

  describe("SyncConflict", () => {
    it("should represent a sync conflict", () => {
      const conflict: SyncConflict = {
        sudocode_entity_id: "s-test",
        external_id: "PROJ-123",
        provider: "jira",
        sudocode_updated_at: "2025-01-02T00:00:00Z",
        external_updated_at: "2025-01-02T01:00:00Z",
      };

      expect(conflict.provider).toBe("jira");
      expect(conflict.sudocode_entity_id).toBe("s-test");
      expect(conflict.external_id).toBe("PROJ-123");
    });
  });
});
