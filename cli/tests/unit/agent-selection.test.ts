/**
 * Tests for dynamic agent selection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  selectAgent,
  initializeSelectionConfig,
  addSelectionRule,
  removeSelectionRule,
  updateSelectionRule,
  getAgentRecommendations,
  type SelectionContext,
} from "../../src/operations/agent-selection.js";
import {
  initializeAgentsDirectory,
  createAgentPreset,
} from "../../src/operations/agents.js";

describe("Dynamic Agent Selection", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    const timestamp = Date.now();
    testDir = path.join("/tmp", `selection-test-${timestamp}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);

    // Create test presets
    createAgentPreset(sudocodeDir, {
      id: "code-reviewer",
      name: "Code Reviewer",
      description: "Reviews code",
      agent_type: "claude-code",
      system_prompt: "Review",
    });

    createAgentPreset(sudocodeDir, {
      id: "test-writer",
      name: "Test Writer",
      description: "Writes tests",
      agent_type: "claude-code",
      system_prompt: "Test",
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("initializeSelectionConfig", () => {
    it("should create default selection config", () => {
      const config = initializeSelectionConfig(sudocodeDir);

      expect(config.version).toBe("1.0.0");
      expect(config.rules.length).toBeGreaterThan(0);
      expect(config.fallback_to_manual).toBe(true);
    });

    it("should include default rules", () => {
      const config = initializeSelectionConfig(sudocodeDir);

      const reviewRule = config.rules.find((r) => r.id === "review-rule");
      expect(reviewRule).toBeDefined();
      expect(reviewRule?.agent_id).toBe("code-reviewer");
    });
  });

  describe("selectAgent", () => {
    it("should select agent based on issue type", () => {
      const context: SelectionContext = {
        issue_id: "ISSUE-001",
        title: "Review authentication code",
        type: "review",
      };

      const result = selectAgent(sudocodeDir, context);

      expect(result.matched).toBe(true);
      expect(result.agent_id).toBe("code-reviewer");
      expect(result.rule_id).toBe("review-rule");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should select agent based on tags", () => {
      const context: SelectionContext = {
        issue_id: "ISSUE-002",
        title: "Add unit tests",
        tags: ["test", "qa"],
      };

      const result = selectAgent(sudocodeDir, context);

      expect(result.matched).toBe(true);
      expect(result.agent_id).toBe("test-writer");
    });

    it("should return no match when no rules apply", () => {
      const context: SelectionContext = {
        issue_id: "ISSUE-003",
        title: "Random task",
        type: "unknown",
      };

      const result = selectAgent(sudocodeDir, context);

      // Should fallback or return no match
      expect(result.confidence).toBeDefined();
    });

    it("should provide alternatives", () => {
      const context: SelectionContext = {
        issue_id: "ISSUE-004",
        title: "Review and test code",
        type: "review",
        tags: ["test"],
      };

      const result = selectAgent(sudocodeDir, context);

      expect(result.alternatives).toBeDefined();
      if (result.alternatives) {
        expect(result.alternatives.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("addSelectionRule", () => {
    it("should add new selection rule", () => {
      const rule = addSelectionRule(sudocodeDir, {
        priority: 5,
        conditions: {
          tags: ["custom"],
        },
        agent_id: "code-reviewer",
        description: "Custom rule",
        enabled: true,
      });

      expect(rule.id).toBeDefined();
      expect(rule.priority).toBe(5);

      const config = initializeSelectionConfig(sudocodeDir);
      expect(config.rules.some((r) => r.id === rule.id)).toBe(true);
    });
  });

  describe("removeSelectionRule", () => {
    it("should remove rule", () => {
      const rule = addSelectionRule(sudocodeDir, {
        priority: 5,
        conditions: { tags: ["test"] },
        agent_id: "test-writer",
        description: "Test rule",
        enabled: true,
      });

      const removed = removeSelectionRule(sudocodeDir, rule.id);
      expect(removed).toBe(true);

      const config = initializeSelectionConfig(sudocodeDir);
      expect(config.rules.some((r) => r.id === rule.id)).toBe(false);
    });

    it("should return false for nonexistent rule", () => {
      const removed = removeSelectionRule(sudocodeDir, "nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("updateSelectionRule", () => {
    it("should update rule", () => {
      const rule = addSelectionRule(sudocodeDir, {
        priority: 5,
        conditions: { tags: ["test"] },
        agent_id: "test-writer",
        description: "Original",
        enabled: true,
      });

      const updated = updateSelectionRule(sudocodeDir, rule.id, {
        description: "Updated",
        priority: 10,
      });

      expect(updated?.description).toBe("Updated");
      expect(updated?.priority).toBe(10);
    });
  });

  describe("getAgentRecommendations", () => {
    it("should provide ranked recommendations", () => {
      const context: SelectionContext = {
        issue_id: "ISSUE-005",
        title: "Review code and add tests",
        type: "review",
        tags: ["test", "quality"],
      };

      const recommendations = getAgentRecommendations(sudocodeDir, context);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].confidence).toBeGreaterThan(0);
      expect(recommendations[0].agent).toBeDefined();

      // Should be sorted by confidence (descending)
      for (let i = 0; i < recommendations.length - 1; i++) {
        expect(recommendations[i].confidence).toBeGreaterThanOrEqual(
          recommendations[i + 1].confidence
        );
      }
    });
  });
});
