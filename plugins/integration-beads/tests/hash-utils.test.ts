/**
 * Tests for hash utilities
 */

import { describe, it, expect } from "vitest";
import { computeCanonicalHash, computeContentHash } from "../src/hash-utils.js";

describe("Hash Utils", () => {
  describe("computeCanonicalHash", () => {
    it("should produce consistent hash regardless of key order", () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      const obj3 = { b: 2, c: 3, a: 1 };

      const hash1 = computeCanonicalHash(obj1);
      const hash2 = computeCanonicalHash(obj2);
      const hash3 = computeCanonicalHash(obj3);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should produce different hashes for different values", () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3 };

      expect(computeCanonicalHash(obj1)).not.toBe(computeCanonicalHash(obj2));
    });

    it("should handle nested objects with different key orders", () => {
      const obj1 = { outer: { a: 1, b: 2 }, x: "y" };
      const obj2 = { x: "y", outer: { b: 2, a: 1 } };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should handle deeply nested objects", () => {
      const obj1 = {
        level1: {
          level2: {
            level3: { a: 1, b: 2 },
          },
        },
      };
      const obj2 = {
        level1: {
          level2: {
            level3: { b: 2, a: 1 },
          },
        },
      };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should handle arrays", () => {
      const obj1 = { items: [1, 2, 3] };
      const obj2 = { items: [1, 2, 3] };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should preserve array order (different order = different hash)", () => {
      const obj1 = { items: [1, 2, 3] };
      const obj2 = { items: [3, 2, 1] };

      expect(computeCanonicalHash(obj1)).not.toBe(computeCanonicalHash(obj2));
    });

    it("should handle arrays of objects with different key orders", () => {
      const obj1 = { items: [{ a: 1, b: 2 }, { c: 3, d: 4 }] };
      const obj2 = { items: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should handle null values", () => {
      const obj1 = { a: null, b: 1 };
      const obj2 = { b: 1, a: null };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should handle undefined values", () => {
      const obj1 = { a: undefined, b: 1 };
      const obj2 = { b: 1, a: undefined };

      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2));
    });

    it("should distinguish null from undefined", () => {
      const obj1 = { a: null };
      const obj2 = { a: undefined };

      // Note: JSON.stringify treats undefined differently than null
      // { a: undefined } becomes {} and { a: null } becomes {"a":null}
      expect(computeCanonicalHash(obj1)).not.toBe(computeCanonicalHash(obj2));
    });

    it("should handle empty objects", () => {
      const hash = computeCanonicalHash({});
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 hex length
    });

    it("should handle primitive values", () => {
      expect(computeCanonicalHash("string")).toBeDefined();
      expect(computeCanonicalHash(123)).toBeDefined();
      expect(computeCanonicalHash(true)).toBeDefined();
      expect(computeCanonicalHash(null)).toBeDefined();
    });

    it("should produce valid SHA-256 hex string", () => {
      const hash = computeCanonicalHash({ test: "value" });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle real-world issue object", () => {
      const issue1 = {
        id: "bd-12345678",
        title: "Test Issue",
        content: "Description here",
        status: "open",
        priority: 2,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
      };

      const issue2 = {
        updated_at: "2024-01-02T00:00:00.000Z",
        content: "Description here",
        title: "Test Issue",
        priority: 2,
        id: "bd-12345678",
        created_at: "2024-01-01T00:00:00.000Z",
        status: "open",
      };

      expect(computeCanonicalHash(issue1)).toBe(computeCanonicalHash(issue2));
    });
  });

  describe("computeContentHash", () => {
    it("should hash string content", () => {
      const content = "Hello, World!";
      const hash = computeContentHash(content);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it("should produce consistent hashes for same content", () => {
      const content = "Test content";
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = computeContentHash("Content A");
      const hash2 = computeContentHash("Content B");

      expect(hash1).not.toBe(hash2);
    });

    it("should be case-sensitive", () => {
      const hash1 = computeContentHash("Hello");
      const hash2 = computeContentHash("hello");

      expect(hash1).not.toBe(hash2);
    });

    it("should be whitespace-sensitive", () => {
      const hash1 = computeContentHash("hello world");
      const hash2 = computeContentHash("hello  world");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = computeContentHash("");
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it("should handle JSONL content", () => {
      const jsonl = '{"id":"bd-1","title":"Issue 1"}\n{"id":"bd-2","title":"Issue 2"}\n';
      const hash = computeContentHash(jsonl);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
