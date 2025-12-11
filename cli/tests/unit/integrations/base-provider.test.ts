import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseIntegrationProvider } from "../../../src/integrations/base-provider.js";
import { DefaultProviderRegistry } from "../../../src/integrations/registry.js";
import type {
  ExternalEntity,
  ExternalChange,
  IntegrationConfig,
  Spec,
  Issue,
} from "@sudocode-ai/types";

/**
 * Mock implementation of BaseIntegrationProvider for testing
 */
class MockProvider extends BaseIntegrationProvider {
  readonly name = "mock";
  readonly supportsWatch = false;
  readonly supportsPolling = true;

  doInitializeSpy = vi.fn();

  protected async doInitialize(): Promise<void> {
    this.doInitializeSpy();
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  async fetchEntity(_externalId: string): Promise<ExternalEntity | null> {
    return null;
  }

  async searchEntities(_query?: string): Promise<ExternalEntity[]> {
    return [];
  }

  async createEntity(_entity: Partial<Spec | Issue>): Promise<string> {
    return "mock-123";
  }

  async updateEntity(
    _externalId: string,
    _entity: Partial<Spec | Issue>
  ): Promise<void> {}

  async getChangesSince(_timestamp: Date): Promise<ExternalChange[]> {
    return [];
  }

  mapToSudocode(
    _external: ExternalEntity
  ): { spec?: Partial<Spec>; issue?: Partial<Issue> } {
    return {};
  }

  mapFromSudocode(_entity: Spec | Issue): Partial<ExternalEntity> {
    return {};
  }

  // Expose protected properties for testing
  getConfig(): IntegrationConfig {
    return this.config;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Mock provider with watch support for testing dispose
 */
class WatchableProvider extends MockProvider {
  readonly name = "watchable";
  readonly supportsWatch = true;
  stopWatchingSpy = vi.fn();

  stopWatching(): void {
    this.stopWatchingSpy();
  }
}

describe("BaseIntegrationProvider", () => {
  let provider: MockProvider;
  const mockConfig: IntegrationConfig = {
    enabled: true,
    auto_sync: false,
    default_sync_direction: "inbound",
    conflict_resolution: "newest-wins",
  };

  beforeEach(() => {
    provider = new MockProvider();
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("should store config", async () => {
      await provider.initialize(mockConfig);
      expect(provider.getConfig()).toBe(mockConfig);
    });

    it("should call doInitialize", async () => {
      await provider.initialize(mockConfig);
      expect(provider.doInitializeSpy).toHaveBeenCalledOnce();
    });

    it("should set initialized flag after init", async () => {
      expect(provider.isInitialized()).toBe(false);
      await provider.initialize(mockConfig);
      expect(provider.isInitialized()).toBe(true);
    });

    it("should call doInitialize after storing config", async () => {
      let configDuringInit: IntegrationConfig | undefined;
      provider.doInitializeSpy.mockImplementation(() => {
        configDuringInit = provider.getConfig();
      });

      await provider.initialize(mockConfig);
      expect(configDuringInit).toBe(mockConfig);
    });
  });

  describe("dispose", () => {
    it("should reset initialized flag", async () => {
      await provider.initialize(mockConfig);
      expect(provider.isInitialized()).toBe(true);

      await provider.dispose();
      expect(provider.isInitialized()).toBe(false);
    });

    it("should call stopWatching if provider supports watch", async () => {
      const watchableProvider = new WatchableProvider();
      await watchableProvider.initialize(mockConfig);

      await watchableProvider.dispose();
      expect(watchableProvider.stopWatchingSpy).toHaveBeenCalledOnce();
    });

    it("should not call stopWatching if provider does not support watch", async () => {
      await provider.initialize(mockConfig);
      await provider.dispose();
      // No error should be thrown, and nothing to spy on since stopWatching is undefined
    });
  });

  describe("parseExternalId", () => {
    it("should parse provider:id format", () => {
      const result = provider.parseExternalId("jira:PROJ-123");
      expect(result).toEqual({ provider: "jira", id: "PROJ-123" });
    });

    it("should use provider name for bare IDs", () => {
      const result = provider.parseExternalId("PROJ-123");
      expect(result).toEqual({ provider: "mock", id: "PROJ-123" });
    });

    it("should handle IDs with multiple colons", () => {
      const result = provider.parseExternalId("provider:id:with:colons");
      expect(result).toEqual({ provider: "provider", id: "id:with:colons" });
    });

    it("should handle empty ID after colon", () => {
      const result = provider.parseExternalId("jira:");
      expect(result).toEqual({ provider: "jira", id: "" });
    });

    it("should handle ID that is just a colon", () => {
      const result = provider.parseExternalId(":");
      expect(result).toEqual({ provider: "", id: "" });
    });
  });

  describe("formatExternalId", () => {
    it("should format as provider:id", () => {
      const result = provider.formatExternalId("PROJ-123");
      expect(result).toBe("mock:PROJ-123");
    });

    it("should handle empty ID", () => {
      const result = provider.formatExternalId("");
      expect(result).toBe("mock:");
    });

    it("should handle ID with colons", () => {
      const result = provider.formatExternalId("id:with:colons");
      expect(result).toBe("mock:id:with:colons");
    });
  });

  describe("abstract method signatures", () => {
    it("should have validate method", async () => {
      const result = await provider.validate();
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it("should have fetchEntity method", async () => {
      const result = await provider.fetchEntity("test-id");
      expect(result).toBeNull();
    });

    it("should have searchEntities method", async () => {
      const result = await provider.searchEntities("query");
      expect(result).toEqual([]);
    });

    it("should have createEntity method", async () => {
      const result = await provider.createEntity({ title: "Test" });
      expect(result).toBe("mock-123");
    });

    it("should have updateEntity method", async () => {
      await expect(
        provider.updateEntity("id", { title: "Test" })
      ).resolves.toBeUndefined();
    });

    it("should have getChangesSince method", async () => {
      const result = await provider.getChangesSince(new Date());
      expect(result).toEqual([]);
    });

    it("should have mapToSudocode method", () => {
      const result = provider.mapToSudocode({
        id: "ext-1",
        type: "issue",
        title: "Test",
      });
      expect(result).toEqual({});
    });

    it("should have mapFromSudocode method", () => {
      const result = provider.mapFromSudocode({
        id: "s-1234",
        uuid: "test-uuid",
        title: "Test",
        file_path: "test.md",
        content: "content",
        priority: 2,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      } as Spec);
      expect(result).toEqual({});
    });
  });
});

describe("DefaultProviderRegistry", () => {
  let registry: DefaultProviderRegistry;
  let provider: MockProvider;

  beforeEach(() => {
    registry = new DefaultProviderRegistry();
    provider = new MockProvider();
  });

  describe("register", () => {
    it("should register a provider", () => {
      registry.register(provider);
      expect(registry.has("mock")).toBe(true);
    });

    it("should throw on duplicate registration", () => {
      registry.register(provider);
      expect(() => registry.register(provider)).toThrow(
        "Provider 'mock' already registered"
      );
    });

    it("should allow registering different providers", () => {
      const watchableProvider = new WatchableProvider();
      registry.register(provider);
      registry.register(watchableProvider);

      expect(registry.has("mock")).toBe(true);
      expect(registry.has("watchable")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return registered provider", () => {
      registry.register(provider);
      expect(registry.get("mock")).toBe(provider);
    });

    it("should return undefined for unregistered provider", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return empty array when no providers registered", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered providers", () => {
      const watchableProvider = new WatchableProvider();
      registry.register(provider);
      registry.register(watchableProvider);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(provider);
      expect(all).toContain(watchableProvider);
    });
  });

  describe("has", () => {
    it("should return true for registered provider", () => {
      registry.register(provider);
      expect(registry.has("mock")).toBe(true);
    });

    it("should return false for unregistered provider", () => {
      expect(registry.has("mock")).toBe(false);
    });
  });
});
