/**
 * Metrics Service
 * Phase 6 Task 6: Track project agent performance metrics and statistics
 */

import type Database from "better-sqlite3";
import type { ProjectAgentAction } from "@sudocode-ai/types";

export interface ActionMetrics {
  total_actions: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  success_rate: number; // percentage
  average_confidence: number; // 0-100
  risk_distribution: {
    low: number;
    medium: number;
    high: number;
  };
}

export interface TimeMetrics {
  average_approval_time_seconds: number;
  average_execution_time_seconds: number;
  time_saved_hours: number; // Estimated time saved by automation
  actions_per_day: number;
}

export interface HealthMetrics {
  agent_uptime_seconds: number;
  events_processed_total: number;
  events_per_minute: number;
  cache_hit_rate: number;
  error_rate: number; // percentage of failed actions
  last_activity_ago_seconds: number;
}

export interface TrendData {
  timestamp: string;
  value: number;
}

export interface MetricsTrend {
  success_rate: TrendData[];
  actions_per_day: TrendData[];
  approval_rate: TrendData[];
}

export interface DashboardMetrics {
  period: {
    start: string;
    end: string;
  };
  actions: ActionMetrics;
  time: TimeMetrics;
  health: HealthMetrics;
  trends: MetricsTrend;
}

/**
 * Metrics Service
 * Tracks and calculates project agent performance metrics
 */
