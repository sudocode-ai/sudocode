/**
 * Agent learning and optimization through success metrics tracking
 */

import * as fs from "fs";
import * as path from "path";

export interface AgentMetrics {
  agent_id: string;

  // Execution statistics
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  cancelled_executions: number;

  // Performance metrics
  average_execution_time_ms: number;
  min_execution_time_ms: number;
  max_execution_time_ms: number;
  total_execution_time_ms: number;

  // Quality metrics
  success_rate: number; // 0-1
  average_quality_score?: number; // 0-1 if manual feedback provided
  user_satisfaction_score?: number; // 0-5 if user provides ratings

  // Issue resolution
  issues_resolved: number;
  issues_blocked: number;
  average_time_to_resolution_ms?: number;

  // Context efficiency
  average_context_tokens_used?: number;
  context_efficiency_score?: number; // Tokens used vs tokens available

  // Learning indicators
  improvement_trend: number; // -1 to 1, negative means declining performance
  last_30_days_success_rate?: number;

  // Timestamps
  first_execution_at?: string;
  last_execution_at?: string;
  last_updated_at: string;
}

export interface ExecutionRecord {
  execution_id: string;
  agent_id: string;
  workflow_id?: string;
  issue_id?: string;

  // Execution details
  started_at: string;
  completed_at?: string;
  duration_ms?: number;

  // Status and outcome
  status: "success" | "failure" | "cancelled";
  error_message?: string;
  error_type?: string;

  // Metrics
  context_tokens_used?: number;
  quality_score?: number; // 0-1, if available
  user_rating?: number; // 0-5, user satisfaction

  // Metadata
  tags?: string[];
  issue_type?: string;
  issue_priority?: number;
}

export interface MetricsDatabase {
  version: string;
  agent_metrics: Record<string, AgentMetrics>;
  execution_history: ExecutionRecord[];

  // Configuration
  max_history_records: number;
  retention_days: number;

  last_updated_at: string;
}

/**
 * Get metrics database path
 */
function getMetricsPath(sudocodeDir: string): string {
  return path.join(sudocodeDir, "agents", "metrics.json");
}

/**
 * Load metrics database
 */
export function loadMetrics(sudocodeDir: string): MetricsDatabase {
  const metricsPath = getMetricsPath(sudocodeDir);

  if (!fs.existsSync(metricsPath)) {
    return {
      version: "1.0.0",
      agent_metrics: {},
      execution_history: [],
      max_history_records: 1000,
      retention_days: 90,
      last_updated_at: new Date().toISOString(),
    };
  }

  return JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
}

/**
 * Save metrics database
 */
export function saveMetrics(sudocodeDir: string, metrics: MetricsDatabase): void {
  const metricsPath = getMetricsPath(sudocodeDir);
  const dir = path.dirname(metricsPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  metrics.last_updated_at = new Date().toISOString();

  // Cleanup old records
  cleanupOldRecords(metrics);

  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
}

/**
 * Cleanup old execution records
 */
function cleanupOldRecords(metrics: MetricsDatabase): void {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - metrics.retention_days);

  metrics.execution_history = metrics.execution_history.filter((record) => {
    const recordDate = new Date(record.started_at);
    return recordDate >= cutoffDate;
  });

  // Also limit total records
  if (metrics.execution_history.length > metrics.max_history_records) {
    metrics.execution_history = metrics.execution_history.slice(
      -metrics.max_history_records
    );
  }
}

/**
 * Record execution
 */
export function recordExecution(
  sudocodeDir: string,
  record: ExecutionRecord
): void {
  const metrics = loadMetrics(sudocodeDir);

  // Add to history
  metrics.execution_history.push(record);

  // Update agent metrics
  updateAgentMetrics(metrics, record);

  saveMetrics(sudocodeDir, metrics);
}

/**
 * Update agent metrics based on execution record
 */
