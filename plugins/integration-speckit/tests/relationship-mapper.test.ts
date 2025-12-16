/**
 * Tests for spec-kit relationship mapping
 */

import { describe, it, expect } from "vitest";
import {
  mapFeatureRelationships,
  mapTaskDependencies,
  mapSupportingDocRelationships,
  mapPlanToSpecRelationship,
  mapTaskToPlanRelationship,
  getStandardSupportingDocTypes,
  createContractDocInfo,
  type MappedRelationship,
  type TaskInfo,
  type SupportingDocInfo,
} from "../src/relationship-mapper.js";

describe("Relationship Mapper", () => {
  describe("mapFeatureRelationships", () => {
    it("should create plan implements spec relationship", () => {
      const relationships = mapFeatureRelationships("001");

      const planToSpec = relationships.find(
        (r) =>
          r.fromId === "sk-001-plan" &&
          r.toId === "sk-001-spec" &&
          r.relationshipType === "implements"
      );

      expect(planToSpec).toBeDefined();
      expect(planToSpec?.fromType).toBe("spec");
      expect(planToSpec?.toType).toBe("spec");
    });

    it("should create task implements plan relationships", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002" },
        { taskId: "T003" },
      ];

      const relationships = mapFeatureRelationships("001", "sk", "skt", tasks);

      const taskRelationships = relationships.filter(
        (r) =>
          r.toId === "sk-001-plan" &&
          r.relationshipType === "implements" &&
          r.fromType === "issue"
      );

      expect(taskRelationships).toHaveLength(3);
      expect(taskRelationships.map((r) => r.fromId)).toContain("skt-001-T001");
      expect(taskRelationships.map((r) => r.fromId)).toContain("skt-001-T002");
      expect(taskRelationships.map((r) => r.fromId)).toContain("skt-001-T003");
    });

    it("should create task dependency relationships", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002", dependsOn: ["T001"] },
        { taskId: "T003", dependsOn: ["T001", "T002"] },
      ];

      const relationships = mapFeatureRelationships("001", "sk", "skt", tasks);

      const dependsOnRelationships = relationships.filter(
        (r) => r.relationshipType === "depends-on"
      );

      expect(dependsOnRelationships).toHaveLength(3);

      // T002 depends on T001
      expect(
        dependsOnRelationships.find(
          (r) => r.fromId === "skt-001-T002" && r.toId === "skt-001-T001"
        )
      ).toBeDefined();

      // T003 depends on T001
      expect(
        dependsOnRelationships.find(
          (r) => r.fromId === "skt-001-T003" && r.toId === "skt-001-T001"
        )
      ).toBeDefined();

      // T003 depends on T002
      expect(
        dependsOnRelationships.find(
          (r) => r.fromId === "skt-001-T003" && r.toId === "skt-001-T002"
        )
      ).toBeDefined();
    });

    it("should create supporting doc reference relationships", () => {
      const supportingDocs: SupportingDocInfo[] = [
        { fileType: "research", entityType: "spec" },
        { fileType: "data-model", entityType: "spec" },
      ];

      const relationships = mapFeatureRelationships(
        "001",
        "sk",
        "skt",
        [],
        supportingDocs
      );

      const referenceRelationships = relationships.filter(
        (r) => r.relationshipType === "references"
      );

      expect(referenceRelationships).toHaveLength(2);

      expect(
        referenceRelationships.find(
          (r) => r.fromId === "sk-001-research" && r.toId === "sk-001-plan"
        )
      ).toBeDefined();

      expect(
        referenceRelationships.find(
          (r) => r.fromId === "sk-001-data-model" && r.toId === "sk-001-plan"
        )
      ).toBeDefined();
    });

    it("should use custom prefixes", () => {
      const tasks: TaskInfo[] = [{ taskId: "T001" }];
      const relationships = mapFeatureRelationships(
        "001",
        "custom",
        "ctask",
        tasks
      );

      expect(relationships.find((r) => r.fromId === "custom-001-plan")).toBeDefined();
      expect(relationships.find((r) => r.toId === "custom-001-spec")).toBeDefined();
      expect(relationships.find((r) => r.fromId === "ctask-001-T001")).toBeDefined();
    });

    it("should handle feature with no tasks", () => {
      const relationships = mapFeatureRelationships("001");

      // Should only have plan implements spec
      expect(relationships).toHaveLength(1);
      expect(relationships[0].relationshipType).toBe("implements");
    });

    it("should handle different feature numbers", () => {
      const relationships = mapFeatureRelationships("042");

      expect(relationships[0].fromId).toBe("sk-042-plan");
      expect(relationships[0].toId).toBe("sk-042-spec");
    });
  });

  describe("mapTaskDependencies", () => {
    it("should create depends-on relationships for tasks with dependencies", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002", dependsOn: ["T001"] },
      ];

      const relationships = mapTaskDependencies("001", "skt", tasks);

      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toEqual({
        fromId: "skt-001-T002",
        fromType: "issue",
        toId: "skt-001-T001",
        toType: "issue",
        relationshipType: "depends-on",
      });
    });

    it("should handle multiple dependencies", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002" },
        { taskId: "T003", dependsOn: ["T001", "T002"] },
      ];

      const relationships = mapTaskDependencies("001", "skt", tasks);

      expect(relationships).toHaveLength(2);
      expect(relationships.map((r) => r.toId)).toContain("skt-001-T001");
      expect(relationships.map((r) => r.toId)).toContain("skt-001-T002");
    });

    it("should return empty array for tasks without dependencies", () => {
      const tasks: TaskInfo[] = [{ taskId: "T001" }, { taskId: "T002" }];

      const relationships = mapTaskDependencies("001", "skt", tasks);

      expect(relationships).toHaveLength(0);
    });

    it("should handle empty task array", () => {
      const relationships = mapTaskDependencies("001", "skt", []);
      expect(relationships).toHaveLength(0);
    });

    it("should use custom prefix", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002", dependsOn: ["T001"] },
      ];

      const relationships = mapTaskDependencies("001", "mytask", tasks);

      expect(relationships[0].fromId).toBe("mytask-001-T002");
      expect(relationships[0].toId).toBe("mytask-001-T001");
    });
  });

  describe("mapSupportingDocRelationships", () => {
    it("should create reference relationships to plan", () => {
      const docs: SupportingDocInfo[] = [
        { fileType: "research", entityType: "spec" },
        { fileType: "data-model", entityType: "spec" },
      ];

      const relationships = mapSupportingDocRelationships("001", "sk", docs);

      expect(relationships).toHaveLength(2);

      expect(relationships[0]).toEqual({
        fromId: "sk-001-research",
        fromType: "spec",
        toId: "sk-001-plan",
        toType: "spec",
        relationshipType: "references",
      });

      expect(relationships[1]).toEqual({
        fromId: "sk-001-data-model",
        fromType: "spec",
        toId: "sk-001-plan",
        toType: "spec",
        relationshipType: "references",
      });
    });

    it("should handle contract documents", () => {
      const docs: SupportingDocInfo[] = [
        { fileType: "contract-api-spec", entityType: "spec" },
      ];

      const relationships = mapSupportingDocRelationships("001", "sk", docs);

      expect(relationships[0].fromId).toBe("sk-001-contract-api-spec");
    });

    it("should return empty array for no documents", () => {
      const relationships = mapSupportingDocRelationships("001", "sk", []);
      expect(relationships).toHaveLength(0);
    });
  });

  describe("mapPlanToSpecRelationship", () => {
    it("should create implements relationship from plan to spec", () => {
      const relationship = mapPlanToSpecRelationship("001");

      expect(relationship).toEqual({
        fromId: "sk-001-plan",
        fromType: "spec",
        toId: "sk-001-spec",
        toType: "spec",
        relationshipType: "implements",
      });
    });

    it("should use custom prefix", () => {
      const relationship = mapPlanToSpecRelationship("001", "custom");

      expect(relationship.fromId).toBe("custom-001-plan");
      expect(relationship.toId).toBe("custom-001-spec");
    });
  });

  describe("mapTaskToPlanRelationship", () => {
    it("should create implements relationship from task to plan", () => {
      const relationship = mapTaskToPlanRelationship("001", "T001");

      expect(relationship).toEqual({
        fromId: "skt-001-T001",
        fromType: "issue",
        toId: "sk-001-plan",
        toType: "spec",
        relationshipType: "implements",
      });
    });

    it("should use custom prefixes", () => {
      const relationship = mapTaskToPlanRelationship(
        "001",
        "T001",
        "myspec",
        "mytask"
      );

      expect(relationship.fromId).toBe("mytask-001-T001");
      expect(relationship.toId).toBe("myspec-001-plan");
    });
  });

  describe("getStandardSupportingDocTypes", () => {
    it("should return standard supporting doc types", () => {
      const docs = getStandardSupportingDocTypes();

      expect(docs).toContainEqual({ fileType: "research", entityType: "spec" });
      expect(docs).toContainEqual({ fileType: "data-model", entityType: "spec" });
    });

    it("should return array with at least 2 items", () => {
      const docs = getStandardSupportingDocTypes();
      expect(docs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("createContractDocInfo", () => {
    it("should create contract doc info with prefixed file type", () => {
      const info = createContractDocInfo("api-spec");

      expect(info).toEqual({
        fileType: "contract-api-spec",
        entityType: "spec",
      });
    });

    it("should handle various contract names", () => {
      expect(createContractDocInfo("openapi").fileType).toBe("contract-openapi");
      expect(createContractDocInfo("schema").fileType).toBe("contract-schema");
      expect(createContractDocInfo("grpc-service").fileType).toBe("contract-grpc-service");
    });
  });

  describe("relationship graph integrity", () => {
    it("should create a valid dependency graph for a complete feature", () => {
      const tasks: TaskInfo[] = [
        { taskId: "T001" },
        { taskId: "T002", dependsOn: ["T001"] },
        { taskId: "T003", dependsOn: ["T001", "T002"] },
      ];

      const supportingDocs: SupportingDocInfo[] = [
        { fileType: "research", entityType: "spec" },
        { fileType: "data-model", entityType: "spec" },
        { fileType: "contract-api-spec", entityType: "spec" },
      ];

      const relationships = mapFeatureRelationships(
        "001",
        "sk",
        "skt",
        tasks,
        supportingDocs
      );

      // Expected relationships:
      // 1. plan implements spec (1)
      // 2. T001 implements plan (1)
      // 3. T002 implements plan (1)
      // 4. T003 implements plan (1)
      // 5. T002 depends-on T001 (1)
      // 6. T003 depends-on T001 (1)
      // 7. T003 depends-on T002 (1)
      // 8. research references plan (1)
      // 9. data-model references plan (1)
      // 10. contract-api-spec references plan (1)
      expect(relationships).toHaveLength(10);

      // Verify no circular dependencies in the basic structure
      const planImplementsSpec = relationships.filter(
        (r) => r.fromId === "sk-001-plan" && r.relationshipType === "implements"
      );
      expect(planImplementsSpec).toHaveLength(1);

      // All tasks should implement plan
      const taskImplementsPlan = relationships.filter(
        (r) =>
          r.fromType === "issue" &&
          r.toId === "sk-001-plan" &&
          r.relationshipType === "implements"
      );
      expect(taskImplementsPlan).toHaveLength(3);

      // All supporting docs should reference plan
      const docsReferencePlan = relationships.filter(
        (r) =>
          r.toId === "sk-001-plan" &&
          r.relationshipType === "references"
      );
      expect(docsReferencePlan).toHaveLength(3);
    });

    it("should maintain correct entity types throughout", () => {
      const tasks: TaskInfo[] = [{ taskId: "T001", dependsOn: [] }];
      const supportingDocs: SupportingDocInfo[] = [
        { fileType: "research", entityType: "spec" },
      ];

      const relationships = mapFeatureRelationships(
        "001",
        "sk",
        "skt",
        tasks,
        supportingDocs
      );

      for (const rel of relationships) {
        // All fromType and toType should be valid
        expect(["spec", "issue"]).toContain(rel.fromType);
        expect(["spec", "issue"]).toContain(rel.toType);

        // All relationship types should be valid
        expect([
          "implements",
          "references",
          "depends-on",
          "blocks",
          "related",
          "discovered-from",
        ]).toContain(rel.relationshipType);
      }
    });
  });
});
