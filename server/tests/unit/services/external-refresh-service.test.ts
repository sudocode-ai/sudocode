import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeContentHash,
  detectLocalChanges,
  computeFieldChanges,
} from "../../../src/services/external-refresh-service.js";

describe("RefreshService", () => {
  describe("computeContentHash", () => {
    it("should compute consistent hash for same content", () => {
      const hash1 = computeContentHash("Test Title", "Test content");
      const hash2 = computeContentHash("Test Title", "Test content");
      expect(hash1).toBe(hash2);
    });

    it("should compute different hash for different titles", () => {
      const hash1 = computeContentHash("Title 1", "Same content");
      const hash2 = computeContentHash("Title 2", "Same content");
      expect(hash1).not.toBe(hash2);
    });

    it("should compute different hash for different content", () => {
      const hash1 = computeContentHash("Same Title", "Content 1");
      const hash2 = computeContentHash("Same Title", "Content 2");
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty content", () => {
      const hash1 = computeContentHash("Title", "");
      const hash2 = computeContentHash("Title", "");
      expect(hash1).toBe(hash2);
    });

    it("should return a 64 character hex string (SHA-256)", () => {
      const hash = computeContentHash("Title", "Content");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe("detectLocalChanges", () => {
    it("should return false when current content matches stored hash", () => {
      const title = "My Spec";
      const content = "Spec description";
      const storedHash = computeContentHash(title, content);

      const hasChanges = detectLocalChanges(title, content, storedHash);
      expect(hasChanges).toBe(false);
    });

    it("should return true when title has changed", () => {
      const originalTitle = "Original Title";
      const content = "Same content";
      const storedHash = computeContentHash(originalTitle, content);

      const hasChanges = detectLocalChanges("Changed Title", content, storedHash);
      expect(hasChanges).toBe(true);
    });

    it("should return true when content has changed", () => {
      const title = "Same Title";
      const originalContent = "Original content";
      const storedHash = computeContentHash(title, originalContent);

      const hasChanges = detectLocalChanges(title, "Changed content", storedHash);
      expect(hasChanges).toBe(true);
    });

    it("should return false when storedHash is undefined", () => {
      // When no stored hash exists, we can't detect changes
      const hasChanges = detectLocalChanges("Title", "Content", undefined);
      expect(hasChanges).toBe(false);
    });

    it("should return true when both title and content have changed", () => {
      const storedHash = computeContentHash("Old Title", "Old content");
      const hasChanges = detectLocalChanges("New Title", "New content", storedHash);
      expect(hasChanges).toBe(true);
    });

    it("should detect whitespace-only changes", () => {
      const title = "Title";
      const originalContent = "Content";
      const storedHash = computeContentHash(title, originalContent);

      const hasChanges = detectLocalChanges(title, "Content ", storedHash);
      expect(hasChanges).toBe(true);
    });
  });

  describe("computeFieldChanges", () => {
    it("should return empty array when no changes", () => {
      const changes = computeFieldChanges(
        "Same Title",
        "Same content",
        "Same Title",
        "Same content"
      );
      expect(changes).toEqual([]);
    });

    it("should detect title change", () => {
      const changes = computeFieldChanges(
        "Local Title",
        "Same content",
        "Remote Title",
        "Same content"
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: "title",
        localValue: "Local Title",
        remoteValue: "Remote Title",
      });
    });

    it("should detect content change", () => {
      const changes = computeFieldChanges(
        "Same Title",
        "Local content",
        "Same Title",
        "Remote content"
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: "content",
        localValue: "Local content",
        remoteValue: "Remote content",
      });
    });

    it("should detect both title and content changes", () => {
      const changes = computeFieldChanges(
        "Local Title",
        "Local content",
        "Remote Title",
        "Remote content"
      );
      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({
        field: "title",
        localValue: "Local Title",
        remoteValue: "Remote Title",
      });
      expect(changes).toContainEqual({
        field: "content",
        localValue: "Local content",
        remoteValue: "Remote content",
      });
    });

    it("should handle empty strings correctly", () => {
      const changes = computeFieldChanges("Title", "", "Title", "New content");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: "content",
        localValue: "",
        remoteValue: "New content",
      });
    });

    it("should handle undefined remote content as empty string", () => {
      const changes = computeFieldChanges(
        "Title",
        "Some content",
        "Title",
        "" // Remote content could be undefined, normalized to ""
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: "content",
        localValue: "Some content",
        remoteValue: "",
      });
    });
  });
});
