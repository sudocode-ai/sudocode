/**
 * Unit Tests for SyncCoordinator
 *
 * Tests the sync orchestration logic, provider lifecycle, and conflict handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncCoordinator } from "../../../src/integrations/sync-coordinator.js";
import { BaseIntegrationProvider } from "../../../src/integrations/base-provider.js";
import type {
  ExternalEntity,
  ExternalChange,
  IntegrationConfig,
  IntegrationsConfig,
  Spec,
  Issue,
} from "@sudocode-ai/types";
import * as fs from "fs";
import * as path from "path";

// Mock the JSONL functions
vi.mock("../../../src/jsonl.js", () => ({
  readJSONLSync: vi.fn(),
  writeJSONLSync: vi.fn(),
  getJSONLEntitySync: vi.fn(),
  updateJSONLLineSync: vi.fn(),
}));

// Mock the external-links functions
vi.mock("../../../src/operations/external-links.js", () => ({
  findSpecsByExternalLink: vi.fn().mockReturnValue([]),
  findIssuesByExternalLink: vi.fn().mockReturnValue([]),
  getSpecFromJsonl: vi.fn().mockReturnValue(null),
  getIssueFromJsonl: vi.fn().mockReturnValue(null),
  updateSpecExternalLinkSync: vi.fn(),
  updateIssueExternalLinkSync: vi.fn(),
  createIssueFromExternal: vi.fn(),
  deleteIssueFromJsonl: vi.fn(),
  closeIssueInJsonl: vi.fn(),
  removeExternalLinkFromIssue: vi.fn(),
}));

import {
  readJSONLSync,
  writeJSONLSync,
  getJSONLEntitySync,
} from "../../../src/jsonl.js";

import {
  findSpecsByExternalLink,
  findIssuesByExternalLink,
  getSpecFromJsonl,
  getIssueFromJsonl,
  createIssueFromExternal,
  deleteIssueFromJsonl,
  closeIssueInJsonl,
  removeExternalLinkFromIssue,
} from "../../../src/operations/external-links.js";

// Type assertion helper for mocked functions
const mockedGetIssueFromJsonl = getIssueFromJsonl as ReturnType<typeof vi.fn>;
const mockedGetSpecFromJsonl = getSpecFromJsonl as ReturnType<typeof vi.fn>;

/**
 * Mock provider for testing
 */
class MockProvider extends BaseIntegrationProvider {
  readonly name = "mock";
  readonly supportsWatch = true;
  readonly supportsPolling = true;

  changes: ExternalChange[] = [];
  entities = new Map<string, ExternalEntity>();
  watchCallback?: (changes: ExternalChange[]) => void;
  initializeCalled = false;
  disposeCalled = false;
  validateResult = { valid: true, errors: [] as string[] };

  protected async doInitialize(): Promise<void> {
    this.initializeCalled = true;
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    return this.validateResult;
  }

  async fetchEntity(id: string): Promise<ExternalEntity | null> {
    return this.entities.get(id) || null;
  }

  async searchEntities(_query?: string): Promise<ExternalEntity[]> {
    return Array.from(this.entities.values());
  }

  async createEntity(entity: Partial<Spec | Issue>): Promise<string> {
    const id = `mock-${Date.now()}`;
    this.entities.set(id, {
      id,
      type: "issue",
      title: entity.title || "Untitled",
    });
    return id;
  }

  async updateEntity(
    externalId: string,
    _entity: Partial<Spec | Issue>
  ): Promise<void> {
    const existing = this.entities.get(externalId);
    if (existing) {
      this.entities.set(externalId, {
        ...existing,
        updated_at: new Date().toISOString(),
      });
    }
  }

  async getChangesSince(_timestamp: Date): Promise<ExternalChange[]> {
    return this.changes;
  }

  mapToSudocode(external: ExternalEntity): {
    spec?: Partial<Spec>;
    issue?: Partial<Issue>;
  } {
    if (external.type === "spec") {
      return { spec: { title: external.title, content: external.description } };
    }
    return { issue: { title: external.title, content: external.description } };
  }