export class MetricsService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Get comprehensive dashboard metrics
   */
  async getDashboardMetrics(options?: {
    periodDays?: number;
  }): Promise<DashboardMetrics> {
    const periodDays = options?.periodDays ?? 7;
    const now = new Date();
    const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    const [actions, time, health, trends] = await Promise.all([
      this.getActionMetrics(startDate, now),
      this.getTimeMetrics(startDate, now),
      this.getHealthMetrics(),
      this.getMetricsTrends(startDate, now),
    ]);

    return {
      period: {
        start: startDate.toISOString(),
        end: now.toISOString(),
      },
      actions,
      time,
      health,
      trends,
    };
  }

  /**
   * Get action metrics
   */
  private async getActionMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<ActionMetrics> {
    // Get all actions in period
    const actions = this.db
      .prepare(
        `
      SELECT
        action_type,
        status,
        confidence_score,
        risk_level
      FROM project_agent_actions
      WHERE created_at >= ? AND created_at <= ?
    `
      )
      .all(startDate.toISOString(), endDate.toISOString()) as Array<{
      action_type: string;
      status: string;
      confidence_score: number | null;
      risk_level: string | null;
    }>;

    const total = actions.length;

    // Count by type
    const byType: Record<string, number> = {};
    for (const action of actions) {
      byType[action.action_type] = (byType[action.action_type] || 0) + 1;
    }

    // Count by status
    const byStatus: Record<string, number> = {};
    for (const action of actions) {
      byStatus[action.status] = (byStatus[action.status] || 0) + 1;
    }

    // Calculate success rate
    const completed = byStatus.completed || 0;
    const failed = byStatus.failed || 0;
    const successRate =
      completed + failed > 0
        ? Math.round((completed / (completed + failed)) * 100)
        : 0;

    // Calculate average confidence
    const confidenceScores = actions
      .map((a) => a.confidence_score)
      .filter((s): s is number => s !== null);
    const avgConfidence =
      confidenceScores.length > 0
        ? Math.round(
            confidenceScores.reduce((sum, s) => sum + s, 0) /
              confidenceScores.length
          )
        : 0;

    // Count risk distribution
    const riskDistribution = { low: 0, medium: 0, high: 0 };
    for (const action of actions) {
      if (action.risk_level === "low") riskDistribution.low++;
      else if (action.risk_level === "medium") riskDistribution.medium++;
      else if (action.risk_level === "high") riskDistribution.high++;
    }

    return {
      total_actions: total,
      by_type: byType,
      by_status: byStatus,
      success_rate: successRate,
      average_confidence: avgConfidence,
      risk_distribution: riskDistribution,
    };
  }

  /**
   * Get time metrics
   */
  private async getTimeMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<TimeMetrics> {
    // Get actions with timing data
    const actions = this.db
      .prepare(
        `
      SELECT
        created_at,
        approved_at,
        executed_at,
        completed_at,
        action_type
      FROM project_agent_actions
      WHERE created_at >= ? AND created_at <= ?
        AND status IN ('approved', 'completed')
    `
      )
      .all(startDate.toISOString(), endDate.toISOString()) as Array<{
      created_at: string;
      approved_at: string | null;
      executed_at: string | null;
      completed_at: string | null;
      action_type: string;
    }>;

    // Calculate average approval time
    const approvalTimes: number[] = [];
    for (const action of actions) {
      if (action.approved_at) {
        const created = new Date(action.created_at).getTime();
        const approved = new Date(action.approved_at).getTime();
        approvalTimes.push((approved - created) / 1000); // seconds
      }
    }

    const avgApprovalTime =
      approvalTimes.length > 0
        ? Math.round(
            approvalTimes.reduce((sum, t) => sum + t, 0) / approvalTimes.length
          )
        : 0;

    // Calculate average execution time
    const executionTimes: number[] = [];
    for (const action of actions) {
      if (action.executed_at && action.completed_at) {
        const executed = new Date(action.executed_at).getTime();
        const completed = new Date(action.completed_at).getTime();
        executionTimes.push((completed - executed) / 1000); // seconds
      }
    }

    const avgExecutionTime =
      executionTimes.length > 0
        ? Math.round(
            executionTimes.reduce((sum, t) => sum + t, 0) /
              executionTimes.length
          )
        : 0;

    // Estimate time saved
    // Assumptions:
    // - add_feedback: 2 min manual
    // - create_issues_from_spec: 30 min manual
    // - start_execution: 5 min manual
    // - pause_execution: 3 min manual
    // - etc.
    const timeSavedEstimates: Record<string, number> = {
      add_feedback: 2,
      create_issues_from_spec: 30,
      start_execution: 5,
      pause_execution: 3,
      resume_execution: 3,
      modify_spec: 15,
      create_relationship: 2,
      update_issue_status: 1,
    };

    let timeSavedMinutes = 0;
    for (const action of actions) {
      timeSavedMinutes += timeSavedEstimates[action.action_type] || 0;
    }

    const timeSavedHours = Math.round((timeSavedMinutes / 60) * 10) / 10;

    // Calculate actions per day
    const periodDays = Math.max(
      1,
      (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
    );
    const actionsPerDay = Math.round((actions.length / periodDays) * 10) / 10;

    return {
      average_approval_time_seconds: avgApprovalTime,
      average_execution_time_seconds: avgExecutionTime,
      time_saved_hours: timeSavedHours,
      actions_per_day: actionsPerDay,
    };
  }

  /**
   * Get health metrics
   */
  private async getHealthMetrics(): Promise<HealthMetrics> {
    // Get running project agent execution
    const execution = this.db
      .prepare(
        `
      SELECT
        started_at,
        last_activity_at,
        events_processed
      FROM project_agent_executions
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `
      )
      .get() as
      | {
          started_at: string;
          last_activity_at: string | null;
          events_processed: number;
        }
      | undefined;

    if (!execution) {
      return {
        agent_uptime_seconds: 0,
        events_processed_total: 0,
        events_per_minute: 0,
        cache_hit_rate: 0,
        error_rate: 0,
        last_activity_ago_seconds: 0,
      };
    }

    const now = Date.now();
    const startedAt = new Date(execution.started_at).getTime();
    const uptimeSeconds = Math.floor((now - startedAt) / 1000);

    const lastActivityAt = execution.last_activity_at
      ? new Date(execution.last_activity_at).getTime()
      : startedAt;
    const lastActivityAgoSeconds = Math.floor((now - lastActivityAt) / 1000);

    // Calculate events per minute
    const uptimeMinutes = Math.max(1, uptimeSeconds / 60);
    const eventsPerMinute = Math.round(
      (execution.events_processed / uptimeMinutes) * 10
    ) / 10;

    // Calculate error rate from recent actions
    const recentActions = this.db
      .prepare(
        `
      SELECT status
      FROM project_agent_actions
      WHERE created_at >= datetime('now', '-1 hour')
    `
      )
      .all() as Array<{ status: string }>;

    const failed = recentActions.filter((a) => a.status === "failed").length;
    const total = recentActions.length;
    const errorRate = total > 0 ? Math.round((failed / total) * 100) : 0;

    // Get cache hit rate (will be updated if cache service is available)
    let cacheHitRate = 0;
    try {
      const { getCacheManager } = await import("./cache-manager.js");
      const cache = getCacheManager();
      const stats = cache.getStats();
      cacheHitRate = stats.hit_rate;
    } catch (err) {
      // Cache manager not available
    }

    return {
      agent_uptime_seconds: uptimeSeconds,
      events_processed_total: execution.events_processed,
      events_per_minute: eventsPerMinute,
      cache_hit_rate: cacheHitRate,
      error_rate: errorRate,
      last_activity_ago_seconds: lastActivityAgoSeconds,
    };
  }

  /**
   * Get metrics trends over time
   */
  private async getMetricsTrends(
    startDate: Date,
    endDate: Date
  ): Promise<MetricsTrend> {
    // Get daily snapshots
    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    const successRateTrend: TrendData[] = [];
    const actionsPerDayTrend: TrendData[] = [];
    const approvalRateTrend: TrendData[] = [];

    for (const day of days) {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      // Get actions for this day
      const dayActions = this.db
        .prepare(
          `
        SELECT status
        FROM project_agent_actions
        WHERE created_at >= ? AND created_at <= ?
      `
        )
        .all(dayStart.toISOString(), dayEnd.toISOString()) as Array<{
        status: string;
      }>;

      // Success rate
      const completed = dayActions.filter((a) => a.status === "completed").length;
      const failed = dayActions.filter((a) => a.status === "failed").length;
      const successRate =
        completed + failed > 0 ? (completed / (completed + failed)) * 100 : 0;

      successRateTrend.push({
        timestamp: day.toISOString().split("T")[0],
        value: Math.round(successRate),
      });

      // Actions per day
      actionsPerDayTrend.push({
        timestamp: day.toISOString().split("T")[0],
        value: dayActions.length,
      });

      // Approval rate
      const approved = dayActions.filter(
        (a) => a.status === "approved" || a.status === "completed"
      ).length;
      const rejected = dayActions.filter((a) => a.status === "rejected").length;
      const approvalRate =
        approved + rejected > 0 ? (approved / (approved + rejected)) * 100 : 0;

      approvalRateTrend.push({
        timestamp: day.toISOString().split("T")[0],
        value: Math.round(approvalRate),
      });
    }

    return {
      success_rate: successRateTrend,
      actions_per_day: actionsPerDayTrend,
      approval_rate: approvalRateTrend,
    };
  }

  /**
   * Get action type breakdown for pie chart
   */
  async getActionTypeBreakdown(periodDays: number = 7): Promise<
    Array<{
      action_type: string;
      count: number;
      percentage: number;
    }>
  > {
    const startDate = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const results = this.db
      .prepare(
        `
      SELECT
        action_type,
        COUNT(*) as count
      FROM project_agent_actions
      WHERE created_at >= ?
      GROUP BY action_type
      ORDER BY count DESC
    `
      )
      .all(startDate) as Array<{ action_type: string; count: number }>;

    const total = results.reduce((sum, r) => sum + r.count, 0);

    return results.map((r) => ({
      action_type: r.action_type,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
    }));
  }

  /**
   * Get recent activity log
   */
  async getRecentActivity(limit: number = 20): Promise<
    Array<{
      timestamp: string;
      action_type: string;
      status: string;
      confidence_score: number | null;
      risk_level: string | null;
    }>
  > {
    return this.db
      .prepare(
        `
      SELECT
        created_at as timestamp,
        action_type,
        status,
        confidence_score,
        risk_level
      FROM project_agent_actions
      ORDER BY created_at DESC
      LIMIT ?
    `
      )
      .all(limit) as Array<{
      timestamp: string;
      action_type: string;
      status: string;
      confidence_score: number | null;
      risk_level: string | null;
    }>;
  }
}

/**
 * Get global metrics service instance
 */
let metricsService: MetricsService | null = null;

export function getMetricsService(db: Database.Database): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService(db);
  }
  return metricsService;
}
