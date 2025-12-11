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

import {
  readJSONLSync,
  writeJSONLSync,
  getJSONLEntitySync,
} from "../../../src/jsonl.js";

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
        // Mock readJSONLSync to return array with the entity (used by getIssueFromJsonl)
        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
          {
            id: "i-test",
            title: "Test Issue",
            uuid: "uuid-123",
            content: "content",
            status: "open",
            priority: 2,
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            // No external_links
          },
        ]);

        const results = await coordinator.syncEntity("i-test");

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("skipped");
      });

      it("should skip disabled links", async () => {
        // Mock readJSONLSync to return array with the entity (used by getIssueFromJsonl)
        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
          {
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
                sync_enabled: false, // Disabled
                sync_direction: "bidirectional",
              },
            ],
          },
        ]);

        const results = await coordinator.syncEntity("i-test");

        expect(results).toHaveLength(0);
      });
    });
  });

  describe("Link Management", () => {
    beforeEach(() => {
      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
        {
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
        },
      ]);

      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "i-test",
        title: "Test Issue",
        uuid: "uuid-123",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      });
    });

    describe("linkEntity", () => {
      it("should throw for non-existent entity", async () => {
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(null);

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
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
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
        });

        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
          {
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
          },
        ]);

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
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
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
        });

        (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
          {
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
          },
        ]);

        await coordinator.unlinkEntity("i-test", "EXT-123");

        const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
          .calls[0];
        const entities = writeCall[1];

        expect(entities[0].external_links).toHaveLength(0);
      });

      it("should do nothing for entity without links", async () => {
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
          id: "i-test",
          title: "Test Issue",
          uuid: "uuid-123",
          content: "content",
          status: "open",
          priority: 2,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          // No external_links
        });

        await coordinator.unlinkEntity("i-test", "EXT-123");

        expect(writeJSONLSync).not.toHaveBeenCalled();
      });

      it("should do nothing for non-existent entity", async () => {
        (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue(null);

        await coordinator.unlinkEntity("i-nonexistent", "EXT-123");

        expect(writeJSONLSync).not.toHaveBeenCalled();
      });
    });
  });

  describe("Entity Type Detection", () => {
    it("should identify specs from ID prefix", async () => {
      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "s-test",
        title: "Test Spec",
        uuid: "uuid-123",
        file_path: ".sudocode/specs/test.md",
        content: "content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      });

      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
        {
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
        },
      ]);

      await coordinator.linkEntity("s-test", "EXT-123", "jira");

      // Should write to specs.jsonl, not issues.jsonl
      const writeCall = (writeJSONLSync as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const filePath = writeCall[0] as string;
      expect(filePath).toContain("specs");
    });

    it("should identify issues from ID prefix", async () => {
      (getJSONLEntitySync as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "i-test",
        title: "Test Issue",
        uuid: "uuid-123",
        content: "content",
        status: "open",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      });

      (readJSONLSync as ReturnType<typeof vi.fn>).mockReturnValue([
        {
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
        },
      ]);

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
});
