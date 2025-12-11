/**
 * Unit Tests for Conflict Resolver
 *
 * Tests conflict resolution strategies and utility functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveByStrategy,
  logConflict,
  createConflictLog,
  isConflict,
} from "../../../src/integrations/utils/conflict-resolver.js";
import type { SyncConflict, ConflictResolution } from "@sudocode-ai/types";

describe("conflict-resolver", () => {
  // Base conflict for testing
  const baseConflict: SyncConflict = {
    sudocode_entity_id: "i-abc",
    external_id: "EXT-123",
    provider: "jira",
    sudocode_updated_at: "2025-01-01T12:00:00Z",
    external_updated_at: "2025-01-01T11:00:00Z",
  };

  describe("resolveByStrategy", () => {
    describe("newest-wins strategy", () => {
      it("should return 'sudocode' when sudocode is newer", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T12:00:00Z",
          external_updated_at: "2025-01-01T11:00:00Z",
        };

        const result = resolveByStrategy(conflict, "newest-wins");
        expect(result).toBe("sudocode");
      });

      it("should return 'external' when external is newer", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T11:00:00Z",
          external_updated_at: "2025-01-01T12:00:00Z",
        };

        const result = resolveByStrategy(conflict, "newest-wins");
        expect(result).toBe("external");
      });

      it("should return 'sudocode' when timestamps are equal (tie-breaker)", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T12:00:00Z",
          external_updated_at: "2025-01-01T12:00:00Z",
        };

        const result = resolveByStrategy(conflict, "newest-wins");
        expect(result).toBe("sudocode");
      });

      it("should handle timestamps with milliseconds", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T12:00:00.500Z",
          external_updated_at: "2025-01-01T12:00:00.499Z",
        };

        const result = resolveByStrategy(conflict, "newest-wins");
        expect(result).toBe("sudocode");
      });
    });

    describe("sudocode-wins strategy", () => {
      it("should always return 'sudocode'", () => {
        const result = resolveByStrategy(baseConflict, "sudocode-wins");
        expect(result).toBe("sudocode");
      });

      it("should return 'sudocode' even when external is newer", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T10:00:00Z",
          external_updated_at: "2025-01-01T15:00:00Z",
        };

        const result = resolveByStrategy(conflict, "sudocode-wins");
        expect(result).toBe("sudocode");
      });
    });

    describe("external-wins strategy", () => {
      it("should always return 'external'", () => {
        const result = resolveByStrategy(baseConflict, "external-wins");
        expect(result).toBe("external");
      });

      it("should return 'external' even when sudocode is newer", () => {
        const conflict: SyncConflict = {
          ...baseConflict,
          sudocode_updated_at: "2025-01-01T15:00:00Z",
          external_updated_at: "2025-01-01T10:00:00Z",
        };

        const result = resolveByStrategy(conflict, "external-wins");
        expect(result).toBe("external");
      });
    });

    describe("manual strategy", () => {
      it("should return 'skip' for manual strategy", () => {
        const result = resolveByStrategy(baseConflict, "manual");
        expect(result).toBe("skip");
      });
    });

    describe("unknown strategy", () => {
      it("should default to 'skip' for unknown strategies", () => {
        const result = resolveByStrategy(
          baseConflict,
          "unknown" as ConflictResolution
        );
        expect(result).toBe("skip");
      });
    });
  });

  describe("logConflict", () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("should log conflict details to console", () => {
      const log = {
        timestamp: "2025-01-01T12:00:00Z",
        conflict: baseConflict,
        resolution: "sudocode" as const,
        strategy: "newest-wins" as ConflictResolution,
      };

      logConflict(log);

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[Sync Conflict]",
        expect.objectContaining({
          provider: "jira",
          entity: "i-abc",
          external: "EXT-123",
          resolution: "sudocode",
          strategy: "newest-wins",
        })
      );
    });

    it("should include timestamps in log output", () => {
      const log = {
        timestamp: "2025-01-01T12:00:00Z",
        conflict: baseConflict,
        resolution: "external" as const,
        strategy: "external-wins" as ConflictResolution,
      };

      logConflict(log);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[Sync Conflict]",
        expect.objectContaining({
          sudocode_updated: baseConflict.sudocode_updated_at,
          external_updated: baseConflict.external_updated_at,
        })
      );
    });
  });

  describe("createConflictLog", () => {
    it("should create a complete conflict log entry", () => {
      const log = createConflictLog(baseConflict, "sudocode", "newest-wins");

      expect(log.conflict).toEqual(baseConflict);
      expect(log.resolution).toBe("sudocode");
      expect(log.strategy).toBe("newest-wins");
      expect(log.timestamp).toBeDefined();
    });

    it("should set current timestamp", () => {
      const before = new Date().toISOString();
      const log = createConflictLog(baseConflict, "external", "external-wins");
      const after = new Date().toISOString();

      expect(log.timestamp >= before).toBe(true);
      expect(log.timestamp <= after).toBe(true);
    });

    it("should preserve all conflict details", () => {
      const customConflict: SyncConflict = {
        sudocode_entity_id: "s-xyz",
        external_id: "SPEC-999",
        provider: "beads",
        sudocode_updated_at: "2025-06-15T10:30:00Z",
        external_updated_at: "2025-06-15T09:45:00Z",
      };

      const log = createConflictLog(customConflict, "skip", "manual");

      expect(log.conflict.sudocode_entity_id).toBe("s-xyz");
      expect(log.conflict.external_id).toBe("SPEC-999");
      expect(log.conflict.provider).toBe("beads");
    });
  });

  describe("isConflict", () => {
    const lastSynced = "2025-01-01T10:00:00Z";

    it("should return true when both updated after last sync", () => {
      const sudocodeUpdated = "2025-01-01T12:00:00Z";
      const externalUpdated = "2025-01-01T11:00:00Z";

      const result = isConflict(sudocodeUpdated, externalUpdated, lastSynced);
      expect(result).toBe(true);
    });

    it("should return false when only sudocode updated after sync", () => {
      const sudocodeUpdated = "2025-01-01T12:00:00Z";
      const externalUpdated = "2025-01-01T09:00:00Z";

      const result = isConflict(sudocodeUpdated, externalUpdated, lastSynced);
      expect(result).toBe(false);
    });

    it("should return false when only external updated after sync", () => {
      const sudocodeUpdated = "2025-01-01T09:00:00Z";
      const externalUpdated = "2025-01-01T12:00:00Z";

      const result = isConflict(sudocodeUpdated, externalUpdated, lastSynced);
      expect(result).toBe(false);
    });

    it("should return false when neither updated after sync", () => {
      const sudocodeUpdated = "2025-01-01T09:00:00Z";
      const externalUpdated = "2025-01-01T08:00:00Z";

      const result = isConflict(sudocodeUpdated, externalUpdated, lastSynced);
      expect(result).toBe(false);
    });

    it("should return false when updates equal last sync time", () => {
      const result = isConflict(lastSynced, lastSynced, lastSynced);
      expect(result).toBe(false);
    });

    it("should handle Date objects", () => {
      const sudocodeUpdated = new Date("2025-01-01T12:00:00Z");
      const externalUpdated = new Date("2025-01-01T11:00:00Z");
      const syncTime = new Date("2025-01-01T10:00:00Z");

      const result = isConflict(sudocodeUpdated, externalUpdated, syncTime);
      expect(result).toBe(true);
    });

    it("should handle mixed Date and string inputs", () => {
      const sudocodeUpdated = new Date("2025-01-01T12:00:00Z");
      const externalUpdated = "2025-01-01T11:00:00Z";
      const syncTime = "2025-01-01T10:00:00Z";

      const result = isConflict(sudocodeUpdated, externalUpdated, syncTime);
      expect(result).toBe(true);
    });
  });
});
