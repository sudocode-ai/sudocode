/**
 * Unit tests for reference management tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as referenceTools from "../../src/tools/references.js";

describe("Reference Tools", () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      exec: vi.fn(),
    };
  });

  describe("addReference", () => {
    it("should try spec add-ref command first", async () => {
      mockClient.exec.mockResolvedValueOnce({}); // spec add-ref succeeds

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "ISSUE-001",
        line: 45,
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "ISSUE-001",
        "--line",
        "45",
      ]);
      expect(mockClient.exec).toHaveBeenCalledTimes(1);
    });

    it("should try issue add-ref if spec fails", async () => {
      mockClient.exec
        .mockRejectedValueOnce(new Error("Entity not found")) // spec add-ref fails
        .mockResolvedValueOnce({}); // issue add-ref succeeds

      await referenceTools.addReference(mockClient, {
        entity_id: "ISSUE-001",
        reference_id: "SPEC-002",
        text: "Design",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "ISSUE-001",
        "SPEC-002",
        "--text",
        "Design",
      ]);
      expect(mockClient.exec).toHaveBeenCalledWith([
        "issue",
        "add-ref",
        "ISSUE-001",
        "SPEC-002",
        "--text",
        "Design",
      ]);
      expect(mockClient.exec).toHaveBeenCalledTimes(2);
    });

    it("should include display text when provided", async () => {
      mockClient.exec.mockResolvedValueOnce({});

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "ISSUE-001",
        line: 10,
        display_text: "OAuth Implementation",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "ISSUE-001",
        "--line",
        "10",
        "--display",
        "OAuth Implementation",
      ]);
    });

    it("should include relationship type when provided", async () => {
      mockClient.exec.mockResolvedValueOnce({});

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "SPEC-002",
        line: 20,
        relationship_type: "implements",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "SPEC-002",
        "--line",
        "20",
        "--type",
        "implements",
      ]);
    });

    it("should include format option when provided", async () => {
      mockClient.exec.mockResolvedValueOnce({});

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "ISSUE-001",
        line: 15,
        format: "newline",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "ISSUE-001",
        "--line",
        "15",
        "--format",
        "newline",
      ]);
    });

    it("should include position option when provided", async () => {
      mockClient.exec.mockResolvedValueOnce({});

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "ISSUE-001",
        text: "Requirements:",
        position: "before",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "ISSUE-001",
        "--text",
        "Requirements:",
        "--position",
        "before",
      ]);
    });

    it("should include all optional parameters when provided", async () => {
      mockClient.exec.mockResolvedValueOnce({});

      await referenceTools.addReference(mockClient, {
        entity_id: "SPEC-001",
        reference_id: "ISSUE-001",
        line: 50,
        display_text: "Auth Feature",
        relationship_type: "blocks",
        format: "newline",
        position: "before",
      });

      expect(mockClient.exec).toHaveBeenCalledWith([
        "spec",
        "add-ref",
        "SPEC-001",
        "ISSUE-001",
        "--line",
        "50",
        "--display",
        "Auth Feature",
        "--type",
        "blocks",
        "--format",
        "newline",
        "--position",
        "before",
      ]);
    });

    it("should throw error when both spec and issue commands fail", async () => {
      const error = new Error("Entity not found: NONEXISTENT-001");
      mockClient.exec
        .mockRejectedValueOnce(new Error("Entity not found")) // spec add-ref fails
        .mockRejectedValueOnce(error); // issue add-ref fails

      await expect(
        referenceTools.addReference(mockClient, {
          entity_id: "NONEXISTENT-001",
          reference_id: "ISSUE-001",
          line: 10,
        })
      ).rejects.toThrow(error);
    });
  });
});
