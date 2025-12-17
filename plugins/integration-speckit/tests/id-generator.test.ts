/**
 * Tests for spec-kit ID generation
 */

import { describe, it, expect } from "vitest";
import {
  extractFeatureNumber,
  extractFileType,
  generateSpecId,
  generateTaskIssueId,
  parseSpecId,
  isValidSpecKitId,
  getFeatureSpecId,
  getFeaturePlanId,
  getFeatureTasksId,
} from "../src/id-generator.js";

describe("ID Generator", () => {
  describe("extractFeatureNumber", () => {
    it("should extract feature number from standard spec paths", () => {
      expect(extractFeatureNumber("specs/001-auth/spec.md")).toBe("001");
      expect(extractFeatureNumber("specs/042-payments/plan.md")).toBe("042");
      expect(extractFeatureNumber("specs/123-feature/tasks.md")).toBe("123");
    });

    it("should handle single-digit feature numbers", () => {
      expect(extractFeatureNumber("specs/1-quick/spec.md")).toBe("1");
      expect(extractFeatureNumber("specs/9-test/plan.md")).toBe("9");
    });

    it("should handle multi-digit feature numbers", () => {
      expect(extractFeatureNumber("specs/0001-detailed/spec.md")).toBe("0001");
      expect(extractFeatureNumber("specs/9999-large/plan.md")).toBe("9999");
    });

    it("should return null for non-feature paths", () => {
      expect(extractFeatureNumber("memory/constitution.md")).toBeNull();
      expect(extractFeatureNumber("other/file.md")).toBeNull();
      expect(extractFeatureNumber("specs/no-number/spec.md")).toBeNull();
    });

    it("should handle subdirectories within features", () => {
      expect(extractFeatureNumber("specs/001-auth/contracts/api-spec.json")).toBe("001");
      expect(extractFeatureNumber("specs/001-auth/docs/readme.md")).toBe("001");
    });
  });

  describe("extractFileType", () => {
    it("should extract standard file types", () => {
      expect(extractFileType("specs/001-auth/spec.md")).toBe("spec");
      expect(extractFileType("specs/001-auth/plan.md")).toBe("plan");
      expect(extractFileType("specs/001-auth/tasks.md")).toBe("tasks");
      expect(extractFileType("specs/001-auth/research.md")).toBe("research");
      expect(extractFileType("specs/001-auth/data-model.md")).toBe("data-model");
    });

    it("should handle contract files with prefix", () => {
      expect(extractFileType("specs/001-auth/contracts/api-spec.json")).toBe("contract-api-spec");
      expect(extractFileType("specs/001-auth/contracts/schema.yaml")).toBe("contract-schema");
      expect(extractFileType("specs/001-auth/contracts/openapi.yml")).toBe("contract-openapi");
    });

    it("should handle memory directory files", () => {
      expect(extractFileType("memory/constitution.md")).toBe("constitution");
      expect(extractFileType("memory/guidelines.md")).toBe("guidelines");
    });

    it("should strip various file extensions", () => {
      expect(extractFileType("specs/001-auth/spec.md")).toBe("spec");
      expect(extractFileType("specs/001-auth/contracts/api.json")).toBe("contract-api");
      expect(extractFileType("specs/001-auth/contracts/schema.yaml")).toBe("contract-schema");
      expect(extractFileType("specs/001-auth/contracts/openapi.yml")).toBe("contract-openapi");
    });
  });

  describe("generateSpecId", () => {
    it("should generate IDs for feature files with default prefix", () => {
      expect(generateSpecId("specs/001-auth/spec.md")).toBe("sk-001-spec");
      expect(generateSpecId("specs/001-auth/plan.md")).toBe("sk-001-plan");
      expect(generateSpecId("specs/001-auth/tasks.md")).toBe("sk-001-tasks");
      expect(generateSpecId("specs/001-auth/research.md")).toBe("sk-001-research");
    });

    it("should generate IDs for contract files", () => {
      expect(generateSpecId("specs/001-auth/contracts/api-spec.json")).toBe("sk-001-contract-api-spec");
    });

    it("should generate IDs for memory files", () => {
      expect(generateSpecId("memory/constitution.md")).toBe("sk-constitution");
    });

    it("should use custom prefix when provided", () => {
      expect(generateSpecId("specs/001-auth/spec.md", "myprefix")).toBe("myprefix-001-spec");
      expect(generateSpecId("memory/constitution.md", "custom")).toBe("custom-constitution");
    });

    it("should handle different feature numbers", () => {
      expect(generateSpecId("specs/042-payments/spec.md")).toBe("sk-042-spec");
      expect(generateSpecId("specs/999-final/plan.md")).toBe("sk-999-plan");
    });
  });

  describe("generateTaskIssueId", () => {
    it("should generate task IDs with default prefix", () => {
      expect(generateTaskIssueId("001", "T001")).toBe("skt-001-T001");
      expect(generateTaskIssueId("001", "T002")).toBe("skt-001-T002");
      expect(generateTaskIssueId("042", "T001")).toBe("skt-042-T001");
    });

    it("should use custom prefix when provided", () => {
      expect(generateTaskIssueId("001", "T001", "task")).toBe("task-001-T001");
      expect(generateTaskIssueId("001", "T001", "t")).toBe("t-001-T001");
    });

    it("should handle various task ID formats", () => {
      expect(generateTaskIssueId("001", "T1")).toBe("skt-001-T1");
      expect(generateTaskIssueId("001", "T100")).toBe("skt-001-T100");
      expect(generateTaskIssueId("001", "TASK-1")).toBe("skt-001-TASK-1");
    });
  });

  describe("parseSpecId", () => {
    it("should parse feature-based spec IDs", () => {
      const result = parseSpecId("sk-001-spec");
      expect(result).toEqual({
        prefix: "sk",
        featureNumber: "001",
        fileType: "spec",
        isTask: false,
      });
    });

    it("should parse plan IDs", () => {
      const result = parseSpecId("sk-001-plan");
      expect(result).toEqual({
        prefix: "sk",
        featureNumber: "001",
        fileType: "plan",
        isTask: false,
      });
    });

    it("should parse task IDs and identify them as tasks", () => {
      const result = parseSpecId("skt-001-T001");
      expect(result).toEqual({
        prefix: "skt",
        featureNumber: "001",
        fileType: "T001",
        isTask: true,
      });
    });

    it("should parse task IDs with various formats", () => {
      expect(parseSpecId("skt-001-T1")?.isTask).toBe(true);
      expect(parseSpecId("skt-001-T100")?.isTask).toBe(true);
      expect(parseSpecId("skt-001-T9999")?.isTask).toBe(true);
    });

    it("should not identify non-task IDs as tasks", () => {
      expect(parseSpecId("sk-001-tasks")?.isTask).toBe(false);
      expect(parseSpecId("sk-001-TASK-list")?.isTask).toBe(false);
    });

    it("should parse non-feature IDs", () => {
      const result = parseSpecId("sk-constitution");
      expect(result).toEqual({
        prefix: "sk",
        featureNumber: null,
        fileType: "constitution",
        isTask: false,
      });
    });

    it("should parse contract IDs", () => {
      const result = parseSpecId("sk-001-contract-api-spec");
      expect(result).toEqual({
        prefix: "sk",
        featureNumber: "001",
        fileType: "contract-api-spec",
        isTask: false,
      });
    });

    it("should return null for invalid IDs", () => {
      expect(parseSpecId("invalid")).toBeNull();
      expect(parseSpecId("")).toBeNull();
      expect(parseSpecId("nohyphen")).toBeNull();
      expect(parseSpecId("-noprefix")).toBeNull();
      expect(parseSpecId("prefix-")).toBeNull();
    });

    it("should handle custom prefixes", () => {
      const result = parseSpecId("myprefix-001-spec");
      expect(result?.prefix).toBe("myprefix");
      expect(result?.featureNumber).toBe("001");
    });
  });

  describe("isValidSpecKitId", () => {
    it("should validate correct spec-kit IDs", () => {
      expect(isValidSpecKitId("sk-001-spec")).toBe(true);
      expect(isValidSpecKitId("sk-001-plan")).toBe(true);
      expect(isValidSpecKitId("skt-001-T001")).toBe(true);
      expect(isValidSpecKitId("sk-constitution")).toBe(true);
    });

    it("should reject invalid IDs", () => {
      expect(isValidSpecKitId("invalid")).toBe(false);
      expect(isValidSpecKitId("")).toBe(false);
    });

    it("should validate against expected prefix", () => {
      expect(isValidSpecKitId("sk-001-spec", "sk")).toBe(true);
      expect(isValidSpecKitId("sk-001-spec", "skt")).toBe(false);
      expect(isValidSpecKitId("skt-001-T001", "skt")).toBe(true);
      expect(isValidSpecKitId("skt-001-T001", "sk")).toBe(false);
    });
  });

  describe("helper functions", () => {
    it("getFeatureSpecId should generate correct spec IDs", () => {
      expect(getFeatureSpecId("001")).toBe("sk-001-spec");
      expect(getFeatureSpecId("042")).toBe("sk-042-spec");
      expect(getFeatureSpecId("001", "custom")).toBe("custom-001-spec");
    });

    it("getFeaturePlanId should generate correct plan IDs", () => {
      expect(getFeaturePlanId("001")).toBe("sk-001-plan");
      expect(getFeaturePlanId("042")).toBe("sk-042-plan");
      expect(getFeaturePlanId("001", "custom")).toBe("custom-001-plan");
    });

    it("getFeatureTasksId should generate correct tasks IDs", () => {
      expect(getFeatureTasksId("001")).toBe("sk-001-tasks");
      expect(getFeatureTasksId("042")).toBe("sk-042-tasks");
      expect(getFeatureTasksId("001", "custom")).toBe("custom-001-tasks");
    });
  });

  describe("round-trip consistency", () => {
    it("should maintain consistency between generate and parse for spec IDs", () => {
      const path = "specs/001-auth/spec.md";
      const id = generateSpecId(path);
      const parsed = parseSpecId(id);

      expect(parsed).not.toBeNull();
      expect(parsed?.prefix).toBe("sk");
      expect(parsed?.featureNumber).toBe("001");
      expect(parsed?.fileType).toBe("spec");
    });

    it("should maintain consistency between generate and parse for task IDs", () => {
      const id = generateTaskIssueId("001", "T001");
      const parsed = parseSpecId(id);

      expect(parsed).not.toBeNull();
      expect(parsed?.prefix).toBe("skt");
      expect(parsed?.featureNumber).toBe("001");
      expect(parsed?.fileType).toBe("T001");
      expect(parsed?.isTask).toBe(true);
    });
  });
});
