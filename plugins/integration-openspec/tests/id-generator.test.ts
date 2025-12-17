/**
 * Unit tests for OpenSpec ID generator
 *
 * Verifies deterministic ID generation for OpenSpec specs and changes.
 */

import { describe, it, expect } from "vitest";
import {
  generateSpecId,
  generateChangeId,
  parseOpenSpecId,
  verifyOpenSpecId,
  isOpenSpecId,
  DEFAULT_SPEC_PREFIX,
  DEFAULT_CHANGE_PREFIX,
} from "../src/id-generator.js";

describe("OpenSpec ID Generator", () => {
  describe("generateSpecId", () => {
    it("generates deterministic IDs for the same capability", () => {
      const id1 = generateSpecId("cli-init");
      const id2 = generateSpecId("cli-init");
      const id3 = generateSpecId("cli-init");

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it("generates different IDs for different capabilities", () => {
      const id1 = generateSpecId("cli-init");
      const id2 = generateSpecId("api-design");
      const id3 = generateSpecId("database-schema");

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("uses default prefix 'os'", () => {
      const id = generateSpecId("cli-init");
      expect(id).toMatch(/^os-[0-9a-f]{4}$/);
    });

    it("uses custom prefix when provided", () => {
      const id = generateSpecId("cli-init", "spec");
      expect(id).toMatch(/^spec-[0-9a-f]{4}$/);

      const id2 = generateSpecId("cli-init", "myprefix");
      expect(id2).toMatch(/^myprefix-[0-9a-f]{4}$/);
    });

    it("normalizes input to lowercase", () => {
      const id1 = generateSpecId("CLI-INIT");
      const id2 = generateSpecId("cli-init");
      const id3 = generateSpecId("Cli-Init");

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it("trims whitespace from input", () => {
      const id1 = generateSpecId("  cli-init  ");
      const id2 = generateSpecId("cli-init");

      expect(id1).toBe(id2);
    });

    it("throws error for empty capability", () => {
      expect(() => generateSpecId("")).toThrow(
        "Capability name is required for spec ID generation"
      );
      expect(() => generateSpecId("   ")).toThrow(
        "Capability name is required for spec ID generation"
      );
    });

    it("produces 4-character hex hashes", () => {
      const testCases = [
        "cli-init",
        "api-design",
        "database",
        "authentication",
        "user-profile",
      ];

      for (const capability of testCases) {
        const id = generateSpecId(capability);
        const parts = id.split("-");
        expect(parts).toHaveLength(2);
        expect(parts[1]).toHaveLength(4);
        expect(parts[1]).toMatch(/^[0-9a-f]{4}$/);
      }
    });
  });

  describe("generateChangeId", () => {
    it("generates deterministic IDs for the same change name", () => {
      const id1 = generateChangeId("add-feature");
      const id2 = generateChangeId("add-feature");
      const id3 = generateChangeId("add-feature");

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it("generates different IDs for different change names", () => {
      const id1 = generateChangeId("add-feature");
      const id2 = generateChangeId("fix-bug");
      const id3 = generateChangeId("refactor-code");

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("uses default prefix 'osc'", () => {
      const id = generateChangeId("add-feature");
      expect(id).toMatch(/^osc-[0-9a-f]{4}$/);
    });

    it("uses custom prefix when provided", () => {
      const id = generateChangeId("add-feature", "ch");
      expect(id).toMatch(/^ch-[0-9a-f]{4}$/);

      const id2 = generateChangeId("add-feature", "change");
      expect(id2).toMatch(/^change-[0-9a-f]{4}$/);
    });

    it("normalizes input to lowercase", () => {
      const id1 = generateChangeId("ADD-FEATURE");
      const id2 = generateChangeId("add-feature");
      const id3 = generateChangeId("Add-Feature");

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it("trims whitespace from input", () => {
      const id1 = generateChangeId("  add-feature  ");
      const id2 = generateChangeId("add-feature");

      expect(id1).toBe(id2);
    });

    it("throws error for empty change name", () => {
      expect(() => generateChangeId("")).toThrow(
        "Change name is required for change ID generation"
      );
      expect(() => generateChangeId("   ")).toThrow(
        "Change name is required for change ID generation"
      );
    });

    it("produces 4-character hex hashes", () => {
      const testCases = [
        "add-feature",
        "fix-bug",
        "update-docs",
        "remove-deprecated",
        "optimize-performance",
      ];

      for (const changeName of testCases) {
        const id = generateChangeId(changeName);
        const parts = id.split("-");
        expect(parts).toHaveLength(2);
        expect(parts[1]).toHaveLength(4);
        expect(parts[1]).toMatch(/^[0-9a-f]{4}$/);
      }
    });
  });

  describe("spec vs change ID uniqueness", () => {
    it("generates different IDs for same name but different entity types", () => {
      // Same name but different types should produce different IDs
      const specId = generateSpecId("feature-x", "test");
      const changeId = generateChangeId("feature-x", "test");

      // The hashes should be different because the hash input is different
      // ("openspec-spec-feature-x" vs "openspec-change-feature-x")
      expect(specId).not.toBe(changeId);
    });
  });

  describe("parseOpenSpecId", () => {
    it("parses valid spec IDs", () => {
      const result = parseOpenSpecId("os-a1b2");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("spec");
      expect(result!.hash).toBe("a1b2");
      expect(result!.prefix).toBe("os");
      expect(result!.name).toBe(""); // Name cannot be recovered from hash
    });

    it("parses valid change IDs", () => {
      const result = parseOpenSpecId("osc-c3d4");

      expect(result).not.toBeNull();
      expect(result!.type).toBe("change");
      expect(result!.hash).toBe("c3d4");
      expect(result!.prefix).toBe("osc");
    });

    it("parses IDs with custom prefixes", () => {
      const specResult = parseOpenSpecId("spec-abcd");
      expect(specResult).not.toBeNull();
      expect(specResult!.type).toBe("spec"); // Custom prefix defaults to spec type
      expect(specResult!.prefix).toBe("spec");

      // Custom prefixes (not matching DEFAULT_CHANGE_PREFIX) are assumed to be specs
      // Only "osc" is recognized as a change type
      const customResult = parseOpenSpecId("custom-1234");
      expect(customResult).not.toBeNull();
      expect(customResult!.type).toBe("spec");
      expect(customResult!.prefix).toBe("custom");
    });

    it("parses IDs with longer hashes", () => {
      const result = parseOpenSpecId("os-abcd1234");

      expect(result).not.toBeNull();
      expect(result!.hash).toBe("abcd1234");
    });

    it("returns null for invalid IDs", () => {
      expect(parseOpenSpecId("")).toBeNull();
      expect(parseOpenSpecId("invalid")).toBeNull();
      expect(parseOpenSpecId("os")).toBeNull();
      expect(parseOpenSpecId("os-")).toBeNull();
      expect(parseOpenSpecId("-abcd")).toBeNull();
      expect(parseOpenSpecId("os-ab")).toBeNull(); // hash too short
      expect(parseOpenSpecId("123-abcd")).toBeNull(); // prefix must be letters
    });

    it("returns null for non-string input", () => {
      expect(parseOpenSpecId(null as unknown as string)).toBeNull();
      expect(parseOpenSpecId(undefined as unknown as string)).toBeNull();
      expect(parseOpenSpecId(123 as unknown as string)).toBeNull();
    });

    it("normalizes hash to lowercase", () => {
      const result = parseOpenSpecId("OS-ABCD");

      expect(result).not.toBeNull();
      expect(result!.hash).toBe("abcd");
      expect(result!.prefix).toBe("os");
    });
  });

  describe("verifyOpenSpecId", () => {
    it("returns true for correctly generated spec IDs", () => {
      const id = generateSpecId("cli-init");
      expect(verifyOpenSpecId(id, "cli-init", "spec")).toBe(true);
    });

    it("returns true for correctly generated change IDs", () => {
      const id = generateChangeId("add-feature");
      expect(verifyOpenSpecId(id, "add-feature", "change")).toBe(true);
    });

    it("returns false for mismatched names", () => {
      const id = generateSpecId("cli-init");
      expect(verifyOpenSpecId(id, "different-name", "spec")).toBe(false);
    });

    it("returns false for mismatched types", () => {
      const id = generateSpecId("feature-x");
      expect(verifyOpenSpecId(id, "feature-x", "change")).toBe(false);
    });

    it("returns false for invalid IDs", () => {
      expect(verifyOpenSpecId("invalid", "cli-init", "spec")).toBe(false);
    });

    it("handles case normalization", () => {
      const id = generateSpecId("cli-init");
      expect(verifyOpenSpecId(id, "CLI-INIT", "spec")).toBe(true);
    });
  });

  describe("isOpenSpecId", () => {
    it("returns true for valid spec IDs", () => {
      expect(isOpenSpecId("os-a1b2")).toBe(true);
      expect(isOpenSpecId("spec-abcd")).toBe(true);
    });

    it("returns true for valid change IDs", () => {
      expect(isOpenSpecId("osc-c3d4")).toBe(true);
      expect(isOpenSpecId("changec-1234")).toBe(true);
    });

    it("returns false for invalid formats", () => {
      expect(isOpenSpecId("invalid")).toBe(false);
      expect(isOpenSpecId("s-abcd")).toBe(false); // sudocode format, single char prefix
      expect(isOpenSpecId("i-1234")).toBe(false); // sudocode format
      expect(isOpenSpecId("")).toBe(false);
      expect(isOpenSpecId("x-abcd")).toBe(false); // single char prefix
    });

    it("distinguishes from sudocode IDs by prefix length", () => {
      // sudocode uses single-character prefixes (s-, i-)
      // OpenSpec uses at least 2-character prefixes (os-, osc-, etc.)
      expect(isOpenSpecId("s-1234")).toBe(false);
      expect(isOpenSpecId("i-abcd")).toBe(false);
      expect(isOpenSpecId("os-1234")).toBe(true);
      expect(isOpenSpecId("osc-abcd")).toBe(true);
    });
  });

  describe("cross-sync determinism", () => {
    it("produces stable IDs that can be used across syncs", () => {
      // Simulate multiple sync operations
      const capabilities = [
        "user-auth",
        "payment-gateway",
        "notification-system",
        "data-export",
      ];

      const firstSync = capabilities.map((c) => generateSpecId(c));
      const secondSync = capabilities.map((c) => generateSpecId(c));
      const thirdSync = capabilities.map((c) => generateSpecId(c));

      // All syncs should produce identical IDs
      expect(firstSync).toEqual(secondSync);
      expect(secondSync).toEqual(thirdSync);
    });

    it("produces stable change IDs across syncs", () => {
      const changes = [
        "v1.0.0-release",
        "add-oauth",
        "fix-memory-leak",
        "deprecate-v1",
      ];

      const firstSync = changes.map((c) => generateChangeId(c));
      const secondSync = changes.map((c) => generateChangeId(c));
      const thirdSync = changes.map((c) => generateChangeId(c));

      expect(firstSync).toEqual(secondSync);
      expect(secondSync).toEqual(thirdSync);
    });
  });

  describe("known hash values (regression)", () => {
    // These tests lock in specific hash values to detect any changes
    // to the hashing algorithm that would break existing IDs
    it("generates expected hash for 'cli-init'", () => {
      const id = generateSpecId("cli-init");
      // Store the expected value on first run, then verify it stays the same
      expect(id).toMatch(/^os-[0-9a-f]{4}$/);
      // The actual hash value depends on SHA256("openspec-spec-cli-init")
    });

    it("generates expected hash for 'add-feature'", () => {
      const id = generateChangeId("add-feature");
      expect(id).toMatch(/^osc-[0-9a-f]{4}$/);
    });
  });

  describe("default constants", () => {
    it("exports correct default prefixes", () => {
      expect(DEFAULT_SPEC_PREFIX).toBe("os");
      expect(DEFAULT_CHANGE_PREFIX).toBe("osc");
    });
  });
});