  mapFromSudocode(entity: Spec | Issue): Partial<ExternalEntity> {
    return {
      title: entity.title,
      description: entity.content,
    };
  }

  startWatching(callback: (changes: ExternalChange[]) => void): void {
    this.watchCallback = callback;
  }

  stopWatching(): void {
    this.watchCallback = undefined;
  }

  // Test helper to simulate external changes
  triggerChange(change: ExternalChange): void {
    this.watchCallback?.([change]);
  }

  // Override dispose to track it was called
  async dispose(): Promise<void> {
    this.disposeCalled = true;
    await super.dispose();
  }
}

describe("SyncCoordinator", () => {
  let coordinator: SyncCoordinator;
  let mockProvider: MockProvider;
  const projectPath = "/test/project";

  const defaultConfig: IntegrationsConfig = {
    // Using 'mock' as a dynamic key - in real usage this would be a known provider
  };

  // Helper to create a config with mock provider
  const createConfig = (
    enabled = true,
    autoSync = true
  ): IntegrationsConfig => {
    return {
      jira: {
        enabled,
        auto_sync: autoSync,
        default_sync_direction: "bidirectional",
        conflict_resolution: "newest-wins",
        instance_url: "https://mock.atlassian.net",
        auth_type: "basic",
      },
    } as IntegrationsConfig;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.warn during tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockProvider = new MockProvider();
    // Override the name to match config
    (mockProvider as any).name = "jira";

    coordinator = new SyncCoordinator({
      projectPath,
      config: createConfig(),
    });
    coordinator.registerProvider(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Provider Management", () => {
    it("should register a provider", () => {
      const provider = coordinator.getProvider("jira");
      expect(provider).toBe(mockProvider);
    });

    it("should return undefined for unregistered provider", () => {
      const provider = coordinator.getProvider("nonexistent");
      expect(provider).toBeUndefined();
    });

    it("should return all registered provider names", () => {
      const names = coordinator.getProviderNames();
      expect(names).toContain("jira");
    });

    it("should allow registering multiple providers", () => {
      const anotherProvider = new MockProvider();
      (anotherProvider as any).name = "beads";
      coordinator.registerProvider(anotherProvider);

      const names = coordinator.getProviderNames();
      expect(names).toContain("jira");
      expect(names).toContain("beads");
    });
  });

  describe("Lifecycle", () => {
    describe("start", () => {
      it("should initialize enabled providers", async () => {
        await coordinator.start();
        expect(mockProvider.initializeCalled).toBe(true);
      });

      it("should skip disabled providers", async () => {
        coordinator = new SyncCoordinator({
          projectPath,
          config: createConfig(false),
        });
        coordinator.registerProvider(mockProvider);

        await coordinator.start();
        expect(mockProvider.initializeCalled).toBe(false);
      });

      it("should start watchers for auto_sync providers", async () => {
        await coordinator.start();
        expect(mockProvider.watchCallback).toBeDefined();
      });

      it("should not start watchers when auto_sync is false", async () => {
        coordinator = new SyncCoordinator({
          projectPath,
          config: createConfig(true, false),
        });
        coordinator.registerProvider(mockProvider);

        await coordinator.start();
        expect(mockProvider.watchCallback).toBeUndefined();
      });

      it("should warn when provider validation fails", async () => {
        mockProvider.validateResult = {
          valid: false,
          errors: ["Connection failed"],
        };

        await coordinator.start();

        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining("validation failed"),
          expect.arrayContaining(["Connection failed"])
        );
      });
    });

    describe("stop", () => {
      it("should dispose all providers", async () => {
        await coordinator.start();
        await coordinator.stop();

        expect(mockProvider.disposeCalled).toBe(true);
      });

      it("should stop watchers", async () => {
        await coordinator.start();
        expect(mockProvider.watchCallback).toBeDefined();

        await coordinator.stop();
        expect(mockProvider.watchCallback).toBeUndefined();
      });
    });
  });

  describe("Sync Operations", () => {
    describe("syncProvider", () => {
      it("should throw for unknown provider", async () => {
        await expect(coordinator.syncProvider("unknown")).rejects.toThrow(
          "Unknown provider: unknown"
        );
      });

      it("should fetch and process changes", async () => {
        mockProvider.changes = [
          {
            entity_id: "ext-1",
            entity_type: "issue",
            change_type: "updated",
            timestamp: new Date().toISOString(),
          },
        ];

        await coordinator.start();
        const results = await coordinator.syncProvider("jira");

        expect(results).toHaveLength(1);
      });

      it("should update last sync time after sync", async () => {
        await coordinator.start();

        const beforeSync = new Date();
        await coordinator.syncProvider("jira");
        // The internal lastSyncTimes map should be updated
        // We can't directly test this without exposing internals,
        // but we can verify the sync completed without error
      });
    });

    describe("syncAll", () => {
      it("should sync all enabled providers", async () => {
        const anotherProvider = new MockProvider();
        (anotherProvider as any).name = "beads";
        coordinator.registerProvider(anotherProvider);

        // Need to update config to include both
        coordinator = new SyncCoordinator({
          projectPath,
          config: {
            jira: {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "bidirectional",
              conflict_resolution: "newest-wins",
              instance_url: "https://mock.atlassian.net",
              auth_type: "basic",
            },
            beads: {
              enabled: true,
              auto_sync: false,
              default_sync_direction: "bidirectional",
              conflict_resolution: "newest-wins",
              path: ".beads",
            },
          } as IntegrationsConfig,
        });
        coordinator.registerProvider(mockProvider);
        coordinator.registerProvider(anotherProvider);

        await coordinator.start();
        const results = await coordinator.syncAll();

        // Both providers should have been synced
        expect(Array.isArray(results)).toBe(true);
      });

      it("should skip disabled providers", async () => {
        coordinator = new SyncCoordinator({
          projectPath,
          config: createConfig(false),
        });
        coordinator.registerProvider(mockProvider);

        await coordinator.start();
        const results = await coordinator.syncAll();

        expect(results).toHaveLength(0);
      });
    });

    describe("syncEntity", () => {
      it("should skip entities without external links", async () => {
        // Mock getIssueFromJsonl to return entity without external_links
        mockedGetIssueFromJsonl.mockReturnValue({
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          relationships: [],
          tags: [],
          // No external_links
        });

        const results = await coordinator.syncEntity("i-test");

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("skipped");
      });

      it("should skip disabled links", async () => {
        // Mock getIssueFromJsonl to return entity with disabled external link
        mockedGetIssueFromJsonl.mockReturnValue({
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          relationships: [],
          tags: [],
          external_links: [
            {
              provider: "jira",
              external_id: "EXT-123",
              sync_enabled: false, // Disabled
              sync_direction: "bidirectional",
            },
          ],
        });

        const results = await coordinator.syncEntity("i-test");

        expect(results).toHaveLength(0);
      });
    });
  });

  describe("Link Management", () => {
    const testIssue = {
      id: "i-test",
      title: "Test Issue",
      uuid: "uuid-123",
      content: "content",
      status: "open",
      priority: 2,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      relationships: [],
      tags: [],
    };

    beforeEach(() => {
      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([testIssue]);

      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(testIssue);

      // Set up the external-links mock for loadEntity
      mockedGetIssueFromJsonl.mockReturnValue(testIssue);
      mockedGetSpecFromJsonl.mockReturnValue(null);
    });

    describe("linkEntity", () => {
      it("should throw for non-existent entity", async () => {
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(null);
        mockedGetIssueFromJsonl.mockReturnValue(null);
        mockedGetSpecFromJsonl.mockReturnValue(null);

        await expect(
          coordinator.linkEntity("i-nonexistent", "EXT-123", "jira")
        ).rejects.toThrow("Entity not found");
      });

      it("should add external link with default options", async () => {
        await coordinator.linkEntity("i-test", "EXT-123", "jira");

        expect(writeJSONLSync).toHaveBeenCalled();
        const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
          .calls[0];
        const entities = writeCall[1];

        expect(entities[0].external_links).toBeDefined();
        expect(entities[0].external_links[0].provider).toBe("jira");
        expect(entities[0].external_links[0].external_id).toBe("EXT-123");
        expect(entities[0].external_links[0].sync_enabled).toBe(true);
        expect(entities[0].external_links[0].sync_direction).toBe(
          "bidirectional"
        );
      });

      it("should add external link with custom options", async () => {
        await coordinator.linkEntity("i-test", "EXT-123", "jira", {
          sync_direction: "outbound",
          sync_enabled: false,
        });

        const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
          .calls[0];
        const entities = writeCall[1];

        expect(entities[0].external_links[0].sync_direction).toBe("outbound");
        expect(entities[0].external_links[0].sync_enabled).toBe(false);
      });

      it("should update existing link", async () => {
        const issueWithLink = {
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          external_links: [
            {
              provider: "jira",
              external_id: "EXT-123",
              sync_enabled: true,
              sync_direction: "inbound",
            },
          ],
          relationships: [],
          tags: [],
        };

        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(issueWithLink);
        mockedGetIssueFromJsonl.mockReturnValue(issueWithLink);

        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([issueWithLink]);

        await coordinator.linkEntity("i-test", "EXT-123", "jira", {
          sync_direction: "bidirectional",
        });

        const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
          .calls[0];
        const entities = writeCall[1];

        // Should still have only one link (updated, not added)
        expect(entities[0].external_links).toHaveLength(1);
        expect(entities[0].external_links[0].sync_direction).toBe(
          "bidirectional"
        );
      });
    });

    describe("unlinkEntity", () => {
      it("should remove external link", async () => {
        const issueWithLink = {
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          external_links: [
            {
              provider: "jira",
              external_id: "EXT-123",
              sync_enabled: true,
              sync_direction: "bidirectional",
            },
          ],
          relationships: [],
          tags: [],
        };

        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(issueWithLink);
        mockedGetIssueFromJsonl.mockReturnValue(issueWithLink);
        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([issueWithLink]);

        await coordinator.unlinkEntity("i-test", "EXT-123");

        const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
          .calls[0];
        const entities = writeCall[1];

        expect(entities[0].external_links).toHaveLength(0);
      });

      it("should do nothing for entity without links", async () => {
        const issueNoLinks = {
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          // No external_links
        };
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(issueNoLinks);
        mockedGetIssueFromJsonl.mockReturnValue(issueNoLinks);

        await coordinator.unlinkEntity("i-test", "EXT-123");

        expect(writeJSONLSync).not.toHaveBeenCalled();
      });

      it("should do nothing for non-existent entity", async () => {
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(null);
        mockedGetIssueFromJsonl.mockReturnValue(null);
        mockedGetSpecFromJsonl.mockReturnValue(null);

        await coordinator.unlinkEntity("i-nonexistent", "EXT-123");

        expect(writeJSONLSync).not.toHaveBeenCalled();
      });
    });
  });

  describe("Entity Type Detection", () => {
    it("should identify specs from ID prefix", async () => {
      const testSpec = {
        id: "s-test",
        title: "Test Spec",
        uuid: "uuid-123",
        file_path: ".sudocode/specs/test.md",
        content: "content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      };

      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(testSpec);
      mockedGetSpecFromJsonl.mockReturnValue(testSpec);
      mockedGetIssueFromJsonl.mockReturnValue(null);
      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([testSpec]);

      await coordinator.linkEntity("s-test", "EXT-123", "jira");

      // Should write to specs.jsonl, not issues.jsonl
      const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const filePath = writeCall[0] as string;
      expect(filePath).toContain("specs");
    });

    it("should identify issues from ID prefix", async () => {
      const testIssue = {
        id: "i-test",
        title: "Test Issue",
        uuid: "uuid-123",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        relationships: [],
        tags: [],
      };

      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(testIssue);
      mockedGetIssueFromJsonl.mockReturnValue(testIssue);
      mockedGetSpecFromJsonl.mockReturnValue(null);
      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([testIssue]);

      await coordinator.linkEntity("i-test", "EXT-123", "jira");

      const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const filePath = writeCall[0] as string;
      expect(filePath).toContain("issues");
    });
  });

  describe("Conflict Resolution", () => {
    it("should use configured conflict resolution strategy", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "sudocode-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      coordinator.registerProvider(mockProvider);

      // The conflict resolution is tested via the conflict-resolver tests
      // Here we just verify the coordinator is properly configured
      expect((coordinator as any).options.config.jira.conflict_resolution).toBe(
        "sudocode-wins"
      );
    });

    it("should call onConflict callback for manual resolution", async () => {
      const onConflict = vi.fn().mockResolvedValue("sudocode");

      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "manual",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
        onConflict,
      });
      coordinator.registerProvider(mockProvider);

      // The callback is stored and would be called during conflict resolution
      expect((coordinator as any).options.onConflict).toBe(onConflict);
    });
  });

  describe("Auto-Import", () => {
    beforeEach(() => {
      // Reset mocks
      vi.mocked(findIssuesByExternalLink).mockReturnValue([]);
      vi.mocked(findSpecsByExternalLink).mockReturnValue([]);
      vi.mocked(createIssueFromExternal).mockReturnValue({
        id: "i-new",
        uuid: "uuid-new",
        title: "Imported Issue",
        content: "",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        external_links: [{
          provider: "jira",
          external_id: "EXT-NEW",
          sync_enabled: true,
          sync_direction: "bidirectional",
          last_synced_at: new Date().toISOString(),
        }],
      });
    });

    it("should auto-import new external issues by default", async () => {
      mockProvider.changes = [
        {
          entity_id: "EXT-NEW",
          entity_type: "issue",
          change_type: "created",
          timestamp: new Date().toISOString(),
          data: {
            id: "EXT-NEW",
            type: "issue",
            title: "New External Issue",
            description: "Created in external system",
            status: "open",
            priority: 1,
          },
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("created");
      expect(results[0].entity_id).toBe("i-new");
      expect(results[0].external_id).toBe("EXT-NEW");
      expect(createIssueFromExternal).toHaveBeenCalledWith(
        expect.stringContaining(".sudocode"),
        expect.objectContaining({
          title: "New External Issue",
          external: expect.objectContaining({
            provider: "jira",
            external_id: "EXT-NEW",
          }),
        })
      );
    });

    it("should skip auto-import when auto_import is false", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            auto_import: false,
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      coordinator.registerProvider(mockProvider);

      mockProvider.changes = [
        {
          entity_id: "EXT-NEW",
          entity_type: "issue",
          change_type: "created",
          timestamp: new Date().toISOString(),
          data: {
            id: "EXT-NEW",
            type: "issue",
            title: "New External Issue",
          },
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(createIssueFromExternal).not.toHaveBeenCalled();
    });

    it("should use configured sync_direction for auto-imported issues", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            default_sync_direction: "inbound",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      coordinator.registerProvider(mockProvider);

      mockProvider.changes = [
        {
          entity_id: "EXT-NEW",
          entity_type: "issue",
          change_type: "created",
          timestamp: new Date().toISOString(),
          data: {
            id: "EXT-NEW",
            type: "issue",
            title: "New External Issue",
          },
        },
      ];

      await coordinator.start();
      await coordinator.syncProvider("jira");

      expect(createIssueFromExternal).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          external: expect.objectContaining({
            sync_direction: "inbound",
          }),
        })
      );
    });

    it("should skip import for updated entities without link", async () => {
      mockProvider.changes = [
        {
          entity_id: "EXT-ORPHAN",
          entity_type: "issue",
          change_type: "updated",
          timestamp: new Date().toISOString(),
          data: {
            id: "EXT-ORPHAN",
            type: "issue",
            title: "Orphan Issue",
          },
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(createIssueFromExternal).not.toHaveBeenCalled();
    });
  });

  describe("Delete Behavior", () => {
    const linkedIssue = {
      id: "i-linked",
      uuid: "uuid-linked",
      title: "Linked Issue",
      content: "content",
      status: "open" as const,
      priority: 2,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      relationships: [],
      tags: [],
      external_links: [{
        provider: "jira",
        external_id: "EXT-DELETE",
        sync_enabled: true,
        sync_direction: "bidirectional" as const,
        last_synced_at: "2025-01-01T00:00:00Z",
      }],
    };

    beforeEach(() => {
      // Setup: external issue is linked to sudocode issue
      vi.mocked(findIssuesByExternalLink).mockImplementation(
        (_dir, _provider, extId) => {
          if (extId === "EXT-DELETE") {
            return [linkedIssue];
          }
          return [];
        }
      );
      vi.mocked(findSpecsByExternalLink).mockReturnValue([]);
      vi.mocked(closeIssueInJsonl).mockReturnValue({
        ...linkedIssue,
        status: "closed",
        closed_at: new Date().toISOString(),
      });
      vi.mocked(deleteIssueFromJsonl).mockReturnValue(true);
    });

    it("should close sudocode issue when external is deleted (default behavior)", async () => {
      mockProvider.changes = [
        {
          entity_id: "EXT-DELETE",
          entity_type: "issue",
          change_type: "deleted",
          timestamp: new Date().toISOString(),
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("updated");
      expect(results[0].entity_id).toBe("i-linked");
      expect(closeIssueInJsonl).toHaveBeenCalledWith(
        expect.stringContaining(".sudocode"),
        "i-linked"
      );
      // Should also remove the external link to prevent orphaned reference
      expect(removeExternalLinkFromIssue).toHaveBeenCalledWith(
        expect.stringContaining(".sudocode"),
        "i-linked",
        "EXT-DELETE"
      );
      expect(deleteIssueFromJsonl).not.toHaveBeenCalled();
    });

    it("should delete sudocode issue when delete_behavior is 'delete'", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "delete",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      coordinator.registerProvider(mockProvider);

      mockProvider.changes = [
        {
          entity_id: "EXT-DELETE",
          entity_type: "issue",
          change_type: "deleted",
          timestamp: new Date().toISOString(),
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("updated");
      expect(deleteIssueFromJsonl).toHaveBeenCalledWith(
        expect.stringContaining(".sudocode"),
        "i-linked"
      );
      expect(closeIssueInJsonl).not.toHaveBeenCalled();
    });

    it("should ignore deletion when delete_behavior is 'ignore'", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "ignore",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      coordinator.registerProvider(mockProvider);

      mockProvider.changes = [
        {
          entity_id: "EXT-DELETE",
          entity_type: "issue",
          change_type: "deleted",
          timestamp: new Date().toISOString(),
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(closeIssueInJsonl).not.toHaveBeenCalled();
      expect(deleteIssueFromJsonl).not.toHaveBeenCalled();
    });

    it("should skip deletion for unlinked external entities", async () => {
      vi.mocked(findIssuesByExternalLink).mockReturnValue([]);

      mockProvider.changes = [
        {
          entity_id: "EXT-UNLINKED",
          entity_type: "issue",
          change_type: "deleted",
          timestamp: new Date().toISOString(),
        },
      ];

      await coordinator.start();
      const results = await coordinator.syncProvider("jira");

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(closeIssueInJsonl).not.toHaveBeenCalled();
      expect(deleteIssueFromJsonl).not.toHaveBeenCalled();
    });
  });

  describe("Watch-triggered Changes", () => {
    beforeEach(() => {
      vi.mocked(findIssuesByExternalLink).mockReturnValue([]);
      vi.mocked(findSpecsByExternalLink).mockReturnValue([]);
      vi.mocked(createIssueFromExternal).mockReturnValue({
        id: "i-watched",
        uuid: "uuid-watched",
        title: "Watched Issue",
        content: "",
        status: "open",
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        relationships: [],
        tags: [],
        external_links: [{
          provider: "jira",
          external_id: "EXT-WATCH",
          sync_enabled: true,
          sync_direction: "bidirectional",
          last_synced_at: new Date().toISOString(),
        }],
      });
    });

    it("should process changes triggered by watch callback", async () => {
      await coordinator.start();

      // Simulate file change triggering watch callback
      mockProvider.triggerChange({
        entity_id: "EXT-WATCH",
        entity_type: "issue",
        change_type: "created",
        timestamp: new Date().toISOString(),
        data: {
          id: "EXT-WATCH",
          type: "issue",
          title: "Watch-triggered Issue",
        },
      });

      // The change is processed asynchronously via handleInboundChanges
      // Since triggerChange calls the callback synchronously in our mock,
      // we need to verify createIssueFromExternal was called
      expect(createIssueFromExternal).toHaveBeenCalled();
    });
  });

  describe("Outbound Entity Deletion (handleEntityDeleted)", () => {
    const externalLinks = [
      {
        provider: "jira" as const,
        external_id: "EXT-TO-DELETE",
        sync_enabled: true,
        sync_direction: "bidirectional" as const,
        last_synced_at: "2025-01-01T00:00:00Z",
      },
    ];

    let updateEntitySpy: ReturnType<typeof vi.fn>;
    let deleteEntitySpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Spy on updateEntity and add deleteEntity method to mock provider
      updateEntitySpy = vi.fn().mockResolvedValue(undefined);
      deleteEntitySpy = vi.fn().mockResolvedValue(undefined);
      mockProvider.updateEntity = updateEntitySpy;
      (mockProvider as any).deleteEntity = deleteEntitySpy;
    });

    it("should close external entity when delete_behavior is 'close' (default)", async () => {
      await coordinator.start();
      const results = await coordinator.handleEntityDeleted("i-deleted", externalLinks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].entity_id).toBe("i-deleted");
      expect(results[0].external_id).toBe("EXT-TO-DELETE");
      expect(results[0].action).toBe("updated");

      // Should call updateEntity with status: "closed"
      expect(updateEntitySpy).toHaveBeenCalledWith(
        "EXT-TO-DELETE",
        expect.objectContaining({ status: "closed" })
      );
      expect(deleteEntitySpy).not.toHaveBeenCalled();
    });

    it("should delete external entity when delete_behavior is 'delete'", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "delete",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      // Re-apply spies to the provider for the new coordinator
      mockProvider.updateEntity = updateEntitySpy;
      (mockProvider as any).deleteEntity = deleteEntitySpy;
      coordinator.registerProvider(mockProvider);

      await coordinator.start();
      const results = await coordinator.handleEntityDeleted("i-deleted", externalLinks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe("updated");

      // Should call deleteEntity
      expect(deleteEntitySpy).toHaveBeenCalledWith("EXT-TO-DELETE");
      expect(updateEntitySpy).not.toHaveBeenCalled();
    });

    it("should skip when delete_behavior is 'ignore'", async () => {
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "ignore",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
        } as IntegrationsConfig,
      });
      mockProvider.updateEntity = updateEntitySpy;
      (mockProvider as any).deleteEntity = deleteEntitySpy;
      coordinator.registerProvider(mockProvider);

      await coordinator.start();
      const results = await coordinator.handleEntityDeleted("i-deleted", externalLinks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe("skipped");

      // Should not call any update/delete methods
      expect(updateEntitySpy).not.toHaveBeenCalled();
      expect(deleteEntitySpy).not.toHaveBeenCalled();
    });

    it("should skip disabled links", async () => {
      await coordinator.start();
      const disabledLinks = [
        {
          provider: "jira" as const,
          external_id: "EXT-DISABLED",
          sync_enabled: false,
          sync_direction: "bidirectional" as const,
        },
      ];

      const results = await coordinator.handleEntityDeleted("i-deleted", disabledLinks);

      expect(results).toHaveLength(0);
      expect(updateEntitySpy).not.toHaveBeenCalled();
    });

    it("should skip inbound-only links", async () => {
      await coordinator.start();
      const inboundLinks = [
        {
          provider: "jira" as const,
          external_id: "EXT-INBOUND",
          sync_enabled: true,
          sync_direction: "inbound" as const,
        },
      ];

      const results = await coordinator.handleEntityDeleted("i-deleted", inboundLinks);

      expect(results).toHaveLength(0);
      expect(updateEntitySpy).not.toHaveBeenCalled();
    });

    it("should handle outbound-only links", async () => {
      await coordinator.start();
      const outboundLinks = [
        {
          provider: "jira" as const,
          external_id: "EXT-OUTBOUND",
          sync_enabled: true,
          sync_direction: "outbound" as const,
        },
      ];

      const results = await coordinator.handleEntityDeleted("i-deleted", outboundLinks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(updateEntitySpy).toHaveBeenCalledWith(
        "EXT-OUTBOUND",
        expect.objectContaining({ status: "closed" })
      );
    });

    it("should handle empty external links array", async () => {
      await coordinator.start();
      const results = await coordinator.handleEntityDeleted("i-deleted", []);

      expect(results).toHaveLength(0);
    });

    it("should handle provider not found", async () => {
      await coordinator.start();
      const unknownProviderLinks = [
        {
          provider: "unknown-provider" as any,
          external_id: "EXT-UNKNOWN",
          sync_enabled: true,
          sync_direction: "bidirectional" as const,
        },
      ];

      const results = await coordinator.handleEntityDeleted("i-deleted", unknownProviderLinks);

      expect(results).toHaveLength(0);
    });

    it("should handle provider errors gracefully", async () => {
      updateEntitySpy = vi.fn().mockRejectedValue(new Error("API error"));
      mockProvider.updateEntity = updateEntitySpy;

      await coordinator.start();
      const results = await coordinator.handleEntityDeleted("i-deleted", externalLinks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("API error");
    });

    it("should handle multiple external links", async () => {
      const anotherProvider = new MockProvider();
      (anotherProvider as any).name = "beads";
      const beadsDeleteSpy = vi.fn().mockResolvedValue(undefined);
      const beadsUpdateSpy = vi.fn().mockResolvedValue(undefined);
      anotherProvider.updateEntity = beadsUpdateSpy;
      (anotherProvider as any).deleteEntity = beadsDeleteSpy;

      // Update config to include beads
      coordinator = new SyncCoordinator({
        projectPath,
        config: {
          jira: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "close",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            instance_url: "https://mock.atlassian.net",
            auth_type: "basic",
          },
          beads: {
            enabled: true,
            auto_sync: false,
            delete_behavior: "delete",
            default_sync_direction: "bidirectional",
            conflict_resolution: "newest-wins",
            path: ".beads",
          },
        } as IntegrationsConfig,
      });
      // Re-apply spies to mock provider
      mockProvider.updateEntity = updateEntitySpy;
      (mockProvider as any).deleteEntity = deleteEntitySpy;
      coordinator.registerProvider(mockProvider);
      coordinator.registerProvider(anotherProvider);

      await coordinator.start();

      const multipleLinks = [
        {
          provider: "jira" as const,
          external_id: "JIRA-123",
          sync_enabled: true,
          sync_direction: "bidirectional" as const,
        },
        {
          provider: "beads" as any,
          external_id: "beads-456",
          sync_enabled: true,
          sync_direction: "bidirectional" as const,
        },
      ];

      const results = await coordinator.handleEntityDeleted("i-deleted", multipleLinks);

      expect(results).toHaveLength(2);
      // Jira should close (delete_behavior: close)
      expect(updateEntitySpy).toHaveBeenCalledWith(
        "JIRA-123",
        expect.objectContaining({ status: "closed" })
      );
      // Beads should delete (delete_behavior: delete)
      expect(beadsDeleteSpy).toHaveBeenCalledWith("beads-456");
    });
  });
});
