/**
 * Tests for agent metrics and learning
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  recordExecution,
  getAgentMetrics,
  getAllAgentMetrics,
  getTopPerformingAgents,
  getExecutionHistory,
  getPerformanceInsights,
  exportMetricsToCSV,
  type ExecutionRecord,
} from "../../src/operations/agent-metrics.js";
import { initializeAgentsDirectory } from "../../src/operations/agents.js";

describe("Agent Metrics and Learning", () => {
  let testDir: string;
  let sudocodeDir: string;

  beforeEach(() => {
    const timestamp = Date.now();
    testDir = path.join("/tmp", `metrics-test-${timestamp}`);
    sudocodeDir = path.join(testDir, ".sudocode");
    fs.mkdirSync(testDir, { recursive: true });
    initializeAgentsDirectory(sudocodeDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("recordExecution", () => {
    it("should record successful execution", () => {
      const record: ExecutionRecord = {
        execution_id: "exec-1",
        agent_id: "test-agent",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        status: "success",
        issue_id: "ISSUE-001",
      };

      recordExecution(sudocodeDir, record);

      const metrics = getAgentMetrics(sudocodeDir, "test-agent");
      expect(metrics).toBeDefined();
      expect(metrics?.total_executions).toBe(1);
      expect(metrics?.successful_executions).toBe(1);
      expect(metrics?.success_rate).toBe(1.0);
    });

    it("should track multiple executions", () => {
      const records: ExecutionRecord[] = [
        {
          execution_id: "exec-1",
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          duration_ms: 1000,
          status: "success",
        },
        {
          execution_id: "exec-2",
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          duration_ms: 2000,
          status: "success",
        },
        {
          execution_id: "exec-3",
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          duration_ms: 1500,
          status: "failure",
        },
      ];

      records.forEach((r) => recordExecution(sudocodeDir, r));

      const metrics = getAgentMetrics(sudocodeDir, "test-agent");
      expect(metrics?.total_executions).toBe(3);
      expect(metrics?.successful_executions).toBe(2);
      expect(metrics?.failed_executions).toBe(1);
      expect(metrics?.success_rate).toBeCloseTo(2 / 3);
      expect(metrics?.average_execution_time_ms).toBeCloseTo(1500);
    });

    it("should track quality scores", () => {
      const record: ExecutionRecord = {
        execution_id: "exec-1",
        agent_id: "test-agent",
        started_at: new Date().toISOString(),
        status: "success",
        quality_score: 0.85,
        user_rating: 4,
      };

      recordExecution(sudocodeDir, record);

      const metrics = getAgentMetrics(sudocodeDir, "test-agent");
      expect(metrics?.average_quality_score).toBe(0.85);
      expect(metrics?.user_satisfaction_score).toBe(4);
    });
  });

  describe("getAllAgentMetrics", () => {
    it("should get all agent metrics", () => {
      recordExecution(sudocodeDir, {
        execution_id: "exec-1",
        agent_id: "agent1",
        started_at: new Date().toISOString(),
        status: "success",
      });

      recordExecution(sudocodeDir, {
        execution_id: "exec-2",
        agent_id: "agent2",
        started_at: new Date().toISOString(),
        status: "success",
      });

      const allMetrics = getAllAgentMetrics(sudocodeDir);
      expect(allMetrics.length).toBe(2);
      expect(allMetrics.map((m) => m.agent_id)).toContain("agent1");
      expect(allMetrics.map((m) => m.agent_id)).toContain("agent2");
    });
  });

  describe("getTopPerformingAgents", () => {
    it("should rank agents by performance", () => {
      // High performer
      for (let i = 0; i < 5; i++) {
        recordExecution(sudocodeDir, {
          execution_id: `high-${i}`,
          agent_id: "high-performer",
          started_at: new Date().toISOString(),
          status: "success",
        });
      }

      // Low performer
      for (let i = 0; i < 5; i++) {
        recordExecution(sudocodeDir, {
          execution_id: `low-${i}`,
          agent_id: "low-performer",
          started_at: new Date().toISOString(),
          status: i < 2 ? "success" : "failure",
        });
      }

      const topAgents = getTopPerformingAgents(sudocodeDir, 10);
      expect(topAgents.length).toBe(2);
      expect(topAgents[0].agent_id).toBe("high-performer");
      expect(topAgents[1].agent_id).toBe("low-performer");
    });
  });

  describe("getExecutionHistory", () => {
    it("should get execution history for agent", () => {
      const records: ExecutionRecord[] = [
        {
          execution_id: "exec-1",
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          status: "success",
        },
        {
          execution_id: "exec-2",
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          status: "failure",
        },
      ];

      records.forEach((r) => recordExecution(sudocodeDir, r));

      const history = getExecutionHistory(sudocodeDir, "test-agent");
      expect(history.length).toBe(2);
      expect(history[0].execution_id).toBe("exec-2"); // Most recent first
    });

    it("should filter by status", () => {
      recordExecution(sudocodeDir, {
        execution_id: "exec-1",
        agent_id: "test-agent",
        started_at: new Date().toISOString(),
        status: "success",
      });

      recordExecution(sudocodeDir, {
        execution_id: "exec-2",
        agent_id: "test-agent",
        started_at: new Date().toISOString(),
        status: "failure",
      });

      const successHistory = getExecutionHistory(sudocodeDir, "test-agent", {
        status: "success",
      });
      expect(successHistory.length).toBe(1);
      expect(successHistory[0].status).toBe("success");
    });

    it("should limit results", () => {
      for (let i = 0; i < 10; i++) {
        recordExecution(sudocodeDir, {
          execution_id: `exec-${i}`,
          agent_id: "test-agent",
          started_at: new Date().toISOString(),
          status: "success",
        });
      }

      const history = getExecutionHistory(sudocodeDir, "test-agent", {
        limit: 5,
      });
      expect(history.length).toBe(5);
    });
  });

  describe("getPerformanceInsights", () => {
    it("should provide insights for excellent performance", () => {
      for (let i = 0; i < 10; i++) {
        recordExecution(sudocodeDir, {
          execution_id: `exec-${i}`,
          agent_id: "excellent-agent",
          started_at: new Date().toISOString(),
          status: "success",
          duration_ms: 1000,
        });
      }

      const insights = getPerformanceInsights(sudocodeDir, "excellent-agent");
      expect(insights.overall_health).toBe("excellent");
      expect(insights.insights.length).toBeGreaterThan(0);
    });

    it("should provide recommendations for poor performance", () => {
      for (let i = 0; i < 10; i++) {
        recordExecution(sudocodeDir, {
          execution_id: `exec-${i}`,
          agent_id: "poor-agent",
          started_at: new Date().toISOString(),
          status: i < 3 ? "success" : "failure",
        });
      }

      const insights = getPerformanceInsights(sudocodeDir, "poor-agent");
      expect(insights.overall_health).toBe("poor");
      expect(insights.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("exportMetricsToCSV", () => {
    it("should export metrics to CSV", () => {
      recordExecution(sudocodeDir, {
        execution_id: "exec-1",
        agent_id: "test-agent",
        started_at: new Date().toISOString(),
        status: "success",
        duration_ms: 1000,
      });

      const csvPath = path.join(testDir, "metrics.csv");
      exportMetricsToCSV(sudocodeDir, csvPath);

      expect(fs.existsSync(csvPath)).toBe(true);

      const content = fs.readFileSync(csvPath, "utf-8");
      expect(content).toContain("agent_id");
      expect(content).toContain("success_rate");
      expect(content).toContain("test-agent");
    });
  });
});
