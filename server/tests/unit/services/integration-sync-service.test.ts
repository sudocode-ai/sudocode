import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  IntegrationSyncService,
  createIntegrationSyncService,
  type IntegrationSyncServiceOptions,
  type ProviderSyncStatus,
} from "../../../src/services/integration-sync-service.js";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock CLI integrations module
vi.mock("@sudocode-ai/cli/dist/integrations/index.js", () => ({
  SyncCoordinator: vi.fn(),
  loadPlugin: vi.fn(),
}));

// Mock websocket module
vi.mock("../../../src/services/websocket.js", () => ({
  broadcastToProject: vi.fn(),
}));

import { existsSync, readFileSync } from "fs";
import {
  SyncCoordinator,
  loadPlugin,
} from "@sudocode-ai/cli/dist/integrations/index.js";
import { broadcastToProject } from "../../../src/services/websocket.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockSyncCoordinator = vi.mocked(SyncCoordinator);
const mockLoadPlugin = vi.mocked(loadPlugin);
const mockBroadcastToProject = vi.mocked(broadcastToProject);

describe("IntegrationSyncService", () => {
  const defaultOptions: IntegrationSyncServiceOptions = {
    projectId: "test-project",
    projectPath: "/path/to/project",
    sudocodeDir: "/path/to/project/.sudocode",
    pollIntervalMs: 60000,
    autoStart: false, // Disable auto-start for most tests
  };

  let service: IntegrationSyncService;
  let mockCoordinatorInstance: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    syncAll: ReturnType<typeof vi.fn>;
    syncProvider: ReturnType<typeof vi.fn>;
    syncEntity: ReturnType<typeof vi.fn>;
    linkEntity: ReturnType<typeof vi.fn>;
    unlinkEntity: ReturnType<typeof vi.fn>;
    handleEntityDeleted: ReturnType<typeof vi.fn>;
    registerProvider: ReturnType<typeof vi.fn>;
    getProviderNames: ReturnType<typeof vi.fn>;
    getProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup default mock implementations
    mockExistsSync.mockReturnValue(false);

    // Create a mock coordinator instance
    mockCoordinatorInstance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      syncAll: vi.fn().mockResolvedValue([]),
      syncProvider: vi.fn().mockResolvedValue([]),
      syncEntity: vi.fn().mockResolvedValue([]),
      linkEntity: vi.fn().mockResolvedValue(undefined),
      unlinkEntity: vi.fn().mockResolvedValue(undefined),
      handleEntityDeleted: vi.fn().mockResolvedValue([]),
      registerProvider: vi.fn(),
      getProviderNames: vi.fn().mockReturnValue([]),
      getProvider: vi.fn(),
    };

    mockSyncCoordinator.mockImplementation(() => mockCoordinatorInstance as unknown as SyncCoordinator);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (service?.isActive()) {
      await service.stop();
    }
  });

  describe("Constructor and Factory", () => {
    it("should create service with default options", () => {
      service = new IntegrationSyncService({
        projectId: "test",
        projectPath: "/test",
        sudocodeDir: "/test/.sudocode",
      });

      expect(service).toBeInstanceOf(IntegrationSyncService);
      expect(service.isActive()).toBe(false);
    });

    it("should create service via factory function", () => {
      service = createIntegrationSyncService(defaultOptions);

      expect(service).toBeInstanceOf(IntegrationSyncService);
    });
  });

  describe("Lifecycle - start()", () => {
    it("should start without errors when no config exists", async () => {
      mockExistsSync.mockReturnValue(false);
      service = new IntegrationSyncService(defaultOptions);

      await service.start();

      expect(service.isActive()).toBe(true);
      expect(mockExistsSync).toHaveBeenCalledWith(
        "/path/to/project/.sudocode/config.json"
      );
    });

    it("should start without creating coordinator when no providers enabled", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            jira: { enabled: false },
          },
        })
      );

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(service.isActive()).toBe(true);
      expect(mockSyncCoordinator).not.toHaveBeenCalled();
    });

    it("should load enabled providers and create coordinator", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, options: { apiUrl: "http://test" } },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(service.isActive()).toBe(true);
      expect(mockSyncCoordinator).toHaveBeenCalled();
      expect(mockLoadPlugin).toHaveBeenCalledWith("beads");
      expect(mockPlugin.createProvider).toHaveBeenCalledWith(
        { apiUrl: "http://test" },
        "/path/to/project"
      );
      expect(mockCoordinatorInstance.registerProvider).toHaveBeenCalled();
      expect(mockCoordinatorInstance.start).toHaveBeenCalled();
    });

    it("should skip providers when plugin not installed", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            unknown: { enabled: true },
          },
        })
      );
      mockLoadPlugin.mockResolvedValue(null);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(service.isActive()).toBe(true);
      expect(mockCoordinatorInstance.registerProvider).not.toHaveBeenCalled();
    });

    it("should not start twice", async () => {
      mockExistsSync.mockReturnValue(false);
      service = new IntegrationSyncService(defaultOptions);

      await service.start();
      await service.start(); // Second call should be no-op

      expect(service.isActive()).toBe(true);
    });

    it("should initialize provider status correctly", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: true,
          supportsPolling: false,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      const status = service.getProviderStatus("beads");
      expect(status).toMatchObject({
        name: "beads",
        enabled: true,
        autoSync: true,
        lastSyncAt: null,
        lastSyncResult: null,
        lastError: null,
        isPolling: false,
        isWatching: true,
      });
    });
  });

  describe("Lifecycle - stop()", () => {
    it("should stop cleanly", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
      await service.stop();

      expect(service.isActive()).toBe(false);
      expect(mockCoordinatorInstance.stop).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      service = new IntegrationSyncService(defaultOptions);
      await service.start();
      await service.stop();
      await service.stop(); // Second call should be no-op

      expect(service.isActive()).toBe(false);
    });
  });

  describe("Lifecycle - reload()", () => {
    it("should stop and restart service", async () => {
      mockExistsSync.mockReturnValue(false);
      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      const stopSpy = vi.spyOn(service, "stop");
      const startSpy = vi.spyOn(service, "start");

      await service.reload();

      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe("Sync Operations - syncAll()", () => {
    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
    });

    it("should throw if not started", async () => {
      await service.stop();

      await expect(service.syncAll()).rejects.toThrow(
        "IntegrationSyncService not started"
      );
    });

    it("should sync all providers and broadcast events", async () => {
      const mockResults = [
        { entity_id: "i-123", action: "created" as const, success: true },
      ];
      mockCoordinatorInstance.syncAll.mockResolvedValue(mockResults);

      const results = await service.syncAll();

      expect(results).toEqual(mockResults);
      expect(mockCoordinatorInstance.syncAll).toHaveBeenCalled();

      // Should broadcast start and complete events
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        "test-project",
        expect.objectContaining({
          type: "integration:sync:all:started",
          providers: ["beads"],
        })
      );
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        "test-project",
        expect.objectContaining({
          type: "integration:sync:all:completed",
          results: mockResults,
        })
      );
    });

    it("should update provider status on success", async () => {
      mockCoordinatorInstance.syncAll.mockResolvedValue([]);

      await service.syncAll();

      const status = service.getProviderStatus("beads");
      expect(status?.lastSyncResult).toBe("success");
      expect(status?.lastSyncAt).toBeInstanceOf(Date);
      expect(status?.lastError).toBeNull();
    });

    it("should update provider status on error", async () => {
      mockCoordinatorInstance.syncAll.mockRejectedValue(new Error("Sync failed"));

      await expect(service.syncAll()).rejects.toThrow("Sync failed");

      const status = service.getProviderStatus("beads");
      expect(status?.lastSyncResult).toBe("error");
      expect(status?.lastError).toBe("Sync failed");
    });
  });

  describe("Sync Operations - syncProvider()", () => {
    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
    });

    it("should throw if not started", async () => {
      await service.stop();

      await expect(service.syncProvider("beads")).rejects.toThrow(
        "IntegrationSyncService not started"
      );
    });

    it("should sync specific provider and broadcast events", async () => {
      const mockResults = [
        { entity_id: "i-123", action: "updated" as const, success: true },
      ];
      mockCoordinatorInstance.syncProvider.mockResolvedValue(mockResults);

      const results = await service.syncProvider("beads");

      expect(results).toEqual(mockResults);
      expect(mockCoordinatorInstance.syncProvider).toHaveBeenCalledWith("beads");

      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        "test-project",
        expect.objectContaining({
          type: "integration:sync:started",
          provider: "beads",
        })
      );
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        "test-project",
        expect.objectContaining({
          type: "integration:sync:completed",
          provider: "beads",
          results: mockResults,
        })
      );
    });

    it("should broadcast error event on failure", async () => {
      mockCoordinatorInstance.syncProvider.mockRejectedValue(
        new Error("Provider sync failed")
      );

      await expect(service.syncProvider("beads")).rejects.toThrow(
        "Provider sync failed"
      );

      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        "test-project",
        expect.objectContaining({
          type: "integration:sync:error",
          provider: "beads",
          error: "Provider sync failed",
        })
      );
    });
  });

  describe("Sync Operations - syncEntity()", () => {
    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
    });

    it("should return empty array if not started", async () => {
      await service.stop();

      const results = await service.syncEntity("i-123");
      expect(results).toEqual([]);
    });

    it("should sync specific entity", async () => {
      const mockResults = [
        { entity_id: "i-123", action: "synced" as const, success: true },
      ];
      mockCoordinatorInstance.syncEntity.mockResolvedValue(mockResults);

      const results = await service.syncEntity("i-123");

      expect(results).toEqual(mockResults);
      expect(mockCoordinatorInstance.syncEntity).toHaveBeenCalledWith("i-123");
    });
  });

  describe("Link Management", () => {
    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "beads",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
    });

    describe("linkEntity()", () => {
      it("should throw if not started", async () => {
        await service.stop();

        await expect(
          service.linkEntity("i-123", "PROJ-123", "beads")
        ).rejects.toThrow("IntegrationSyncService not started");
      });

      it("should link entity with options", async () => {
        await service.linkEntity("i-123", "PROJ-123", "beads", {
          sync_direction: "bidirectional",
        });

        expect(mockCoordinatorInstance.linkEntity).toHaveBeenCalledWith(
          "i-123",
          "PROJ-123",
          "beads",
          { sync_direction: "bidirectional" }
        );
      });
    });

    describe("unlinkEntity()", () => {
      it("should throw if not started", async () => {
        await service.stop();

        await expect(service.unlinkEntity("i-123", "PROJ-123")).rejects.toThrow(
          "IntegrationSyncService not started"
        );
      });

      it("should unlink entity", async () => {
        await service.unlinkEntity("i-123", "PROJ-123");

        expect(mockCoordinatorInstance.unlinkEntity).toHaveBeenCalledWith(
          "i-123",
          "PROJ-123"
        );
      });
    });

    describe("handleEntityDeleted()", () => {
      it("should return empty array if not started", async () => {
        await service.stop();

        const results = await service.handleEntityDeleted("i-123", [
          {
            provider: "beads",
            external_id: "EXT-123",
            sync_enabled: true,
            sync_direction: "bidirectional" as const,
          },
        ]);
        expect(results).toEqual([]);
      });

      it("should return empty array for empty external links", async () => {
        const results = await service.handleEntityDeleted("i-123", []);
        expect(results).toEqual([]);
      });

      it("should delegate to coordinator with external links", async () => {
        const externalLinks = [
          {
            provider: "beads",
            external_id: "EXT-123",
            sync_enabled: true,
            sync_direction: "bidirectional" as const,
          },
          {
            provider: "jira",
            external_id: "PROJ-456",
            sync_enabled: true,
            sync_direction: "outbound" as const,
          },
        ];

        const mockResults = [
          {
            entity_id: "i-123",
            external_id: "EXT-123",
            action: "updated" as const,
            success: true,
          },
          {
            entity_id: "i-123",
            external_id: "PROJ-456",
            action: "updated" as const,
            success: true,
          },
        ];
        mockCoordinatorInstance.handleEntityDeleted.mockResolvedValue(mockResults);

        const results = await service.handleEntityDeleted("i-123", externalLinks);

        expect(results).toEqual(mockResults);
        expect(mockCoordinatorInstance.handleEntityDeleted).toHaveBeenCalledWith(
          "i-123",
          externalLinks
        );
      });

      it("should handle coordinator errors gracefully", async () => {
        const externalLinks = [
          {
            provider: "beads",
            external_id: "EXT-123",
            sync_enabled: true,
          },
        ];

        mockCoordinatorInstance.handleEntityDeleted.mockRejectedValue(
          new Error("Delete propagation failed")
        );

        await expect(
          service.handleEntityDeleted("i-123", externalLinks)
        ).rejects.toThrow("Delete propagation failed");
      });

      it("should work with mixed sync_enabled links", async () => {
        const externalLinks = [
          {
            provider: "beads",
            external_id: "EXT-ENABLED",
            sync_enabled: true,
            sync_direction: "bidirectional" as const,
          },
          {
            provider: "jira",
            external_id: "EXT-DISABLED",
            sync_enabled: false,
            sync_direction: "bidirectional" as const,
          },
        ];

        mockCoordinatorInstance.handleEntityDeleted.mockResolvedValue([
          {
            entity_id: "i-123",
            external_id: "EXT-ENABLED",
            action: "updated" as const,
            success: true,
          },
        ]);

        const results = await service.handleEntityDeleted("i-123", externalLinks);

        // The service passes through to coordinator - filtering is done there
        expect(mockCoordinatorInstance.handleEntityDeleted).toHaveBeenCalledWith(
          "i-123",
          externalLinks
        );
        expect(results).toHaveLength(1);
      });
    });
  });

  describe("Status and Info", () => {
    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
            jira: { enabled: true },
          },
        })
      );

      const mockPlugin = {
        name: "test",
        displayName: "Test",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "test",
          supportsWatch: false,
          supportsPolling: true,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();
    });

    it("should return all provider statuses", () => {
      const statuses = service.getStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.name)).toContain("beads");
      expect(statuses.map((s) => s.name)).toContain("jira");
    });

    it("should return specific provider status", () => {
      const status = service.getProviderStatus("beads");

      expect(status).not.toBeNull();
      expect(status?.name).toBe("beads");
    });

    it("should return null for unknown provider", () => {
      const status = service.getProviderStatus("unknown");

      expect(status).toBeNull();
    });

    it("should report active status", () => {
      expect(service.isActive()).toBe(true);
    });

    it("should return registered provider names", () => {
      mockCoordinatorInstance.getProviderNames.mockReturnValue([
        "beads",
        "jira",
      ]);

      const names = service.getRegisteredProviders();

      expect(names).toEqual(["beads", "jira"]);
    });
  });

  describe("Polling", () => {
    it("should start polling for providers with auto_sync and supportsPolling", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockProvider = {
        name: "beads",
        supportsWatch: false,
        supportsPolling: true,
      };
      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue(mockProvider),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);
      mockCoordinatorInstance.getProvider.mockReturnValue(mockProvider);

      service = new IntegrationSyncService({
        ...defaultOptions,
        autoStart: true,
        pollIntervalMs: 60000,
      });
      await service.start();

      const status = service.getProviderStatus("beads");
      expect(status?.isPolling).toBe(true);

      // Advance timer and verify sync is called
      mockCoordinatorInstance.syncProvider.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(60000);

      expect(mockCoordinatorInstance.syncProvider).toHaveBeenCalledWith("beads");
    });

    it("should not poll providers that support watching", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockProvider = {
        name: "beads",
        supportsWatch: true,
        supportsPolling: true,
      };
      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue(mockProvider),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);
      mockCoordinatorInstance.getProvider.mockReturnValue(mockProvider);

      service = new IntegrationSyncService({
        ...defaultOptions,
        autoStart: true,
      });
      await service.start();

      const status = service.getProviderStatus("beads");
      expect(status?.isPolling).toBe(false);
      expect(status?.isWatching).toBe(true);
    });

    it("should enforce minimum poll interval", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockProvider = {
        name: "beads",
        supportsWatch: false,
        supportsPolling: true,
      };
      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue(mockProvider),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);
      mockCoordinatorInstance.getProvider.mockReturnValue(mockProvider);
      mockCoordinatorInstance.syncProvider.mockResolvedValue([]);

      service = new IntegrationSyncService({
        ...defaultOptions,
        autoStart: true,
        pollIntervalMs: 1000, // Below minimum of 30 seconds
      });
      await service.start();

      // Should use minimum of 30 seconds, not 1 second
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockCoordinatorInstance.syncProvider).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(29000);
      expect(mockCoordinatorInstance.syncProvider).toHaveBeenCalledTimes(1);
    });

    it("should stop polling on service stop", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockProvider = {
        name: "beads",
        supportsWatch: false,
        supportsPolling: true,
      };
      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue(mockProvider),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);
      mockCoordinatorInstance.getProvider.mockReturnValue(mockProvider);
      mockCoordinatorInstance.syncProvider.mockResolvedValue([]);

      service = new IntegrationSyncService({
        ...defaultOptions,
        autoStart: true,
        pollIntervalMs: 60000,
      });
      await service.start();
      await service.stop();

      // Advance timer - should not trigger sync
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockCoordinatorInstance.syncProvider).not.toHaveBeenCalled();
    });
  });

  describe("Config Loading", () => {
    it("should return empty config when file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(service.getRegisteredProviders()).toEqual([]);
    });

    it("should handle invalid JSON gracefully", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not valid json");

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      // Should not throw, just log error and use empty config
      expect(service.isActive()).toBe(true);
    });

    it("should handle config without integrations key", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ other: "config" }));

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(service.isActive()).toBe(true);
    });

    it("should use custom plugin ID when specified", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            mybeads: {
              enabled: true,
              plugin: "@custom/beads-plugin",
            },
          },
        })
      );

      const mockPlugin = {
        name: "custom-beads",
        displayName: "Custom Beads",
        version: "2.0.0",
        createProvider: vi.fn().mockReturnValue({
          name: "mybeads",
          supportsWatch: false,
          supportsPolling: false,
        }),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      expect(mockLoadPlugin).toHaveBeenCalledWith("@custom/beads-plugin");
    });
  });

  describe("Error Handling", () => {
    it("should handle plugin load errors gracefully", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true },
          },
        })
      );
      mockLoadPlugin.mockRejectedValue(new Error("Plugin load failed"));

      service = new IntegrationSyncService(defaultOptions);
      await service.start();

      // Should continue running despite plugin error
      expect(service.isActive()).toBe(true);
    });

    it("should handle polling errors without stopping service", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          integrations: {
            beads: { enabled: true, auto_sync: true },
          },
        })
      );

      const mockProvider = {
        name: "beads",
        supportsWatch: false,
        supportsPolling: true,
      };
      const mockPlugin = {
        name: "beads",
        displayName: "Beads",
        version: "1.0.0",
        createProvider: vi.fn().mockReturnValue(mockProvider),
      };
      mockLoadPlugin.mockResolvedValue(mockPlugin);
      mockCoordinatorInstance.getProvider.mockReturnValue(mockProvider);
      mockCoordinatorInstance.syncProvider.mockRejectedValue(
        new Error("Sync error")
      );

      service = new IntegrationSyncService({
        ...defaultOptions,
        autoStart: true,
        pollIntervalMs: 60000,
      });
      await service.start();

      // Advance timer - should catch error and continue
      await vi.advanceTimersByTimeAsync(60000);

      expect(service.isActive()).toBe(true);
    });
  });
});