function updateAgentMetrics(
  metrics: MetricsDatabase,
  record: ExecutionRecord
): void {
  let agentMetrics = metrics.agent_metrics[record.agent_id];

  if (!agentMetrics) {
    agentMetrics = {
      agent_id: record.agent_id,
      total_executions: 0,
      successful_executions: 0,
      failed_executions: 0,
      cancelled_executions: 0,
      average_execution_time_ms: 0,
      min_execution_time_ms: Infinity,
      max_execution_time_ms: 0,
      total_execution_time_ms: 0,
      success_rate: 0,
      issues_resolved: 0,
      issues_blocked: 0,
      improvement_trend: 0,
      first_execution_at: record.started_at,
      last_execution_at: record.started_at,
      last_updated_at: new Date().toISOString(),
    };
    metrics.agent_metrics[record.agent_id] = agentMetrics;
  }

  // Update counts
  agentMetrics.total_executions++;
  if (record.status === "success") {
    agentMetrics.successful_executions++;
    if (record.issue_id) {
      agentMetrics.issues_resolved++;
    }
  } else if (record.status === "failure") {
    agentMetrics.failed_executions++;
    if (record.issue_id) {
      agentMetrics.issues_blocked++;
    }
  } else if (record.status === "cancelled") {
    agentMetrics.cancelled_executions++;
  }

  // Update timing metrics
  if (record.duration_ms !== undefined) {
    agentMetrics.total_execution_time_ms += record.duration_ms;
    agentMetrics.average_execution_time_ms =
      agentMetrics.total_execution_time_ms / agentMetrics.total_executions;
    agentMetrics.min_execution_time_ms = Math.min(
      agentMetrics.min_execution_time_ms,
      record.duration_ms
    );
    agentMetrics.max_execution_time_ms = Math.max(
      agentMetrics.max_execution_time_ms,
      record.duration_ms
    );
  }

  // Update success rate
  agentMetrics.success_rate =
    agentMetrics.successful_executions / agentMetrics.total_executions;

  // Update quality scores
  if (record.quality_score !== undefined) {
    const prevAvg = agentMetrics.average_quality_score || 0;
    const count = agentMetrics.total_executions;
    agentMetrics.average_quality_score =
      (prevAvg * (count - 1) + record.quality_score) / count;
  }

  if (record.user_rating !== undefined) {
    const prevAvg = agentMetrics.user_satisfaction_score || 0;
    const count = agentMetrics.total_executions;
    agentMetrics.user_satisfaction_score =
      (prevAvg * (count - 1) + record.user_rating) / count;
  }

  // Update context efficiency
  if (record.context_tokens_used !== undefined) {
    const prevAvg = agentMetrics.average_context_tokens_used || 0;
    const count = agentMetrics.total_executions;
    agentMetrics.average_context_tokens_used =
      (prevAvg * (count - 1) + record.context_tokens_used) / count;
  }

  // Calculate improvement trend (last 30 days vs previous 30 days)
  agentMetrics.improvement_trend = calculateImprovementTrend(
    metrics.execution_history,
    record.agent_id
  );

  // Update last 30 days success rate
  agentMetrics.last_30_days_success_rate = calculateLast30DaysSuccessRate(
    metrics.execution_history,
    record.agent_id
  );

  // Update timestamps
  agentMetrics.last_execution_at = record.started_at;
  agentMetrics.last_updated_at = new Date().toISOString();
}

/**
 * Calculate improvement trend
 */
function calculateImprovementTrend(
  history: ExecutionRecord[],
  agentId: string
): number {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const agentHistory = history.filter((r) => r.agent_id === agentId);

  // Last 30 days
  const recent = agentHistory.filter(
    (r) => new Date(r.started_at) >= thirtyDaysAgo
  );
  const recentSuccessRate =
    recent.length > 0
      ? recent.filter((r) => r.status === "success").length / recent.length
      : 0;

  // Previous 30 days (30-60 days ago)
  const previous = agentHistory.filter((r) => {
    const date = new Date(r.started_at);
    return date >= sixtyDaysAgo && date < thirtyDaysAgo;
  });
  const previousSuccessRate =
    previous.length > 0
      ? previous.filter((r) => r.status === "success").length / previous.length
      : recentSuccessRate; // If no previous data, assume same

  return recentSuccessRate - previousSuccessRate;
}

/**
 * Calculate last 30 days success rate
 */
function calculateLast30DaysSuccessRate(
  history: ExecutionRecord[],
  agentId: string
): number {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recent = history.filter(
    (r) => r.agent_id === agentId && new Date(r.started_at) >= thirtyDaysAgo
  );

  if (recent.length === 0) {
    return 0;
  }

  return recent.filter((r) => r.status === "success").length / recent.length;
}

/**
 * Get agent metrics
 */
export function getAgentMetrics(
  sudocodeDir: string,
  agentId: string
): AgentMetrics | null {
  const metrics = loadMetrics(sudocodeDir);
  return metrics.agent_metrics[agentId] || null;
}

