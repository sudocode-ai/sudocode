/**
 * Unit tests for Agent lifecycle and coordination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateAgentId, createDefaultConfig } from "../../src/agent.js";
import type { CoordinationConfig } from "../../src/types.js";

describe("Agent Utilities", () => {
  describe("generateAgentId", () => {
    it("should generate unique agent IDs", () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it("should include prefix in agent ID", () => {
      const id = generateAgentId("test");
      expect(id).toMatch(/^test-/);
    });

    it("should include hostname in agent ID", () => {
      const id = generateAgentId("agent");
      expect(id).toMatch(/^agent-.*-[a-f0-9]{12}$/);
    });
  });

  describe("createDefaultConfig", () => {
    it("should create config with default values", () => {
      const config = createDefaultConfig();

      expect(config.agentId).toBeDefined();
      expect(config.gitRemote).toBe("origin");
      expect(config.coordinationBranch).toBe("coordination");
      expect(config.peerDiscoveryInterval).toBe(60000);
      expect(config.heartbeatInterval).toBe(15000);
      expect(config.leaseTTL).toBe(300000);
      expect(config.capabilities).toEqual(["code", "review", "test"]);
      expect(config.enableFileDiffs).toBe(false);
    });

    it("should allow custom agent ID", () => {
      const config = createDefaultConfig("custom-agent-123");
      expect(config.agentId).toBe("custom-agent-123");
    });

    it("should allow overriding options", () => {
      const config = createDefaultConfig(undefined, {
        capabilities: ["custom-capability"],
        leaseTTL: 600000,
        coordinationBranch: "custom-branch",
      });

      expect(config.capabilities).toEqual(["custom-capability"]);
      expect(config.leaseTTL).toBe(600000);
      expect(config.coordinationBranch).toBe("custom-branch");
    });

    it("should merge options with defaults", () => {
      const config = createDefaultConfig(undefined, {
        leaseTTL: 600000,
      });

      // Should have custom value
      expect(config.leaseTTL).toBe(600000);

      // Should still have defaults
      expect(config.gitRemote).toBe("origin");
      expect(config.heartbeatInterval).toBe(15000);
    });
  });
});

describe("Agent Configuration Validation", () => {
  it("should accept valid configuration", () => {
    const config: CoordinationConfig = {
      agentId: "test-agent",
      gitRemote: "origin",
      coordinationBranch: "coordination",
      peerDiscoveryInterval: 60000,
      heartbeatInterval: 15000,
      leaseTTL: 300000,
      capabilities: ["code"],
      listenAddresses: ["/ip4/0.0.0.0/tcp/0"],
      enableFileDiffs: false,
    };

    expect(config).toBeDefined();
    expect(config.agentId).toBe("test-agent");
  });

  it("should handle empty capabilities array", () => {
    const config = createDefaultConfig(undefined, {
      capabilities: [],
    });

    expect(config.capabilities).toEqual([]);
  });

  it("should handle multiple listen addresses", () => {
    const config = createDefaultConfig(undefined, {
      listenAddresses: [
        "/ip4/0.0.0.0/tcp/4001",
        "/ip4/0.0.0.0/tcp/4001/ws",
        "/ip6/::/tcp/4001",
      ],
    });

    expect(config.listenAddresses.length).toBe(3);
    expect(config.listenAddresses[0]).toBe("/ip4/0.0.0.0/tcp/4001");
  });
});

describe("Agent Timeouts and Intervals", () => {
  it("should have reasonable default intervals", () => {
    const config = createDefaultConfig();

    // Peer discovery should be less frequent than heartbeat
    expect(config.peerDiscoveryInterval).toBeGreaterThan(config.heartbeatInterval);

    // Lease TTL should be longer than heartbeat
    expect(config.leaseTTL).toBeGreaterThan(config.heartbeatInterval);

    // Values should be in reasonable ranges
    expect(config.heartbeatInterval).toBeGreaterThanOrEqual(1000); // At least 1 second
    expect(config.heartbeatInterval).toBeLessThanOrEqual(60000); // At most 1 minute

    expect(config.leaseTTL).toBeGreaterThanOrEqual(60000); // At least 1 minute
    expect(config.leaseTTL).toBeLessThanOrEqual(3600000); // At most 1 hour
  });

  it("should allow custom intervals", () => {
    const config = createDefaultConfig(undefined, {
      heartbeatInterval: 5000,
      peerDiscoveryInterval: 30000,
      leaseTTL: 600000,
    });

    expect(config.heartbeatInterval).toBe(5000);
    expect(config.peerDiscoveryInterval).toBe(30000);
    expect(config.leaseTTL).toBe(600000);
  });
});

describe("Agent Capabilities", () => {
  const commonCapabilities = [
    "code",
    "review",
    "test",
    "document",
    "refactor",
    "debug",
  ];

  it("should support common capability types", () => {
    for (const capability of commonCapabilities) {
      const config = createDefaultConfig(undefined, {
        capabilities: [capability],
      });

      expect(config.capabilities).toContain(capability);
    }
  });

  it("should support multiple capabilities", () => {
    const config = createDefaultConfig(undefined, {
      capabilities: ["code", "review", "test"],
    });

    expect(config.capabilities.length).toBe(3);
    expect(config.capabilities).toContain("code");
    expect(config.capabilities).toContain("review");
    expect(config.capabilities).toContain("test");
  });

  it("should allow custom capabilities", () => {
    const config = createDefaultConfig(undefined, {
      capabilities: ["custom-capability", "another-custom"],
    });

    expect(config.capabilities).toContain("custom-capability");
    expect(config.capabilities).toContain("another-custom");
  });
});