/**
 * Get all agent metrics
 */
export function getAllAgentMetrics(sudocodeDir: string): AgentMetrics[] {
  const metrics = loadMetrics(sudocodeDir);
  return Object.values(metrics.agent_metrics);
}

/**
 * Get top performing agents
 */
export function getTopPerformingAgents(
  sudocodeDir: string,
  limit: number = 10
): AgentMetrics[] {
  const allMetrics = getAllAgentMetrics(sudocodeDir);

  return allMetrics
    .filter((m) => m.total_executions >= 3) // Minimum executions for ranking
    .sort((a, b) => {
      // Combine success rate and improvement trend
      const scoreA =
        a.success_rate * 0.7 + (a.improvement_trend + 1) / 2 * 0.3;
      const scoreB =
        b.success_rate * 0.7 + (b.improvement_trend + 1) / 2 * 0.3;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

/**
 * Get execution history for an agent
 */
export function getExecutionHistory(
  sudocodeDir: string,
  agentId: string,
  options?: {
    limit?: number;
    status?: "success" | "failure" | "cancelled";
    since?: Date;
  }
): ExecutionRecord[] {
  const metrics = loadMetrics(sudocodeDir);

  let history = metrics.execution_history.filter((r) => r.agent_id === agentId);

  if (options?.status) {
    history = history.filter((r) => r.status === options.status);
  }

  if (options?.since) {
    history = history.filter((r) => new Date(r.started_at) >= options.since!);
  }

  if (options?.limit) {
    history = history.slice(-options.limit);
  }

  return history.reverse(); // Most recent first
}

/**
 * Get agent performance insights
 */
export function getPerformanceInsights(
  sudocodeDir: string,
  agentId: string
): {
  overall_health: "excellent" | "good" | "fair" | "poor";
  insights: string[];
  recommendations: string[];
} {
  const metrics = getAgentMetrics(sudocodeDir, agentId);

  if (!metrics) {
    return {
      overall_health: "poor",
      insights: ["No execution data available"],
      recommendations: ["Execute this agent to collect metrics"],
    };
  }

  const insights: string[] = [];
  const recommendations: string[] = [];

  // Analyze success rate
  if (metrics.success_rate >= 0.9) {
    insights.push(
      `Excellent success rate: ${(metrics.success_rate * 100).toFixed(1)}%`
    );
  } else if (metrics.success_rate >= 0.7) {
    insights.push(
      `Good success rate: ${(metrics.success_rate * 100).toFixed(1)}%`
    );
  } else {
    insights.push(
      `Low success rate: ${(metrics.success_rate * 100).toFixed(1)}%`
    );
    recommendations.push("Review failed executions to identify common issues");
  }

  // Analyze improvement trend
  if (metrics.improvement_trend > 0.1) {
    insights.push("Performance improving over time");
  } else if (metrics.improvement_trend < -0.1) {
    insights.push("Performance declining recently");
    recommendations.push("Review recent changes or consider agent reconfiguration");
  }

  // Analyze execution time
  if (metrics.average_execution_time_ms > 300000) {
    // > 5 minutes
    insights.push("Long average execution time");
    recommendations.push("Consider optimizing agent configuration or tools");
  }

  // Determine overall health
  let overall_health: "excellent" | "good" | "fair" | "poor";
  if (metrics.success_rate >= 0.9 && metrics.improvement_trend >= 0) {
    overall_health = "excellent";
  } else if (metrics.success_rate >= 0.7 && metrics.improvement_trend >= -0.1) {
    overall_health = "good";
  } else if (metrics.success_rate >= 0.5) {
    overall_health = "fair";
  } else {
    overall_health = "poor";
  }

  return {
    overall_health,
    insights,
    recommendations,
  };
}

/**
 * Export metrics to CSV
 */
export function exportMetricsToCSV(sudocodeDir: string, outputPath: string): void {
  const allMetrics = getAllAgentMetrics(sudocodeDir);

  const headers = [
    "agent_id",
    "total_executions",
    "success_rate",
    "average_execution_time_ms",
    "issues_resolved",
    "improvement_trend",
  ];

  const rows = allMetrics.map((m) => [
    m.agent_id,
    m.total_executions,
    m.success_rate.toFixed(3),
    m.average_execution_time_ms.toFixed(0),
    m.issues_resolved,
    m.improvement_trend.toFixed(3),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  fs.writeFileSync(outputPath, csv);
}
